import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { TriggerWorkspace } from "../modules/trigger/workspace.js";
import {
  heroSelectionRecipe,
  heroSelectionSchema,
} from "../modules/trigger/recipes/heroSelection.js";
import { triggerPlanSchema } from "../modules/trigger/schemas.js";
import { compileAuthorScript } from "../app/authoringScript.js";

test("hero-selection recipe creates actual typed GUI, owned folders and bounded per-player state", () => {
  for (const count of [2, 20]) {
    const requests = heroSelectionRecipe({
      heroes: Array.from({ length: count }, (_, i) => "Hero" + i),
      players: [1, 2],
      spawn: { x: 24, y: 24 },
    });
    for (const request of requests)
      assert.equal(triggerPlanSchema.safeParse(request).success, true);
    assert.ok(requests.every((r) => r.create?.folder === "GAMEPLAY/HERO_SELECTION"));
    assert.ok(!JSON.stringify(requests).includes('"kind":"customScript"'));
    assert.equal(requests[0].variables?.find((v) => v.name === "HeroesHero")?.arraySizes?.[0], 15);
    const confirm = requests[2].calls;
    assert.equal(
      confirm.findIndex((c) => c.function === "SetVariable"),
      6,
    );
    assert.ok(
      confirm.findIndex((c) => c.function === "UnitCreate") >
        confirm.findIndex((c) => c.function === "SetVariable"),
    );
  }
  assert.equal(
    heroSelectionSchema.safeParse({ heroes: ["Marine", "Marine"], spawn: { x: 10, y: 10 } })
      .success,
    false,
  );
  const script = compileAuthorScript(
    "trigger recipe_hero_select prefix=Pick heroes=Marine,Marauder players=1,2 at=24,24",
    "save",
  );
  assert.deepEqual(
    script.map((s) => s.tool),
    ["trigger.recipe_hero_select", "trigger.apply", "trigger.save"],
  );
  assert.deepEqual(script[0].args.heroes, ["Marine", "Marauder"]);
});

test("hero selector plans and saves one editable GUI graph, then generates runtime from that same graph", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-hero-selection-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "Base.SC2Data/GameData"), { recursive: true });
  await fs.mkdir(path.join(root, "enUS.SC2Data/LocalizedData"), { recursive: true });
  await fs.writeFile(path.join(root, "Triggers"), "<TriggerData><Root/></TriggerData>");
  await fs.writeFile(
    path.join(root, "Base.SC2Data/GameData/UnitData.xml"),
    '<Catalog><CUnit id="Marine"/><CUnit id="Marauder"/></Catalog>',
  );
  await fs.writeFile(
    path.join(root, "Base.SC2Data/GameData.xml"),
    '<Includes><Catalog path="GameData/UnitData.xml"/></Includes>',
  );
  const workspace = new Workspace(root),
    data = new DataWorkspace(workspace),
    trigger = new TriggerWorkspace(workspace, undefined, data);
  const plan = await trigger.recipeHeroSelection({
    heroes: ["Marine", "Marauder"],
    spawn: { x: 24, y: 24 },
  });
  assert.equal(plan.system.selectedUnitVariable, "HeroesHero");
  assert.equal(workspace.draftFiles().length, 0);
  await trigger.applyPlan(plan.planId, false, true);
  await trigger.save();
  const xml = await fs.readFile(path.join(root, "Triggers"), "utf8");
  assert.ok(!xml.includes("ScriptCode") && !xml.includes('Type="CustomScript"'));
  assert.equal((await trigger.validate()).valid, true);
  const runtime = await trigger.generateRuntime(false, true);
  assert.ok(runtime.sourceBytes > 1000);
  await workspace.save("MapScript.galaxy", { backup: false });
  const galaxy = await fs.readFile(path.join(root, "MapScript.galaxy"), "utf8");
  assert.match(galaxy, /HeroesHero\[EventPlayer\(\)\] != null/);
  assert.match(galaxy, /TriggerAddEventDialogControl\(gt_HeroesBrowse, 16,/);
  assert.ok(!galaxy.includes("TriggerAddEventDialogControl(gt_HeroesBrowse, -1,"));
  assert.ok(!galaxy.includes('!= "null"'));
  assert.ok(galaxy.includes("UnitModel") || galaxy.includes("c_triggerControlTypeUnitModel"));
  assert.ok(
    galaxy.includes("HeroesLocked") &&
      galaxy.includes("HeroesHero") &&
      galaxy.includes("UnitCreate"),
  );
  assert.ok(
    (
      await fs.readFile(path.join(root, "enUS.SC2Data/LocalizedData/TriggerStrings.txt"), "utf8")
    ).includes("HERO_SELECTION"),
  );
  await assert.rejects(
    trigger.recipeHeroSelection({ heroes: ["Marine", "Marauder"], spawn: { x: 24, y: 24 } }),
  );
  assert.equal(await fs.readFile(path.join(root, "Triggers"), "utf8"), xml);
});
