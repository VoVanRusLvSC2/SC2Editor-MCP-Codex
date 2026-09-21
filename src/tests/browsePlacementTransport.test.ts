import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { PlacementWorkspace } from "../modules/placement/workspace.js";
import { dispatchGuiApi } from "../gui/api.js";

test("Browse / Placement GUI API shares plans, rejects bad numbers, and defaults apply to dry-run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-authoring-gui-"));
  await fs.cp("src/tests/fixtures/browse-placement-map", root, { recursive: true });
  const schema = await SchemaRegistry.loadBundled(); const workspace = new Workspace(root, schema);
  const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace)); const authoring = { browse, placement: new PlacementWorkspace(workspace, browse) };
  const before = (await workspace.readRaw("Objects")).text;
  const search = await dispatchGuiApi(workspace, schema, { method: "GET", pathname: "/api/browse/search", query: new URLSearchParams({ q: "Marine", catalogType: "Unit" }) }, authoring);
  assert.equal(search.status, 200);
  const plan = await dispatchGuiApi(workspace, schema, { method: "POST", pathname: "/api/placement/unit", body: { id: "Marine", position: { x: 30, y: 40, z: 0 } } }, authoring);
  assert.equal(plan.status, 200);
  const planId = (plan.body as { plan: { id: string } }).plan.id;
  const apply = await dispatchGuiApi(workspace, schema, { method: "POST", pathname: "/api/placement/apply", body: { planId } }, authoring);
  assert.equal(apply.status, 200); assert.equal((await workspace.readRaw("Objects")).text, before);
  const bad = await dispatchGuiApi(workspace, schema, { method: "POST", pathname: "/api/placement/unit", body: { id: "Marine", position: { x: "not-a-number", y: 40, z: 0 } } }, authoring);
  assert.equal(bad.status, 400);
});

test("the existing stdio MCP launcher lists and executes browse/placement alongside all old modules", { timeout: 15000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-authoring-mcp-"));
  await fs.cp("src/tests/fixtures/browse-placement-map", root, { recursive: true });
  const before = await fs.readFile(path.join(root, "Objects"), "utf8");
  for (const name of await fs.readdir("src/tests/fixtures/terrain-native/nydus"))
    await fs.writeFile(path.join(root, name.slice(0, -3)), gunzipSync(await fs.readFile(path.join("src/tests/fixtures/terrain-native/nydus", name))));
  await fs.mkdir(path.join(root,"Base.SC2Data/GameData"),{recursive:true});
  await fs.writeFile(path.join(root,"Base.SC2Data/GameData/WaterData.xml"),gunzipSync(await fs.readFile("src/tests/fixtures/water-native/Core-WaterData.xml.gz")));
  const terrainBefore = await fs.readFile(path.join(root, "t3HeightMap"));
  const child = spawn(process.execPath, ["dist/index.js"], { env: { ...process.env, SC2_UI_ROOT: root, SC2_ASSET_ROOTS: "", SC2_BROWSE_INSTALLED_ROOTS: "" }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let buffer = ""; let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  child.stdout.on("data", (data) => {
    buffer += data;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const response = JSON.parse(line); const item = pending.get(response.id);
      if (item) { pending.delete(response.id); if (response.error) item.reject(new Error(JSON.stringify(response.error))); else item.resolve(response.result); }
    }
  });
  child.on("exit", () => { for (const item of pending.values()) item.reject(new Error(`MCP exited: ${stderr}`)); });
  let id = 0;
  const call = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    const nextId = ++id; pending.set(nextId, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: nextId, method, params }) + "\n");
  });
  try {
    await call("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "sc2-regression", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = await call("tools/list", {}); const names = listed.tools.map((tool: { name: string }) => tool.name);
    for (const name of ["terrain.water.inspect", "terrain.water.plan", "terrain.inspect", "terrain.plan", "terrain.generate", "terrain.apply", "ai.context", "ai.query", "ai.describe_type", "ai.apply", "ai.validate", "browse.search", "browse.resolve", "placement.createLocation", "placement.apply", "data.apply", "text.apply", "cutscene.apply", "ui.apply"]) assert.ok(names.includes(name), name);
    assert.equal(names.some((name: string) => /^trigger\./.test(name)), false);
    const terrainInspect = await call("tools/call", { name: "terrain.inspect", arguments: {} });
    assert.deepEqual(JSON.parse(terrainInspect.content[0].text).dimensions.vertices, [33, 33]);
    const waterRead = await call("tools/call",{name:"terrain.water.inspect",arguments:{}});
    assert.equal(JSON.parse(waterRead.content[0].text).water.count,0);
    const waterPlanned = await call("tools/call",{name:"terrain.water.plan",arguments:{operations:[{op:"water.material",id:"TransportLake",parent:"Default",height:6},{op:"water.create",template:"TransportLake",area:{type:"rectangle",minX:8,minY:8,maxX:16,maxY:16}}]}});
    assert.equal(waterPlanned.isError,undefined);
    const waterPlan = JSON.parse(waterPlanned.content[0].text);
    assert.equal(waterPlan.valid,true);
    const waterDry = await call("tools/call",{name:"terrain.apply",arguments:{planId:waterPlan.id}});
    assert.equal(waterDry.isError,undefined);assert.equal(JSON.parse(waterDry.content[0].text).transaction.dryRun,true);
    const terrainPlanned = await call("tools/call", { name: "terrain.plan", arguments: { operations: [{ op: "height.raise", amount: 0.5, area: { type: "circle", center: { x: 16, y: 16 }, radius: 6 }, edgeBlend: 2 }] } });
    assert.equal(terrainPlanned.isError, undefined);
    const terrainPlan = JSON.parse(terrainPlanned.content[0].text);
    const terrainPreview = await call("tools/call", { name: "terrain.preview", arguments: { planId: terrainPlan.id } });
    assert.equal(terrainPreview.content[1].type, "image");
    const terrainDryRun = await call("tools/call", { name: "terrain.apply", arguments: { planId: terrainPlan.id } });
    assert.equal(JSON.parse(terrainDryRun.content[0].text).transaction.dryRun, true);
    assert.deepEqual(await fs.readFile(path.join(root, "t3HeightMap")), terrainBefore);
    const terrainStaged = await call("tools/call", { name: "terrain.apply", arguments: { planId: terrainPlan.id, dryRun: false, stage: true } });
    const transactionId = JSON.parse(terrainStaged.content[0].text).transaction.transactionId;
    const terrainDiscard = await call("tools/call", { name: "terrain.rollback", arguments: { transactionId, dryRun: false } });
    assert.equal(JSON.parse(terrainDiscard.content[0].text).discarded, true);
    assert.deepEqual(await fs.readFile(path.join(root, "t3HeightMap")), terrainBefore);
    const doodadPlanned = await call("tools/call", { name: "placement.scatterDoodads", arguments: { area: { type: "rectangle", minX: 4, minY: 4, maxX: 28, maxY: 28 }, objects: [{ id: "AgriaTree", weight: 3 }, { id: "CharDuneRock", weight: 1 }], count: 20, seed: 42 } });
    const doodadPlan = JSON.parse(doodadPlanned.content[0].text);
    assert.equal(doodadPlan.plan.totalOperations, 20); assert.equal(doodadPlan.plan.operations.length, 10);
    assert.equal(doodadPlan.plan.truncated, true);
    const doodadApplied = await call("tools/call", { name: "placement.apply", arguments: { planId: doodadPlan.plan.id } });
    assert.equal(JSON.parse(doodadApplied.content[0].text).applied, false);
    const snap = await call("tools/call", { name: "placement.snapToTerrain", arguments: { objectIds: [100, 101] } });
    assert.equal(JSON.parse(snap.content[0].text).objects, 2);
    const recipePlan = await call("tools/call", { name: "terrain.recipe.plan", arguments: { xml: '<TerrainRecipe version="1"><Area id="a" shape="circle" center="16 16" radius="4"/><Raise area="a" amount="0.2"/></TerrainRecipe>' } });
    assert.equal(JSON.parse(recipePlan.content[0].text).valid, true);
    const aiPreview = await call("tools/call", { name: "ai.apply", arguments: { operations: [{ op: "definition.create", id: "PreviewAI" }] } });
    assert.equal(JSON.parse(aiPreview.content[0].text).files[0].dryRun, true);
    await assert.rejects(fs.stat(path.join(root, "CustomAI")));
    const aiContext = await call("tools/call", { name: "ai.context", arguments: {} });
    assert.equal(JSON.parse(aiContext.content[0].text).scope.triggerEditing, false);
    const searched = await call("tools/call", { name: "browse.search", arguments: { query: "Marine", catalogType: "Unit", limit: 1 } });
    assert.equal(JSON.parse(searched.content[0].text).results[0].id, "Marine");
    const planned = await call("tools/call", { name: "placement.addUnit", arguments: { id: "Marine", position: { x: 30, y: 40, z: 0 } } });
    const plan = JSON.parse(planned.content[0].text);
    const applied = await call("tools/call", { name: "placement.apply", arguments: { planId: plan.id } });
    assert.equal(JSON.parse(applied.content[0].text).applied, false);
    assert.equal(await fs.readFile(path.join(root, "Objects"), "utf8"), before);
  } finally { child.kill(); }
});
