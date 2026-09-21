import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Workspace } from "../core/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { DataSchemaRegistry } from "../modules/data/schemaRegistry.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { PlacementDocument } from "../modules/placement/document.js";
import { planPositions } from "../modules/placement/planner.js";
import { PlacementWorkspace } from "../modules/placement/workspace.js";

const FIXTURE = path.resolve("src/tests/fixtures/browse-placement-map");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-placement-"));
  await fs.cp(FIXTURE, root, { recursive: true });
  const workspace = new Workspace(root);
  const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace, new DataSchemaRegistry()));
  return { root, workspace, placement: new PlacementWorkspace(workspace, browse) };
}

test("PlacementDocument adds Unit and Doodad using their real distinct type attributes", () => {
  const document = PlacementDocument.create();
  document.add({ kind: "Unit", catalogId: "Marine", position: { x: 1, y: 2, z: 3 }, owner: 1 });
  document.add({ kind: "Doodad", catalogId: "AgriaTree", position: { x: 4, y: 5, z: 6 }, scale: { x: 1, y: 1, z: 1 } });
  assert.match(document.source, /<ObjectUnit[^>]*UnitType="Marine"[^>]*Player="1"/);
  assert.match(document.source, /<ObjectDoodad[^>]*Type="AgriaTree"/);
  assert.equal(document.validate().length, 0);
});

test("line, grid, circle and seeded scatter planners are deterministic", () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(planPositions(origin, 3, { type: "line", spacing: 2 }).length, 3);
  assert.deepEqual(planPositions(origin, 4, { type: "grid", columns: 2, spacingX: 2, spacingY: 3 })[3], { x: 2, y: 3, z: 0 });
  assert.equal(planPositions(origin, 8, { type: "circle", radius: 5 }).length, 8);
  const scatter = { type: "scatter" as const, area: { type: "circle" as const, center: origin, radius: 10 }, seed: 1234, minimumDistance: 1 };
  assert.deepEqual(planPositions(origin, 20, scatter), planPositions(origin, 20, scatter));
  assert.notDeepEqual(planPositions(origin, 20, scatter), planPositions(origin, 20, { ...scatter, seed: 1235 }));
});

test("placement.addUnit resolves through browse and dry-run changes no file", async () => {
  const { root, placement } = await fixture();
  const before = await fs.readFile(path.join(root, "Objects"), "utf8");
  const plan = await placement.addUnit({ id: "Marine", catalogType: "Unit", position: { x: 30, y: 40, z: 0 }, owner: 2, count: 3, layout: { type: "line", spacing: 2 } });
  const preview = await placement.preview(plan.id);
  assert.equal(preview.validation.valid, true);
  assert.equal(preview.applied.length, 3);
  await placement.apply(plan.id);
  assert.equal(await fs.readFile(path.join(root, "Objects"), "utf8"), before);
});

test("placement applies a Doodad atomically, creates backup, reparses, and is idempotent", async () => {
  const { root, placement } = await fixture();
  const before = await fs.readFile(path.join(root, "Objects"), "utf8");
  const plan = await placement.addDoodad({ id: "AgriaTree", catalogType: "Actor", position: { x: 30, y: 30, z: 0 }, rotation: 2, scale: 0.9 });
  const applied = await placement.apply(plan.id, { dryRun: false, stage: false, backup: true });
  assert.equal(applied.accepted, true);
  const after = await fs.readFile(path.join(root, "Objects"), "utf8");
  assert.match(after, /ObjectDoodad[^>]*Type="AgriaTree"/);
  assert.equal(await fs.readFile(path.join(root, "Objects.sc2uimcp.bak"), "utf8"), before);
  assert.equal(new PlacementDocument(after).validate().length, 0);
  const second = await placement.apply(plan.id, { dryRun: false, stage: false });
  assert.equal(second.alreadyApplied, true);
  assert.equal(await fs.readFile(path.join(root, "Objects"), "utf8"), after);
});

test("move/rotate/scale/remove patch only selected object spans and preserve unknown data", async () => {
  const { root, placement } = await fixture();
  for (const input of [
    { op: "move" as const, objectId: 100, position: { x: 33, y: 44, z: 1 } },
    { op: "rotate" as const, objectId: 100, rotation: 3.14 },
    { op: "scale" as const, objectId: 100, scale: 1.2 },
  ]) {
    const plan = await placement.mutate(input);
    await placement.apply(plan.id, { dryRun: false, stage: false });
  }
  const edited = await fs.readFile(path.join(root, "Objects"), "utf8");
  assert.match(edited, /Unknown="keep"/);
  assert.match(edited, /UnknownChild Value="preserve"/);
  assert.match(edited, /Position="33,44,1"/);
  assert.match(edited, /Rotation="3.14"/);
  assert.match(edited, /Scale="1.2,1.2,1.2"/);
  const removal = await placement.mutate({ op: "remove", objectId: 100 });
  await placement.apply(removal.id, { dryRun: false, stage: false });
  assert.doesNotMatch(await fs.readFile(path.join(root, "Objects"), "utf8"), /ObjectUnit Id="100"/);
});

test("duplicate ids and out-of-bounds plans are rejected by validation", async () => {
  const duplicate = new PlacementDocument(`<PlacedObjects Version="27"><ObjectUnit Id="1" Position="0,0,0" UnitType="Marine"/><ObjectDoodad Id="1" Position="1,1,0" Type="Tree"/></PlacedObjects>`);
  assert.ok(duplicate.validate().some((issue) => issue.code === "DUPLICATE_OBJECT_ID"));
  const { placement } = await fixture();
  const plan = await placement.addUnit({ id: "Marine", catalogType: "Unit", position: { x: 500, y: 500, z: 0 }, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
  const preview = await placement.preview(plan.id);
  assert.equal(preview.validation.checks.bounds, "FAIL");
  assert.equal((await placement.apply(plan.id, { dryRun: false, stage: false })).accepted, false);
});

test("createLocation builds forest, desert and city as one deterministic batch from browse candidates", async () => {
  const { placement } = await fixture();
  for (const locationType of ["forest", "desert", "city"] as const) {
    const first = await placement.createLocation({ locationType, area: { type: "circle", center: { x: 50, y: 50, z: 0 }, radius: 18 }, objectCount: 12, seed: 777, minimumDistance: 1, scaleRange: { min: 0.85, max: 1.15 } });
    const second = await placement.createLocation({ locationType, area: { type: "circle", center: { x: 50, y: 50, z: 0 }, radius: 18 }, objectCount: 12, seed: 777, minimumDistance: 1, scaleRange: { min: 0.85, max: 1.15 } });
    assert.equal(first.plan.id, second.plan.id);
    assert.equal(first.plan.operations.length, 12);
    assert.ok(first.plan.candidates.length > 0);
    assert.equal((await placement.preview(first.plan.id)).validation.valid, true);
  }
});

test("scatter honors an exclusion zone and minimum distance", () => {
  const positions = planPositions({ x: 0, y: 0, z: 0 }, 30, { type: "scatter", area: { type: "circle", center: { x: 0, y: 0, z: 0 }, radius: 20 }, seed: 99, minimumDistance: 2, exclusionZones: [{ type: "circle", center: { x: 0, y: 0 }, radius: 5 }] });
  assert.equal(positions.length, 30);
  assert.ok(positions.every((point) => Math.hypot(point.x, point.y) >= 5));
  for (let left = 0; left < positions.length; left++) for (let right = left + 1; right < positions.length; right++) assert.ok(Math.hypot(positions[left]!.x - positions[right]!.x, positions[left]!.y - positions[right]!.y) >= 2);
});

test("placement refuses a stale disk snapshot before any write", async () => {
  const { root, placement } = await fixture();
  const plan = await placement.addUnit({ id: "Marine", position: { x: 60, y: 60, z: 0 } });
  await fs.appendFile(path.join(root, "Objects"), "\n<!-- external edit -->");
  const changed = await fs.readFile(path.join(root, "Objects"), "utf8");
  await assert.rejects(placement.apply(plan.id, { dryRun: false, stage: false }), /STALE_PLACEMENT_PLAN/);
  assert.equal(await fs.readFile(path.join(root, "Objects"), "utf8"), changed);
});

test("recreating the exact committed request cannot silently duplicate objects", async () => {
  const { root, placement } = await fixture();
  const request = { id: "Marine", position: { x: 60, y: 60, z: 0 } };
  const first = await placement.addUnit(request);
  await placement.apply(first.id, { dryRun: false, stage: false });
  const before = await fs.readFile(path.join(root, "Objects"), "utf8");
  const second = await placement.addUnit(request);
  assert.equal(first.id, second.id);
  assert.equal((await placement.apply(second.id, { dryRun: false, stage: false })).alreadyApplied, true);
  assert.equal(await fs.readFile(path.join(root, "Objects"), "utf8"), before);
});

test("rollback dry-run preserves both staged components", async () => {
  const { root, workspace, placement } = await fixture();
  const before = await fs.readFile(path.join(root, "Objects"), "utf8");
  await workspace.applyRawTransaction(["ComponentList.SC2Components"], (sources) => new Map(sources).set("ComponentList.SC2Components", "<Components/>"), { dryRun: false, stage: true });
  const plan = await placement.addUnit({ id: "Marine", position: { x: 60, y: 60, z: 0 } });
  await placement.apply(plan.id, { dryRun: false, stage: true });
  await placement.rollback();
  assert.equal(workspace.hasDraft("Objects"), true);
  assert.equal(workspace.hasDraft("ComponentList.SC2Components"), true);
  await placement.rollback("Objects", "ComponentList.SC2Components", false);
  assert.equal(workspace.hasDraft("Objects"), false);
  assert.equal(workspace.hasDraft("ComponentList.SC2Components"), false);
  assert.equal(await fs.readFile(path.join(root, "Objects"), "utf8"), before);
});

test("invalid format and unproven writable attributes are not accepted", () => {
  assert.ok(new PlacementDocument("<PlacedObjects><ObjectUnit").validate().some((issue) => issue.code === "MALFORMED_XML"));
  const invalid = new PlacementDocument('<PlacedObjects Version="27"><ObjectUnit Id="1abc" UnitType="Marine" Scale="1,1" Rotation="NaN"/></PlacedObjects>');
  assert.ok(invalid.validate().some((issue) => issue.code === "MISSING_OBJECT_ID"));
  assert.ok(invalid.validate().some((issue) => issue.code === "INVALID_SCALE"));
  assert.ok(invalid.validate().some((issue) => issue.code === "INVALID_ROTATION"));
  assert.throws(() => PlacementDocument.create().add({ kind: "Doodad", catalogId: "Tree", position: { x: 0, y: 0, z: 0 }, flags: { InventedFlag: "1" } }), /Unproven/);
});

test("settlement createLocation reserves crossroads without pretending to paint terrain", async () => {
  const { placement } = await fixture();
  const created = await placement.createLocation({ locationType: "city", area: { type: "circle", center: { x: 50, y: 50, z: 0 }, radius: 20 }, objectCount: 20, seed: 32 });
  assert.equal(created.composition.reservedPaths.length, 2);
  for (const operation of created.plan.operations) if (operation.op === "add") assert.ok(Math.abs(operation.object.position.x - 50) > 1.6 && Math.abs(operation.object.position.y - 50) > 1.6);
});
