import test from "node:test";
import assert from "node:assert/strict";
import { configureLiveWait, configureLivePeriodic, type LiveTriggerTree } from "../modules/editorLive/triggerWait.js";
import { triggerAppendActionSchema, triggerAppendEventSchema } from "../modules/editorLive/triggers.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

function fixture(loseReply = false, periodic = false) {
  const window = { windowId: "123", processId: 929810, processStart: "55", enabled: true,
    acceptsFiles: true, title: "Triggers - [Current.SC2Map] - StarCraft II Editor" };
  const left: LiveTriggerTree = { fingerprint: "left", items: [] };
  const detail: LiveTriggerTree = { fingerprint: "detail", items: [
    { handle: "2", parent: "0", depth: 0, text: "Start" },
    { handle: "3", parent: "2", depth: 1, text: "Actions" },
    { handle: "4", parent: "3", depth: 2, text: periodic ? "Timer -Every 2.0 seconds of Game Time" : "General -Wait 2.0 Game Time seconds" },
  ] };
  const parameters: LiveTriggerTree = { fingerprint: "parameters", items: [
    { handle: "5", parent: "0", depth: 0, text: periodic ? "Periodic Event" : "Wait" },
    { handle: "6", parent: "5", depth: 1, text: periodic ? "Duration: 2.0" : "Time: 2.0" },
    { handle: "7", parent: "5", depth: 1, text: "Time Type: Game Time" },
  ] };
  let fingerprint = "initial", commits = 0, cancellations = 0, changed = false;
  const desktop: MemoryDesktop = {
    windows: async () => [window],
    command: async (_w, op, args) => {
      if (op === 55) return { selectionRequested: true };
      if (op === 51) { assert.equal(args?.value, "2:4:6"); return { status: "pending" }; }
      if (op === 52) return { title: "Real", fingerprint, initial: fingerprint, manualInput: false };
      if (op === 59) { assert.equal(args?.value, "3.5"); fingerprint = "configured"; return { optionsSet: true }; }
      if (op === 58) { commits++; changed = true; if (loseReply) throw Error("lost acknowledgement"); return { submitted: true }; }
      if (op === 54) { cancellations++; return {}; }
      throw Error("Unexpected command " + op);
    },
  };
  const tree = async (_w: typeof window, id: number) => id === 468 ? parameters : {
    ...detail, items: detail.items.map(item => item.handle === "4" && changed ? { ...item, text: periodic ? "Timer -Every 3.5 seconds of Game Time" : "General -Wait 3.5 Game Time seconds" } : item),
  };
  return { context: { desktop, window, triggerHandle: "2", actionHandle: "4", left, detail,
    seconds: 3.5, tree, guardArchive: async () => {}, pause: async () => {} },
  counts: () => ({ commits, cancellations }) };
}

test("Wait parameter uses the original numeric dialog and verifies the new value", async () => {
  const f = fixture();
  assert.equal((await configureLiveWait(f.context)).status, "applied");
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("an uncertain numeric commit is never repeated or cancelled", async () => {
  const f = fixture(true);
  assert.equal((await configureLiveWait(f.context)).status, "unknown");
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("periodic event duration reuses the guarded Real dialog", async () => {
  const f = fixture(false, true);
  assert.equal((await configureLivePeriodic(f.context)).status, "applied");
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("Wait requires seconds and skip_remaining rejects them", () => {
  const base = { archive: "Current.SC2Map", windowId: "123", path: "MAIN/Start" };
  assert.equal(triggerAppendActionSchema.safeParse({ ...base, action: "wait" }).success, false);
  assert.equal(triggerAppendActionSchema.safeParse({ ...base, action: "skip_remaining", seconds: 3 }).success, false);
  assert.equal(triggerAppendActionSchema.safeParse({ ...base, action: "builtin_default", actionName: "Set Variable" }).success, false);
  assert.equal(triggerAppendActionSchema.safeParse({ ...base, action: "builtin_default", actionName: "Custom Script", useDefaults: true }).success, false);
  assert.equal(triggerAppendActionSchema.safeParse({ ...base, action: "builtin_default", actionName: "Set Variable", useDefaults: true }).success, true);
});

test("periodic events require a positive interval and generic events require explicit defaults", () => {
  const base = { archive: "Current.SC2Map", windowId: "123", path: "MAIN/Start" };
  assert.equal(triggerAppendEventSchema.safeParse({ ...base, event: "periodic", seconds: 0 }).success, false);
  assert.equal(triggerAppendEventSchema.safeParse({ ...base, event: "periodic", seconds: 1.25 }).success, true);
  assert.equal(triggerAppendEventSchema.safeParse({ ...base, eventName: "Periodic Event" }).success, false);
  assert.equal(triggerAppendEventSchema.safeParse({ ...base, eventName: "Periodic Event", useDefaults: true }).success, true);
});
