import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import { Workspace } from "../core/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { PlacementWorkspace } from "../modules/placement/workspace.js";
import { PlacementDocument } from "../modules/placement/document.js";
import { planPositions } from "../modules/placement/planner.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { applyOperations, parseState } from "../modules/terrain/operations.js";
import { dispatchGuiApi } from "../gui/api.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import type { PlacementMutation } from "../modules/placement/types.js";

const area = {
  type: "rectangle" as const,
  minX: 4,
  minY: 4,
  maxX: 28,
  maxY: 28,
  z: 0,
};
async function nativeSources(id: string) {
  const sources = new Map<string, Buffer>();
  for (const f of await fs.readdir(`src/tests/fixtures/terrain-native/${id}`))
    sources.set(
      f.slice(0, -3),
      gunzipSync(
        await fs.readFile(`src/tests/fixtures/terrain-native/${id}/${f}`),
      ),
    );
  return sources;
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "terrain-doodads-"));
  for (const [name, bytes] of await nativeSources("nydus"))
    await fs.writeFile(path.join(root, name), bytes);
  await fs.cp("src/tests/fixtures/browse-placement-map", root, {
    recursive: true,
  });
  const schema = await SchemaRegistry.loadBundled(),
    workspace = new Workspace(root, schema);
  const browse = new BrowseWorkspace(workspace, new DataWorkspace(workspace)),
    placement = new PlacementWorkspace(workspace, browse);
  const terrain = new TerrainWorkspace(workspace, browse, placement);
  placement.terrain = terrain;
  return {
    root,
    schema,
    workspace,
    browse,
    placement,
    terrain,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

test("batched Doodad append preserves sequential XML/IDs, mixed order and rejects a bad run before mutation", () => {
  const source =
    '<PlacedObjects Version="27" Unknown="keep"><!-- keep --><ObjectDoodad Id="10" Type="Rock" Position="0,0,0"/></PlacedObjects>';
  const operations: PlacementMutation[] = [
    {
      op: "add",
      object: {
        kind: "Doodad",
        catalogId: "Tree",
        position: { x: 1, y: 2, z: 8 },
        flags: { HeightAbsolute: "1" },
      },
    },
    {
      op: "add",
      object: {
        kind: "Unit",
        catalogId: "Marine",
        objectId: 30,
        position: { x: 3, y: 4, z: 8 },
        owner: 1,
      },
    },
    { op: "move", objectId: 11, position: { x: 4, y: 2, z: 9 } },
    { op: "remove", objectId: 30 },
    {
      op: "add",
      object: {
        kind: "Doodad",
        catalogId: "Bush",
        position: { x: 4, y: 2, z: 9 },
      },
    },
  ];
  const sequential = new PlacementDocument(source),
    batched = new PlacementDocument(source);
  for (const operation of operations) sequential.apply([operation]);
  batched.apply(operations);
  assert.equal(batched.source, sequential.source);
  const invalid = new PlacementDocument(source);
  assert.throws(
    () =>
      invalid.addMany([
        { kind: "Doodad", catalogId: "Tree", position: { x: 1, y: 1, z: 8 } },
        {
          kind: "Doodad",
          objectId: 10,
          catalogId: "Rock",
          position: { x: 1, y: 1, z: 8 },
        },
      ]),
    /Duplicate/,
  );
  assert.equal(invalid.source, source);
  const full = new PlacementDocument(
    '<PlacedObjects><ObjectDoodad Id="2147483647" Type="R" Position="0,0,0"/></PlacedObjects>',
  );
  assert.deepEqual(
    full.addMany(
      Array.from({ length: 3 }, () => ({
        kind: "Doodad" as const,
        catalogId: "Tree",
        position: { x: 1, y: 1, z: 8 },
      })),
    ),
    [1, 2, 3],
  );
});

test("spatial scatter retains alpha.8 seeded output and handles negative coordinates/existing centers", () => {
  const points = planPositions({ x: 0, y: 0, z: 0 }, 5000, {
    type: "scatter",
    area: { type: "rectangle", minX: 0, minY: 0, maxX: 200, maxY: 200, z: 0 },
    minimumDistance: 1,
    seed: 42,
  });
  assert.equal(
    createHash("sha256").update(JSON.stringify(points)).digest("hex"),
    "60ff1cfca0256dc72274b91a1d17638d4e9d5c321045ed0532ae09811e658208",
  );
  const existing = [{ x: -5, y: -5, z: 0 }];
  const negative = planPositions(
    { x: 0, y: 0, z: 0 },
    100,
    {
      type: "scatter",
      area: { type: "rectangle", minX: -20, minY: -20, maxX: 0, maxY: 0, z: 0 },
      minimumDistance: 1.2,
      seed: 9,
    },
    { existingPoints: existing },
  );
  for (let i = 0; i < negative.length; i++)
    for (const other of [...existing, ...negative.slice(0, i)])
      assert.ok(
        Math.hypot(negative[i].x - other.x, negative[i].y - other.y) >= 1.2,
      );
});

test("bounded native terrain processing retains byte-exact alpha.8 brush output", async () => {
  const sources = await nativeSources("ant"),
    state = parseState(sources);
  applyOperations(state, [
    {
      op: "height.noise",
      area: { type: "circle", center: { x: 68, y: 68 }, radius: 6 },
      seed: 42,
      amplitude: 0.2,
    },
    {
      op: "texture.paint",
      area: { type: "circle", center: { x: 68, y: 68 }, radius: 6 },
      texture: "KorhalCityEx2_1",
      strength: 0.5,
    },
  ]);
  assert.equal(
    createHash("sha256")
      .update(Buffer.concat([...sources.values()]))
      .digest("hex"),
    "7919164a4c9d6ef6b60932326497712f2f4a52f04a938983d12fd9f103297afb",
  );
});

test("terrain-aware Doodads use weighted deterministic assets, spacing, native flags and preserve unknown XML on commit", async () => {
  const f = await fixture();
  try {
    const before = await fs.readFile(path.join(f.root, "Objects"), "utf8");
    const request = {
      area,
      objects: [
        { id: "AgriaTree", weight: 3 },
        { id: "CharDuneRock", weight: 1 },
      ],
      count: 80,
      seed: 42,
      minimumDistance: 1.2,
      textures: [{ id: "BelShirDirtLight", minWeight: 10 }],
    };
    const first = await f.placement.scatterDoodads(request),
      second = await f.placement.scatterDoodads(request);
    assert.equal(first.plan.id, second.plan.id);
    assert.deepEqual(first.plan.operations, second.plan.operations);
    const trees = first.plan.operations.filter(
      (o) => o.op === "add" && o.object.catalogId === "AgriaTree",
    ).length;
    assert.ok(trees > 40 && trees < 80);
    const surface = await f.terrain.surface();
    for (const operation of first.plan.operations)
      if (operation.op === "add") {
        assert.equal(operation.object.flags?.HeightAbsolute, "1");
        assert.equal(
          operation.object.position.z,
          surface.sampleGround(operation.object.position).height,
        );
        for (const existing of [
          { x: 10, y: 20 },
          { x: 12, y: 20 },
        ])
          assert.ok(
            Math.hypot(
              operation.object.position.x - existing.x,
              operation.object.position.y - existing.y,
            ) >= 1.2,
          );
      }
    assert.equal(
      (await f.placement.preview(first.plan.id)).validation.valid,
      true,
    );
    await f.placement.apply(first.plan.id);
    assert.equal(
      await fs.readFile(path.join(f.root, "Objects"), "utf8"),
      before,
    );
    await f.placement.apply(first.plan.id, { dryRun: false, stage: false });
    const after = await fs.readFile(path.join(f.root, "Objects"), "utf8");
    assert.ok(after.includes('<UnknownChild Value="preserve"/>'));
    assert.ok(after.includes('Unknown="keep"'));
    assert.equal(new PlacementDocument(after).list().length, 82);
    assert.equal(
      await fs.readFile(path.join(f.root, "Objects.sc2uimcp.bak"), "utf8"),
      before,
    );
  } finally {
    await f.cleanup();
  }
});

test("unknown water coverage blocks exclusion; proven empty water supports height/texture filters without writes", async () => {
  const f = await fixture();
  try {
    const water = (await nativeSources("city")).get("t3Water")!;
    const entry = Buffer.from(water.subarray(32, 88)),
      header = Buffer.from(water.subarray(0, 32));
    header.writeUInt32LE(1, 8);
    [12, 12, 20, 20].forEach((v, i) => entry.writeFloatLE(v, 40 + i * 4));
    await fs.writeFile(
      path.join(f.root, "t3Water"),
      Buffer.concat([header, entry]),
    );
    const before = await fs.readFile(path.join(f.root, "Objects"));
    await assert.rejects(f.placement.scatterDoodads({ area,objects:[{ id:"AgriaTree" }],count:1 }),/TERRAIN_WATER_COVERAGE_UNAVAILABLE/);
    assert.equal((await f.terrain.surface()).waterCoverageKnown,false);
    await fs.writeFile(path.join(f.root,"t3Water"),(await nativeSources("nydus")).get("t3Water")!);
    const made = await f.placement.scatterDoodads({
      area,
      objects: [{ id: "AgriaTree" }],
      count: 60,
      seed: 1,
      minHeight: 7,
      maxHeight: 9,
      maxSlope: 0.1,
    });
    const surface = await f.terrain.surface();
    assert.equal(made.summary.rejected.water, 0);
    for (const op of made.plan.operations)
      if (op.op === "add")
        assert.equal(surface.sampleGround(op.object.position).water?.length, 0);
    await assert.rejects(
      f.placement.scatterDoodads({
        area,
        objects: [{ id: "AgriaTree" }],
        count: 1,
        minHeight: 40,
        maxAttempts: 40,
      }),
      /only 0\/1/,
    );
    await assert.rejects(
      f.placement.scatterDoodads({
        area,
        objects: [{ id: "AgriaTree" }],
        count: 1,
        textures: [{ id: "NotInPalette" }],
        maxAttempts: 40,
      }),
      /only 0\/1/,
    );
    await assert.rejects(
      f.placement.scatterDoodads({
        area,
        objects: [{ id: "MissingDoodad" }],
        count: 1,
      }),
    );
    assert.deepEqual(await fs.readFile(path.join(f.root, "Objects")), before);
  } finally {
    await f.cleanup();
  }
});

test("resnapping updates selected Z/native flag only, and pins terrain without rebinding a stale cached plan", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(
      path.join(f.root, "Objects"),
      '<PlacedObjects Version="27"><ObjectUnit Id="100" UnitType="Marine" Position="10,20,0" Unknown="keep"/><ObjectDoodad Id="101" Type="AgriaTree" Position="12,20,0" Rotation="1.5"><Flag Index="HeightAbsolute" Value="0"/><UnknownChild Value="keep"/></ObjectDoodad></PlacedObjects>',
    );
    const made = await f.placement.snapObjects({
      objectIds: [100, 101],
      heightOffset: 0.2,
    });
    assert.equal(
      (await f.placement.preview(made.plan.id)).validation.valid,
      true,
    );
    await f.placement.apply(made.plan.id, { dryRun: false, stage: false });
    const objects = (await f.placement.scan()).objects;
    assert.equal(objects[1].flags.HeightAbsolute, "1");
    assert.equal(objects[1].rotation, "1.5");
    assert.ok(objects[1].position!.startsWith("12,20,"));
    assert.ok(
      (await fs.readFile(path.join(f.root, "Objects"), "utf8")).includes(
        '<UnknownChild Value="keep"/>',
      ),
    );
    const original = await f.placement.addDoodad({
      id: "AgriaTree",
      position: { x: 16, y: 16, z: 0 },
      snapToTerrain: true,
    });
    const edit = await f.terrain.plan({
      operations: [
        {
          op: "height.raise",
          area: { type: "circle", center: { x: 16, y: 16 }, radius: 4 },
          amount: 0.5,
        },
      ],
    });
    await f.terrain.apply(edit.id, { dryRun: false, stage: false });
    const updated = await f.placement.addDoodad({
      id: "AgriaTree",
      position: { x: 16, y: 16, z: 0 },
      snapToTerrain: true,
    });
    assert.notEqual(updated.id, original.id);
    await assert.rejects(
      f.placement.preview(original.id),
      /STALE_PLACEMENT_PLAN/,
    );
    if (
      updated.operations[0].op === "add" &&
      original.operations[0].op === "add"
    )
      assert.ok(
        updated.operations[0].object.position.z >
          original.operations[0].object.position.z,
      );
  } finally {
    await f.cleanup();
  }
});

test("standalone ground placement refuses uncommitted terrain drafts and unknown water coverage", async () => {
  const f = await fixture();
  try {
    const edit = await f.terrain.plan({
      operations: [
        {
          op: "height.raise",
          area: { type: "rectangle", minX: 4, minY: 4, maxX: 28, maxY: 28 },
          amount: 0.5,
        },
      ],
    });
    const stage = await f.terrain.apply(edit.id, {
      dryRun: false,
      stage: true,
    });
    const made = await f.placement.scatterDoodads({
      area,
      objects: [{ id: "AgriaTree" }],
      count: 5,
    });
    assert.equal(
      (await f.placement.preview(made.plan.id)).validation.valid,
      false,
    );
    assert.equal(
      (await f.placement.apply(made.plan.id, { dryRun: false, stage: false }))
        .accepted,
      false,
    );
    await f.terrain.rollback(stage.transaction!.transactionId!, false);
    await fs.unlink(path.join(f.root, "t3Water"));
    await assert.rejects(
      f.placement.scatterDoodads({
        area,
        objects: [{ id: "AgriaTree" }],
        count: 1,
      }),
      /WATER_COVERAGE_UNAVAILABLE/,
    );
    assert.equal(
      (
        await f.placement.scatterDoodads({
          area,
          objects: [{ id: "AgriaTree" }],
          count: 1,
          avoidWater: false,
          seed: 8,
        })
      ).plan.operations.length,
      1,
    );
    await assert.rejects(
      f.placement.snapObjects({ objectIds: [999] }),
      /WATER_COVERAGE_UNAVAILABLE/,
    );
  } finally {
    await f.cleanup();
  }
});

test("GUI dispatch exposes Doodad tools and routes combined locations to the terrain preview/apply engine", async () => {
  const f = await fixture();
  try {
    const authoring = {
      browse: f.browse,
      placement: f.placement,
      terrain: f.terrain,
    };
    const scatter = await dispatchGuiApi(
      f.workspace,
      f.schema,
      {
        method: "POST",
        pathname: "/api/placement/scatterDoodads",
        body: { area, objects: [{ id: "AgriaTree" }], count: 5 },
      },
      authoring,
    );
    assert.equal(scatter.status, 200);
    assert.equal((scatter.body as any).preview.validation.valid, true);
    const location = await dispatchGuiApi(
      f.workspace,
      f.schema,
      {
        method: "POST",
        pathname: "/api/placement/location",
        body: {
          locationType: "forest",
          area,
          objectCount: 5,
          terrain: { style: "forest", materials: { base: "BelShirDirtLight" } },
        },
      },
      authoring,
    );
    assert.equal(location.status, 200, JSON.stringify(location.body));
    assert.equal((location.body as any).applyModule, "terrain");
    assert.ok((location.body as any).preview.imageBase64);
    const malformed = await dispatchGuiApi(
      f.workspace,
      f.schema,
      {
        method: "POST",
        pathname: "/api/placement/scatterDoodads",
        body: {
          area,
          objects: [{ id: "AgriaTree" }],
          count: 1,
          minHeight: 9,
          maxHeight: 7,
        },
      },
      authoring,
    );
    assert.equal(malformed.status, 400);
  } finally {
    await f.cleanup();
  }
});
