import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LiveDocument } from "../modules/live/document.js";
import { withEditorLease } from "../modules/live/editorLease.js";
import type { EditorWindow } from "../modules/live/desktop.js";
import { compileAuthorScript } from "../app/authoringScript.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

let processId = 920000;
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-document-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "original");
  const state = {
    calls: 0,
    loseReply: false,
    remainDirty: false,
    blocked: false,
    relatedFrames: [] as EditorWindow[],
    window: {
      windowId: "123",
      processId: ++processId,
      processStart: "88",
      title: `Terrain - [${archive}*] - StarCraft II Editor`,
      enabled: true,
      acceptsFiles: true,
    } as EditorWindow,
  };
  const desktop: MemoryDesktop = {
    windows: async () => [structuredClone(state.window), ...structuredClone(state.relatedFrames)],
    command: async (_w, operation) => {
      assert.equal(operation, 24);
      state.calls++;
      await fs.writeFile(archive, "native saved current unsaved document");
      if (!state.remainDirty) {
        state.window.title = state.window.title.replace("*]", "]");
        for (const frame of state.relatedFrames) frame.title = frame.title.replace("*]", "]");
      }
      if (state.loseReply) throw Error("reply lost after save");
      return { saveRequested: true };
    },
  };
  const document = new LiveDocument(
    root,
    desktop,
    () => state.blocked,
    async () => {},
  );
  t.after(() => document.close());
  const target = { archive, windowId: "123" };
  const status = await document.status(target);
  return {
    document,
    desktop,
    state,
    target,
    input: { ...target, expectedSha256: status.sha256 },
    root,
  };
}

test("native save writes the selected current file without creating or reopening copies", async (t) => {
  const f = await fixture(t);
  const result = await f.document.save(f.input);
  assert.equal(result.status, "saved");
  assert.equal(result.copiesCreated, 0);
  assert.equal(result.reopensMap, false);
  assert.equal(f.state.calls, 1);
  assert.equal(
    await fs.readFile(f.target.archive, "utf8"),
    "native saved current unsaved document",
  );
  assert.deepEqual(await fs.readdir(f.root), ["Current.SC2Map"]);
});
test("external archive changes refuse before Save", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target.archive, "external edit");
  await assert.rejects(f.document.save(f.input), /ARCHIVE_CHANGED/);
  assert.equal(f.state.calls, 0);
});
test("existing dialogs and checkpoint work prevent native saving", async (t) => {
  const f = await fixture(t);
  f.state.window.enabled = false;
  await assert.rejects(f.document.save(f.input), /USER_DIALOG_PRESENT/);
  f.state.window.enabled = true;
  f.state.blocked = true;
  await assert.rejects(f.document.save(f.input), /WORKFLOW_BUSY/);
  assert.equal(f.state.calls, 0);
});
test("lost Save acknowledgement is unknown and never replayed", async (t) => {
  const f = await fixture(t);
  f.state.loseReply = true;
  const result = await f.document.save(f.input);
  assert.equal(result.status, "unknown");
  assert.equal(result.retryMutation, false);
  assert.equal(f.state.calls, 1);
});
test("a remaining dirty marker cannot be reported as saved even when disk changed", async (t) => {
  const f = await fixture(t);
  f.state.remainDirty = true;
  const result = await f.document.save(f.input);
  assert.equal(result.status, "unknown");
  assert.equal(result.saved, false);
  assert.equal(f.state.calls, 1);
});
test("clean documents do not invoke Save and scalar clients share the native lease", async (t) => {
  const f = await fixture(t);
  await withEditorLease(f.state.window, async () => {
    await assert.rejects(f.document.save(f.input), /LEASE_BUSY/);
  });
  f.state.window.title = f.state.window.title.replace("*]", "]");
  assert.equal((await f.document.save(f.input)).status, "already_clean");
  assert.equal(f.state.calls, 0);
});
test("compact Save is an explicit mutation; plan mode only permits status", () => {
  assert.throws(
    () =>
      compileAuthorScript(
        "live document.save archive=Current.SC2Map windowId=123 expectedSha256=" + "a".repeat(64),
        "plan",
      ),
    /AUTHOR_LIVE_REQUIRES_STAGE/,
  );
  const result = compileAuthorScript(
    "live document.status archive=Current.SC2Map windowId=123",
    "plan",
  );
  assert.equal(result[0].tool, "live.document.status");
});

test("a dirty related module is saved even when the Terrain caption is clean", async (t) => {
  const f = await fixture(t);
  f.state.window.title = f.state.window.title.replace("*]", "]");
  f.state.relatedFrames.push({
    ...f.state.window,
    windowId: "124",
    title: `Triggers - [${f.target.archive}*] - StarCraft II Editor`,
  });
  assert.equal((await f.document.status(f.target)).documentDirty, true);
  const saved = await f.document.save(f.input);
  assert.equal(saved.status, "saved");
  assert.equal(f.state.calls, 1);
  assert.equal((await f.document.status(f.target)).documentDirty, false);
});

test("dirty frames of a different document do not trigger a save of the clean target", async (t) => {
  const f = await fixture(t);
  f.state.window.title = f.state.window.title.replace("*]", "]");
  f.state.relatedFrames.push({
    ...f.state.window,
    windowId: "125",
    title: `Triggers - [${f.root}/Other.SC2Map*] - StarCraft II Editor`,
  });
  assert.equal((await f.document.status(f.target)).documentDirty, false);
  assert.equal((await f.document.save(f.input)).status, "already_clean");
  assert.equal(f.state.calls, 0);
});

test("native dirty or pending buffers cannot be hidden behind a clean Terrain caption", async (t) => {
  const f = await fixture(t);
  f.state.window.title = f.state.window.title.replace("*]", "]");
  f.desktop.documentState = async () => ({
    documentDirty: false,
    pendingXmlBuffers: 1,
    pendingInput: false,
    dialogs: [],
  });
  const status = await f.document.status(f.target);
  assert.equal(status.documentDirty, true);
  assert.equal(status.pendingXmlBuffers, 1);
  const saved = await f.document.save(f.input);
  assert.equal(saved.status, "unknown");
  assert.equal(f.state.calls, 1);
});

test("pending inline input and incomplete native observations refuse before File Save", async (t) => {
  const f = await fixture(t);
  f.desktop.documentState = async () => ({
    documentDirty: true,
    pendingXmlBuffers: 0,
    pendingInput: true,
    dialogs: [],
  });
  await assert.rejects(f.document.save(f.input), /PENDING_INLINE_INPUT/);
  f.desktop.documentState = async () => ({ documentDirty: false, dialogs: [] });
  await assert.rejects(f.document.save(f.input), /pendingXmlBuffers/);
  assert.equal(f.state.calls, 0);
  assert.equal(await fs.readFile(f.target.archive, "utf8"), "original");
});
