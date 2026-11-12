import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { TriggerWorkspace } from "../modules/trigger/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { bindGuiCatalogContext } from "../modules/trigger/catalogContext.js";
import type { GuiRequest } from "../modules/trigger/authoring.js";
const integer = (value: number) => ({ kind: "literal" as const, type: "int" as const, value });
const spawn = (id: string): GuiRequest => ({
  create: { identifier: "Spawn" + id },
  calls: [
    {
      kind: "Action",
      function: "UnitCreate",
      args: {
        count: integer(1),
        type: { kind: "gamelink", domain: "Unit", id },
        flags: { kind: "preset", name: "Birth" },
        player: integer(15),
        pos: {
          kind: "call",
          function: "Point",
          args: {
            x: { kind: "literal", type: "fixed", value: 16 },
            y: { kind: "literal", type: "fixed", value: 16 },
          },
        },
        angle: { kind: "literal", type: "fixed", value: 0 },
      },
    },
  ],
});
async function fixture(t: { after(f: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sc2-live-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "enUS.SC2Data/LocalizedData"), { recursive: true });
  await writeFile(path.join(root, "Triggers"), "<TriggerData><Root/></TriggerData>");
  const ws = new Workspace(root);
  return { ws, trigger: new TriggerWorkspace(ws, undefined, new DataWorkspace(ws)) };
}
test("live identity context feeds the existing GUI generator without fake Data entries", async (t) => {
  const { trigger, ws } = await fixture(t);
  await assert.rejects(trigger.plan(spawn("Marauder")), /GAMELINK_UNRESOLVED/);
  trigger.guiCatalogContext = bindGuiCatalogContext([
    { domain: "Unit", id: "Marauder", source: "Liberty.SC2Mod" },
  ]);
  const p = await trigger.plan(spawn("Marauder"));
  await trigger.applyPlan(p.planId, false);
  assert.ok((await ws.readRaw("Triggers")).text.includes("Marauder"));
  assert.deepEqual(
    ws.draftFiles().filter((f) => f.includes("GameData")),
    [],
  );
  await assert.rejects(trigger.plan(spawn("UnknownUnit")), /GAMELINK_UNRESOLVED/);
});
test("batch planning inherits the exact catalog evidence and stale identities stop application", async (t) => {
  const { trigger } = await fixture(t);
  trigger.guiCatalogContext = bindGuiCatalogContext([
    { domain: "Unit", id: "Marine", source: "Core" },
    { domain: "Unit", id: "Marauder", source: "User.SC2Map" },
  ]);
  const batch = await trigger.planBatch([spawn("Marine"), spawn("Marauder")]);
  trigger.guiCatalogContext = bindGuiCatalogContext([
    { domain: "Unit", id: "Marine", source: "Core" },
    { domain: "Unit", id: "Marauder", source: "Changed.SC2Mod" },
  ]);
  await assert.rejects(trigger.applyPlan(batch.planId, false), /DEPENDENCY_STALE/);
});
test("catalog evidence cannot authorize another domain or change through its source array", () => {
  const rows = [{ domain: "Unit", id: "Same", source: "Map" }],
    bound = bindGuiCatalogContext(rows);
  rows[0].id = "Other";
  assert.equal(bound.validate([{ domain: "Unit", id: "Same" }]), bound.revision);
  assert.throws(() => bound.validate([{ domain: "Effect", id: "Same" }]), /GAMELINK_UNRESOLVED/);
  assert.throws(
    () =>
      bindGuiCatalogContext([
        { domain: "Unit", id: "A", source: "X" },
        { domain: "Unit", id: "A", source: "Y" },
      ]),
    /IDENTITIES_INVALID/,
  );
});
