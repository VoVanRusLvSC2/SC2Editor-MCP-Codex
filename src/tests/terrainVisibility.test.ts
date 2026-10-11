import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Workspace } from "../core/workspace.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { TerrainVisibility } from "../modules/terrain/visibility.js";
import { terrainVisibilitySchema } from "../modules/terrain/schemas.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { PlacementWorkspace } from "../modules/placement/workspace.js";
import { renderTerrainPng } from "../modules/terrain/preview.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const area = { type: "rectangle" as const, minX: 4, minY: 4, maxX: 6, maxY: 6 };
async function fixture(t: test.TestContext) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "terrain-visibility-"));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const source = "src/tests/fixtures/terrain-visibility/p";
 for (const name of await fs.readdir(source)) await fs.writeFile(path.join(root, name.slice(0, -3)), gunzipSync(await fs.readFile(path.join(source, name))));
 const workspace = new Workspace(root), terrain = new TerrainWorkspace(workspace);
 return { root, workspace, terrain };
}
const flagBytes = (root: string) => fs.readFile(path.join(root, "t3CellFlags"));

test("user p.SC2Map fixture retains exact native hashes and the 24 hidden cells", async t => {
 const { root, terrain } = await fixture(t);
 const manifest = JSON.parse(await fs.readFile("src/tests/fixtures/terrain-visibility/manifest.json", "utf8"));
 for (const item of manifest.components) assert.equal(createHash("sha256").update(await fs.readFile(path.join(root, item.name))).digest("hex"), item.sha256);
 const visibility = await terrain.visibility("", [{ x: 55, y: 62 }, { x: 30, y: 30 }, { x: 62, y: 66 }]);
 assert.equal(visibility.hiddenCells, 24);
 assert.deepEqual(visibility.samples.map(cell => [cell.rawFlags, cell.hidden]), [[6, true], [2, false], [3, false]]);
 const capabilities = await terrain.capabilities(); assert.equal("hideTerrain" in capabilities && capabilities.hideTerrain, true);
});

test("hide/show toggles only bit 0x04, preserving cliff and unknown bits", () => {
 const bytes = Buffer.alloc(36); bytes.write("LFCT"); bytes.writeUInt32LE(102, 4); bytes.writeUInt32LE(2, 24); bytes.writeUInt32LE(2, 28);
 bytes.set([2, 3, 0x82, 0xa7], 32); const original = Buffer.from(bytes), visibility = new TerrainVisibility(bytes, 2, 2);
 assert.equal(visibility.setHidden(0, 0, true), true); assert.equal(visibility.setHidden(0, 0, true), false);
 visibility.setHidden(1, 0, true); visibility.setHidden(0, 1, true); visibility.setHidden(1, 1, false);
 assert.deepEqual([...bytes.subarray(32)], [6, 7, 0x86, 0xa3]);
 assert.deepEqual(bytes.subarray(0, 32), original.subarray(0, 32));
 visibility.setHidden(0, 0, false); assert.equal(bytes[32], original[32]);
});

test("visibility plans select cell centers and keep height/texture bytes unchanged", async t => {
 const { root, terrain } = await fixture(t), original = await flagBytes(root);
 const plan = await terrain.visibilityPlan(true, { area });
 assert.equal(plan.changedVisibilityCells, 4); assert.equal(plan.changedVertices, 0); assert.equal(plan.changedTexturePixels, 0);
 assert.deepEqual(plan.files.filter(file => file.changedBytes > 0).map(file => file.file), ["t3CellFlags"]);
 const planned = await terrain.visibility("", [{ x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 5 }], plan.id);
 assert.deepEqual(planned.samples.map(cell => cell.hidden), [true, true, false]);
 assert.deepEqual(await flagBytes(root), original);
 const unchanged = await terrain.visibilityPlan(true, { cells: [{ x: 55, y: 62 }] }); assert.equal(unchanged.changedVisibilityCells, 0);
});

test("native visibility supports stage/save, show restoration and grouped rollback", async t => {
 const { root, terrain } = await fixture(t), original = await flagBytes(root);
 const plan = await terrain.visibilityPlan(true, { cells: [{ x: 4, y: 4 }] });
 const applied = await terrain.apply(plan.id, { dryRun: false, stage: true });
 assert.deepEqual(await flagBytes(root), original);
 assert.equal((await terrain.visibility("", [{ x: 4, y: 4 }])).samples[0].hidden, true);
 const id = applied.transaction!.transactionId!;
 await terrain.save(id, { dryRun: false }); assert.notDeepEqual(await flagBytes(root), original);
 await terrain.rollback(id, false); assert.deepEqual(await flagBytes(root), original);
 const restored = await terrain.visibilityPlan(false, { cells: [{ x: 55, y: 62 }] });
 const state = await terrain.state("", restored.id);
 assert.equal(state.visibility!.raw(55, 62), 2); assert.equal(state.visibility!.hidden(55, 62), false);
});

test("visibility refuses out-of-bounds, duplicate, missing/both targets and unverified LFCT versions", async t => {
 const { root, terrain } = await fixture(t), original = await flagBytes(root);
 for (const value of [{}, { area, cells: [{ x: 4, y: 4 }] }, { cells: [{ x: 4, y: 4 }, { x: 4, y: 4 }] }, { cells: [{ x: 0.5, y: 0 }] }]) assert.equal(terrainVisibilitySchema.safeParse(value).success, false);
 await assert.rejects(terrain.visibilityPlan(true, { cells: [{ x: 128, y: 0 }] }), /VISIBILITY_CELL_OUT_OF_BOUNDS/);
 assert.deepEqual(await flagBytes(root), original);
 original.writeUInt32LE(101, 4); await fs.writeFile(path.join(root, "t3CellFlags"), original);
 const capabilities = await terrain.capabilities(); assert.equal("hideTerrain" in capabilities && capabilities.hideTerrain, false);
 await assert.rejects(terrain.visibilityPlan(true, { area }), /VISIBILITY_COMPONENT_UNSUPPORTED/);
});

test("visibility stale-source checks refuse apply/save after external changes", async t => {
 const { root, terrain } = await fixture(t), original = await flagBytes(root);
 const plan = await terrain.visibilityPlan(true, { area });
 const changed = Buffer.from(original); changed[32] ^= 8; await fs.writeFile(path.join(root, "t3CellFlags"), changed);
 await assert.rejects(terrain.apply(plan.id, { dryRun: false }), /STALE_TERRAIN_PLAN/);
 await fs.writeFile(path.join(root, "t3CellFlags"), original);
 const applied = await terrain.apply(plan.id, { dryRun: false });
 await fs.writeFile(path.join(root, "t3CellFlags"), changed);
 await assert.rejects(terrain.save(applied.transaction!.transactionId!, { dryRun: false }), /STALE_BINARY_TRANSACTION/);
});

test("visibility preview renders black ground cells and samplers preserve the height mask", async t => {
 const { terrain } = await fixture(t);
 const plan = await terrain.visibilityPlan(true, { area: { type: "rectangle", minX: 0, minY: 0, maxX: 16, maxY: 16 } });
 const state = await terrain.state("", plan.id), png = renderTerrainPng(state, "visibility", 16), chunks: Buffer[] = [];
 for (let offset = 8; offset < png.length;) { const length = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8); if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length)); offset += length + 12; }
 const pixels = inflateSync(Buffer.concat(chunks)); assert.deepEqual([...pixels.subarray(15 * 49 + 1, 15 * 49 + 4)], [0, 0, 0]);
 const sample = (await terrain.sample([{ x: 4.5, y: 4.5 }], "", plan.id)).samples[0];
 assert.equal(sample.hidden, true); assert.notEqual(sample.mask, 0);
});

test("placement snapping refuses a visually hidden native cell", async t => {
 const { root, workspace } = await fixture(t);
 await fs.cp("src/tests/fixtures/browse-placement-map", root, { recursive: true });
 const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace)), placement = new PlacementWorkspace(workspace, browse), terrain = new TerrainWorkspace(workspace, browse, placement);
 placement.terrain = terrain;
 await assert.rejects(placement.addDoodad({ id: "AgriaTree", position: { x: 55.5, y: 62.5, z: 8 }, snapToTerrain: true }), /terrain hole or excessive slope/);
});

test("default texture.blend retains both textures instead of repainting at full strength", async t => {
 const { terrain } = await fixture(t), palette = (await terrain.palette()).textures.filter(texture => texture.id && texture.slot < 8);
 const paint = await terrain.plan({ operations: [{ op: "texture.paint", area, texture: palette[0].id }] });
 await terrain.apply(paint.id, { dryRun: false, stage: false });
 const blend = await terrain.plan({ operations: [{ op: "texture.blend", area, texture: palette[1].id }] });
 const weights = (await terrain.state("", blend.id)).masks!.weights(36, 36);
 assert.ok(weights[palette[0].slot] > 0); assert.ok(weights[palette[1].slot] > 0); assert.equal(weights.reduce((a, b) => a + b, 0), 15);
});

test("real MCP tools paint, blend, sculpt, hide, save and restore native p.SC2Map components", { timeout: 20000 }, async t => {
 const { root } = await fixture(t), env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
 delete env.SC2_MCP_MODULES; env.SC2_UI_ROOT = root; env.SC2_MCP_PROFILE = "terrain";
 const client = new Client({ name: "terrain-authoring-test", version: "1" }); t.after(() => client.close());
 await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env, stderr: "pipe" }));
 const call = async (name: string, args: Record<string, unknown>) => { const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true, JSON.stringify(result)); if (result.content[0].type !== "text") throw new Error("Expected text"); return JSON.parse(result.content[0].text); };
 const commit = async (plan: any) => { assert.equal(plan.valid, true); const result = await call("terrain.apply", { planId: plan.id, dryRun: false, stage: true }); await call("terrain.save", { transactionId: result.transaction.transactionId, dryRun: false }); };
 const palette = (await call("terrain.palette.get", {})).textures.filter((texture: any) => texture.id && texture.slot < 8);
 const paint = await call("terrain.paint", { area, texture: palette[2].id }); assert.ok(paint.changedTexturePixels > 0); await commit(paint);
 const blend = await call("terrain.blend", { area, texture: palette[1].id }); assert.ok(blend.changedTexturePixels > 0); await commit(blend);
 const relief = await call("terrain.plan", { operations: [{ op: "height.raise", area, amount: 0.5 }, { op: "height.noise", area, amplitude: 0.2, seed: 42, wavelength: 3 }] }); assert.ok(relief.changedVertices > 0); await commit(relief);
 const hidden = await call("terrain.hide", { area }); assert.equal(hidden.changedVisibilityCells, 4); await commit(hidden);
 assert.equal((await call("terrain.visibility.inspect", { cells: [{ x: 4, y: 4 }] })).samples[0].hidden, true);
 const shown = await call("terrain.show", { area }); assert.equal(shown.changedVisibilityCells, 4); await commit(shown);
 assert.equal((await call("terrain.visibility.inspect", { cells: [{ x: 4, y: 4 }] })).samples[0].hidden, false);
});
