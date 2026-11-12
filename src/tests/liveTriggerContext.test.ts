import test from "node:test";
import assert from "node:assert/strict";
import { resolveTriggerContext } from "../modules/editorLive/triggerContext.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

const archive = "K:/Maps/User.SC2Map";
const ai = {
  windowId: "1",
  processId: 931721,
  processStart: "77",
  title: `AI Assistant - [${archive}] - StarCraft II Editor`,
  enabled: true,
  acceptsFiles: false,
};
const terrain = {
  ...ai,
  windowId: "2",
  title: `Terrain - [${archive}*] - StarCraft II Editor`,
  acceptsFiles: true,
};
const triggers = {
  ...ai,
  windowId: "3",
  title: `Triggers - [${archive}*] - StarCraft II Editor`,
  acceptsFiles: true,
};
test("AI panel is compatible with existing dirty Trigger Editor and needs no Save", async () => {
  const d = {
    windows: async () => [ai, terrain, triggers],
    command: async () => assert.fail("no module command needed"),
  } as MemoryDesktop;
  const result = await resolveTriggerContext(d, { archive, windowId: "1" }, async () => {});
  assert.equal(result.windowId, "3");
});
test("missing Trigger Editor opens through the same document's Terrain command once", async () => {
  let opened = false,
    commands = 0;
  const d = {
    windows: async () => (opened ? [ai, terrain, triggers] : [ai, terrain]),
    command: async (w, op, args) => {
      commands++;
      assert.equal(w.windowId, "2");
      assert.equal(op, 31);
      assert.equal(args?.unit, "Triggers");
      opened = true;
      return { moduleRequested: "Triggers" };
    },
  } as MemoryDesktop;
  const result = await resolveTriggerContext(d, { archive, windowId: "1" }, async () => {});
  assert.equal(result.windowId, "3");
  assert.equal(commands, 1);
});
test("real modal dialogs, another process and document mismatches are not bypassed", async () => {
  const blocked = {
    windows: async () => [ai, terrain, { ...triggers, enabled: false }],
    command: async () => assert.fail("user dialog must remain"),
  } as MemoryDesktop;
  await assert.rejects(
    resolveTriggerContext(blocked, { archive, windowId: "1" }, async () => {}),
    /USER_DIALOG/,
  );
  const changed = {
    windows: async () => [
      { ...ai, title: "AI Assistant - [K:/Maps/Other.SC2Map] - StarCraft II Editor" },
      terrain,
      triggers,
    ],
    command: async () => assert.fail(),
  } as MemoryDesktop;
  await assert.rejects(
    resolveTriggerContext(changed, { archive, windowId: "1" }, async () => {}),
    /SOURCE_DOCUMENT_CHANGED/,
  );
});
