import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveWorkspace, type LiveRuntime } from "../modules/live/workspace.js";
import { documentMatches, type EditorWindow } from "../modules/live/desktop.js";
import { compileAuthorScript } from "../app/authoringScript.js";

const response = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
test("SC2-abbreviated paths require the correct drive and multi-directory suffix", () => {
  const window: EditorWindow = {
    windowId: "1",
    processId: 2,
    processStart: "3",
    enabled: true,
    acceptsFiles: true,
    title: "Terrain - [K:/.../Maps/Live/Visible_Source.SC2Map] - StarCraft II Editor",
  };
  assert.equal(documentMatches(window, "K:/Workspace/Maps/Live/Visible_Source.SC2Map"), true);
  assert.equal(documentMatches(window, "L:/Workspace/Maps/Live/Visible_Source.SC2Map"), false);
  assert.equal(
    documentMatches(
      { ...window, title: "Terrain - [K:/.../Visible_Source.SC2Map] - StarCraft II Editor" },
      "K:/Workspace/Maps/Live/Visible_Source.SC2Map",
    ),
    false,
  );
  assert.equal(
    documentMatches(
      { ...window, title: window.title.replace("]", "*]") },
      "K:/Workspace/Maps/Live/Visible_Source.SC2Map",
    ),
    true,
  );
});

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "User Map.SC2Map");
  await fs.writeFile(source, "original map");
  const state = {
    windows: [
      {
        windowId: "123",
        processId: 77,
        processStart: "100000",
        title: `Terrain - [${source}] - StarCraft II Editor`,
        enabled: true,
        acceptsFiles: true,
      },
    ] as EditorWindow[],
    delivered: [] as string[],
    throws: false,
    exports: 0,
    closed: 0,
    exportHook: undefined as (() => Promise<void>) | undefined,
    callHook: undefined as (() => Promise<void>) | undefined,
  };
  const runtimes: LiveRuntime[] = [];
  const unpack = async (_file: string, target: string) => {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "ComponentList.SC2Components"), "<Components/>");
  };
  const live = new LiveWorkspace(
    new Workspace(root),
    {
      windows: async () => structuredClone(state.windows),
      present: async (_window, archive) => {
        state.delivered.push(archive);
        if (state.throws) throw Error("transport lost after possible delivery");
        return { status: "open_requested" };
      },
    },
    unpack,
  );
  live.runtimeFactory = async (directory) => {
    const workspace = new Workspace(directory);
    const runtime: LiveRuntime = {
      workspace,
      call: async (tool, args) => {
        await state.callHook?.();
        if (args.mode !== "plan")
          await fs.writeFile(path.join(directory, "Data.xml"), String(args.script ?? tool));
        return response({ ok: true, tool });
      },
      export: async (archive) => {
        state.exports++;
        if (workspace.draftFiles().length || workspace.binary.draftFiles().length)
          throw Error("MAP_DRAFTS_PENDING");
        await fs.mkdir(path.dirname(archive), { recursive: true });
        await fs.writeFile(archive, "updated " + state.exports, { flag: "wx" });
        await state.exportHook?.();
        return { verified: true };
      },
      close: async () => {
        state.closed++;
      },
    };
    runtimes.push(runtime);
    return runtime;
  };
  t.after(() => live.close());
  return {
    root,
    source,
    state,
    live,
    runtimes,
    window: state.windows[0],
    open: (archive: string) => {
      state.windows[0].title = `Terrain - [${archive}] - StarCraft II Editor`;
    },
  };
}

test("live binding requires the exact clean visible document and rejects duplicate ownership", async (t) => {
  const f = await fixture(t);
  f.window.title = f.window.title.replace("]", "*]");
  await assert.rejects(f.live.connect(f.source), /LIVE_SAVE_REQUIRED/);
  f.open(f.source);
  f.window.enabled = false;
  await assert.rejects(f.live.connect(f.source), /LIVE_EDITOR_DIALOG_OPEN/);
  f.window.enabled = true;
  const s = await f.live.connect(f.source, "123");
  await assert.rejects(f.live.connect(f.source), /LIVE_WINDOW_ALREADY_BOUND/);
  assert.equal(s.sourceArchive, f.source);
  assert.equal(
    documentMatches({ ...f.window, title: "Terrain - [User Map.SC2Map]" }, f.source),
    false,
  );
  assert.equal(await fs.readFile(f.source, "utf8"), "original map");
});

test("connectivity inspection accepts dirty documents without importing a checkpoint", async (t) => {
  const f = await fixture(t);
  f.window.title = f.window.title.replace("]", "*]");
  const windows = await f.live.windows();
  assert.match(windows[0].title, /\*\]/);
  const routes = f.live.capabilities().routing;
  assert.equal(routes.connectivityTest.requiresSave, false);
  assert.equal(routes.connectivityTest.requiresConnect, false);
  assert.equal(routes.memory.requiresConnect, false);
  assert.equal(routes.memory.permitsUnsavedValues, true);
  assert.equal(routes.checkpoint.requiresSavedDocument, true);
  assert.equal(f.runtimes.length, 0);
  assert.equal(await fs.readFile(f.source, "utf8"), "original map");
});

test("compact plan mode cannot accidentally publish or present a visible checkpoint", () => {
  for (const verb of ["connect", "publish", "present", "pull", "disconnect"])
    assert.throws(
      () => compileAuthorScript(`live ${verb} sessionId=x`, "plan"),
      /AUTHOR_LIVE_REQUIRES_STAGE/,
    );
  assert.equal(compileAuthorScript("live windows", "plan")[0].tool, "live.windows");
  assert.equal(
    compileAuthorScript("live publish sessionId=x present=true", "stage")[0].tool,
    "live.publish",
  );
});

test("checkpoint handoff is once-only and is not reported as native application before document observation", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  await f.live.call(s.sessionId, "modkit.author", { script: "new hero", mode: "save" });
  const receipt = await f.live.publish(s.sessionId, true);
  assert.equal(receipt.directlyAppliedInMemory, false);
  assert.ok(path.basename(receipt.archive).includes(s.sessionId.slice(0, 8)));
  assert.equal(receipt.handoff?.status, "open_requested");
  assert.equal(f.state.delivered.length, 1);
  assert.equal((await f.live.status(s.sessionId)).checkpoint?.presentation, "requested");
  await f.live.present(s.sessionId);
  assert.equal(f.state.delivered.length, 1);
  await assert.rejects(f.live.call(s.sessionId, "data.peek", {}), /AWAITING_EDITOR/);
  await assert.rejects(f.live.pull(s.sessionId), /AWAITING_EDITOR/);
  f.open(receipt.archive);
  assert.equal((await f.live.status(s.sessionId)).checkpoint?.presentation, "observed");
  await f.live.call(s.sessionId, "modkit.author", {
    mode: "plan",
    script: "data find text=Marine",
  });
  assert.equal(await fs.readFile(f.source, "utf8"), "original map");
});

test("dirty modal and foreign documents prevent authoring and cannot be silently saved or closed", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  f.window.title = f.window.title.replace("]", "*]");
  await assert.rejects(
    f.live.call(s.sessionId, "modkit.author", { mode: "save" }),
    /LIVE_SAVE_REQUIRED/,
  );
  f.open(f.source);
  f.window.enabled = false;
  await assert.rejects(f.live.publish(s.sessionId), /LIVE_EDITOR_DIALOG_OPEN/);
  f.window.enabled = true;
  f.open(path.join(f.root, "Other.SC2Map"));
  await assert.rejects(f.live.call(s.sessionId, "data.peek", {}), /LIVE_DOCUMENT_CHANGED/);
  assert.equal(f.state.exports, 0);
  assert.deepEqual(f.state.delivered, []);
});

test("window and process identity are pinned across requests, including HWND reuse", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  f.window.processStart = "100001";
  await assert.rejects(f.live.status(s.sessionId), /LIVE_EDITOR_SESSION_CHANGED/);
  await assert.rejects(f.live.publish(s.sessionId), /LIVE_EDITOR_SESSION_CHANGED/);
});

test("new Editor saves require explicit pull and pending MCP edits refuse destructive reimport", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  await f.live.call(s.sessionId, "modkit.author", { script: "private edit", mode: "save" });
  await fs.writeFile(f.source, "user saved concurrently");
  await assert.rejects(f.live.publish(s.sessionId, true), /LIVE_EDITOR_SAVE_CHANGED/);
  await assert.rejects(f.live.pull(s.sessionId), /LIVE_LOCAL_CHANGES_CONFLICT/);
  assert.equal(await fs.readFile(path.join(s.authoringRoot, "Data.xml"), "utf8"), "private edit");
  assert.equal(await fs.readFile(f.source, "utf8"), "user saved concurrently");
});

test("clean pull imports a saved version into a new project and disposes the old project", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  await fs.writeFile(f.source, "user saved");
  assert.equal((await f.live.status(s.sessionId)).sourceChanged, true);
  assert.equal((await f.live.pull(s.sessionId)).imported, true);
  assert.equal(f.state.closed, 1);
  assert.notEqual((await f.live.status(s.sessionId)).authoringRoot, s.authoringRoot);
});

test("saving an observed checkpoint can be pulled without pretending old archive hashes still match", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source),
    checkpoint = await f.live.publish(s.sessionId);
  f.open(checkpoint.archive);
  await f.live.status(s.sessionId);
  await fs.writeFile(checkpoint.archive, "native saved changes");
  assert.equal((await f.live.status(s.sessionId)).sourceChanged, true);
  assert.equal((await f.live.pull(s.sessionId)).imported, true);
  assert.equal(await fs.readFile(f.source, "utf8"), "original map");
});

test("unknown handoff outcomes never replay the same native mutation", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  await f.live.publish(s.sessionId);
  f.state.throws = true;
  await assert.rejects(f.live.present(s.sessionId), /transport lost/);
  assert.equal((await f.live.present(s.sessionId)).status, "awaiting_editor_no_retry");
  assert.equal(f.state.delivered.length, 1);
});

test("unsupported file drop returns a manual-open checkpoint and no fake success", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  f.window.acceptsFiles = false;
  const published = await f.live.publish(s.sessionId, true);
  assert.equal(published.handoff?.status, "manual_open_required");
  assert.equal(published.handoff?.submitted, false);
  assert.deepEqual(f.state.delivered, []);
});

test("a save during export prevents handoff and preserves both files", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  f.state.exportHook = () => fs.writeFile(f.source, "saved during export");
  await assert.rejects(f.live.publish(s.sessionId, true), /LIVE_EDITOR_SAVE_CHANGED/);
  assert.deepEqual(f.state.delivered, []);
  assert.equal(await fs.readFile(f.source, "utf8"), "saved during export");
});

test("live sessions refuse native worker tools and preserve staged transaction guards", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source),
    runtime = f.runtimes[0];
  await assert.rejects(f.live.call(s.sessionId, "editor.check", {}), /LIVE_TOOL_NOT_ALLOWED/);
  await assert.rejects(
    f.live.call(s.sessionId, "map.minimap.rebuild", {}),
    /LIVE_NATIVE_WORKER_NOT_ALLOWED/,
  );
  await assert.rejects(f.live.call(s.sessionId, "modkit.batch", {}), /LIVE_TOOL_NOT_ALLOWED/);
  await runtime.workspace.applyRawTransaction(
    ["Draft.xml"],
    () => new Map([["Draft.xml", "<Draft/>"]]),
    { dryRun: false, stage: true },
  );
  await assert.rejects(f.live.publish(s.sessionId), /MAP_DRAFTS_PENDING/);
  await assert.rejects(f.live.disconnect(s.sessionId), /LIVE_PENDING_DRAFTS/);
  assert.deepEqual(f.state.delivered, []);
});

test("disconnect retains user/checkpoint files and shutdown drains an in-flight operation", async (t) => {
  const f = await fixture(t),
    s = await f.live.connect(f.source);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.state.callHook = async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const running = f.live.call(s.sessionId, "modkit.author", { mode: "save", script: "done" });
  await ready;
  await assert.rejects(f.live.publish(s.sessionId), /LIVE_SESSION_BUSY/);
  const closing = f.live.close();
  assert.equal(f.state.closed, 0);
  release();
  await running;
  await closing;
  assert.equal(f.state.closed, 1);
  assert.equal(await fs.readFile(f.source, "utf8"), "original map");
});
