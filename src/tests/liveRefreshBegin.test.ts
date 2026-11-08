import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../core/workspace.js";
import { LiveDocument } from "../modules/editorLive/document.js";
import { LiveRefresh } from "../modules/editorLive/refresh.js";
import { beginRefresh, refreshBeginSchema } from "../modules/editorLive/refreshBegin.js";
import type { RefreshDesktop } from "../modules/editorLive/refreshTransfer.js";
import type { LiveRuntimeFactory } from "../modules/editorLive/runtime.js";

let serial = 0;
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-begin-")),
    archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "saved before manual changes");
  const state = {
    dirty: true,
    pendingInput: false,
    dialog: false,
    loseSaveReply: false,
    failUnpack: false,
    saves: 0,
    window: {
      windowId: "73",
      processId: 999910,
      processStart: String(Date.now()) + ++serial,
      title: `Terrain - [${archive}*] - StarCraft II Editor`,
      enabled: true,
      acceptsFiles: true,
    },
  };
  const desktop: RefreshDesktop = {
    windows: async () => [{ ...state.window }],
    window: async () => ({ ...state.window }),
    documentState: async () => ({
      documentDirty: state.dirty,
      pendingXmlBuffers: 0,
      pendingInput: state.pendingInput,
      dialogs: state.dialog ? [{}] : [],
    }),
    command: async (_window, operation) => {
      if (operation === 24) {
        state.saves++;
        await fs.writeFile(archive, "native saved manual changes");
        state.dirty = false;
        state.window.title = state.window.title.replace("*]", "]");
        if (state.loseSaveReply) throw Error("save reply lost");
        return { saveRequested: true };
      }
      if (operation === 25)
        return {
          refreshReady: !state.dirty && !state.pendingInput && !state.dialog,
          refreshFingerprint: "same native document",
          openDocuments: 1,
          dialogs: state.dialog ? [{}] : [],
        };
      throw Error("Unexpected native operation " + operation);
    },
    present: async () => {
      throw Error("Opening a map is not part of begin");
    },
  };
  const factory: LiveRuntimeFactory = async (directory) => ({
    workspace: new Workspace(directory),
    call: async () => ({}),
    close: async () => {},
    export: async () => {
      throw Error("Export is not part of begin");
    },
  });
  const document = new LiveDocument(
      root,
      desktop,
      () => false,
      async () => {},
    ),
    refresh = new LiveRefresh(
      new Workspace(root),
      () => factory,
      desktop,
      () => false,
      async (_archive, destination) => {
        if (state.failUnpack) throw Error("component extraction failed");
        await fs.mkdir(destination, { recursive: true });
        await fs.writeFile(path.join(destination, "Payload.txt"), "existing component");
      },
      async () => {},
    );
  t.after(async () => {
    await refresh.close();
    await document.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const input = { archive, windowId: state.window.windowId, mode: "same_file_refresh" as const };
  return { state, document, refresh, input, archive };
}

test("dirty map is saved once only when explicitly requested, then its same-file revision is prepared", async (t) => {
  const f = await fixture(t);
  const refused = await beginRefresh(f.document, f.refresh, refreshBeginSchema.parse(f.input));
  assert.equal(refused.status, "save_required");
  assert.equal(f.state.saves, 0);
  const result = await beginRefresh(f.document, f.refresh, { ...f.input, saveIfDirty: true });
  assert.equal(result.status, "prepared");
  assert.equal(f.state.saves, 1);
  assert.equal(await fs.readFile(f.archive, "utf8"), "native saved manual changes");
  assert.ok("sessionId" in result && result.sessionId);
  assert.equal(result.saveAttempted, true);
});

test("a clean map needs no native Save even when saveIfDirty is set", async (t) => {
  const f = await fixture(t);
  f.state.dirty = false;
  f.state.window.title = f.state.window.title.replace("*]", "]");
  const result = await beginRefresh(f.document, f.refresh, { ...f.input, saveIfDirty: true });
  assert.equal(result.status, "prepared");
  assert.equal(result.saveAttempted, false);
  assert.equal(f.state.saves, 0);
});

test("pending user input and dialogs remain untouched", async (t) => {
  const f = await fixture(t);
  f.state.pendingInput = true;
  let result = await beginRefresh(f.document, f.refresh, { ...f.input, saveIfDirty: true });
  assert.equal(result.status, "attention_required");
  f.state.pendingInput = false;
  f.state.dialog = true;
  result = await beginRefresh(f.document, f.refresh, { ...f.input, saveIfDirty: true });
  assert.equal(result.status, "attention_required");
  assert.equal(f.state.saves, 0);
});

test("an uncertain native Save never starts preparation or repeats the Save", async (t) => {
  const f = await fixture(t);
  f.state.loseSaveReply = true;
  const result = await beginRefresh(f.document, f.refresh, { ...f.input, saveIfDirty: true });
  assert.equal(result.status, "save_unconfirmed");
  assert.equal(f.state.saves, 1);
  assert.equal("retryMutation" in result && result.retryMutation, false);
  assert.equal("sessionId" in result, false);
});

test("preparation failure retains the already confirmed native Save receipt", async (t) => {
  const f = await fixture(t);
  f.state.failUnpack = true;
  const result = await beginRefresh(f.document, f.refresh, { ...f.input, saveIfDirty: true });
  assert.equal(result.status, "prepare_failed");
  assert.equal(f.state.saves, 1);
  assert.ok("save" in result && result.save?.status === "saved");
  assert.equal(await fs.readFile(f.archive, "utf8"), "native saved manual changes");
});

test("a confirmed Save with unresolved UI reconciliation is retained, not reported as an unknown Save", async (t) => {
  const f = await fixture(t);
  const before = await f.document.status({ archive: f.archive, windowId: f.input.windowId });
  const document = {
    status: async () => before,
    save: async () => ({
      status: "saved",
      sha256: before.sha256,
      savedUiBufferError: "UI source changed concurrently",
    }),
  } as unknown as Pick<LiveDocument, "status" | "save">;
  const result = await beginRefresh(document, f.refresh, { ...f.input, saveIfDirty: true });
  assert.equal(result.status, "save_confirmed_prepare_blocked");
  assert.ok("save" in result && result.save?.status === "saved");
  assert.equal("sessionId" in result, false);
});

test("preparation rejects a changed process or saved file after the earlier observation", async (t) => {
  const f = await fixture(t);
  f.state.dirty = false;
  f.state.window.title = f.state.window.title.replace("*]", "]");
  const observed = await f.document.status({ archive: f.archive, windowId: f.input.windowId });
  await fs.writeFile(f.archive, "external saved revision");
  await assert.rejects(
    f.refresh.prepare(f.input, {
      processId: observed.processId,
      processStart: observed.processStart,
      sha256: observed.sha256,
    }),
    /EXPECTED_DOCUMENT_CHANGED/,
  );
  assert.equal(f.state.saves, 0);
});
