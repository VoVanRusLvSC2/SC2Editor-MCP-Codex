import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";
import { acknowledgeSavedUiBuffers } from "../modules/editorLive/savedUiBuffer.js";
import { liveDigest } from "../modules/editorLive/identity.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-saved-ui-"));
  const archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "saved archive");
  const terrain = {
    windowId: "1",
    processId: 999998,
    processStart: "44",
    title: `Terrain - [${archive}] - StarCraft II Editor`,
    enabled: true,
    acceptsFiles: true,
  };
  const ui = { ...terrain, windowId: "2", title: `UI - [${archive}] - StarCraft II Editor` };
  const state = {
    saved: Buffer.from("<Desc/>"),
    buffer: Buffer.from("<Desc/>"),
    acknowledged: 0,
    stale: false,
  };
  const desktop: MemoryDesktop = {
    windows: async () => [terrain, ui],
    window: async () => ui,
    temporaryDirectory: async () => root,
    command: async (_w, op, args = {}) => {
      if (op === 60 && args.field === "status")
        return { layout: "CurrentUI", source: "Current.SC2Map", bufferModified: true };
      if (op === 60) {
        const folder = path.join(root, "SC2EditorToolkit-live-ui");
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(path.join(folder, args.token + ".xml"), state.buffer, { flag: "wx" });
        return {
          snapshotExported: true,
          fingerprint: liveDigest(state.buffer),
          bytes: state.buffer.length,
        };
      }
      if (op === 65) {
        if (state.stale) throw Error("LIVE_UI_PERSISTED_BUFFER_CHANGED");
        assert.equal(args.expected, liveDigest(state.buffer));
        state.acknowledged++;
        return { persistedBufferAcknowledged: true };
      }
      throw Error("Unexpected native operation");
    },
  };
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = () =>
    acknowledgeSavedUiBuffers(
      desktop,
      terrain,
      archive,
      liveDigest("saved archive"),
      async () => state.saved,
    );
  return { state, run };
}
test("only the exact current UI bytes already in the saved archive receive a native savepoint", async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(f.state.acknowledged, 1);
  assert.equal(result[0].status, "saved_buffer_acknowledged");
});
test("a clean document title never permits discarding a different pending UI buffer", async (t) => {
  const f = await fixture(t);
  f.state.buffer = Buffer.from("<Desc><!--manual edit--></Desc>");
  const result = await f.run();
  assert.equal(f.state.acknowledged, 0);
  assert.equal(result[0].status, "preserved_unsaved_buffer");
});
test("a concurrent native buffer edit refuses its old savepoint without replay", async (t) => {
  const f = await fixture(t);
  f.state.stale = true;
  await assert.rejects(f.run(), /PERSISTED_BUFFER_CHANGED/);
  assert.equal(f.state.acknowledged, 0);
});
