import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { EditorLiveWorkspace } from "../modules/editorLive/workspace.js";
import { createProject } from "../app/project.js";
import { createProjectServer } from "../app/server.js";
import { resolveModuleSelection } from "../app/moduleSelection.js";
import { projectToolRegistry } from "../app/toolServer.js";
import { compactResult, runMcpBatch } from "../app/mcpBatch.js";

test("editor-live profile exposes current-document tools without checkpoint import/export", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-editor-live-profile-"));
  const project = await createProject(root, {
    selection: resolveModuleSelection({ SC2_MCP_PROFILE: "editor-live" }),
  });
  const server = createProjectServer(project);
  try {
    const tools = projectToolRegistry(server).batchTools;
    const help = await runMcpBatch(
      [{ id: "help", tool: "modkit.author_help", args: { section: "live" } }],
      tools,
      {},
    );
    assert.equal(help.ok, true);
    const guide = help.steps[0].result as {
      section: string;
      examples: string[];
      limitations: string[];
    };
    assert.equal(guide.section, "live");
    assert.ok(guide.examples.some((line) => line.includes("live refresh.compile_finish")));
    assert.ok(guide.limitations.some((line) => line.includes("compile_pending")));
    for (const name of [
      "live.windows",
      "live.capabilities",
      "live.document.save",
      "live.data.author",
      "live.placement.move",
      "live.placement.delete",
      "live.placement.catalog",
      "live.placement.create",
      "live.trigger.prepare",
      "live.trigger.create",
      "live.trigger.income",
      "live.trigger.catalog",
      "live.data.append_xml",
      "live.trigger.apply",
      "live.ui.create",
      "live.ui.author",
      "live.text.author",
      "live.import.prepare",
      "live.import.apply",
      "live.import.verify",
      "live.trigger.configure",
      "live.trigger.append_condition",
      "live.trigger.append_configured",
      "live.refresh.prepare",
      "live.refresh.begin",
      "live.refresh.author",
      "live.refresh.resources",
      "live.refresh.compile_begin",
      "live.refresh.compile_finish",
      "live.refresh.compile_apply",
      "live.refresh.apply",
      "live.refresh.recover",
    ])
      assert.ok(tools.has(name), name);
    for (const name of [
      "live.connect",
      "live.publish",
      "live.pull",
      "live.call",
      "live.author",
      "editor.check",
      "game.call",
    ])
      assert.equal(tools.has(name), false, name);
    const cap = project.live.current.capabilities();
    assert.equal(cap.module, "editor-live");
    assert.equal(cap.apiVersion, "editor-live-2026-11-14-gui-nesting");
    const compactCapabilities = await runMcpBatch(
      [{ id: "cap", tool: "live.capabilities", args: {} }],
      tools,
      {},
    );
    const compact = compactCapabilities.steps[0].result as {
      apiVersion: string;
      unsupported: string[];
      refresh: { backend: string; reopensSamePath: boolean };
    };
    assert.equal(compact.apiVersion, cap.apiVersion);
    assert.ok(
      compact.unsupported.includes(
        "Direct regional terrain brush and general terrain component application",
      ),
    );
    assert.equal(compact.refresh.backend, "same_file_refresh");
    assert.equal(compact.refresh.reopensSamePath, true);
    const workflowCompact = compactResult({
      module: "live",
      apiVersion: cap.apiVersion,
      currentDocument: cap,
    }) as typeof compact;
    assert.equal(workflowCompact.apiVersion, cap.apiVersion);
    assert.ok(
      workflowCompact.unsupported.includes(
        "Direct regional terrain brush and general terrain component application",
      ),
    );
    assert.equal(workflowCompact.refresh.backend, "same_file_refresh");
    assert.equal(cap.copiesCreated, 0);
    assert.equal(cap.reopensMap, false);
  } finally {
    await server.close();
    await project.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("compact compile shortcuts route one snapshot through the native job and verified adoption", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-compile-route-"));
  const project = await createProject(root, {
    selection: resolveModuleSelection({ SC2_MCP_PROFILE: "editor-live" }),
  });
  const server = createProjectServer(project);
  const sessionId = "d1d044cb-c1c0-46a6-a243-0c1dbb44967a",
    jobId = "6e9ee78b-50e8-4eb6-8312-008a02d0c977";
  let submissions = 0,
    adoptions = 0;
  try {
    t.mock.method(
      project.live.current.refresh,
      "compileSnapshot",
      async () => ({ archive: "internal.SC2Map", sha256: "snapshot" }) as never,
    );
    t.mock.method(project.nativeEditor, "check", async () => {
      submissions++;
      return { id: jobId } as never;
    });
    t.mock.method(
      project.nativeEditor,
      "job",
      () => ({ state: "completed", result: { outcome: "passed" } }) as never,
    );
    t.mock.method(project.live.current.refresh, "adoptCompiled", async () => {
      adoptions++;
      return { nativeCompilePassed: true } as never;
    });
    t.mock.method(project.live.current.refresh, "isCompiledCurrent", async () => true);
    const registry = projectToolRegistry(server).batchTools;
    const call = async (name: string) => {
      const tool = registry.get(name)!;
      const raw = (await tool.invoke(tool.schema.parse({ sessionId }), {})) as {
        content: Array<{ text: string }>;
      };
      return JSON.parse(raw.content[0].text);
    };
    assert.equal((await call("live.refresh.compile_begin")).status, "compile_pending");
    assert.equal((await call("live.refresh.compile_begin")).jobId, jobId);
    assert.equal((await call("live.refresh.compile_finish")).nativeCompilePassed, true);
    assert.equal((await call("live.refresh.compile_finish")).status, "prepared");
    assert.equal(submissions, 1);
    assert.equal(adoptions, 1);
  } finally {
    await server.close();
    await project.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("compile_apply publishes only after a successful native compilation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-compile-apply-"));
  const project = await createProject(root, {
    selection: resolveModuleSelection({ SC2_MCP_PROFILE: "editor-live" }),
  });
  const server = createProjectServer(project),
    sessionId = "d1d044cb-c1c0-46a6-a243-0c1dbb44967a";
  let state = "running",
    applies = 0;
  try {
    t.mock.method(
      project.live.current.refresh,
      "compileSnapshot",
      async () => ({ archive: "internal.SC2Map", sha256: "snapshot" }) as never,
    );
    t.mock.method(project.nativeEditor, "check", async () => ({ id: "job" }) as never);
    t.mock.method(
      project.nativeEditor,
      "job",
      () => ({ state, result: { outcome: "passed" } }) as never,
    );
    t.mock.method(project.live.current.refresh, "adoptCompiled", async () => ({}) as never);
    t.mock.method(project.live.current.refresh, "apply", async () => {
      applies++;
      return { status: "refreshed", reopensSamePath: true } as never;
    });
    const registry = projectToolRegistry(server).batchTools;
    const call = async (name: string, args: Record<string, unknown>) => {
      const tool = registry.get(name)!;
      const raw = (await tool.invoke(tool.schema.parse(args), {})) as {
        content: Array<{ text: string }>;
      };
      return JSON.parse(raw.content[0].text);
    };
    await call("live.refresh.compile_begin", { sessionId });
    assert.equal(
      (await call("live.refresh.compile_apply", { sessionId, waitMs: 0 })).status,
      "compile_pending",
    );
    assert.equal(applies, 0);
    state = "completed";
    const saved = await call("live.refresh.compile_apply", { sessionId, waitMs: 0 });
    assert.equal(saved.status, "refreshed");
    assert.equal(saved.reopensSamePath, true);
    assert.equal(saved.nativeCompilePassed, true);
    assert.equal(applies, 1);
    const failedSession = "b58ef082-d58f-4b35-afc8-634d8c2996a6";
    state = "failed";
    await call("live.refresh.compile_begin", { sessionId: failedSession });
    assert.equal(
      (await call("live.refresh.compile_apply", { sessionId: failedSession, waitMs: 0 })).status,
      "compile_failed",
    );
    assert.equal(applies, 1);
  } finally {
    await server.close();
    await project.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("current-document module blocks overlapping backends and checkpoint ownership", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-editor-live-lock-"));
  let checkpoint = false;
  const live = new EditorLiveWorkspace(
    new Workspace(root),
    () => undefined,
    () => checkpoint,
  );
  const target = { archive: "User.SC2Map", windowId: "1" };
  try {
    live.data.busy = true;
    await assert.rejects(live.placement.inspect(target), /WORKFLOW_BUSY/);
    live.data.busy = false;
    live.triggers.busy = true;
    await assert.rejects(live.placement.inspect(target), /WORKFLOW_BUSY/);
    await assert.rejects(live.data.read({ ...target, unit: "Marine" }), /WORKFLOW_BUSY/);
    await assert.rejects(
      live.document.save({ ...target, expectedSha256: "a".repeat(64) }),
      /WORKFLOW_BUSY/,
    );
    live.triggers.busy = false;
    live.ui.busy = true;
    await assert.rejects(live.placement.inspect(target), /WORKFLOW_BUSY/);
    await assert.rejects(live.triggers.inspect(target), /WORKFLOW_BUSY/);
    live.ui.busy = false;
    live.text.busy = true;
    await assert.rejects(live.ui.read({ ...target, layout: "Local" }), /WORKFLOW_BUSY/);
    live.text.busy = false;
    live.imports.busy = true;
    await assert.rejects(live.ui.read({ ...target, layout: "Local" }), /WORKFLOW_BUSY/);
    live.imports.busy = false;
    live.refresh.busy = true;
    await assert.rejects(live.placement.inspect(target), /WORKFLOW_BUSY/);
    live.refresh.busy = false;
    checkpoint = true;
    await assert.rejects(live.placement.inspect(target), /WORKFLOW_BUSY/);
    assert.equal(live.capabilities().fallback.includes("no checkpoint"), true);
  } finally {
    live.data.busy = false;
    live.triggers.busy = false;
    live.ui.busy = false;
    live.text.busy = false;
    await live.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a background placement job blocks other live edits until it stops", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-editor-live-job-lock-"));
  const live = new EditorLiveWorkspace(new Workspace(root), () => undefined);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  live.placement.prepare = async () => {
    await barrier;
    return {} as never;
  };
  try {
    const job = live.placementJobs.start({
      archive: "User.SC2Map",
      windowId: "1",
      objects: [{ type: "Lamp", x: 1, y: 1 }],
    });
    assert.equal(live.busy, true);
    await assert.rejects(
      live.document.save({ archive: "User.SC2Map", windowId: "1", expectedSha256: "a".repeat(64) }),
      /WORKFLOW_BUSY/,
    );
    live.placementJobs.cancel(job.jobId);
    release();
    await live.close();
    assert.equal(live.placementJobs.status(job.jobId).status, "cancelled");
  } finally {
    release();
    await live.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("current-document close disposes every backend once even if one disposal fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-editor-live-close-"));
  const live = new EditorLiveWorkspace(new Workspace(root), () => undefined);
  const closed: string[] = [];
  for (const name of [
    "memory",
    "document",
    "placement",
    "data",
    "triggers",
    "ui",
    "text",
    "imports",
    "refresh",
  ] as const)
    live[name].close = async () => {
      closed.push(name);
      if (name === "memory") throw Error("failed close");
    };
  try {
    const first = live.close();
    assert.equal(live.close(), first);
    await assert.rejects(first, /EDITOR_LIVE_CLOSE_FAILED/);
    assert.deepEqual(closed.sort(), [
      "data",
      "document",
      "imports",
      "memory",
      "placement",
      "refresh",
      "text",
      "triggers",
      "ui",
    ]);
    await assert.rejects(
      live.placement.inspect({ archive: "User.SC2Map", windowId: "1" }),
      /WORKFLOW_BUSY/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("refresh detailed calls forward original MCP errors and image blocks without double encoding", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-result-")),
    project = await createProject(root, {
      selection: resolveModuleSelection({ SC2_MCP_PROFILE: "editor-live" }),
    }),
    server = createProjectServer(project);
  try {
    const tool = projectToolRegistry(server).batchTools.get("live.refresh.call")!;
    project.live.current.refresh.call = async () => ({
      isError: true,
      content: [{ type: "text", text: '{"error":"original failure"}' }],
    });
    const args = tool.schema.parse({
        sessionId: "00000000-0000-4000-8000-000000000001",
        tool: "text.apply",
        args: {},
      }),
      error = (await tool.invoke(args, {})) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
    assert.equal(error.isError, true);
    assert.equal(error.content[0].text, '{"error":"original failure"}');
    project.live.current.refresh.call = async () => ({
      content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
    });
    const image = (await tool.invoke(args, {})) as { content: Array<{ type: string }> };
    assert.equal(image.content[0].type, "image");
  } finally {
    await server.close();
    await project.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("compact authoring returns the live session handle and stops after an uncertain Save", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-compact-")),
    project = await createProject(root, {
      selection: resolveModuleSelection({ SC2_MCP_PROFILE: "workflow" }),
    }),
    server = createProjectServer(project);
  try {
    let unknown = false,
      laterCalls = 0,
      authored = 0,
      applied = 0;
    t.mock.method(
      project.live.current,
      "beginRefresh",
      async () =>
        (unknown
          ? {
              status: "save_unconfirmed",
              retryMutation: false,
              recovery: "Inspect the same document",
            }
          : {
              status: "prepared",
              sessionId: "d1d044cb-c1c0-46a6-a243-0c1dbb44967a",
              saveAttempted: true,
              save: { status: "saved", saved: true, sha256: "a".repeat(64) },
            }) as unknown as Awaited<ReturnType<typeof project.live.current.beginRefresh>>,
    );
    t.mock.method(project.live.current.document, "status", async () => {
      laterCalls++;
      throw Error("A later command must not execute");
    });
    t.mock.method(
      project.live.current.refresh,
      "author",
      async (args: { sessionId: string; script: string }) => {
        authored++;
        assert.equal(args.sessionId, "d1d044cb-c1c0-46a6-a243-0c1dbb44967a");
        assert.equal(
          args.script,
          'text set key=Mission/Title value="Ready"\nsettings player.set id=1 color=2',
        );
        return { ok: true };
      },
    );
    t.mock.method(project.live.current.refresh, "apply", async (args: { sessionId: string }) => {
      applied++;
      assert.equal(args.sessionId, "d1d044cb-c1c0-46a6-a243-0c1dbb44967a");
      return { status: "refreshed" } as unknown as Awaited<
        ReturnType<typeof project.live.current.refresh.apply>
      >;
    });
    const tool = projectToolRegistry(server).batchTools.get("modkit.author")!;
    const begin =
      "live refresh.begin archive=Current.SC2Map windowId=123 mode=same_file_refresh saveIfDirty=true";
    const invoke = async (script: string) => {
      const raw = (await tool.invoke(tool.schema.parse({ script, mode: "stage" }), {})) as {
        content: Array<{ text: string }>;
      };
      return JSON.parse(raw.content[0].text);
    };
    const success = await invoke(begin);
    assert.equal(success.steps[0].result.sessionId, "d1d044cb-c1c0-46a6-a243-0c1dbb44967a");
    assert.equal(success.steps[0].result.save.status, "saved");
    const batch = [
      begin,
      "live refresh.author sessionId=@s1.sessionId <<EDITS",
      'text set key=Mission/Title value="Ready"',
      "settings player.set id=1 color=2",
      "EDITS",
      "live refresh.apply sessionId=@s1.sessionId",
    ].join("\n");
    const complete = await invoke(batch);
    assert.equal(complete.ok, true);
    assert.equal(authored, 1);
    assert.equal(applied, 1);
    unknown = true;
    const stopped = await invoke(
      batch + "\nlive document.status archive=Current.SC2Map windowId=123",
    );
    assert.equal(stopped.ok, false);
    assert.equal(stopped.steps[0].result.status, "save_unconfirmed");
    assert.equal(stopped.steps[0].result.retryMutation, false);
    assert.equal(laterCalls, 0);
    assert.equal(authored, 1);
    assert.equal(applied, 1);
  } finally {
    await server.close();
    await project.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
