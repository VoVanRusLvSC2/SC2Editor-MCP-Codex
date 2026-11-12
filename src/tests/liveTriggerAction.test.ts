import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveTriggers } from "../modules/editorLive/triggers.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

async function fixture(t: test.TestContext, loseReply = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-action-"));
  const archive = path.join(root, "Current.SC2Map"); await fs.writeFile(archive, "map");
  const window = { windowId: "123", processId: 929345, processStart: "77", enabled: true,
    acceptsFiles: true, title: `Triggers - [${archive}] - StarCraft II Editor` };
  const left = [{ handle: "1", parent: "0", depth: 0, text: "MAIN" },
    { handle: "2", parent: "1", depth: 1, text: "Start" }];
  const details = [{ handle: "3", parent: "0", depth: 0, text: "Start" },
    { handle: "7", parent: "3", depth: 1, text: "Events" },
    { handle: "4", parent: "3", depth: 1, text: "Actions" },
    { handle: "5", parent: "4", depth: 2, text: "Existing action" }];
  let fingerprint = "initial", commits = 0, cancellations = 0, selectedName = "", event = false;
  const desktop: MemoryDesktop = {
    windows: async () => [window],
    command: async (_w, op, args) => {
      if (op === 50) return { trees: [
        { id: 28, count: left.length, fingerprint: "left", truncated: false, items: left },
        { id: 134, count: details.length, fingerprint: "detail", truncated: false, items: details },
      ] };
      if (op === 55) return { selectionRequested: true };
      if (op === 51) { event = args?.field === "trigger.event"; assert.equal(args?.value, event ? "2:7" : "2:5"); return { status: "pending" }; }
      if (op === 52) return { title: event ? "Event" : "Action", fingerprint, initial: fingerprint, manualInput: false };
      if (op === 59) { selectedName = args!.field!; fingerprint = "selected"; return { optionsSet: true, category: event ? "Timer" : "General" }; }
      if (op === 58) {
        commits++;
        const node = { handle: "6", parent: event ? "7" : "4", depth: 2, text: (event ? "Timer -" : "General -") + selectedName };
        if (event) details.splice(2, 0, node); else details.push(node);
        if (loseReply) throw Error("lost acknowledgement");
        return { submitted: true };
      }
      if (op === 54) { cancellations++; return {}; }
      throw Error("Unexpected command " + op);
    },
  };
  const live = new LiveTriggers(new Workspace(root), () => undefined, desktop, () => false, async () => {});
  t.after(async () => { await live.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { live, archive, counts: () => ({ commits, cancellations }) };
}

test("append uses the last existing action as its insertion point", async t => {
  const f = await fixture(t);
  const result = await f.live.appendAction({ archive: f.archive, windowId: "123", path: "MAIN/Start", action: "skip_remaining" });
  assert.equal(result.status, "applied");
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("an uncertain action commit is not repeated or cancelled", async t => {
  const f = await fixture(t, true);
  const result = await f.live.appendAction({ archive: f.archive, windowId: "123", path: "MAIN/Start", action: "skip_remaining" });
  assert.equal(result.status, "unknown");
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("generic built-in insertion reports unverified default parameters", async t => {
  const f = await fixture(t);
  const result = await f.live.appendAction({ archive: f.archive, windowId: "123", path: "MAIN/Start",
    action: "builtin_default", actionName: "Set Variable", useDefaults: true });
  assert.equal(result.status, "needs_parameters");
  assert.ok("parametersVerified" in result);
  assert.equal(result.parametersVerified, false);
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("built-in event is inserted under Events and reports unverified parameters", async t => {
  const f = await fixture(t);
  const result = await f.live.appendEvent({ archive: f.archive, windowId: "123", path: "MAIN/Start",
    eventName: "Periodic Event", useDefaults: true });
  assert.equal(result.status, "needs_parameters");
  assert.ok("createdEvent" in result);
  assert.equal(result.createdEvent, true);
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});
