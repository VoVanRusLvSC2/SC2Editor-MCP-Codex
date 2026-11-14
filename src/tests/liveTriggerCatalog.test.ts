import test from "node:test";
import assert from "node:assert/strict";
import { captureTriggerCatalog } from "../modules/editorLive/triggerCatalog.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";
const archive = "K:/Maps/Unsaved.SC2Map";
const source = {
  windowId: "1",
  processId: 963751,
  processStart: "77",
  title: `Triggers - [${archive}*] - StarCraft II Editor`,
  enabled: true,
  acceptsFiles: true,
};
const data = { ...source, windowId: "2", title: source.title.replace("Triggers - [", "Data - [") };
function fixture(mode: "normal" | "missing" | "pending" = "normal") {
  const calls: number[] = [];
  let id = "",
    domain = "",
    observations = 0;
  const desktop: MemoryDesktop = {
    windows: async () => [source, data],
    command: async (_w, op, args) => {
      calls.push(op);
      if (op === 91) {
        if (mode === "pending") throw Error("LIVE_CATALOG_PENDING_INPUT_OR_VIEW_UNAVAILABLE");
        id = args!.unit!;
        domain = args!.value!;
        return { prepared: true };
      }
      if (op === 92) {
        if (mode === "missing" || ++observations === 1) return { ready: false };
        return { ready: true, id, domain, source: "Unsaved.SC2Map", label: id + " (Custom)" };
      }
      if (op === 93) return { viewRestored: true };
      assert.fail("Unexpected mutation " + op);
    },
  };
  return { desktop, calls };
}
test("live catalog reads unsaved committed IDs and restores the native filter for each domain", async () => {
  const f = fixture();
  const result = await captureTriggerCatalog(
    f.desktop,
    { archive, windowId: "1" },
    [
      { domain: "Unit", id: "UnsavedHero" },
      { domain: "Abil", id: "UnsavedSpell" },
    ],
    async () => {},
  );
  assert.equal(result.identities.length, 2);
  assert.equal(result.context.validate([{ domain: "Abil", id: "UnsavedSpell" }]), result.revision);
  assert.deepEqual(f.calls, [91, 92, 92, 93, 91, 92, 93]);
  const again = await captureTriggerCatalog(
    f.desktop,
    { archive, windowId: "1" },
    result.identities,
    async () => {},
  );
  assert.equal(again.revision, result.revision);
});
test("missing IDs restore the view and pending manual XML is never dismissed", async () => {
  const f = fixture("missing");
  await assert.rejects(
    captureTriggerCatalog(
      f.desktop,
      { archive, windowId: "1" },
      [{ domain: "Unit", id: "Missing" }],
      async () => {},
    ),
    /REFERENCE_UNRESOLVED/,
  );
  assert.equal(f.calls.at(-1), 93);
  assert.equal(f.calls.filter((op) => op === 91).length, 1);
  const pending = fixture("pending");
  await assert.rejects(
    captureTriggerCatalog(
      pending.desktop,
      { archive, windowId: "1" },
      [{ domain: "Unit", id: "Hero" }],
      async () => {},
    ),
    /PENDING_INPUT/,
  );
  assert.deepEqual(pending.calls, [91]);
});
