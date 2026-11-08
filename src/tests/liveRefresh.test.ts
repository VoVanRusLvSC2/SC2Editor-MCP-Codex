import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../core/workspace.js";
import { LiveRefresh } from "../modules/editorLive/refresh.js";
import { refreshAuthoringAllowed } from "../modules/editorLive/refreshPolicy.js";
import { liveDigest } from "../modules/editorLive/identity.js";
import {
  readCompiledAttestation,
  writeCompiledAttestation,
} from "../modules/editorLive/refreshProject.js";
import type { RefreshDesktop } from "../modules/editorLive/refreshTransfer.js";
import type { LiveRuntimeFactory } from "../modules/editorLive/runtime.js";

function pendingId(value: object) {
  assert.ok("pendingId" in value && typeof value.pendingId === "string");
  return value.pendingId;
}
let serial = 0;
test("compiled attestation survives restart and incomplete newest records fail closed", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-attestation-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const record = {
    sessionId: "2e533021-67b5-42ee-a1a4-7b906e94dc37",
    sourceSha256: "a".repeat(64),
    manifest: "[]",
    runtimeSha256: "b".repeat(64),
  };
  await writeCompiledAttestation(dir, record);
  assert.deepEqual(
    await readCompiledAttestation(dir, record.sessionId, record.sourceSha256),
    record,
  );
  await writeCompiledAttestation(dir, { ...record, runtimeSha256: "c".repeat(64) });
  assert.equal(
    (await readCompiledAttestation(dir, record.sessionId, record.sourceSha256))?.runtimeSha256,
    "c".repeat(64),
  );
  await fs.writeFile(path.join(dir, "CompiledAttestation-000003.json"), "{");
  await assert.rejects(readCompiledAttestation(dir, record.sessionId, record.sourceSha256));
});
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-")),
    archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "original archive");
  const w = {
    windowId: "47",
    processId: 999990,
    processStart: String(Date.now()) + ++serial,
    title: `Terrain - [${archive}] - StarCraft II Editor`,
    enabled: true,
    acceptsFiles: true,
  };
  const state = {
    ready: true,
    documents: 1,
    fingerprint: "original",
    closes: 0,
    opens: 0,
    loseClose: false,
    loseOpen: false,
    exportFailure: false,
    omitExportedComponent: false,
    mutateDuringExport: false,
    staged: false,
    otherDocument: false,
    componentDirectory: "",
    cleanupFailure: false,
    includeGui: false,
    afterOpen: undefined as (() => Promise<void>) | undefined,
  };
  const desktop: RefreshDesktop = {
    windows: async () => [w],
    window: async () => w,
    command: async (_w, op, args = {}) => {
      if (op === 25)
        return {
          refreshReady: state.ready && state.documents === 1,
          refreshFingerprint: state.fingerprint,
          dialogs: [],
          openDocuments: state.documents,
        };
      if (op === 26) {
        assert.equal(args.expected, state.fingerprint);
        assert.equal(state.ready, true);
        state.closes++;
        w.title = state.otherDocument
          ? "Terrain - [Other.SC2Map] - StarCraft II Editor"
          : "Terrain - StarCraft II Editor";
        if (state.loseClose) throw Error("Lost close acknowledgement");
        return { closeRequested: true };
      }
      throw Error("Unexpected native command " + op);
    },
    present: async () => {
      state.opens++;
      if (state.loseOpen) throw Error("Lost open acknowledgement");
      w.title = `Terrain - [${archive}] - StarCraft II Editor`;
      await state.afterOpen?.();
      return { status: "open_requested" };
    },
  };
  const factory: LiveRuntimeFactory = async (components) => {
    state.componentDirectory = components;
    const workspace = new Workspace(components);
    workspace.draftFiles = () => (state.staged ? ["Payload.txt"] : []);
    return {
      workspace,
      close: async () => {
        if (state.cleanupFailure) throw Error("Child cleanup failed");
      },
      call: async (_name, args) => {
        await fs.writeFile(path.join(components, "Payload.txt"), String(args.value));
        return { saved: true };
      },
      author: async (script) => {
        await fs.writeFile(path.join(components, "Payload.txt"), script);
        return { ok: true };
      },
      export: async (candidate) => {
        if (state.exportFailure) throw Error("Invalid prepared package");
        const payload = await fs.readFile(path.join(components, "Payload.txt"));
        await fs.mkdir(path.dirname(candidate), { recursive: true });
        await fs.writeFile(candidate, Buffer.concat([Buffer.from("verified package:"), payload]));
        const hashes: Record<string, string> = { "Payload.txt": liveDigest(payload) };
        for (const file of ["Triggers", "MapScript.galaxy"]) {
          try {
            hashes[file] = liveDigest(await fs.readFile(path.join(components, file)));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        if (!state.omitExportedComponent) {
          try {
            hashes["Assets/kept.txt"] = liveDigest(
              await fs.readFile(path.join(components, "Assets/kept.txt")),
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        if (state.mutateDuringExport)
          await fs.writeFile(path.join(components, "Assets/kept.txt"), "concurrent user edit");
        return { verification: { reopened: true, contentSha256: hashes } };
      },
    };
  };
  const unpack = async (_source: string, destination: string) => {
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, "Payload.txt"), "original payload");
    await fs.mkdir(path.join(destination, "Assets"));
    await fs.writeFile(path.join(destination, "Assets/kept.txt"), "existing map resource");
    if (state.includeGui) {
      await fs.writeFile(path.join(destination, "Triggers"), "original GUI graph");
      await fs.writeFile(path.join(destination, "MapScript.galaxy"), "original runtime");
    }
  };
  const create = () =>
      new LiveRefresh(
        new Workspace(root),
        () => factory,
        desktop,
        undefined,
        unpack,
        async () => {},
      ),
    live = create();
  t.after(async () => {
    await live.close();
    const file = path.join(
      os.tmpdir(),
      "SC2EditorToolkit-live-memory",
      "pending-refresh",
      liveDigest(
        JSON.stringify([w.processId, w.processStart, path.resolve(archive).toLowerCase()]),
      ) + ".json",
    );
    await fs.unlink(file).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  const target = { archive, windowId: w.windowId };
  return {
    root,
    archive,
    w,
    state,
    live,
    create,
    target,
    prepare: () => live.prepare({ ...target, mode: "same_file_refresh" }),
  };
}

test("an unchanged apply releases its session and project lease without touching the editor", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  const result = await f.live.apply({ sessionId: session.sessionId });
  assert.equal(result.status, "unchanged");
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.opens, 0);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /SESSION_MISSING/);
  const next = await f.prepare();
  await f.live.release(next.sessionId);
});

test("changed GUI triggers cannot be published with an unchanged runtime", async (t) => {
  const f = await fixture(t);
  f.state.includeGui = true;
  const session = await f.prepare();
  await fs.writeFile(path.join(f.state.componentDirectory, "Triggers"), "edited GUI graph");
  await assert.rejects(
    f.live.apply({ sessionId: session.sessionId }),
    /TRIGGER_RUNTIME_SYNC_REQUIRED/,
  );
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.opens, 0);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal(
    await fs.readFile(path.join(f.state.componentDirectory, "Triggers"), "utf8"),
    "edited GUI graph",
  );
  await fs.unlink(path.join(f.state.componentDirectory, "MapScript.galaxy"));
  await assert.rejects(
    f.live.apply({ sessionId: session.sessionId }),
    /TRIGGER_RUNTIME_SYNC_REQUIRED/,
  );
  await fs.writeFile(path.join(f.state.componentDirectory, "MapScript.galaxy"), "changed runtime");
  f.state.exportFailure = true;
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /Invalid prepared package/);
  assert.equal(f.state.closes, 0);
  await f.live.release(session.sessionId);
});

test("compile snapshot exports the changed GUI internally without publishing it", async (t) => {
  const f = await fixture(t);
  f.state.includeGui = true;
  const session = await f.prepare();
  await fs.writeFile(path.join(f.state.componentDirectory, "Triggers"), "edited GUI graph");
  const snapshot = await f.live.compileSnapshot({ sessionId: session.sessionId });
  assert.equal(snapshot.internalTestArtifact, true);
  assert.equal(snapshot.editorChanged, false);
  assert.ok(snapshot.changed.includes("Triggers"));
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.opens, 0);
  await assert.rejects(
    f.live.apply({ sessionId: session.sessionId }),
    /TRIGGER_RUNTIME_SYNC_REQUIRED/,
  );
  await f.live.release(session.sessionId);
});

test("compiled runtime adoption requires the exact unchanged snapshot and prepared component set", async (t) => {
  const f = await fixture(t);
  f.state.includeGui = true;
  const session = await f.prepare();
  await fs.writeFile(path.join(f.state.componentDirectory, "Triggers"), "edited GUI graph");
  const snapshot = await f.live.compileSnapshot({ sessionId: session.sessionId });
  const compiled = Buffer.from("generated native runtime");
  const jobId = "2e533021-67b5-42ee-a1a4-7b906e94dc37";
  f.live.nativeCompiled = async () => ({
    source: { absolute: snapshot.archive, sha256: snapshot.sha256 },
    outputSha256: liveDigest(compiled),
    bytes: compiled,
  });
  await fs.writeFile(path.join(f.state.componentDirectory, "Payload.txt"), "concurrent change");
  await assert.rejects(
    f.live.adoptCompiled({ sessionId: session.sessionId, jobId }),
    /COMPONENTS_STALE/,
  );
  assert.equal(
    await fs.readFile(path.join(f.state.componentDirectory, "MapScript.galaxy"), "utf8"),
    "original runtime",
  );
  await fs.writeFile(path.join(f.state.componentDirectory, "Payload.txt"), "original payload");
  f.live.nativeCompiled = async () => ({
    source: { absolute: snapshot.archive, sha256: "wrong" },
    outputSha256: liveDigest(compiled),
    bytes: compiled,
  });
  await assert.rejects(
    f.live.adoptCompiled({ sessionId: session.sessionId, jobId }),
    /SOURCE_MISMATCH/,
  );
  f.live.nativeCompiled = async () => ({
    source: { absolute: snapshot.archive, sha256: snapshot.sha256 },
    outputSha256: liveDigest(compiled),
    bytes: compiled,
  });
  const adopted = await f.live.adoptCompiled({ sessionId: session.sessionId, jobId });
  assert.equal(adopted.nativeCompilePassed, true);
  assert.equal(await f.live.isCompiledCurrent(session.sessionId), true);
  assert.equal(
    await fs.readFile(path.join(f.state.componentDirectory, "MapScript.galaxy"), "utf8"),
    compiled.toString(),
  );
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal(f.state.closes, 0);
  await assert.rejects(
    f.live.adoptCompiled({ sessionId: session.sessionId, jobId }),
    /COMPILE_SNAPSHOT_REQUIRED/,
  );
  await f.live.release(session.sessionId);
  const resumed = await f.live.resume({
    ...f.target,
    preparedDirectory: session.preparedDirectory,
  });
  assert.equal(resumed.sessionId, session.sessionId);
  await fs.writeFile(
    path.join(f.state.componentDirectory, "Triggers"),
    "changed after compilation",
  );
  assert.equal(await f.live.isCompiledCurrent(session.sessionId), false);
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /COMPILED_COMPONENTS_STALE/);
  assert.equal(f.state.closes, 0);
  await fs.writeFile(path.join(f.state.componentDirectory, "Triggers"), "edited GUI graph");
  f.state.exportFailure = true;
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /Invalid prepared package/);
  await f.live.release(session.sessionId);
});

test("a committed multi-call package refreshes the same file once and retains the original rollback", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "first change" });
  await f.live.call({
    sessionId: session.sessionId,
    tool: "text.apply",
    args: { value: "fifty prepared edits" },
  });
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal(f.state.closes, 0);
  const applied = await f.live.apply({ sessionId: session.sessionId });
  assert.equal(applied.status, "refreshed");
  assert.ok(
    "sourcePublished" in applied &&
      "newWorkingMapCopies" in applied &&
      "internalRollback" in applied,
  );
  assert.equal(applied.sourcePublished, true);
  assert.equal(applied.newWorkingMapCopies, 0);
  assert.equal(await fs.readFile(applied.internalRollback!, "utf8"), "original archive");
  assert.equal(await fs.readFile(f.archive, "utf8"), "verified package:fifty prepared edits");
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.opens, 1);
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /SESSION_MISSING/);
});
test("dirty native buffers, stale source and unsaved component groups refuse before original Close", async (t) => {
  const f = await fixture(t);
  f.state.ready = false;
  await assert.rejects(f.prepare(), /SAVE_PENDING_BUFFERS/);
  f.state.ready = true;
  const session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "prepared" });
  f.state.staged = true;
  await assert.rejects(
    f.live.apply({ sessionId: session.sessionId }),
    /SAVE_COMPLETE_COMPONENT_GROUPS/,
  );
  f.state.staged = false;
  f.state.fingerprint = "manual document change";
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /STALE_DOCUMENT/);
  f.state.fingerprint = "original";
  await fs.writeFile(f.archive, "manual saved change");
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /STALE_DOCUMENT/);
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.opens, 0);
  assert.equal(await fs.readFile(f.archive, "utf8"), "manual saved change");
});
test("package validation failure leaves the current document open and prepared components intact", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "prepared" });
  f.state.exportFailure = true;
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /Invalid prepared package/);
  assert.equal(f.state.closes, 0);
  assert.equal(
    await fs.readFile(path.join(f.state.componentDirectory, "Payload.txt"), "utf8"),
    "prepared",
  );
});

test("multiple documents refuse before preparation with a specific cause, without asking for another Save", async (t) => {
  const f = await fixture(t);
  f.state.documents = 2;
  await assert.rejects(f.prepare(), /LIVE_REFRESH_SINGLE_DOCUMENT_REQUIRED/);
  assert.equal(f.state.componentDirectory, "");
  assert.equal(f.state.closes, 0);
  f.state.documents = 1;
  const prepared = await f.prepare();
  await f.live.author({ sessionId: prepared.sessionId, script: "prepared" });
  f.state.documents = 2;
  await assert.rejects(
    f.live.apply({ sessionId: prepared.sessionId }),
    /STALE_DOCUMENT: LIVE_REFRESH_SINGLE_DOCUMENT_REQUIRED/,
  );
  assert.equal(f.state.closes, 0);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
});
test("a lost close reply survives a new MCP session and restores the original path without publishing or repeating Close", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "prepared" });
  f.state.loseClose = true;
  const applied = await f.live.apply({ sessionId: session.sessionId });
  assert.equal(applied.status, "recovery_required");
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal("sourcePublished" in applied && applied.sourcePublished, false);
  const another = f.create();
  try {
    const recovered = await another.recover({ ...f.target, pendingId: pendingId(applied) });
    assert.equal(recovered.status, "not_published");
    assert.equal(f.state.closes, 1);
    assert.equal(f.state.opens, 1);
    assert.equal(
      await fs.readFile(path.join(f.state.componentDirectory, "Payload.txt"), "utf8"),
      "prepared",
    );
  } finally {
    await another.close();
  }
});
test("a lost original Open reply is observed across sessions rather than sent again", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "prepared" });
  f.state.loseOpen = true;
  const applied = await f.live.apply({ sessionId: session.sessionId });
  assert.equal(applied.status, "recovery_required");
  assert.equal(f.state.opens, 1);
  assert.equal("sourcePublished" in applied && applied.sourcePublished, true);
  const another = f.create();
  try {
    const pending = await another.recover({ ...f.target, pendingId: pendingId(applied) });
    assert.equal(pending.status, "pending_open");
    assert.equal(pending.sourcePublished, true);
    assert.equal(pending.publication, "candidate");
    assert.equal(f.state.opens, 1);
    f.w.title = `Terrain - [${f.archive}] - StarCraft II Editor`;
    const done = await another.recover({ ...f.target, pendingId: pendingId(applied) });
    assert.equal(done.status, "refreshed");
    assert.equal(f.state.opens, 1);
    assert.equal(f.state.closes, 1);
  } finally {
    await another.close();
  }
});

test("a loaded title with pending native work retains recovery after successful publication", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "prepared" });
  f.state.afterOpen = async () => {
    f.state.ready = false;
  };
  const applied = await f.live.apply({ sessionId: session.sessionId });
  assert.equal(applied.status, "pending_native");
  assert.equal("sourcePublished" in applied && applied.sourcePublished, true);
  assert.equal(await fs.readFile(f.archive, "utf8"), "verified package:prepared");
  const pending = await f.live.recover({ ...f.target, pendingId: pendingId(applied) });
  assert.equal(pending.status, "pending_native");
  f.state.ready = true;
  const completed = await f.live.recover({ ...f.target, pendingId: pendingId(applied) });
  assert.equal(completed.status, "refreshed");
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.opens, 1);
});

test("an external saved revision during reload is a conflict even when the title matches", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "prepared" });
  f.state.afterOpen = () => fs.writeFile(f.archive, "manual revision during reload");
  const result = await f.live.apply({ sessionId: session.sessionId });
  assert.equal(result.status, "conflict");
  assert.equal(await fs.readFile(f.archive, "utf8"), "manual revision during reload");
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.opens, 1);
});
test("another active document or conflicting saved archive is never overwritten by recovery", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "prepared" });
  f.state.otherDocument = true;
  const applied = await f.live.apply({ sessionId: session.sessionId });
  assert.equal(applied.status, "recovery_required");
  assert.equal(f.state.opens, 0);
  const recovery = await f.live.recover({ ...f.target, pendingId: pendingId(applied) });
  assert.equal(recovery.status, "pending_native");
  assert.equal(f.state.opens, 0);
  await fs.writeFile(f.archive, "conflicting external version");
  const conflict = await f.live.recover({ ...f.target, pendingId: pendingId(applied) });
  assert.equal(conflict.status, "conflict");
  assert.equal(await fs.readFile(f.archive, "utf8"), "conflicting external version");
});
test("refresh authoring excludes nested sessions, archive handoffs and native test workers", () => {
  for (const name of [
    "live.connect",
    "live.refresh.apply",
    "editor.check",
    "game.call",
    "map.export",
    "map.import",
    "map.clone",
    "map.create",
    "modkit.author",
  ])
    assert.equal(refreshAuthoringAllowed(name), false, name);
  assert.equal(refreshAuthoringAllowed("map.minimap.rebuild"), false);
  assert.equal(refreshAuthoringAllowed("map.minimap.rebuild", { backend: "overview" }), true);
  for (const name of [
    "data.apply",
    "trigger.plan_file",
    "ui.apply",
    "text.apply",
    "terrain.surface.apply",
    "settings.apply",
    "placement.apply",
    "cutscene.compose",
    "cutscene.register_document",
    "cutscene.save",
  ])
    assert.equal(refreshAuthoringAllowed(name), true, name);
});

test("a package that loses an untouched component is refused before the current map closes", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "edited payload" });
  f.state.omitExportedComponent = true;
  await assert.rejects(f.live.apply({ sessionId: session.sessionId }), /EXPORT_COMPONENT_MISMATCH/);
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.opens, 0);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal(
    await fs.readFile(path.join(session.componentDirectory, "Assets/kept.txt"), "utf8"),
    "existing map resource",
  );
});

test("an edit to prepared components during export is preserved and prevents refresh", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await f.live.author({ sessionId: session.sessionId, script: "edited payload" });
  f.state.mutateDuringExport = true;
  await assert.rejects(
    f.live.apply({ sessionId: session.sessionId }),
    /COMPONENTS_CHANGED_DURING_EXPORT/,
  );
  assert.equal(f.state.closes, 0);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal(
    await fs.readFile(path.join(session.componentDirectory, "Assets/kept.txt"), "utf8"),
    "concurrent user edit",
  );
});

test("resource edits join the same refresh session without editing the current archive", async (t) => {
  const f = await fixture(t),
    session = await f.prepare();
  await fs.writeFile(path.join(f.root, "replacement.dds"), "new resource bytes");
  const result = await f.live.resources({
    sessionId: session.sessionId,
    changes: [{ action: "add", path: "Assets/Art/added.dds", source: "replacement.dds" }],
  });
  assert.equal(result.editorChanged, false);
  assert.equal(
    await fs.readFile(path.join(session.componentDirectory, "Assets/Art/added.dds"), "utf8"),
    "new resource bytes",
  );
  assert.equal(await fs.readFile(f.archive, "utf8"), "original archive");
  assert.equal(f.state.closes, 0);
});
test("preserved preparation resumes after reconnect without repeating generation or stealing live drafts", async (t) => {
  const f = await fixture(t),
    prepared = await f.prepare();
  await f.live.author({ sessionId: prepared.sessionId, script: "fifty preserved operations" });
  const another = f.create();
  try {
    await assert.rejects(
      another.resume({ ...f.target, preparedDirectory: prepared.preparedDirectory }),
      /PROJECT_OWNED/,
    );
    await f.live.close();
    const resumed = await another.resume({
      ...f.target,
      preparedDirectory: prepared.preparedDirectory,
    });
    assert.equal(resumed.sessionId, prepared.sessionId);
    assert.equal(
      await fs.readFile(path.join(resumed.componentDirectory, "Payload.txt"), "utf8"),
      "fifty preserved operations",
    );
    const applied = await another.apply({ sessionId: resumed.sessionId });
    assert.equal(applied.status, "refreshed");
    assert.equal(f.state.closes, 1);
    assert.equal(f.state.opens, 1);
  } finally {
    await another.close();
  }
});
test("cleanup failure cannot hide a completed publication or leave the prepared project owned", async (t) => {
  const f = await fixture(t),
    prepared = await f.prepare();
  await f.live.author({ sessionId: prepared.sessionId, script: "prepared" });
  f.state.cleanupFailure = true;
  const result = await f.live.apply({ sessionId: prepared.sessionId });
  assert.equal(result.status, "refreshed");
  assert.ok(
    "cleanupError" in result && String(result.cleanupError).includes("Child cleanup failed"),
  );
  await assert.rejects(fs.stat(path.join(prepared.preparedDirectory, "Prepared.lock")), {
    code: "ENOENT",
  });
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.opens, 1);
});
