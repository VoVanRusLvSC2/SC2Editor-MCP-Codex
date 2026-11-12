import test from "node:test";
import assert from "node:assert/strict";
import { readTriggerTreePages } from "../modules/editorLive/triggerTreePages.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";
import { compileAuthorScript } from "../app/authoringScript.js";
import { compactResult } from "../app/toolResults.js";

const window = { windowId: "1", processId: 1, processStart: "1", enabled: true, acceptsFiles: true, title: "Triggers" };
const rows = Array.from({ length: 300 }, (_, i) => ({
  handle: String(i + 1), parent: "0", depth: 0, text: `Trigger ${i + 1}`,
}));
function desktopFor(mode: "stable" | "changed" | "incomplete" | "duplicate") {
  const calls: Array<Record<string, string | undefined>> = [];
  const desktop: MemoryDesktop = { windows: async () => [window], command: async (_w, op, args) => {
    assert.equal(op, 50);
    calls.push(args ?? {});
    const offset = Number(args?.value), fingerprint = mode === "changed" && offset ? "different" : "original";
    let items = rows.slice(offset, offset + 128);
    if (mode === "incomplete" && offset) items = [];
    if (mode === "duplicate" && offset) items = [rows[0], ...items.slice(1)];
    return { tree: { id: 28, count: rows.length, total: rows.length, offset, fingerprint, truncated: false, items } };
  } };
  return { desktop, calls };
}

test("large native trigger trees are assembled across guarded pages", async () => {
  const { desktop, calls } = desktopFor("stable");
  const tree = await readTriggerTreePages(desktop, window, 28);
  assert.deepEqual(tree.items, rows);
  assert.deepEqual(calls.map(c => c.value), ["0", "128", "256"]);
  assert.deepEqual(calls.map(c => c.expected), ["", "original", "original"]);
});

test("a changed revision, incomplete page or duplicate handle cannot be assembled", async () => {
  for (const mode of ["changed", "incomplete", "duplicate"] as const) {
    const { desktop } = desktopFor(mode);
    await assert.rejects(readTriggerTreePages(desktop, window, 28), /LIVE_TRIGGER_TREE_PAGE_/);
  }
});

test("compact chat authoring preserves the tree page and its exact 64-bit fingerprint", () => {
  const fingerprint = "18160450125616126148";
  const steps = compileAuthorScript(`live trigger.tree archive=Current.SC2Map windowId=123 offset=128 expectedFingerprint=${fingerprint}`, "plan");
  assert.equal(steps[0].args.expectedFingerprint, fingerprint);
  const receipt = compactResult({ tree: { id: 28, count: 300, total: 300, offset: 128,
    fingerprint, truncated: true, items: rows.slice(128, 256) }, offset: 128, nextOffset: 256 }) as Record<string, any>;
  assert.equal(receipt.tree.fingerprint, fingerprint);
  assert.equal(receipt.tree.items.length, 128);
  assert.equal(receipt.nextOffset, 256);
});
