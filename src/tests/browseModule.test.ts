import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Workspace } from "../core/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { DataSchemaRegistry } from "../modules/data/schemaRegistry.js";
import { DataWorkspace } from "../modules/data/workspace.js";

const FIXTURE = path.resolve("src/tests/fixtures/browse-placement-map");

test('operation-scoped browse snapshots avoid rebuilds while preserving dependency stale guards',async t=>{
 const {root,browse}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));const workspace=browse.workspace;
 await workspace.withReadSet(()=>browse.withSnapshot(async()=>{
  const first=await browse.index(),second=await browse.index();assert.equal(first,second);
  const file=first.files.find(f=>f.path.endsWith('ActorData.xml'))!;assert.ok(file);await fs.appendFile(file.path,'\n');
  await assert.rejects(workspace.applyRawTransaction(['Proof.txt'],values=>new Map([...values,['Proof.txt','test']]),{dryRun:false,stage:true}),/STALE_/);
 }));
 assert.equal(await fs.stat(path.join(root,'Proof.txt')).catch(()=>null),null);
});

test('tracked browse cache replays dependency guards and detects same-size timestamp-preserved edits',async t=>{
 const {root,browse}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));const workspace=browse.workspace,file=path.join(root,'Base.SC2Data/GameData/ActorData.xml'),stamp=new Date('2020-01-01T00:00:00Z');await fs.utimes(file,stamp,stamp);
 const first=await workspace.withReadSet(()=>browse.index());
 await fs.appendFile(path.join(root,'Objects'),'\n');assert.equal(await workspace.withReadSet(()=>browse.index()),first);
 await fs.mkdir(path.join(root,'.sc2mcp'),{recursive:true});await fs.writeFile(path.join(root,'.sc2mcp/locations.json'),'{}');assert.equal(await workspace.withReadSet(()=>browse.index()),first);
 await workspace.withReadSet(async()=>{const cached=await browse.index();assert.equal(cached,first);const original=await fs.readFile(file,'utf8'),edited=original.replace('AgriaTreeModel','OtherTreeModel');assert.equal(edited.length,original.length);await fs.writeFile(file,edited);await fs.utimes(file,stamp,stamp);await assert.rejects(workspace.applyRawTransaction(['Proof.txt'],values=>new Map([...values,['Proof.txt','test']]),{dryRun:false,stage:true}),/STALE_/);});
 const changed=await workspace.withReadSet(()=>browse.index());assert.notEqual(changed,first);assert.notEqual(changed.fingerprint,first.fingerprint);assert.equal(await fs.stat(path.join(root,'Proof.txt')).catch(()=>null),null);
});

test('native terrain XML changes retain the catalog cache while actual TerrainData edits invalidate it',async t=>{
 const {root,browse}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));const workspace=browse.workspace;
 await fs.writeFile(path.join(root,'t3Terrain.xml'),'<terrain version="115"><heightMap/></terrain>');
 const catalog=path.join(root,'Base.SC2Data/GameData/TerrainData.xml');await fs.writeFile(catalog,'<Catalog><CTerrain id="LocalTerrain"/></Catalog>');
 const first=await workspace.withReadSet(()=>browse.index());assert.ok(!first.files.some(f=>path.basename(f.path).toLowerCase()==='t3terrain.xml'));assert.ok(first.files.some(f=>f.path===catalog));
 await fs.writeFile(path.join(root,'t3Terrain.xml'),'<terrain version="115"><heightMap><rampList num="0"/></heightMap></terrain>');
 const second=await workspace.withReadSet(()=>browse.index());assert.equal(second,first);assert.equal(second.fingerprint,first.fingerprint);
 await fs.writeFile(catalog,'<Catalog><CTerrain id="OtherTerrain"/></Catalog>');const changed=await workspace.withReadSet(()=>browse.index());assert.notEqual(changed,first);assert.notEqual(changed.fingerprint,first.fingerprint);
});

test('read memos track missing files, directory membership and effective drafts without capturing unrelated outer reads',async t=>{
 const {root,browse}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));const workspace=browse.workspace,file=path.join(root,'MissingData.xml');
 const {memo}=await workspace.withReadSet(async()=>{await workspace.readRaw('Objects');return workspace.memoizeReads(async()=>{await workspace.readDependency(file,true);await workspace.readDirectory(root,'memo-catalogs',e=>e.name.endsWith('Data.xml'));});});
 await fs.appendFile(path.join(root,'Objects'),'\n');assert.equal(await workspace.reuseReads(memo),true);await fs.writeFile(file,'<Catalog/>');assert.equal(await workspace.reuseReads(memo),false);
 const captured=await workspace.memoizeReads(()=>workspace.readRaw('Base.SC2Data/GameData/ActorData.xml'));
 await workspace.applyRawTransaction(['Base.SC2Data/GameData/ActorData.xml'],v=>new Map([...v,['Base.SC2Data/GameData/ActorData.xml',v.get('Base.SC2Data/GameData/ActorData.xml')!+'\n']]),{dryRun:false,stage:true});assert.equal(await workspace.reuseReads(captured.memo),false);
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-browse-"));
  await fs.cp(FIXTURE, root, { recursive: true });
  const workspace = new Workspace(root);
  const data = new DataWorkspace(workspace, new DataSchemaRegistry());
  return { root, browse: new BrowseWorkspace(workspace, data) };
}

test("browse.search finds a real Unit id and a localized name with ranking evidence", async () => {
  const { browse } = await fixture();
  const byId = await browse.search({ query: "Marine", catalogType: "Unit", limit: 10 });
  assert.equal(byId.results[0]?.id, "Marine");
  assert.equal(byId.results[0]?.placeableRepresentation?.objectElement, "ObjectUnit");
  assert.ok(byId.results[0]?.matchedBy.includes("exact-id"));
  const localized = await browse.search({ query: "Морпех", locale: "ruRU", placeable: true });
  assert.equal(localized.results[0]?.id, "Marine");
  const details = await browse.get({ key: byId.results[0]!.key, includeRaw: true });
  assert.match(details.definitions[0]!.rawDefinition!, /<CUnit id="Marine"/);
  assert.equal(details.definitions[0]!.sourceLayers[0]?.layer, "workspace");
});

test("browse keeps an unknown catalog type as a generic indexed object", async () => {
  const { browse } = await fixture();
  const result = await browse.search({ query: "UnknownCatalogObject" });
  assert.equal(result.results[0]?.ctype, "CExperimentalThing");
  assert.equal(result.results[0]?.placeable, false);
});

test("browse.related follows Unit to Actor to Model and an exact model asset path", async () => {
  const { browse } = await fixture();
  const graph = await browse.related({ id: "Marine", catalogType: "Unit", direction: "both", depth: 3 });
  assert.ok(graph.nodes.some((entry) => entry.ctype === "CActorUnit"));
  assert.ok(graph.nodes.some((entry) => entry.catalogType === "Model" && entry.assets.some((asset) => asset.endsWith("Marine.m3"))));
});

test("browse resolves a Doodad to Actor/Model assets and reports placeability", async () => {
  const { browse } = await fixture();
  const result = await browse.resolve({ id: "AgriaTree", catalogType: "Actor" });
  assert.equal(result.resolved, true);
  assert.equal(result.placeableRepresentation?.kind, "Doodad");
  const graph = await browse.related({ id: "AgriaTree", catalogType: "Actor", depth: 2 });
  assert.ok(graph.nodes.some((entry) => entry.assets.some((asset) => asset.endsWith("AgriaTree.m3"))));
});

test("browse index fingerprint is stable and changes after an indexed file changes", async () => {
  const { root, browse } = await fixture();
  const first = await browse.index();
  const second = await browse.index();
  assert.equal(first, second);
  await fs.appendFile(path.join(root, "enUS.SC2Data/LocalizedData/GameStrings.txt"), "\nActor/Name/New=New\n");
  const third = await browse.index();
  assert.notEqual(third.fingerprint, first.fingerprint);
});

test("installed-but-not-declared data remains searchable but is not dependency-ready", async () => {
  const installed = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-installed-"));
  await fs.cp(FIXTURE, installed, { recursive: true });
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-map-empty-"));
  const workspace = new Workspace(empty);
  const data = new DataWorkspace(workspace, new DataSchemaRegistry());
  const browse = new BrowseWorkspace(workspace, data, [installed]);
  const result = await browse.search({ query: "Marine", catalogType: "Unit", sourceLayer: "installed" });
  assert.equal(result.results[0]?.availability, "INSTALLED_BUT_NOT_DECLARED");
  const resolved = await browse.resolve({ key: result.results[0]!.key });
  assert.equal(resolved.dependencyReady, false);
});

test("browse reports duplicate ids across source layers without dropping either definition", async () => {
  const map = await fixture();
  const dependency = await fs.mkdtemp(path.join(os.tmpdir(), "liberty.SC2Mod-"));
  await fs.cp(FIXTURE, dependency, { recursive: true });
  const workspace = new Workspace(map.root);
  const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace, new DataSchemaRegistry(), [dependency]));
  const validation = await browse.validate();
  assert.ok(validation.duplicatesAcrossLayers.some((entry) => entry.key === "unit:marine"));
});

test("dependency declarations resolve available roots and report missing mods", async () => {
  const map = await fixture();
  const dependencyParent = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-dependency-"));
  const dependency = path.join(dependencyParent, "Liberty.SC2Mod");
  await fs.cp(FIXTURE, dependency, { recursive: true });
  await fs.writeFile(path.join(map.root, "DocumentInfo"), '<DocInfo><Dependencies><Value>file:Mods/Liberty.SC2Mod</Value><Value>file:Mods/Missing.SC2Mod</Value></Dependencies></DocInfo>');
  const workspace = new Workspace(map.root);
  const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace, new DataSchemaRegistry(), [dependency]));
  const dependencies = await browse.dependencies();
  assert.equal(dependencies.roots[1]?.availability, "AVAILABLE_THROUGH_DEPENDENCY");
  assert.equal(dependencies.missing[0]?.dependency, "Mods/Missing.SC2Mod");
  const result = await browse.search({ query: "Marine", catalogType: "Unit", sourceLayer: "dependency" });
  assert.equal((await browse.resolve({ key: result.results[0]!.key })).dependencyReady, true);
});

test("a configured catalog root without a dependency declaration is not placement-ready", async () => {
  const { root } = await fixture(); const map = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-no-deps-"));
  const workspace = new Workspace(map); const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace, new DataSchemaRegistry(), [root]));
  const result = await browse.resolve({ id: "Marine", catalogType: "Unit" });
  assert.equal(result.dependencyReady, false);
});
