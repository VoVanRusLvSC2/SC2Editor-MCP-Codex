import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { DataDocument, referenceSchema } from "../modules/data/document.js";
import { CatalogObjectIndex } from "../modules/data/catalogIndex.js";
import { validateDataAuthoring } from "../modules/data/authoringValidation.js";
import { validateDataDocuments } from "../modules/data/validator.js";
import { DataReferenceGraph } from "../modules/data/referenceGraph.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { DataSchemaRegistry } from "../modules/data/schemaRegistry.js";
import { registerDataTools } from "../modules/data/tools.js";
import { compactDataBatch } from "../modules/data/responseStore.js";
import { runMcpBatch } from "../app/mcpBatch.js";
import type { CatalogRecord } from "../modules/data/catalogTypes.js";
import { DataXsdRegistry } from "../modules/data/xsdRegistry.js";
import { scanXml } from "../core/xmlScanner.js";
import { actorEvents } from "../modules/data/actorEvents.js";
import { galaxyReferences, guiReferences } from "../modules/data/crossReferences.js";
import { DataCatalogRepository } from "../modules/data/catalogRepository.js";

const record = (
  file: string,
  document: DataDocument,
  layer: "workspace" | "dependency",
  engineActive = true,
): CatalogRecord => ({ file, document, layer, engineActive, absolute: file, provenance: [file] });

test("ordered Galaxy consumer scans retain constants, lexical shadows and exact rewrite spans", () => {
  const source = `const string Prefix = "Mar";
const string Kind = Prefix + "ine";
void First() {
  Other(Unrelated("ignored"));
  UnitCreate(1, Kind, 0, 1, null, 0);
  { string Kind = "local"; UnitCreate(1, Kind, 0, 1, null, 0); }
  Other();
  CatalogFieldValueGet(c_gameCatalogUnit, Kind, "LifeMax", 1);
  { string Prefix = "local"; UnitCreate(1, "Marine", 0, 1, null, 0); }
  Other();
  UnitCreate(1, Prefix + "ine", 0, 1, null, 0);
}
void Second(string Kind) {
  UnitCreate(1, Kind, 0, 1, null, 0);
  ActorCreate(1, "HeroActor");
  UnitCreate(1, Unknown(), 0, 1, null, 0);
  CatalogEntryGet(dynamicCatalog, "Marine");
  receiver.UnitCreate(1, "Marine");
}
void Third() { UnitCreate(1, Kind, 0, 1, null, 0); }
`;
  const result = galaxyReferences("MapScript.galaxy", source);
  assert.deepEqual(
    result.references.map((r) => [r.value, r.targetDomain, r.rewrite]),
    [
      ["Marine", "Unit", "readOnly"],
      ["Marine", "Unit", "readOnly"],
      ["Marine", "Unit", "galaxyLiteral"],
      ["Marine", "Unit", "readOnly"],
      ["HeroActor", "Actor", "galaxyLiteral"],
      ["Marine", "Unit", "readOnly"],
    ],
  );
  assert.deepEqual(
    result.issues.map((i) => i.code),
    [
      "GALAXY_DYNAMIC_CATALOG_REFERENCE",
      "GALAXY_DYNAMIC_CATALOG_REFERENCE",
      "GALAXY_DYNAMIC_CATALOG_REFERENCE",
      "GALAXY_DYNAMIC_CATALOG_REFERENCE",
      "GALAXY_CATALOG_SIGNATURE_SHADOWED",
    ],
  );
  for (const ref of result.references)
    assert.equal(source.slice(ref.sourceSpan!.start, ref.sourceSpan!.end), ref.rawExpression);
  const shadowed = galaxyReferences(
    "Custom.galaxy",
    'void UnitCreate() {} void Use() { UnitCreate(1, "Marine"); }',
  );
  assert.equal(shadowed.references.length, 0);
  assert.equal(shadowed.issues[0].code, "GALAXY_CATALOG_SIGNATURE_SHADOWED");
  const gui = guiReferences(
    "Triggers",
    `<TriggerData><ScriptCode>${source}</ScriptCode><Element Type="Param" Id="A"><ValueType Type="gamelink" GameType="Unit"/><Value>Marine</Value></Element></TriggerData>`,
  );
  assert.deepEqual(
    gui.references.slice(0, -1),
    result.references.map((r) => ({
      ...r,
      file: "Triggers",
      rewrite: "readOnly",
      sourceSpan: undefined,
    })),
  );
  assert.equal(gui.references.at(-1)!.rewrite, "xmlValue");
});

test("field ordinal indexing preserves sibling order, nested paths, raw source and independent snapshots", () => {
  const source =
    '<Catalog><CUnit id="A"><Items value="a"/><Other/><Items index="x"/><Items value="b"><Entry Link="One"/><Entry Link="Two"/></Items><Items Index="X"/></CUnit><CUnit id="B"><Items value="alone"/></CUnit></Catalog>';
  const doc = new DataDocument(source, "Units.xml");
  const first = doc.objects(true);
  assert.deepEqual(
    first[0].fields.map((f) => f.path),
    ["Items[#0]", "Other", "Items[x]", "Items[#1]", "Items[X]"],
  );
  assert.deepEqual(
    first[0].fields[3].children.map((f) => f.path),
    ["Items[#1].Entry[#0]", "Items[#1].Entry[#1]"],
  );
  assert.equal(first[1].fields[0].path, "Items");
  assert.equal(
    first[0].fields[3].rawSource,
    source.slice(first[0].fields[3].sourceSpan!.start, first[0].fields[3].sourceSpan!.end),
  );
  first[0].fields[3].children[0].attrs.Link = "caller-edit";
  assert.equal(doc.objects()[0].fields[3].children[0].attrs.Link, "One");
  doc.removeField("A", "Items[#0]");
  assert.deepEqual(
    doc.objects()[0].fields.map((f) => f.path),
    ["Other", "Items[x]", "Items", "Items[X]"],
  );
  doc.source = '<Catalog><CUnit id="C"><Only/><Only/></CUnit></Catalog>';
  assert.deepEqual(
    doc.objects()[0].fields.map((f) => f.path),
    ["Only[#0]", "Only[#1]"],
  );
  doc.source = '<Catalog><CUnit id="C"><Only/></CUnit></Catalog>';
  assert.equal(doc.objects()[0].fields[0].ordinal, undefined);
});

test("final-graph indexes reuse only unchanged documents and rebuild order, activation and changed fields", () => {
  const stable = new DataDocument('<Catalog><CUnit id="Stable"/></Catalog>');
  const changed = new DataDocument(
    '<Catalog><CUnit id="Changed"><LifeMax value="10"/></CUnit></Catalog>',
  );
  const firstRecords = [
    record("Stable.xml", stable, "dependency"),
    record("Changed.xml", changed, "workspace"),
  ];
  const before = new CatalogObjectIndex(firstRecords);
  const original = stable.objects.bind(stable);
  stable.objects = () => {
    throw new Error("Unchanged document rematerialized");
  };
  changed.setField("Changed", "LifeMax", "value", 20);
  const finalRecords = [
    firstRecords[1],
    { ...firstRecords[0], engineActive: false, file: "Rebound.xml" },
  ];
  const after = new CatalogObjectIndex(finalRecords, before);
  assert.equal(after.objectsFor(changed)[0].fields[0].value, "20");
  assert.equal(after.activeMatches("Unit", "Stable").length, 0);
  assert.deepEqual(
    after.objects.map((o) => o.file),
    ["Changed.xml", "Rebound.xml"],
  );
  stable.objects = original;
  assert.deepEqual(after.objects, new CatalogObjectIndex(finalRecords).objects);
  assert.throws(() => before.assertMatches(firstRecords), /STALE_DATA_CATALOG_INDEX/);
  after.assertMatches(finalRecords);
  const recreated = new DataDocument(stable.source, stable.sourceFile);
  recreated.objects = () => {
    throw new Error("Recreated unchanged document rematerialized");
  };
  const reused = new CatalogObjectIndex([record("Stable.xml", recreated, "dependency")], before);
  assert.deepEqual(reused.objectsFor(recreated), before.objectsFor(stable));
  const rebound = new DataDocument(stable.source, "DifferentFile.xml");
  const reboundIndex = new CatalogObjectIndex(
    [record("DifferentFile.xml", rebound, "dependency")],
    before,
  );
  assert.equal(reboundIndex.objects[0].sourcePath, "DifferentFile.xml");
});

test("catalog classification shares document parsing while retaining malformed, nested and changed-source coverage", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-discovery-perf-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "Base.SC2Data/GameData");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "UnitData.xml"), '<Catalog><CUnit id="A"/></Catalog>');
  await fs.writeFile(path.join(dir, "NestedData.xml"), "<Wrapper><Catalog/></Wrapper>");
  await fs.writeFile(path.join(dir, "BrokenData.xml"), '<Catalog><CUnit id="Broken"></Catalog>');
  const repository = new DataCatalogRepository(new Workspace(root), []);
  const before = await repository.catalog();
  assert.deepEqual(before.map((r) => path.basename(r.file)).sort(), [
    "BrokenData.xml",
    "UnitData.xml",
  ]);
  assert.equal(before.issues.filter((i) => i.code === "CATALOG_XML_INVALID").length, 1);
  const valid = before.find((r) => r.file.endsWith("UnitData.xml"))!;
  assert.equal(valid.document.objects()[0].id, "A");
  const staged = await repository.catalog(
    new Map([["Base.SC2Data/GameData/UnitData.xml", '<Catalog><CUnit id="B"/></Catalog>']]),
  );
  assert.equal(staged.find((r) => r.file.endsWith("UnitData.xml"))!.document.objects()[0].id, "B");
  await fs.writeFile(path.join(dir, "UnitData.xml"), '<Catalog><CUnit id="C"/></Catalog>');
  await fs.writeFile(path.join(dir, "BrokenData.xml"), "<Catalog/>");
  const after = await repository.catalog();
  assert.equal(after.find((r) => r.file.endsWith("UnitData.xml"))!.document.objects()[0].id, "C");
  assert.equal(after.issues.filter((i) => i.code === "CATALOG_XML_INVALID").length, 0);
});

test("scalar apply keeps final reference validation and consumers while identity edits retain incoming-reference preflight", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-apply-perf-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = "Base.SC2Data/GameData/EffectData.xml";
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  const source =
    '<Catalog><CEffectDamage id="Hit"><Amount value="10"/></CEffectDamage><CEffectSet id="Set"><EffectArray value="Hit"/></CEffectSet></Catalog>';
  await fs.writeFile(path.join(root, file), source);
  await fs.writeFile(
    path.join(root, "MapScript.galaxy"),
    'void Use() { CatalogEntryGet(c_gameCatalogEffect, "Hit"); }',
  );
  const workspace = new Workspace(root),
    data = new DataWorkspace(workspace, DataSchemaRegistry.lazy());
  const scopes: string[] = [];
  const references = data.references.bind(data);
  data.references = (...args) => {
    scopes.push(args[1] ?? "all");
    return references(...args);
  };
  const result = await data.apply({
    file,
    operations: [{ op: "field.set", object: "Hit", path: "Amount", value: 20 }],
    dryRun: true,
  });
  assert.equal(result.authoring.accepted, true);
  assert.deepEqual(scopes, ["workspace"]);
  scopes.length = 0;
  await assert.rejects(
    data.apply({
      file,
      operations: [{ op: "field.set", object: "Set", path: "EffectArray", value: "Missing" }],
      dryRun: true,
    }),
  );
  assert.deepEqual(scopes, ["workspace"]);
  scopes.length = 0;
  await assert.rejects(
    data.apply({ file, operations: [{ op: "object.delete", object: "Hit" }], dryRun: true }),
    /incoming reference/,
  );
  assert.equal(scopes[0], "all");
  assert.equal(await fs.readFile(path.join(root, file), "utf8"), source);
  assert.deepEqual(workspace.draftFiles(), []);
});

test("one batch index preserves typed references, inherited tokens and diagnostics across catalogs", () => {
  const native = new DataDocument(
    '<Catalog><CActorUnit id="GenericUnitBase"><?token id="unitName" type="CUnitLink" value=""?></CActorUnit><CUnit id="Marine"/><CModel id="Visible"/></Catalog>',
  );
  const before = DataDocument.create("ActorData.xml");
  const after = new DataDocument(
    '<Catalog><CActorUnit id="Hero" parent="GenericUnitBase" unitName="Marine"><Model value="Missing"/><On Terms="UnitBirth.Marine" Send="Create"/></CActorUnit></Catalog>',
    "ActorData.xml",
  );
  const inactive = new DataDocument('<Catalog><CModel id="Missing"/></Catalog>');
  const records = [
    record("Native.xml", native, "dependency"),
    record("Inactive.xml", inactive, "dependency", false),
    record("ActorData.xml", after, "workspace"),
  ];
  const index = new CatalogObjectIndex(records);
  const plain = validateDataAuthoring("ActorData.xml", before, after, records, []);
  const indexed = validateDataAuthoring(
    "ActorData.xml",
    before,
    after,
    records,
    [],
    new Map(),
    index,
  );
  assert.deepEqual(indexed, plain);
  assert.equal(indexed.accepted, false);
  assert.ok(indexed.diagnostics.some((d) => d.message.includes("Missing")));
  const graph = new DataReferenceGraph(new Workspace(os.tmpdir()));
  const refs = graph.references(records, "workspace");
  assert.deepEqual(graph.references(records, "workspace", index), refs);
  assert.deepEqual(
    validateDataDocuments("ActorData.xml", records, undefined, refs, new Map(), index),
    validateDataDocuments("ActorData.xml", records, undefined, refs),
  );
});

test("shared index materializes a dependency once and keeps ambiguous parent declarations", () => {
  const native = new DataDocument(
    '<Catalog><CActorUnit id="Parent"/><CActorModel id="Parent"/><CUnit id="Marine"/></Catalog>',
  );
  const original = native.objects.bind(native);
  let materialized = 0;
  native.objects = (...args) => {
    materialized++;
    return original(...args);
  };
  const a = new DataDocument('<Catalog><CActorUnit id="A" parent="Parent"/></Catalog>');
  const b = new DataDocument('<Catalog><CActorUnit id="B" parent="Parent"/></Catalog>');
  const records = [
    record("Native.xml", native, "dependency"),
    record("A.xml", a, "workspace"),
    record("B.xml", b, "workspace"),
  ];
  const index = new CatalogObjectIndex(records);
  assert.equal(index.activeMatches("Actor", "Parent").length, 2);
  for (const [file, doc] of [
    ["A.xml", a],
    ["B.xml", b],
  ] as const) {
    const result = validateDataAuthoring(
      file,
      DataDocument.create(file),
      doc,
      records,
      [],
      new Map(),
      index,
    );
    assert.equal(
      result.diagnostics.some((d) => d.code === "DATA_PARENT_CLASS_INCOMPATIBLE"),
      false,
    );
  }
  validateDataDocuments("A.xml", records, undefined, [], new Map(), index);
  assert.equal(materialized, 1);
});

test("an operation index refuses changed content, order, layer and activation", () => {
  const doc = new DataDocument('<Catalog><CUnit id="A"><LifeMax value="10"/></CUnit></Catalog>');
  const records = [record("UnitData.xml", doc, "workspace")],
    index = new CatalogObjectIndex(records);
  for (const change of [
    { file: "Other.xml" },
    { layer: "dependency" as const },
    { engineActive: false },
  ])
    assert.throws(
      () => index.assertMatches([{ ...records[0], ...change }]),
      /STALE_DATA_CATALOG_INDEX/,
    );
  doc.setField("A", "LifeMax", "value", 20);
  assert.throws(() => index.assertMatches(records), /STALE_DATA_CATALOG_INDEX/);
  assert.throws(() => index.objectsFor(doc), /STALE_DATA_CATALOG_INDEX/);
  assert.equal(new CatalogObjectIndex(records).objectsFor(doc)[0].fields[0].value, "20");
});

test("query typos reject the entire MCP batch before catalog loading or an earlier mutation", async () => {
  let reads = 0,
    mutations = 0;
  const tools = new Map<string, { schema: any; invoke: any }>();
  registerDataTools(
    {
      registerTool: (name: string, config: any, callback: any) =>
        tools.set(name, { schema: config.inputSchema, invoke: callback }),
    } as any,
    {
      workspace: {
        workspace: { root: os.tmpdir() },
        query: async () => {
          reads++;
        },
        context: async () => {
          reads++;
        },
      } as any,
    },
  );
  tools.set("mutate", {
    schema: tools.get("data.query")!.schema,
    invoke: async () => {
      mutations++;
      return {};
    },
  });
  for (const tool of ["data.query", "data.context"]) {
    const result = await runMcpBatch(
      [
        { id: "first", tool: "mutate", args: {} },
        { id: "bad", tool, args: { query: "Hybrid", domain: "Actor" } },
      ],
      tools,
      {},
    );
    assert.equal(result.ok, false);
    assert.equal(result.completed, 0);
    assert.equal(
      tools.get(tool)!.schema.parse({ text: "Hybrid", domains: ["Actor"], limit: 1 }).limit,
      1,
    );
  }
  assert.equal(reads, 0);
  assert.equal(mutations, 0);
});

test("Data batch reports stage timings while preserving dry-run and schema read guards", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-perf-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root),
    data = new DataWorkspace(workspace, DataSchemaRegistry.lazy());
  const changes = [
    {
      file: "Base.SC2Data/GameData/Effects.xml",
      operations: [
        {
          op: "object.create" as const,
          ctype: "CEffectDamage",
          id: "Hit",
          fields: [{ name: "Amount", value: 5 }],
        },
      ],
    },
  ];
  const result = await data.batch({ changes, dryRun: true });
  assert.equal(result.accepted, true);
  for (const stage of ["catalog", "index", "references", "validation", "authoring", "schemaGuards"])
    assert.ok(Number.isFinite(result.timing.stagesMs[stage]));
  assert.deepEqual(compactDataBatch(result).timing, result.timing);
  assert.deepEqual(workspace.draftFiles(), []);
  await assert.rejects(fs.stat(path.join(root, changes[0].file)), { code: "ENOENT" });
  const read = workspace.readDependency.bind(workspace);
  workspace.readDependency = async (...args) => {
    const source = await read(...args);
    return args[0] === referenceSchema.manifestFile ? source + " " : source;
  };
  await assert.rejects(
    data.batch({ changes, dryRun: false, stage: true }),
    /STALE_DATA_BATCH_SCHEMA/,
  );
  assert.deepEqual(workspace.draftFiles(), []);
});

test("schema descriptor index keeps exact case priority, ambiguous folds and manifest refresh", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-xsd-lookup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const types = ["CFoo", "CFOO"];
  for (const [i, name] of types.entries())
    await fs.writeFile(
      path.join(root, i + ".json"),
      JSON.stringify({ name, kind: "complex", fields: [], enumValues: [], facets: [] }),
    );
  const manifest = {
    schemaVersion: "1",
    types: types.map((name, i) => ({ name, shard: i + ".json" })),
  };
  const file = path.join(root, "manifest.json");
  await fs.writeFile(file, JSON.stringify(manifest));
  const registry = new DataXsdRegistry(file);
  assert.equal(registry.describe("CFoo")?.name, "CFoo");
  assert.equal(registry.describe("CFOO")?.name, "CFOO");
  assert.equal(registry.describe("cfoo"), undefined);
  manifest.types.pop();
  await fs.writeFile(file, JSON.stringify(manifest));
  registry.refresh();
  assert.equal(registry.describe("cfoo")?.name, "CFoo");
  await fs.unlink(file);
  registry.refresh();
  assert.equal(registry.describe("CFoo"), undefined);
});

test("actor event traversal preserves nested source order without entering adjacent actors", () => {
  const source =
    '<Catalog><CActorModel id="A"><Group><On Terms="Effect.First.Start" Send="Create"/></Group><On><Terms value="Effect.Second.Stop"/><Send value="Destroy"/></On></CActorModel><CActorModel id="B"><On Terms="Effect.Foreign.Start" Send="Create"/></CActorModel></Catalog>';
  const parsed = scanXml(source),
    entry = parsed.nodes.find((n) => n.attrs.id === "A")!;
  const result = actorEvents(source, entry, parsed.nodes, (raw) => raw);
  assert.deepEqual(
    result.references.map((r) => r.value),
    ["First", "Second"],
  );
  for (const ref of result.references) assert.equal(source.slice(ref.start, ref.end), ref.value);
});

test("consumer memo replays content and directory guards without retaining caller mutations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-consumer-cache-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "consumer.galaxy");
  const source = 'void Use(){UnitCreate(1,"Marine",0,1,null,0);}';
  await fs.writeFile(file, source);
  const workspace = new Workspace(root),
    graph = new DataReferenceGraph(workspace);
  const first = await graph.crossReferences();
  assert.ok(first.references.some((r) => r.value === "Marine"));
  first.issues.push({ file: "caller", code: "LOCAL_ONLY" } as any);
  first.references[0].value = "CallerMutation";
  const second = await graph.crossReferences();
  assert.ok(second.references.some((r) => r.value === "Marine"));
  assert.equal(
    second.issues.some((r) => r.code === "LOCAL_ONLY"),
    false,
  );
  const stat = await fs.stat(file);
  await fs.writeFile(file, source.replace("Marine", "Maraud"));
  await fs.utimes(file, stat.atime, stat.mtime);
  assert.ok((await graph.crossReferences()).references.some((r) => r.value === "Maraud"));
  await fs.writeFile(path.join(root, "new.galaxy"), source.replace("Marine", "NewGuy"));
  assert.ok((await graph.crossReferences()).references.some((r) => r.value === "NewGuy"));
  await fs.unlink(path.join(root, "new.galaxy"));
  assert.equal(
    (await graph.crossReferences()).references.some((r) => r.value === "NewGuy"),
    false,
  );
  // A cache hit must still join later transactions' dependency read sets.
  await workspace.applyRawTransaction(
    ["pending.galaxy"],
    () => new Map([["pending.galaxy", source.replace("Marine", "DraftA")]]),
    { dryRun: false, stage: true },
  );
  assert.ok((await graph.crossReferences()).references.some((r) => r.value === "DraftA"));
  await workspace.applyRawTransaction(
    ["pending.galaxy"],
    () => new Map([["pending.galaxy", source.replace("Marine", "DraftB")]]),
    { dryRun: false, stage: true },
  );
  const staged = await graph.crossReferences();
  assert.ok(staged.references.some((r) => r.value === "DraftB"));
  assert.equal(
    staged.references.some((r) => r.value === "DraftA"),
    false,
  );
  await workspace.withReadSet(async () => {
    await graph.crossReferences();
    await workspace.applyRawTransaction(["test.txt"], () => new Map([["test.txt", "staged"]]), {
      dryRun: false,
      stage: true,
    });
  });
  await fs.writeFile(file, source);
  await assert.rejects(workspace.save("test.txt"), /STALE_(?:DEPENDENCY|FILE_TRANSACTION)/);
  await assert.rejects(fs.stat(path.join(root, "test.txt")), { code: "ENOENT" });
});
