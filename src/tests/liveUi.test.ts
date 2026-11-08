import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../core/workspace.js";
import { LayoutDocument } from "../core/layoutDocument.js";
import { LiveUi } from "../modules/editorLive/ui.js";
import { liveDigest } from "../modules/editorLive/identity.js";
import { ComponentTransfer } from "../modules/editorLive/componentTransfer.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";
import type { LiveRuntimeFactory } from "../modules/editorLive/runtime.js";

async function fixture(t: test.TestContext, separateEditorTemp = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-ui-")),
    archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "original map bytes");
  const window = {
    windowId: "12",
    processId: 999991,
    processStart: "444",
    title: `UI - [${archive}*] - StarCraft II Editor`,
    enabled: true,
    acceptsFiles: true,
  };
  const state = {
    source:
      '<Desc><Frame type="Frame" name="Panel"><Width val="100"/><UnknownManual flag="keep"/></Frame></Desc>',
    writes: 0,
    selections: 0,
    lost: false,
    extra: false,
  };
  const transfers: string[] = [];
  const editorTemp = separateEditorTemp ? path.join(root, "editor-temp") : os.tmpdir();
  const location = (token: string, candidate = false) =>
    path.join(
      editorTemp,
      "SC2EditorToolkit-live-ui",
      token + (candidate ? ".candidate.xml" : ".xml"),
    );
  const desktop: MemoryDesktop = {
    ...(separateEditorTemp ? { temporaryDirectory: async () => editorTemp } : {}),
    windows: async () => [window],
    command: async (_w, op, args = {}) => {
      if (op === 61) return { sourceSelected: true, changed: false };
      if (op === 55) {
        state.selections++;
        throw Error("Pending source must not be reselected");
      }
      if (op === 60) {
        const file = location(args.token!);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, state.source, { flag: "wx" });
        transfers.push(file);
        return {
          snapshotExported: true,
          fingerprint: liveDigest(state.source),
          bytes: Buffer.byteLength(state.source),
          bufferModified: true,
        };
      }
      if (op === 62) {
        state.writes++;
        const file = location(args.token!, true);
        transfers.push(file);
        state.source = await fs.readFile(file, "utf8");
        if (state.lost) throw Error("lost native write acknowledgement");
        return { bufferWriteRequested: true };
      }
      if (op === 50)
        return { trees: [{ id: 18, count: 2, fingerprint: "tree", truncated: false, items: [] }] };
      throw Error("Unexpected native operation " + op);
    },
  };
  const factory: LiveRuntimeFactory = async (directory) => ({
    workspace: new Workspace(directory),
    call: async () => {
      throw Error("unused");
    },
    export: async () => {
      throw Error("map export forbidden");
    },
    close: async () => {},
    authorUi: async (_script, file) => {
      const full = path.join(directory, file),
        doc = new LayoutDocument(await fs.readFile(full, "utf8"));
      doc.setSimpleProperty("Panel", "Width", 360);
      await fs.writeFile(full, doc.source);
      if (state.extra)
        await fs.writeFile(path.join(directory, "Extra.txt"), "unapplied dependency");
      return { ok: true };
    },
  });
  const live = new LiveUi(
    new Workspace(root),
    () => factory,
    desktop,
    () => false,
    async () => {},
  );
  t.after(async () => {
    await live.close();
    for (const file of transfers) await fs.rm(file, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  });
  return { live, state, archive, target: { archive, windowId: window.windowId, layout: "LiveUI" } };
}
test("current UI snapshot preserves pending manual XML without reselecting the native tree", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  assert.equal(s.bufferModified, true);
  assert.equal(f.state.selections, 0);
  const result = await f.live.author({
    snapshotId: s.snapshotId,
    script: "ui property framePath=Panel property=Width value=360",
    apply: true,
  });
  assert.equal(result.status, "buffer_applied");
  assert.equal(f.state.writes, 1);
  assert.match(f.state.source, /<UnknownManual flag="keep"\/>/);
  assert.match(f.state.source, /<Width val="360"\/>/);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original map bytes");
});

test("UI snapshot and candidate share the target Editor temp when the client temp differs", async (t) => {
  const f = await fixture(t, true);
  const snapshot = await f.live.read(f.target);
  const result = await f.live.author({
    snapshotId: snapshot.snapshotId,
    script: "ui property framePath=Panel property=Width value=360",
    apply: true,
  });
  assert.equal(result.status, "buffer_applied");
  assert.equal(f.state.writes, 1);
  assert.match(f.state.source, /<UnknownManual flag="keep"\/>/);
  assert.equal(await fs.readFile(f.archive, "utf8"), "original map bytes");
});
test("manual XML changes after a UI snapshot refuse before a native write", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  f.state.source = f.state.source.replace('val="100"', 'val="101"');
  await assert.rejects(
    f.live.author({
      snapshotId: s.snapshotId,
      script: "ui property framePath=Panel property=Width value=360",
      apply: true,
    }),
    /LIVE_UI_STALE_BUFFER/,
  );
  assert.equal(f.state.writes, 0);
});
test("a lost native UI reply cannot replay its consumed snapshot", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  f.state.lost = true;
  const result = await f.live.author({
    snapshotId: s.snapshotId,
    script: "ui property framePath=Panel property=Width value=360",
    apply: true,
  });
  assert.equal(result.status, "unknown");
  assert.ok("retryMutation" in result);
  assert.equal(result.retryMutation, false);
  await assert.rejects(
    f.live.author({
      snapshotId: s.snapshotId,
      script: "ui property framePath=Panel property=Width value=360",
      apply: true,
    }),
    /SNAPSHOT_EXPIRED/,
  );
  assert.equal(f.state.writes, 1);
});
test("additional UI preparation components refuse before partial native application", async (t) => {
  const f = await fixture(t),
    s = await f.live.read(f.target);
  f.state.extra = true;
  await assert.rejects(
    f.live.author({
      snapshotId: s.snapshotId,
      script: "ui property framePath=Panel property=Width value=360",
      apply: true,
    }),
    /MULTI_COMPONENT_UNSUPPORTED/,
  );
  assert.equal(f.state.writes, 0);
});

function modal(manual = false, lost = false) {
  const calls: number[] = [],
    w = {
      windowId: "12",
      processId: 999992,
      processStart: "555",
      title: "UI - [Current.SC2Map] - StarCraft II Editor",
      enabled: true,
      acceptsFiles: true,
    };
  const d: MemoryDesktop = {
    windows: async () => [w],
    command: async (_w, op, args) => {
      calls.push(op);
      if (op === 51) return { status: "pending" };
      if (op === 52)
        return {
          fingerprint: "same",
          initial: "same",
          manualInput: manual,
          controls: [
            { id: 13, type: "Edit", text: "" },
            { id: 11, type: "Button", text: "&OK" },
            { id: 12, type: "Button", text: "Cancel" },
          ],
        };
      if (op === 56) {
        assert.equal(args?.value, "LiveLayout");
        if (lost) throw Error("lost filename submission");
        return { submitted: true };
      }
      if (op === 54) return { cancelRequested: true };
      throw Error("Unexpected modal operation");
    },
  };
  return { calls, w, transfer: new ComponentTransfer(d, async () => {}) };
}
test("deferred layout dialogs submit once and uncertain submissions are never cancelled or repeated", async () => {
  const f = modal(false, true);
  await assert.rejects(f.transfer.layout(f.w, "LiveLayout"), /lost filename/);
  assert.deepEqual(f.calls, [51, 52, 56]);
  const ok = modal();
  assert.equal((await ok.transfer.layout(ok.w, "LiveLayout")).submitted, true);
  assert.deepEqual(ok.calls, [51, 52, 56]);
});
test("manual input in an owned layout name dialog remains untouched", async () => {
  const f = modal(true);
  await assert.rejects(f.transfer.layout(f.w, "LiveLayout"), /MANUAL_DIALOG_CHANGED/);
  assert.deepEqual(f.calls, [51, 52]);
});
