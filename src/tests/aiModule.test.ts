import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { AiDocument } from "../modules/ai/document.js";
import { AiSchemaRegistry } from "../modules/ai/schemaRegistry.js";
import { AiWorkspace } from "../modules/ai/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { dispatchGuiApi } from "../gui/api.js";
import { PlacementWorkspace } from "../modules/placement/workspace.js";
import { createHash } from "node:crypto";

async function fixture(customAi?: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ai-"));
  await fs.writeFile(path.join(root, "ComponentList.SC2Components"), `<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n    <DataComponent Type="info">DocumentInfo</DataComponent>\r\n</Components>`);
  if (customAi !== undefined) await fs.writeFile(path.join(root, "CustomAI"), customAi);
  const core = new Workspace(root, await SchemaRegistry.loadBundled());
  return { root, core, ai: new AiWorkspace(core, await AiSchemaRegistry.load()) };
}

test("CustomAI open/parse is byte-identical and preserves unknown extensions", async () => {
  const source = `<?xml version="1.0" encoding="utf-8"?>\r\n<AIData future="yes">\r\n    <!-- keep -->\r\n    <Definition Id="A"><Future x='1'><Nested opaque="yes"/></Future></Definition>\r\n</AIData>`;
  const document = new AiDocument(source);
  assert.equal(document.source, source);
  const ir = document.toIR(await AiSchemaRegistry.load(), true);
  assert.equal(ir.definitions[0].id, "A");
  assert.deepEqual(ir.definitions[0].unknownChildren, ["Future"]);
  assert.match(ir.definitions[0].rawSource!, /opaque="yes"/);
});

test("previously extracted CustomAI samples retain exact original bytes and native Definition IDs", async () => {
  const fixtures = JSON.parse(await fs.readFile("src/tests/fixtures/ai-observed-documents.json", "utf8")) as Array<{ name: string; sha256: string; bytes: string }>;
  const schema = await AiSchemaRegistry.load();
  for (const fixture of fixtures) {
    const bytes = Buffer.from(fixture.bytes, "base64");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
    const document = new AiDocument(bytes.toString("utf8"));
    assert.equal(createHash("sha256").update(document.source, "utf8").digest("hex"), fixture.sha256);
    assert.equal(document.toIR(schema).root, "AIData");
    if (fixture.name === "UA3.CustomAI") assert.equal(document.toIR(schema).definitions[0].id, "71EEC1FA");
  }
});

test("AI preserves single-quoted XML when editing IDs containing apostrophes", async () => {
  const { ai } = await fixture(`<AIData><Definition Id='A' unknown='keep'/></AIData>`);
  await ai.apply({ operations: [{ op: "definition.rename", definition: "A", newId: "Enemy's AI" }], dryRun: false, stage: true });
  const source = (await ai.open()).document.source;
  assert.match(source, /Id='Enemy&apos;s AI' unknown='keep'/);
  assert.equal((await ai.validate()).levels.L1, "PASS");
});

test("ai.apply creates missing CustomAI and registers aiai atomically", async () => {
  const { root, ai } = await fixture();
  const result = await ai.apply({ operations: [{ op: "definition.create", as: "enemy", id: "EnemyAI" }], dryRun: false, stage: false });
  assert.equal(result.accepted, true);
  assert.equal(result.aliases["@enemy"], "Definition:EnemyAI");
  assert.match(await fs.readFile(path.join(root, "CustomAI"), "utf8"), /<AIData>[\s\S]*<Definition Id="EnemyAI"\/>/);
  assert.match(await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8"), /<DataComponent Type="aiai">CustomAI<\/DataComponent>/);
});

test("dry-run creates neither CustomAI nor component entry", async () => {
  const { root, ai } = await fixture();
  const result = await ai.apply({ operations: [{ op: "definition.create", id: "Preview" }] });
  assert.equal(result.files.some((entry) => entry.changed), true);
  await assert.rejects(fs.stat(path.join(root, "CustomAI")));
  assert.doesNotMatch(await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8"), /aiai/);
});

test("one batch creates a definition and multiple inferred waves with aliases", async () => {
  const { root, ai } = await fixture();
  await fs.mkdir(path.join(root, "Base.SC2Data/GameData"), { recursive: true });
  await fs.writeFile(path.join(root, "Base.SC2Data/GameData/UnitData.xml"), `<Catalog><CUnit id="Zergling"/><CUnit id="Roach"/></Catalog>`);
  await ai.references.refresh();
  const result = await ai.apply({ operations: [
    { op: "definition.create", as: "enemy", id: "ZergP3" },
    { op: "wave.create", definition: "@enemy", as: "w1", id: "Wave0400", properties: { SourcePlayer: 3, TargetPlayer: 1, Time: 240 }, composition: [{ unit: "Zergling", quantity: 12 }], allowUnconfirmedStructure: true },
    { op: "wave.create", definition: "@enemy", id: "Wave0600", properties: { Time: 360 }, composition: [{ unit: "Roach", quantity: 8 }, { unit: "Zergling", quantity: 12 }], allowUnconfirmedStructure: true },
  ], dryRun: false, stage: false });
  assert.equal(result.validation?.valid, true);
  const opened = await ai.open();
  const ir = opened.document.toIR(ai.schema);
  assert.equal(ir.waves.length, 2);
  assert.equal(ir.waves[1].composition.length, 2);
  assert.equal(result.efficiency.operations, 3);
});

test("validation reports exact missing unit path and rolls back the whole batch", async () => {
  const source = `<AIData>\n    <Definition Id="Existing"/>\n</AIData>`;
  const { root, ai } = await fixture(source);
  await assert.rejects(ai.apply({ operations: [
    { op: "definition.create", as: "new", id: "New" },
    { op: "wave.create", definition: "@new", id: "Broken", composition: [{ unit: "MissingUnit", quantity: 1 }], allowUnconfirmedStructure: true },
  ], dryRun: false, stage: false }), /AI validation failed/);
  assert.equal(await fs.readFile(path.join(root, "CustomAI"), "utf8"), source);
  assert.equal(ai.workspace.hasDraft("CustomAI"), false);
});

test("typed aidef Trigger references are read-only and block rename/delete", async () => {
  const source = `<AIData>\n    <Definition Id="Old"/>\n</AIData>`;
  const { root, ai } = await fixture(source);
  await fs.writeFile(path.join(root, "Triggers"), `<TriggerData><Element Type="Param" ValueType="aidef" Value="Old"/></TriggerData>`);
  await ai.references.refresh();
  await assert.rejects(ai.apply({ operations: [{ op: "definition.delete", definition: "Old" }], dryRun: false, stage: false }), /incoming reference/);
  await assert.rejects(ai.apply({ operations: [{ op: "definition.rename", definition: "Old", newId: "Renamed", updateReferences: true }], dryRun: false, stage: false }), /AI_TRIGGER_EDITING_DISABLED/);
  assert.match(await fs.readFile(path.join(root, "Triggers"), "utf8"), /Value="Old"/);
  assert.equal(await fs.readFile(path.join(root, "CustomAI"), "utf8"), source);
});

test("AI write scope rejects Trigger/Terrain files and non-sibling component paths", async () => {
  const { root, ai } = await fixture();
  for (const file of ["Triggers", "t3Terrain.xml", "../CustomAI", "/CustomAI"]) await assert.rejects(ai.apply({ file, operations: [{ op: "definition.create", id: "X" }], dryRun: false, stage: false }), /AI_WRITE_SCOPE/);
  await assert.rejects(ai.apply({ componentListFile: "Triggers", operations: [{ op: "definition.create", id: "X" }] }), /AI_WRITE_SCOPE/);
  await assert.rejects(fs.stat(path.join(root, "CustomAI")));
});

test("force/native/validation opt-outs cannot break read-only aidefwave links", async () => {
  const source = `<AIData><Definition Id="A"><Wave Id="W"/></Definition></AIData>`;
  const { root, ai } = await fixture(source);
  await fs.writeFile(path.join(root, "Triggers"), `<TriggerData><Element ValueType="aidefwave" Value="W"/></TriggerData>`);
  for (const operation of [
    { op: "wave.delete" as const, wave: "W", force: true },
    { op: "wave.rename" as const, wave: "W", newId: "X", updateReferences: true },
    { op: "definition.delete" as const, definition: "A", force: true },
    { op: "native.remove" as const, node: "A", force: true },
  ]) await assert.rejects(ai.apply({ operations: [operation], validate: false, allowInvalid: true, dryRun: false, stage: false }), /AI_TRIGGER_EDITING_DISABLED|reference-safe removal/);
  assert.equal(await fs.readFile(path.join(root, "CustomAI"), "utf8"), source);
  assert.equal(ai.workspace.hasDraft("CustomAI"), false);
});

test("AI reference cache observes changed and staged Trigger links", async () => {
  const { root, core, ai } = await fixture(`<AIData><Definition Id="A"/></AIData>`);
  await ai.context();
  await core.applyRawTransaction(["Triggers"], () => new Map([["Triggers", `<TriggerData><Element ValueType="aidef" Value="A"/></TriggerData>`]]), { dryRun: false, stage: true });
  await assert.rejects(ai.apply({ operations: [{ op: "definition.rename", definition: "A", newId: "B" }] }), /AI_TRIGGER_EDITING_DISABLED/);
  core.discard("Triggers");
  await fs.writeFile(path.join(root, "Triggers"), `<TriggerData><Element ValueType="aidef" Value="A"/></TriggerData>`);
  await assert.rejects(ai.apply({ operations: [{ op: "definition.rename", definition: "A", newId: "B" }] }), /AI_TRIGGER_EDITING_DISABLED/);
  await core.applyRawTransaction(["Triggers"], () => new Map([["Triggers", `<TriggerData/>`]]), { dryRun: false, stage: true });
  const result = await ai.apply({ operations: [{ op: "definition.rename", definition: "A", newId: "B" }] });
  assert.ok(result.files.some((file) => file.changed));
  const preview = await ai.apply({ operations: [{ op: "definition.create", id: "Future" }] });
  await core.applyRawTransaction(["CustomAI"], () => new Map([["CustomAI", `<AIData><Definition Id="Staged"/></AIData>`]]), { dryRun: false, stage: true });
  await assert.rejects(ai.apply({ operations: [{ op: "definition.create", id: "Future" }], expectedSourceSha256: preview.sourceSha256, dryRun: false, stage: false }), /AI_STALE_SOURCE/);
});

test("AI and Browse reject installed-but-undeclared units and accept declared dependencies", async () => {
  const { root, core } = await fixture();
  const mod = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ai-dependency-"));
  await fs.writeFile(path.join(mod, "UnitData.xml"), `<Catalog><CUnit id="CustomUnit"/></Catalog>`);
  const data = new DataWorkspace(core, undefined, [mod]);
  const browse = new BrowseWorkspace(core, data);
  const ai = new AiWorkspace(core, await AiSchemaRegistry.load(), data, browse);
  const operations = [{ op: "definition.create" as const, as: "a", id: "A" }, { op: "wave.create" as const, definition: "@a", id: "W", composition: [{ unit: "CustomUnit", quantity: 2 }], allowUnconfirmedStructure: true }];
  await assert.rejects(ai.apply({ operations }), /AI validation failed/);
  await fs.writeFile(path.join(root, "DocumentInfo"), `<DocInfo><Dependencies><Value>file:${path.basename(mod)}</Value></Dependencies></DocInfo>`);
  const result = await ai.apply({ operations });
  assert.equal(result.validation?.valid, true);
});

test("AI rejects duplicate/ambiguous identities and wrong operation selectors", async () => {
  const { ai } = await fixture(`<AIData><Definition Id="A"><Wave Id="W"/></Definition><Definition Id="B"><Wave Id="W"/></Definition></AIData>`);
  await assert.rejects(ai.apply({ operations: [{ op: "wave.rename", wave: "W", newId: "New" }] }), /Ambiguous/);
  await assert.rejects(ai.apply({ operations: [{ op: "definition.rename", definition: { nativeType: "Wave", occurrence: 0 }, newId: "New" }] }), /requires Definition/);
  await assert.rejects(ai.apply({ operations: [{ op: "definition.clone", definition: "A", id: "B" }] }), /Ambiguous|validation failed/);
});

test("AI recursive native creation cannot bypass inferred structure gates", async () => {
  const { ai } = await fixture();
  await assert.rejects(ai.apply({ operations: [{ op: "native.add", node: { nativeType: "Definition", attrs: { Id: "A" }, children: [{ nativeType: "Wave", attrs: { Id: "W" } }] } }] }), /not confirmed writable/);
  await assert.rejects(ai.apply({ operations: [{ op: "definition.create", as: "a", id: "A" }, { op: "native.set", node: "@a", property: "Active", value: true }] }), /GATED_UNCONFIRMED/);
});

test("AI validates malformed components and handles self-closing Components losslessly", async () => {
  const { root, ai } = await fixture();
  await fs.writeFile(path.join(root, "ComponentList.SC2Components"), `<Components extra="keep"/>`);
  const result = await ai.apply({ operations: [{ op: "definition.create", id: "A" }], dryRun: false, stage: false });
  assert.equal(result.accepted, true);
  assert.match(await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8"), /extra="keep"/);
  await fs.writeFile(path.join(root, "ComponentList.SC2Components"), `<Components><DataComponent Type="aiai">Wrong</DataComponent></Components>`);
  await assert.rejects(ai.apply({ operations: [{ op: "definition.create", id: "B" }] }), /must point to CustomAI/);
});

test("AI GUI API uses shared schema, defaults to dry-run and writes only reviewed components", async () => {
  const page = await fs.readFile("src/gui/public/index.html", "utf8");
  for (const id of ["aiModeButton", "aiWorkspace", "aiOperations", "aiRefreshButton", "aiPreviewButton", "aiApplyButton"]) assert.ok(page.includes(`id="${id}"`), id);
  assert.match(page, /id="aiDryRun"[^>]*checked/);
  assert.match(page, /id="aiApplyButton"[^>]*disabled/);
  const { root, core, ai } = await fixture();
  const schema = await SchemaRegistry.loadBundled();
  const browse = new BrowseWorkspace(core, new DataWorkspace(core));
  const context = { ai, browse, placement: new PlacementWorkspace(core, browse) };
  const invoke = (body: unknown) => dispatchGuiApi(core, schema, { method: "POST", pathname: "/api/ai/apply", body }, context);
  assert.equal((await invoke({ operations: [{ op: "definition.create", id: "Preview" }] })).status, 200);
  await assert.rejects(fs.stat(path.join(root, "CustomAI")));
  assert.equal((await invoke({ operations: [{ op: "definition.create", id: "Bad" }], dryRun: "false" })).status, 400);
  assert.equal((await invoke({ file: "Triggers", operations: [{ op: "definition.create", id: "Bad" }] })).status, 400);
  assert.equal((await invoke({ operations: [{ op: "definition.create", id: "Applied" }], dryRun: false, stage: false })).status, 200);
  const result = await dispatchGuiApi(core, schema, { method: "GET", pathname: "/api/ai/context" }, context);
  assert.equal((result.body as { definitions: { id: string }[] }).definitions[0].id, "Applied");
});

test("clone/reorder preserve native unknown children", async () => {
  const source = `<AIData>\n    <Definition Id="A"><Future x="1"/></Definition>\n    <Definition Id="B"/>\n</AIData>`;
  const { ai } = await fixture(source);
  await ai.apply({ operations: [
    { op: "definition.clone", definition: "A", id: "C", as: "copy" },
    { op: "definition.reorder", definition: "@copy", before: "B" },
  ], dryRun: false, stage: true });
  const text = (await ai.workspace.readRaw("CustomAI")).text;
  assert.match(text, /Definition Id="C"><Future x="1"\/><\/Definition>/);
  assert.ok(text.indexOf('Id="C"') < text.indexOf('Id="B"'));
});

test("empty CustomAI and dozens of waves remain queryable without loading native XML", async () => {
  const { ai } = await fixture(`<?xml version="1.0" encoding="utf-8"?>\n<AIData>\n</AIData>`);
  await ai.apply({ operations: [
    { op: "definition.create", as: "many", id: "ManyWaves" },
    ...Array.from({ length: 40 }, (_, index) => ({ op: "wave.create" as const, definition: "@many", id: `Wave${String(index).padStart(2, "0")}`, properties: { Time: index * 30 }, allowUnconfirmedStructure: true })),
  ], dryRun: false, stage: true });
  const context = await ai.context({ definitions: ["Many"], waves: ["Wave"], includeNative: false, limit: 100 });
  assert.equal(context.definitions.length, 1);
  assert.equal(context.waves.length, 40);
  assert.equal(context.nativeNodes, undefined);
});

test("Data-derived wave graph uses catalog values and never hardcodes unit prices", async () => {
  const source = `<AIData><Definition Id="Graph"><Wave Id="W"><Time Value="60"/><CreateUnits><Unit Type="CustomUnit" Count="2"/></CreateUnits></Wave></Definition></AIData>`;
  const { root, ai } = await fixture(source);
  await fs.mkdir(path.join(root, "Dependency.SC2Mod/Base.SC2Data/GameData"), { recursive: true });
  await fs.writeFile(path.join(root, "Dependency.SC2Mod/Base.SC2Data/GameData/UnitData.xml"), `<Catalog><CUnit id="CustomUnit"><CostResource index="Minerals" value="125"/><CostResource index="Vespene" value="50"/><Food value="3"/></CUnit></Catalog>`);
  await ai.references.refresh();
  const context = await ai.context({ waves: ["W"] });
  assert.deepEqual(context.waves[0].graph, {
    time: 60, minerals: 250, vespene: 100, supply: 6, complete: true,
    units: [{ unit: "CustomUnit", quantity: 2, minerals: 125, vespene: 50, supply: 3, provenance: ["Dependency.SC2Mod", "Base.SC2Data"] }],
    policy: "Values are read from current dependency catalog fields; missing/inherited values are not guessed.",
  });
});

test("AI wave graphs use data.* inheritance when the modules share one server workspace", async () => {
  const source = `<AIData><Definition Id="Graph"><Wave Id="W"><CreateUnits><Unit Type="ChildUnit" Count="2"/></CreateUnits></Wave></Definition></AIData>`;
  const { root, core } = await fixture(source);
  await fs.mkdir(path.join(root, "Base.SC2Data/GameData"), { recursive: true });
  await fs.writeFile(path.join(root, "Base.SC2Data/GameData/UnitData.xml"), `<Catalog><CUnit id="BaseUnit"><CostResource index="Minerals" value="75"/><Food value="2"/></CUnit><CUnit id="ChildUnit" parent="BaseUnit"/></Catalog>`);
  const ai = new AiWorkspace(core, await AiSchemaRegistry.load(), new DataWorkspace(core));
  await ai.references.refresh();
  const context = await ai.context({ waves: ["W"] });
  assert.equal(context.waves[0].graph.minerals, 150);
  assert.equal(context.waves[0].graph.supply, 4);
  assert.match(context.waves[0].graph.policy, /inheritance.*data\.\*/);
});

test("invalid player/timing diagnostics are typed and source-addressed", async () => {
  const { ai } = await fixture(`<AIData><Definition Id="A"><SourcePlayer Value="99"/><Wave Id="W"><Time Value="-1"/></Wave></Definition></AIData>`);
  const report = await ai.validate();
  assert.equal(report.valid, false);
  assert.ok(report.diagnostics.some((entry) => entry.code === "AI_PLAYER_INVALID" && entry.path === "Definition[A]/SourcePlayer"));
  assert.ok(report.diagnostics.some((entry) => entry.code === "AI_NUMBER_INVALID" && entry.path === "Definition[A]/Wave[W]/Time"));
});

test("stage=false writes backups for every existing changed file", async () => {
  const { root, ai } = await fixture(`<AIData>\n</AIData>`);
  const beforeComponent = await fs.readFile(path.join(root, "ComponentList.SC2Components"), "utf8");
  const beforeAi = await fs.readFile(path.join(root, "CustomAI"), "utf8");
  await ai.apply({ operations: [{ op: "definition.create", id: "BackedUp" }], dryRun: false, stage: false, backup: true });
  assert.equal(await fs.readFile(path.join(root, "CustomAI.sc2uimcp.bak"), "utf8"), beforeAi);
  assert.equal(await fs.readFile(path.join(root, "ComponentList.SC2Components.sc2uimcp.bak"), "utf8"), beforeComponent);
});
