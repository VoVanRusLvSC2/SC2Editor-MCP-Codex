import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { Workspace } from "../core/workspace.js";
import { MapWorkspace } from "../modules/map/workspace.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { inspectNativeIntegrity } from "../modules/terrain/nativeIntegrity.js";
import { directoryManifest, archiveBackendAvailable, extractArchive } from "../archive/archiveAdapter.js";
import { createProject } from "../app/project.js";
import { dispatchGuiApi } from "../gui/api.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-create-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "template"); await fs.mkdir(source);
  for (const dir of ["terrain-native", "map-native"])
    for (const name of await fs.readdir(`src/tests/fixtures/${dir}/nydus`))
      if (name.endsWith(".gz")) await fs.writeFile(path.join(source, name.slice(0, -3)), gunzipSync(await fs.readFile(`src/tests/fixtures/${dir}/nydus/${name}`)));
  await fs.writeFile(path.join(source, "Custom.galaxy"), "void Custom() {}\n");
  await fs.writeFile(path.join(source, "opaque.bin"), Buffer.from([255, 0, 127]));
  const workspace = new Workspace(root), map = new MapWorkspace(workspace);
  return { root, source, workspace, map };
}
const area = { type: "rectangle" as const, minX: 4, minY: 4, maxX: 28, maxY: 28 };

test("registered template survives restart; real dry-run and create have identical manifests and preserve native contents", async t => {
  const f = await fixture(t), before = await directoryManifest(f.source);
  assert.equal((await f.map.registerBlueprint("native", "template")).dryRun, true);
  assert.equal((await f.map.listBlueprints()).blueprints.length, 0);
  const registration = await f.map.registerBlueprint("native", "template", false);
  const map = new MapWorkspace(new Workspace(f.root));
  assert.equal((await map.listBlueprints()).blueprints[0].sha256, registration.blueprint.sha256);
  const request = { blueprintId: "native", destinationDirectory: "created", landscape: { style: "desert" as const, seed: 2026, area, relief: 0.4 }, metadataPatch: { fogMaskStyle: "Dark" } };
  const preview = await map.create(request);
  await assert.rejects(fs.stat(path.join(f.root, "created")), { code: "ENOENT" });
  const actual = await map.create({ ...request, dryRun: false });
  assert.equal(actual.contentSha256, preview.contentSha256);
  assert.ok(actual.changedFiles.includes("t3HeightMap")); assert.ok(actual.changedFiles.includes("MapInfo"));
  assert.equal(actual.cleanMap, false);
  assert.deepEqual(await directoryManifest(f.source), before);
  for (const name of ["Custom.galaxy", "opaque.bin", "DocumentHeader", "t3CellFlags", "t3SyncCliffLevel", "t3VertCol"])
    assert.deepEqual(await fs.readFile(path.join(f.root, "created", name)), await fs.readFile(path.join(f.source, name)));
  assert.equal((await map.inspect("created")).valid, true);
  await assert.rejects(map.create({ ...request, dryRun: false }), /DESTINATION_EXISTS/);
});

test("template content, enumeration, metadata and pending drafts invalidate create before publication", async t => {
  const f = await fixture(t); await f.map.registerBlueprint("native", "template", false);
  const request = { blueprintId: "native", destinationDirectory: "created", dryRun: false };
  await assert.rejects(f.map.create({ ...request, expectedBlueprintSha256: "0".repeat(64) }), /HASH_MISMATCH/);
  await fs.writeFile(path.join(f.source, "external"), "new");
  await assert.rejects(f.map.create(request), /STALE_BLUEPRINT/); await fs.unlink(path.join(f.source, "external"));
  await fs.appendFile(path.join(f.source, "opaque.bin"), Buffer.from([1]));
  await assert.rejects(f.map.create(request), /STALE_BLUEPRINT/); await fs.writeFile(path.join(f.source, "opaque.bin"), Buffer.from([255, 0, 127]));
  await fs.writeFile(path.join(f.source, ".sc2mcp-archive.json"), "{}");
  await assert.rejects(f.map.create(request), /STALE_BLUEPRINT/); await fs.unlink(path.join(f.source, ".sc2mcp-archive.json"));
  await f.workspace.applyRawTransaction(["template/Custom.galaxy"], () => new Map([["template/Custom.galaxy", "void Changed() {}"]]), { dryRun: false, stage: true });
  await assert.rejects(f.map.create(request), /DRAFTS_PENDING/);
  await assert.rejects(fs.stat(path.join(f.root, "created")), { code: "ENOENT" });
});

test("failed/unsupported terrain generation leaves source and destination untouched", async t => {
  const f = await fixture(t); await f.map.registerBlueprint("native", "template", false);
  const before = await directoryManifest(f.source);
  await assert.rejects(f.map.create({ blueprintId: "native", destinationDirectory: "created", dryRun: false,
    terrainOperations: [{ op: "cliff.paint", parameters: {} }] }), /NATIVE_TERRAIN_OPERATION_UNAVAILABLE/);
  await assert.rejects(f.map.create({ blueprintId: "native", destinationDirectory: "created", dryRun: false,
    landscape: { style: "city", materials: { base: "UnavailableTexture" } } }), /TEXTURE_NOT_RESOLVED|TEXTURE.*MISSING|TEXTURE.*PALETTE/);
  await assert.rejects(f.map.create({ blueprintId: "native", destinationDirectory: "template/nested" }), /INSIDE_BLUEPRINT/);
  await assert.rejects(fs.stat(path.join(f.root, "created")), { code: "ENOENT" });
  assert.deepEqual(await directoryManifest(f.source), before);
});

test("native integrity catches cell dimensions, cliff truncation and variable vertex sub-data corruption", async t => {
  const f = await fixture(t), terrain = new TerrainWorkspace(f.workspace);
  const pristine = await terrain.inspectComponents("template"); assert.equal(pristine.valid, true);
  for (const [name, corrupt] of [
    ["t3CellFlags", (b: Buffer) => { b.writeUInt32LE(31, 24); }],
    ["t3SyncCliffLevel", (b: Buffer) => { b.writeUInt32LE(31, 8); }],
    ["t3VertCol", (b: Buffer) => { b.writeUInt32LE(0xffffffff, 64); }],
  ] as const) {
    const file = path.join(f.source, name), original = await fs.readFile(file), invalid = Buffer.from(original);
    corrupt(invalid); await fs.writeFile(file, invalid);
    assert.equal((await f.map.inspect("template")).valid, false, name);
    await assert.rejects(f.map.registerBlueprint("bad", "template", false), /INVALID_BLUEPRINT/);
    await fs.writeFile(file, original);
  }
  const unknown = await fs.readFile(path.join(f.source, "t3CellFlags")); unknown.writeUInt32LE(99, 4);
  const r = inspectNativeIntegrity(new Map([["t3CellFlags", unknown]]), 32, 32);
  assert.equal(r.components[0].status, "PRESERVE_ONLY"); assert.equal(r.valid, true);
});

test("root templates create under reserved output without changing blueprint fingerprint", async t => {
  const f = await fixture(t), map = new MapWorkspace(new Workspace(f.source));
  const before = await directoryManifest(f.source);
  await map.registerBlueprint("root", "", false);
  const request = { blueprintId: "root", destinationDirectory: ".sc2mcp-output/new-map", dryRun: false };
  const result = await map.create(request); assert.equal(result.dryRun, false);
  assert.deepEqual(await directoryManifest(f.source), before);
  const newMap = new MapWorkspace(new Workspace(path.join(f.source, ".sc2mcp-output/new-map")));
  assert.equal((await newMap.inspect()).valid, true);
  await fs.writeFile(path.join(f.source, ".sc2mcp-output/new-map/Output.SC2Layout"), "<Desc/>");
  await fs.writeFile(path.join(f.source, ".sc2mcp-output/new-map/Output.SC2Cutscene"), "<Cutscene/>");
  await fs.mkdir(path.join(f.source, ".sc2mcp-output/new-map/Base.SC2Data/GameData"), { recursive: true });
  await fs.writeFile(path.join(f.source, ".sc2mcp-output/new-map/Base.SC2Data/GameData/UnitData.xml"), '<Catalog><CUnit id="OutputOnly"/></Catalog>');
  const sourceProject = await createProject(f.source);
  assert.deepEqual(await sourceProject.workspace.listLayoutFiles(), []);
  assert.deepEqual(await sourceProject.cutscene.listFiles(), []);
  assert.equal((await sourceProject.browse.search({ query: "OutputOnly" })).results.length, 0);
});

test("created map exports and reopens with exact authored component hashes", { skip: !archiveBackendAvailable() }, async t => {
  const f = await fixture(t); await f.map.registerBlueprint("native", "template", false);
  await f.map.create({ blueprintId: "native", destinationDirectory: "created", dryRun: false,
    terrainOperations: [{ op: "height.raise", area, amount: 0.25 }] });
  const result = await f.map.export("created", "created.SC2Map", false, false);
  assert.ok("verification" in result); assert.equal(result.verification.reopened, true);
  await extractArchive(path.join(f.root, "created.SC2Map"), path.join(f.root, "reopened"));
  assert.deepEqual(await directoryManifest(path.join(f.root, "created")), await directoryManifest(path.join(f.root, "reopened")));
});

test("HTTP uses the same strict blueprint/create schemas and real preview as MCP", async t => {
  const f = await fixture(t), project = await createProject(f.root);
  const call = (method: string, endpoint: string, body?: unknown) => dispatchGuiApi(project.workspace, project.schema, { method, pathname: `/api/map/${endpoint}`, body }, project);
  const registered = await call("POST", "blueprint/register", { id: "http", directory: "template", dryRun: false });
  assert.equal(registered.status, 200);
  assert.equal((await call("GET", "blueprints")).status, 200);
  const request = { blueprintId: "http", destinationDirectory: "created", landscape: { style: "city", seed: 42, materials: { base: "BelShirDirtLight" } } };
  const preview = await call("POST", "create", request); assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal((preview.body as { dryRun: boolean }).dryRun, true);
  await assert.rejects(fs.stat(path.join(f.root, "created")), { code: "ENOENT" });
  assert.notEqual((await call("POST", "create", { ...request, typo: true })).status, 200);
  const actual = await call("POST", "create", { ...request, dryRun: false }); assert.equal(actual.status, 200);
  assert.equal((actual.body as { contentSha256: string }).contentSha256, (preview.body as { contentSha256: string }).contentSha256);
});

test("Terrain validation and writer reject known malformed native grids", async t => {
  const f = await fixture(t), terrain = new TerrainWorkspace(f.workspace), file = path.join(f.source, "t3CellFlags");
  const b = await fs.readFile(file); await fs.writeFile(file, b.subarray(0, b.length - 1));
  assert.equal((await terrain.validate(undefined, "template")).valid, false);
  await assert.rejects(terrain.plan({ directory: "template", operations: [{ op: "height.raise", area, amount: 0.1 }] }), /INVALID_TERRAIN_NATIVE_COMPONENTS/);
  assert.deepEqual(await fs.readFile(file), b.subarray(0, b.length - 1));
});
