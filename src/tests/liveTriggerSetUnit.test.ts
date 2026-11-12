import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveTriggers } from "../modules/editorLive/triggers.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

async function fixture(t: test.TestContext, ambiguous = false, kind: "unit" | "point" = "unit") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-unit-param-")), archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "map");
  const window = { windowId: "123", processId: 929820 + Number(ambiguous) + (kind === "point" ? 2 : 0), processStart: "77", enabled: true,
    acceptsFiles: true, title: `Triggers - [${archive}] - StarCraft II Editor` };
  const left = [{ handle: "1", parent: "0", depth: 0, text: "MAIN" }, { handle: "2", parent: "1", depth: 1, text: "Start" }];
  const detail = [{ handle: "3", parent: "0", depth: 0, text: "Start" }, { handle: "4", parent: "3", depth: 1, text: "Actions" },
    { handle: "5", parent: "4", depth: 2, text: "Create 1 Unit" }];
  const params = [{ handle: "7", parent: "0", depth: 0, text: "Create Units" },
    { handle: "8", parent: "7", depth: 1, text: kind === "point" ? "Point: (No Value)" : "Type: (No Value)" },
    { handle: "9", parent: "7", depth: 1, text: "Count: 1" }];
  let fingerprint = "initial", commits = 0, cancellations = 0;
  const desktop: MemoryDesktop = { windows: async () => [window], command: async (_w, op, args) => {
    if (op === 50) return { trees: [
      { id: 28, count: left.length, fingerprint: "11", truncated: false, items: left },
      { id: 134, count: detail.length, fingerprint: "42", truncated: false, items: detail },
      { id: 468, count: params.length, fingerprint: "43", truncated: false, items: params }] };
    if (op === 55) return { selectionRequested: true };
    if (op === 51) { assert.equal(args?.field, "trigger.choice"); return { status: "pending" }; }
    if (op === 52) return { title: kind === "point" ? "Point" : "Game Link - Unit", fingerprint, initial: fingerprint, manualInput: false };
    if (op === 59) {
      if (args?.field === kind && ambiguous) throw Error(`LIVE_TRIGGER_${kind.toUpperCase()}_NAME_AMBIGUOUS`);
      fingerprint = args?.field === "list" ? "list" : "unit"; return { optionsSet: true };
    }
    if (op === 54) { cancellations++; return {}; }
    if (op === 58) { commits++; params[1].text = kind === "point" ? "Point: MCP Spawn Point" : "Type: Murloc Marine"; detail[2].text = "Updated action"; return { submitted: true }; }
    throw Error("Unexpected operation " + op);
  } };
  const live = new LiveTriggers(new Workspace(root), () => undefined, desktop, () => false, async () => {});
  t.after(async () => { await live.close(); await fs.rm(root, { recursive: true, force: true }); });
  const target = { archive, windowId: "123", path: "MAIN/Start", section: "actions" as const, itemIndex: 1,
    expectedDetailHash: "42", expectedParameterHash: "43", parameterIndex: 1 };
  return { live, target, counts: () => ({ commits, cancellations }) };
}

test("unit type is selected through the native dialog and its GUI parameter is verified", async t => {
  const f = await fixture(t), result = await f.live.setUnit({ ...f.target, unitName: "Murloc Marine" });
  assert.equal(result.status, "applied");
  assert.equal(result.parameterVerified, true);
  assert.equal("catalogIdVerified" in result && result.catalogIdVerified, false);
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("ambiguous display names cancel the owned dialog without committing", async t => {
  const f = await fixture(t, true), result = await f.live.setUnit({ ...f.target, unitName: "Marine" });
  assert.equal(result.status, "stopped");
  assert.deepEqual(f.counts(), { commits: 0, cancellations: 1 });
});

test("an existing named point is selected and its GUI parameter is verified", async t => {
  const f = await fixture(t, false, "point"), result = await f.live.setPoint({ ...f.target, pointName: "MCP Spawn Point" });
  assert.equal(result.status, "applied");
  assert.equal(result.parameterVerified, true);
  assert.deepEqual(f.counts(), { commits: 1, cancellations: 0 });
});

test("ambiguous point names leave the existing parameter unchanged", async t => {
  const f = await fixture(t, true, "point"), result = await f.live.setPoint({ ...f.target, pointName: "Shared Point" });
  assert.equal(result.status, "stopped");
  assert.deepEqual(f.counts(), { commits: 0, cancellations: 1 });
});
