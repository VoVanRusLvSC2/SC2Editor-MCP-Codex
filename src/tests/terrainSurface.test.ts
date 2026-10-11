import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ZodType } from "zod/v4";
import { Workspace } from "../core/workspace.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { TerrainSurfaceWorkspace } from "../modules/terrain/surface/workspace.js";
import { registerTerrainSurfaceTools } from "../modules/terrain/surface/tools.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-terrain-surface-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp("src/tests/fixtures/terrain-surface", root, { recursive: true });
  const workspace = new Workspace(root);
  return { root, workspace, surface: new TerrainSurfaceWorkspace(workspace) };
}
function tools(workspace: Workspace) {
  const registered = new Map<string, { schema: ZodType; run: (args: any) => Promise<any> }>();
  const server = { registerTool(name: string, config: { inputSchema: ZodType }, run: (args: any) => Promise<any>) {
    registered.set(name, { schema: config.inputSchema, run });
  } } as unknown as McpServer;
  registerTerrainSurfaceTools(server, { workspace: new TerrainWorkspace(workspace) });
  return async (name: string, args: unknown) => {
    const tool = registered.get(`terrain.surface.${name}`)!;
    const result = await tool.run(tool.schema.parse(args));
    return { isError: result.isError, body: JSON.parse(result.content[0].text) };
  };
}

test("Terrain surface reads drafts and newly staged components; discard restores the snapshot", async t => {
  const { workspace, surface } = await fixture(t), before = await surface.load();
  const bytes = Buffer.from(before.snapshot.bytes("t3HeightMap"));
  bytes.writeUInt16LE(1234, 32);
  await workspace.binary.apply(["t3HeightMap"], () => new Map([["t3HeightMap", bytes]]), { dryRun: false, stage: true });
  const staged = await surface.load();
  assert.notEqual(staged.revision, before.revision);
  assert.equal(staged.snapshot.sampleHeight(0, 0).raw.heightBase, 1234);
  assert.deepEqual(staged.stagedFiles, ["t3HeightMap"]);
  workspace.discard("t3HeightMap");
  assert.equal((await surface.load()).revision, before.revision);
  await workspace.binary.apply(["t3Future"], () => new Map([["t3Future", Buffer.from([1, 2])]]), { dryRun: false, stage: true });
  assert.ok((await surface.load()).snapshot.names().includes("t3Future"));
});

test("Terrain surface preview is pure and tiny overview budgets are explicit", async t => {
  const { root, workspace } = await fixture(t), call = tools(workspace);
  const before = await fs.readFile(path.join(root, "t3HeightMap"));
  const plan = await call("plan.cell", { edit: { kind: "height-raw", x: 0, y: 0, channel: "heightBase", value: 1234 } });
  assert.equal(plan.isError, false);
  assert.equal(plan.body.engineValidated, false);
  assert.equal(plan.body.result.data.requiresEditorRoundTrip, true);
  assert.ok(plan.body.result.data.dirtyDependencies.includes("t3SyncHeightMap"));
  assert.ok(plan.body.result.data.changedRanges.length);
  assert.deepEqual(await fs.readFile(path.join(root, "t3HeightMap")), before);
  assert.deepEqual(workspace.binary.draftFiles(), []);
  assert.match((await call("overview", { maxChars: 128 })).body.result.data, /TRUNCATED/);
  const bad = await call("bytes", { component: "../outside", offset: 0 });
  assert.equal(bad.isError, true);
  assert.match(bad.body.result.error, /UNSAFE_COMPONENT_PATH/);
});

test("Terrain surface keeps maps separate and rejects absolute, traversal and symlink scopes", async t => {
  const { root, surface } = await fixture(t);
  await fs.mkdir(path.join(root, "A")); await fs.mkdir(path.join(root, "B"));
  await fs.copyFile(path.join(root, "t3HeightMap"), path.join(root, "A/t3HeightMap"));
  await fs.copyFile(path.join(root, "t3HeightMap"), path.join(root, "B/t3HeightMap"));
  const a = await surface.load("A"), b = await surface.load("B");
  assert.deepEqual(a.snapshot.names(), ["t3HeightMap"]);
  assert.notEqual(a.revision, b.revision);
  for (const directory of ["..", "A/../B", root, "C:/other", "A:other"])
    await assert.rejects(surface.load(directory), /UNSAFE_COMPONENT_PATH/);
  await fs.symlink(path.join(root, "B"), path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(surface.load("link"), /symlink/i);
});

test("Terrain surface detects file changes during the observed read set", async t => {
  const { root, workspace, surface } = await fixture(t), read = workspace.binary.read.bind(workspace.binary);
  let changed = false;
  workspace.binary.read = async (file, includeDraft) => {
    const raw = await read(file, includeDraft);
    if (file === "t3HeightMap" && !changed) {
      changed = true;
      const next = Buffer.from(raw.bytes); next[32] ^= 1;
      await fs.writeFile(path.join(root, file), next);
    }
    return raw;
  };
  await assert.rejects(surface.load(), /SURFACE_CHANGED_DURING_READ/);
});

test("Terrain surface rejects oversized inputs before reading the component", async t => {
  const { root, surface } = await fixture(t), file = await fs.open(path.join(root, "t3Future"), "w");
  await file.truncate(128 * 1024 * 1024 + 1); await file.close();
  await assert.rejects(surface.load(), /SURFACE_INPUT_BYTE_BUDGET/);
});

test("Terrain surface catalog inspection preserves tokens and sparse fields with actual byte provenance", async t => {
  const { root, workspace, surface } = await fixture(t);
  await fs.mkdir(path.join(root, "GameData"));
  await fs.writeFile(path.join(root, "GameData/CliffMeshData.xml"), `<Catalog><CCliffMesh id="Mesh"><?token id="id" type="string"?><ModelPath value="Assets/##id##/"/><CliffHeights index="0" value="1"/><CliffHeights index="2" value="3"/></CCliffMesh></Catalog>`);
  const result = await surface.catalog("GameData/CliffMeshData.xml", { offset: 0, limit: 5, bindings: { id: "Mesh" } });
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.items[0].tokens[0].id, "id");
  assert.deepEqual(result.items[0].cliffHeights?.entries.map(entry => entry.index), [0, 2]);
  assert.equal(result.items[0].references[0].preview?.value, "Assets/Mesh/");
  assert.equal(result.inheritanceResolved, false);
  const call = tools(workspace);
  await fs.writeFile(path.join(root, "GameData/WaterData.xml"), `<Catalog><CWater id="Huge"><Future value="${"x".repeat(40000)}"/></CWater></Catalog>`);
  const huge = await call("catalog.inspect", { file: "GameData/WaterData.xml" });
  assert.equal(huge.isError, true); assert.equal(huge.body.error, "OUTPUT_BUDGET");
});
