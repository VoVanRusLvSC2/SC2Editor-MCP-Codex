import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { DataDocument } from "../modules/data/document.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { DataSchemaRegistry } from "../modules/data/schemaRegistry.js";

async function fixture(files: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-data-"));
  await fs.writeFile(path.join(root, "ComponentList.SC2Components"), `<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n    <DataComponent Type="info">DocumentInfo</DataComponent>\r\n</Components>`);
  for (const [file, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  const workspace = new Workspace(root, await SchemaRegistry.loadBundled());
  return { root, workspace, data: new DataWorkspace(workspace) };
}

test("GameData open/parse is byte-identical and preserves unknown extensions", () => {
  const source = `<?xml version="1.0"?>\r\n<Catalog future="yes">\r\n    <!--keep-->\r\n    <CUnit id="X" parent="Marine" custom="opaque"><Future foo='bar'><Nested/></Future></CUnit>\r\n</Catalog>`;
  const document = new DataDocument(source);
  assert.equal(document.source, source);
  assert.equal(document.objects(true)[0].attrs.custom, "opaque");
  assert.match(document.objects(true)[0].rawSource!, /<Future foo='bar'>/);
});

test("data.apply creates a missing Catalog and registers the native gada component", async () => {
  const { root, data } = await fixture();
  const result = await data.apply({ operations: [{ op: "object.create", ctype: "CUnit", id: "CodexMarine", parent: "Marine" }], dryRun: false, stage: false });
  assert.equal(result.accepted, true);
  assert.match(await fs.readFile(path.join(root, "Base.SC2Data/GameData/UnitData.xml"), "utf8"), /<CUnit id="CodexMarine" parent="Marine"\/>/);
  assert.match(await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8"), /<DataComponent Type="gada">GameData<\/DataComponent>/);
  assert.match(await fs.readFile(path.join(root, "Base.SC2Data/GameData.xml"), "utf8"), /<Catalog path="GameData\/UnitData.xml"\/>/);
});

test("new Data objects keep the Catalog closing tag on its own line", async () => {
  const { root, data } = await fixture();
  await data.apply({ operations: [
    { op: "object.create", ctype: "CEffectDamage", id: "One" },
    { op: "object.create", ctype: "CEffectSet", id: "Two" },
  ], dryRun: false, stage: false });
  const source = await fs.readFile(path.join(root, "Base.SC2Data/GameData/UnitData.xml"), "utf8");
  assert.match(source, /<CEffectSet id="Two"\/>\r\n<\/Catalog>$/);
});

test("data.apply defaults to dry-run and writes nothing", async () => {
  const { root, data } = await fixture();
  const result = await data.apply({ operations: [{ op: "object.create", ctype: "CUnit", id: "Preview" }] });
  assert.ok(result.files.some((entry) => entry.changed));
  await assert.rejects(fs.stat(path.join(root, "Base.SC2Data/GameData/UnitData.xml")));
  await assert.rejects(fs.stat(path.join(root, "Base.SC2Data/GameData.xml")));
  assert.doesNotMatch(await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8"), /gada/);
});

test("one batch creates and patches nested/indexed fields through an alias", async () => {
  const { data } = await fixture();
  const result = await data.apply({ operations: [
    { op: "object.create", as: "unit", ctype: "CUnit", id: "Hero", fields: [{ name: "LifeMax", value: 100 }] },
    { op: "field.set", object: "@unit", path: "LifeMax", value: 500 },
    { op: "field.set", object: "@unit", path: "FlagArray[ArmySelect]", value: true },
    { op: "field.setLink", object: "@unit", path: "WeaponArray[0]", link: "HeroWeapon" },
    { op: "native.add", object: "@unit", field: { name: "Future", attrs: { opaque: "yes" }, children: [{ name: "Nested", value: 7 }] } },
  ], dryRun: false, stage: true, allowInvalid: true });
  assert.equal(result.aliases["@unit"], "CUnit:Hero");
  const text = (await data.workspace.readRaw("Base.SC2Data/GameData/UnitData.xml")).text;
  assert.match(text, /<LifeMax value="500"\/>/);
  assert.match(text, /<FlagArray index="ArmySelect" value="1"\/>/);
  assert.match(text, /<WeaponArray index="0" Link="HeroWeapon"\/>/);
  assert.match(text, /<Future opaque="yes">[\s\S]*<Nested value="7"\/>/);
});

test("array.append uses the next numeric index and preserves token indexes", async () => {
  const { data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": `<Catalog><CUnit id="X"><AbilArray index="0" Link="A"/><AbilArray index="2" Link="B"/><AbilArray index="Named" Link="C"/></CUnit></Catalog>` });
  await data.apply({ operations: [{ op: "array.append", object: "X", path: "AbilArray", link: "D" }], dryRun: false, stage: true, allowInvalid: true });
  assert.match((await data.workspace.readRaw("Base.SC2Data/GameData/UnitData.xml")).text, /<AbilArray index="3" Link="D"\/>/);
});

test("clone carries unknown native XML and allows a new parent", async () => {
  const { data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": `<Catalog>\n    <CUnit id="A"><Unknown x="1"/></CUnit>\n</Catalog>` });
  await data.apply({ operations: [{ op: "object.clone", object: "A", id: "B", parent: "Marine" }], dryRun: false, stage: true, allowInvalid: true });
  const text = (await data.workspace.readRaw("Base.SC2Data/GameData/UnitData.xml")).text;
  assert.match(text, /<CUnit parent="Marine" id="B"><Unknown x="1"\/><\/CUnit>/);
});

test("typed parent and Link references update across catalog files on rename", async () => {
  const { root, data } = await fixture({
    "Base.SC2Data/GameData/UnitData.xml": `<Catalog><CUnit id="Old"/></Catalog>`,
    "Base.SC2Data/GameData/ActorData.xml": `<Catalog><CActorUnit id="OldActor"><UnitName Link="Old"/></CActorUnit></Catalog>`,
    "Base.SC2Data/GameData/MoreUnitData.xml": `<Catalog><CUnit id="Child" parent="Old"/></Catalog>`,
  });
  await data.apply({ file: "Base.SC2Data/GameData/UnitData.xml", operations: [{ op: "object.rename", object: "Old", newId: "New", updateReferences: true }], dryRun: false, stage: false, allowInvalid: true });
  assert.match(await fs.readFile(path.join(root, "Base.SC2Data/GameData/ActorData.xml"), "utf8"), /Link="New"/);
  assert.match(await fs.readFile(path.join(root, "Base.SC2Data/GameData/MoreUnitData.xml"), "utf8"), /parent="New"/);
});

test("delete is blocked by live references and the transaction rolls back", async () => {
  const source = `<Catalog><CUnit id="A"/><CUnit id="B" parent="A"/></Catalog>`;
  const { root, data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": source });
  await assert.rejects(data.apply({ operations: [{ op: "object.delete", object: "A" }], dryRun: false, stage: false }), /incoming reference/);
  assert.equal(await fs.readFile(path.join(root, "Base.SC2Data/GameData/UnitData.xml"), "utf8"), source);
});

test("failed late operation rolls back object creation and component registration", async () => {
  const { root, data } = await fixture();
  await assert.rejects(data.apply({ operations: [
    { op: "object.create", ctype: "CUnit", id: "Same" },
    { op: "object.create", ctype: "CUnit", id: "Same" },
  ], dryRun: false, stage: false }), /already exists/);
  await assert.rejects(fs.stat(path.join(root, "Base.SC2Data/GameData/UnitData.xml")));
  assert.doesNotMatch(await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8"), /gada/);
});

test("context resolves inherited fields and describe_type is corpus-driven", async () => {
  const { data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": `<Catalog><CUnit id="Base"><LifeMax value="45"/><CostResource index="Minerals" value="50"/></CUnit><CUnit id="Child" parent="Base"><LifeMax value="60"/></CUnit></Catalog>` });
  const context = await data.context({ ids: ["Child"] });
  assert.equal(context.objects[0].effective!.fields.LifeMax.value, "60");
  assert.equal(context.objects[0].effective!.fields["CostResource[Minerals]"].value, "50");
  const described = await data.describeType("CUnit");
  assert.ok(described.types[0].properties.some((field) => field.path === "LifeMax"));
});

test("selective context projects fields and omits unrelated file indexes", async () => {
  const { data } = await fixture({
    "Base.SC2Data/GameData/UnitData.xml": `<Catalog><CUnit id="Marine"><LifeMax value="45"/><LifeArmor value="0"/></CUnit></Catalog>`,
    "Base.SC2Data/GameData/WeaponData.xml": `<Catalog><CWeaponLegacy id="Gauss"><Effect value="GaussDamage"/></CWeaponLegacy></Catalog>`,
  });
  const context = await data.context({ ids: ["Marine"], fields: ["LifeMax"], includeReferences: false });
  assert.deepEqual(context.files.map((entry) => entry.file), ["Base.SC2Data/GameData/UnitData.xml"]);
  assert.deepEqual(context.objects[0].fields.map((field) => field.path), ["LifeMax"]);
  assert.deepEqual(Object.keys(context.objects[0].effective!.fields), ["LifeMax"]);
  assert.equal(context.corpusSummary.files, 2);
});

test("validation reports missing links with exact object/field path", async () => {
  const { data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": `<Catalog><CUnit id="X"><WeaponArray index="0" Link="MissingWeapon"/></CUnit></Catalog>` });
  const report = await data.validate();
  assert.equal(report.valid, true);
  assert.ok(report.diagnostics.some((entry) => entry.code === "DATA_LINK_UNRESOLVED" && entry.path === "CUnit:X.WeaponArray[0]@Link"));
  assert.equal(report.levels.L5, "UNAVAILABLE");
  assert.equal(report.levels.L6, "UNTESTED");
});

test("observed semantic validation checks enum candidates and value-carried catalog references", async () => {
  const { workspace } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": `<Catalog><CEffectDamage id="Known"/><CEffectSet id="Valid"><EffectArray index="0" value="Known"/></CEffectSet><CEffectSet id="Missing"><EffectArray index="0" value="Absent"/></CEffectSet><CValidatorUnitCompareVital id="Bad"><Compare value="NOPE"/></CValidatorUnitCompareVital></Catalog>` });
  const data = new DataWorkspace(workspace, await DataSchemaRegistry.load());
  const report = await data.validate();
  assert.ok(report.diagnostics.some((entry) => entry.code === "DATA_VALUE_REFERENCE_UNRESOLVED" && entry.path === "CEffectSet:Missing.EffectArray[0]@value"));
  assert.ok(!report.diagnostics.some((entry) => entry.code === "DATA_VALUE_REFERENCE_UNRESOLVED" && entry.path === "CEffectSet:Valid.EffectArray[0]@value"));
  assert.ok(report.diagnostics.some((entry) => entry.code === "DATA_VALUE_ENUM_UNOBSERVED" && entry.path === "CValidatorUnitCompareVital:Bad.Compare"));
});

test("generic object/field attributes can be set and removed without rewriting unknown XML", async () => {
  const source = `<Catalog>\n  <CUnit id="X" custom="keep"><LifeMax value="10" future="old"/><Unknown z="1"/></CUnit>\n</Catalog>`;
  const { data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": source });
  await data.apply({ operations: [
    { op: "object.setAttribute", object: "X", attribute: "editorOnly", value: true },
    { op: "field.setAttribute", object: "X", path: "LifeMax", attribute: "future", value: "new" },
    { op: "field.removeAttribute", object: "X", path: "LifeMax", attribute: "future" },
    { op: "object.removeAttribute", object: "X", attribute: "editorOnly" },
  ], dryRun: false, stage: true, allowInvalid: true });
  const text = (await data.workspace.readRaw("Base.SC2Data/GameData/UnitData.xml")).text;
  assert.match(text, /<CUnit id="X" custom="keep">/);
  assert.match(text, /<LifeMax value="10"\/>/);
  assert.match(text, /<Unknown z="1"\/>/);
});

test("rename refuses ambiguous cross-domain Link targets", async () => {
  const source = `<Catalog><CUnit id="Shared"/><CWeapon id="Shared"/><CActorUnit id="Consumer"><UnitName Link="Shared"/></CActorUnit></Catalog>`;
  const { root, data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": source });
  await assert.rejects(data.apply({ operations: [{ op: "object.rename", object: { ctype: "CUnit", id: "Shared" }, newId: "UnitOnly", updateReferences: true }], dryRun: false, stage: false, allowInvalid: true }), /ambiguous catalog id/);
  assert.equal(await fs.readFile(path.join(root, "Base.SC2Data/GameData/UnitData.xml"), "utf8"), source);
});

test("stage=false writes backups for every existing changed Data file", async () => {
  const source = `<Catalog><CUnit id="X"><LifeMax value="10"/></CUnit></Catalog>`;
  const { root, data } = await fixture({ "Base.SC2Data/GameData/UnitData.xml": source });
  await data.apply({ operations: [{ op: "field.set", object: "X", path: "LifeMax", value: 20 }], dryRun: false, stage: false, allowInvalid: true });
  assert.equal(await fs.readFile(path.join(root, "Base.SC2Data/GameData/UnitData.xml.sc2uimcp.bak"), "utf8"), source);
});

test("weapon burn recipe expands one semantic operation into the native linked Data graph", async () => {
  const { data } = await fixture();
  const result = await data.apply({ operations: [{
    op: "recipe.weaponBurn", as: "burn", id: "CodexReaperBurn",
    carrierEffect: "P38ScytheGuassPistolBurst", impactEffect: "P38ScytheGuassPistol",
    duration: 4, period: 0.5, periodicDamage: 2,
    visualModel: "HellionTankAttackFireAddition",
  }], dryRun: false, stage: true });
  assert.equal(result.aliases["@burn"], "CBehaviorBuff:CodexReaperBurn");
  const source = (await data.workspace.readRaw("Base.SC2Data/GameData/UnitData.xml")).text;
  assert.match(source, /<CBehaviorBuff id="CodexReaperBurn">[\s\S]*<Period value="0.5"\/>[\s\S]*<PeriodicEffect value="CodexReaperBurnPeriodicDamage"\/>/);
  assert.match(source, /<CEffectSet id="CodexReaperBurnHitSet">[\s\S]*<EffectArray index="0" value="P38ScytheGuassPistol"\/>[\s\S]*<EffectArray index="1" value="CodexReaperBurnApply"\/>/);
  assert.match(source, /<CActorModel id="CodexReaperBurnVisual" parent="ModelAnimationStyleOneShot">[\s\S]*<Host Subject="_Unit"\/>/);
  assert.match(source, /<CEffectCreatePersistent id="P38ScytheGuassPistolBurst">[\s\S]*<PeriodicEffectArray index="0" value="CodexReaperBurnHitSet"\/>/);
});

test("vital texture recipe creates reversible multi-slot texture states at an exact fraction", async () => {
  const { data } = await fixture();
  const result = await data.apply({ operations: [{
    op: "recipe.unitTextureByVital", as: "skin", id: "CodexReaperDamageSkin", unit: "Reaper",
    threshold: 0.4, pollInterval: 0.25,
    textures: [
      { slot: "main.diffuse", healthyFile: "Assets\\Textures\\codex_reaper_normal.dds", damagedFile: "Assets\\Textures\\codex_reaper_burned.dds" },
      { slot: "main.emissive", healthyFile: "Assets\\Textures\\codex_reaper_normal_emissive.dds", damagedFile: "Assets\\Textures\\codex_reaper_burned_emissive.dds" },
    ],
  }], dryRun: false, stage: true });
  assert.equal(result.aliases["@skin"], "CActorStateMonitor:CodexReaperDamageSkinMonitor");
  const source = (await data.workspace.readRaw("Base.SC2Data/GameData/UnitData.xml")).text;
  assert.match(source, /<CValidatorUnitCompareVital id="CodexReaperDamageSkinLifeBelow" parent="CasterLifePercent">[\s\S]*<Compare value="LT"\/>[\s\S]*<Value value="0.4"\/>/);
  assert.match(source, /<CTexture id="CodexReaperDamageSkinDamagedTexture0">[\s\S]*<Slot value="main.diffuse"\/>/);
  assert.match(source, /<On Terms="StateChange; StateValid Damaged" Target="_Unit" Send="TextureSelectById CodexReaperDamageSkinDamagedTexture1"\/>/);
  assert.match(source, /<StateArray Name="Healthy" Terms="!ValidateUnit CodexReaperDamageSkinLifeBelow"\/>/);
  assert.match(source, /<StateThinkInterval value="0.25"\/>/);
});

test("late failure rolls back every object expanded by a Data recipe", async () => {
  const { root, data } = await fixture();
  await assert.rejects(data.apply({ operations: [
    { op: "recipe.weaponBurn", id: "AtomicBurn", carrierEffect: "Burst", impactEffect: "Impact", duration: 4, period: 0.5, periodicDamage: 2, visualModel: "Fire" },
    { op: "object.create", ctype: "CBehaviorBuff", id: "AtomicBurn" },
  ], dryRun: false, stage: false }), /already exists/);
  await assert.rejects(fs.stat(path.join(root, "Base.SC2Data/GameData/UnitData.xml")));
  assert.doesNotMatch(await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8"), /gada/);
});
