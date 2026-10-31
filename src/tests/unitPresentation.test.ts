import test from "node:test";
import assert from "node:assert/strict";
import { DataDocument } from "../modules/data/document.js";
import { inspectUnitPresentation } from "../modules/data/unitPresentation.js";
import { inspectEffectPresentation } from "../modules/data/presentation.js";

const declarations = (xml: string) =>
  new DataDocument(`<Catalog>${xml}</Catalog>`)
    .objects()
    .map((object) => ({ ...object, file: "Test.xml" }));
const graph = `<CUnit id="Base"><WeaponArray index="0" Link="Gun"/></CUnit><CUnit id="Hero" parent="Base"/>
<CActorUnit id="Generic"/><CActorUnit id="Hero" parent="Generic" unitName="Hero"><Model value="Body"/><WalkAnimMoveSpeed value="2.25"/><On index="1" Terms="WeaponStart.OldGun.AttackStart" Send="AnimBracketStart Attack Attack"/></CActorUnit>
<CModel id="Body"/><CModel id="Impact"/><CModel id="Ammo"/><CWeapon id="Gun"><Effect value="Hit"/></CWeapon><CEffectDamage id="Hit"/>
<CActorAction id="Action" parent="GenericAttack" effectAttack="Hit"><ImpactMap index="None" Model="Impact"/></CActorAction>`;

test("unit audit identifies inherited weapons and exact animation selector mismatch without changing source", () => {
  const objects = declarations(graph),
    before = JSON.stringify(objects),
    report = inspectUnitPresentation(objects, { unit: "Hero" });
  assert.equal(report.primaryActors[0].model, "Body");
  assert.equal(report.weapons[0].id, "Gun");
  assert.deepEqual(report.weapons[0].effects, ["Hit"]);
  assert.equal(report.effects[0].presentation, "declared_links_found");
  assert.ok(
    report.findings.some(
      (f) => f.code === "PRESENTATION_ATTACK_WEAPON_MISMATCH" && f.detail === "OldGun",
    ),
  );
  assert.equal(report.nativePlayback, "not_checked");
  assert.equal(report.assetResolution, "not_checked");
  assert.equal(JSON.stringify(objects), before);
});
test("effect audit recognizes GenericAttack assets and native Missile model links without pretending to render them", () => {
  const objects = declarations(
    graph +
      `<CEffectLaunchMissile id="Launch"/><CActorMissile id="MissileBase"><Model value="##unitName##"/></CActorMissile><CActorMissile id="Missile" parent="MissileBase" unitName="Ammo"/><CActorAction id="Travel" parent="GenericAttack" effectLaunch="Launch"><Missile value="Missile"/></CActorAction>`,
  );
  const report = inspectEffectPresentation(objects, { effects: ["Launch"] }).effects[0];
  assert.equal(report.presentation, "declared_links_found");
  assert.equal(report.bindings[0].declaredCreateEvent, false);
  assert.equal(report.bindings[0].activation, "generic_attack_selectors");
  assert.equal(report.bindings[0].declaredVisualLinks[0].id, "Ammo");
  assert.equal(report.bindings[0].assetResolution, "not_checked");
  const removed = inspectEffectPresentation(
    declarations(graph.replace('Model="Impact"', 'Model="Impact" removed="1"')),
    { effects: ["Hit"] },
  );
  assert.equal(removed.effects[0].presentation, "needs_resolution");
});
test("ambiguity, cycles and exhausted effect budgets stay explicit and do not select a convenient declaration", () => {
  const objects = declarations(
    graph.replace('<Effect value="Hit"/>', '<Effect value="Hit"/><Effect value="Other"/>') +
      '<CEffectDamage id="Other"/>',
  );
  const report = inspectUnitPresentation(objects, { unit: "Hero", maxEffects: 1 });
  assert.equal(report.effectsTruncated, true);
  const ambiguous = inspectUnitPresentation(
    [...objects, ...declarations('<CActorUnit id="Second" unitName="Hero"/>')],
    { unit: "Hero" },
  );
  assert.ok(ambiguous.findings.some((f) => f.code === "PRESENTATION_MAIN_ACTOR_UNRESOLVED"));
  const cycle = inspectUnitPresentation(
    declarations('<CUnit id="A" parent="B"/><CUnit id="B" parent="A"/>'),
    { unit: "A" },
  );
  assert.ok(cycle.findings.some((f) => f.code === "PRESENTATION_PARENT_CYCLE_OR_LIMIT"));
});
