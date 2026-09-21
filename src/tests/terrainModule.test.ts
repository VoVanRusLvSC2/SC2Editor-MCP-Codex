import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { Workspace } from "../core/workspace.js";
import { bytesHash } from "../core/binaryTransactions.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { parseState } from "../modules/terrain/operations.js";
import { TextureMasks } from "../modules/terrain/document.js";
import { parseTerrainRecipe } from "../modules/terrain/xmlRecipe.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { PlacementWorkspace } from "../modules/placement/workspace.js";
import type { TerrainOperation } from "../modules/terrain/types.js";
const area = {
  type: "rectangle" as const,
  minX: 4,
  minY: 4,
  maxX: 28,
  maxY: 28,
};
async function fixture(id = "nydus") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-terrain-"));
  const dir = `src/tests/fixtures/terrain-native/${id}`;
  for (const name of await fs.readdir(dir))
    await fs.writeFile(
      path.join(root, name.slice(0, -3)),
      gunzipSync(await fs.readFile(path.join(dir, name))),
    );
  const workspace = new Workspace(root);
  return {
    root,
    workspace,
    terrain: new TerrainWorkspace(workspace),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

for (const [id, w, h] of [
  ["nydus", 33, 33],
  ["ant", 137, 137],
  ["city", 145, 217],
  ["warships", 257, 257],
] as const)
  test(`native ${id} terrain: dimensions, exact component SHA, sync layout and water`, async () => {
    const f = await fixture(id);
    try {
      const manifest = JSON.parse(
        await fs.readFile(
          "src/tests/fixtures/terrain-native/manifest.json",
          "utf8",
        ),
      ).find((m: any) => m.id === id);
      for (const entry of manifest.components)
        assert.equal(
          bytesHash(await fs.readFile(path.join(f.root, entry.name))),
          entry.sha256,
        );
      const inspected = await f.terrain.inspect();
      assert.ok(!("error" in inspected), JSON.stringify(inspected));
      assert.equal(inspected.nativeIntegrity?.valid, true, JSON.stringify(inspected.nativeIntegrity));
      assert.deepEqual(inspected.dimensions?.vertices, [w, h]);
      const state = await f.terrain.state();
      assert.equal(state.sync?.bytes.length, 64 + w * h * 4);
      for (let i = 0; i < w * h; i++)
        assert.equal(
          state.sync!.bytes.readInt16LE(64 + i * 4 + 2),
          state.heights.bytes.readUInt16LE(32 + i * 6 + 4),
        );
      if (id === "city") {
        assert.equal(inspected.ramps, 46);
        assert.equal(inspected.water?.count, 6);
        assert.deepEqual(inspected.water?.entries[0].rawFloats, [136, 72, 144, 152]);
        assert.equal(inspected.water?.entries[0].semantics, "flat-v110-rectangle-reference");
      } else assert.equal(inspected.water?.count, 0);
    } finally {
      await f.cleanup();
    }
  });

test("height batch preserves base/mask/native data, updates interleaved sync and stages all files together", async () => {
  const f = await fixture();
  try {
    const before = await fs.readFile(path.join(f.root, "t3HeightMap"));
    const syncBefore = await fs.readFile(path.join(f.root, "t3SyncHeightMap"));
    const sourceState = await f.terrain.state();
    const p = await f.terrain.plan({
      operations: [{ op: "height.raise", area, amount: 1, edgeBlend: 2 }],
    });
    assert.ok(p.changedVertices > 0);
    assert.equal(p.valid, true);
    await f.terrain.apply(p.id);
    assert.deepEqual(
      await fs.readFile(path.join(f.root, "t3HeightMap")),
      before,
    );
    const applied = await f.terrain.apply(p.id, { dryRun: false, stage: true });
    assert.ok(applied.transaction?.transactionId);
    assert.deepEqual(
      await fs.readFile(path.join(f.root, "t3HeightMap")),
      before,
    );
    const next = await f.terrain.state();
    const i = 16 * 33 + 16;
    assert.ok(
      Math.abs(next.heights.z(16, 16) - sourceState.heights.z(16, 16) - 1) <
        0.001,
    );
    assert.equal(
      next.sync!.bytes.readInt16LE(64 + i * 4) -
        syncBefore.readInt16LE(64 + i * 4),
      256,
    );
    for (let j = 0; j < 33 * 33; j++) {
      assert.equal(
        next.heights.bytes.readUInt16LE(32 + j * 6),
        before.readUInt16LE(32 + j * 6),
      );
      assert.equal(
        next.heights.bytes.readUInt16LE(32 + j * 6 + 4),
        before.readUInt16LE(32 + j * 6 + 4),
      );
      assert.equal(
        next.sync!.bytes.readInt16LE(64 + j * 4 + 2),
        syncBefore.readInt16LE(64 + j * 4 + 2),
      );
    }
    await assert.rejects(
      f.workspace.save("t3HeightMap"),
      /BINARY_TRANSACTION_STAGED/,
    );
    const save = await f.terrain.save(applied.transaction!.transactionId!, {
      dryRun: false,
    });
    assert.equal(save.saved, true);
    assert.deepEqual(
      await fs.readFile(path.join(f.root, "t3HeightMap.sc2uimcp.bak")),
      before,
    );
    assert.deepEqual(
      await fs.readFile(path.join(f.root, "t3SyncHeightMap.sc2uimcp.bak")),
      syncBefore,
    );
    assert.deepEqual(
      await fs.readFile(path.join(f.root, "t3HeightMap")),
      next.heights.bytes,
    );
    assert.equal(f.workspace.binary.hasDraft("t3HeightMap"), false);
  } finally {
    await f.cleanup();
  }
});

test("tiled mask addressing crosses 64-pixel boundaries without touching neighbouring nibbles", () => {
  const bytes = Buffer.alloc(64 + 128 * 64 * 4);
  bytes.write("MASK");
  bytes.writeUInt32LE(102, 4);
  bytes.writeUInt32LE(128, 12);
  bytes.writeUInt32LE(64, 16);
  const masks = new TextureMasks(bytes);
  masks.set(63, 0, 0, 7);
  masks.set(64, 0, 0, 11);
  masks.set(65, 0, 0, 3);
  assert.equal(bytes[64 + 31] & 15, 7);
  assert.equal(bytes[64 + 2048], 0xb3);
  assert.equal(masks.get(62, 0, 0), 0);
  assert.equal(masks.get(64, 0, 1), 0);
});

test("new palette assets resolve through browse; texture painting updates masks and sync names/indices", async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, "Base.SC2Data/GameData"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(f.root, "Base.SC2Data/GameData/TerrainTextureData.xml"),
      '<Catalog><CTerrainTexture id="ForestGrass"><Texture value="Assets\\Textures\\ForestGrass.dds"/></CTerrainTexture></Catalog>',
    );
    const browse = new BrowseWorkspace(
      f.workspace,
      new DataWorkspace(f.workspace),
    );
    const terrain = new TerrainWorkspace(f.workspace, browse);
    const p = await terrain.plan({
      operations: [
        {
          op: "palette.update",
          replacements: [{ slot: 1, texture: "ForestGrass" }],
        },
        { op: "texture.paint", area, texture: "ForestGrass", edgeBlend: 1 },
      ],
    });
    assert.ok(p.changedTexturePixels > 0);
    const state = await terrain.state("", p.id);
    assert.equal(state.syncTextures?.names[1], "ForestGrass");
    assert.equal(state.masks?.get(128, 128, 1), 15);
    assert.equal(state.masks?.get(128, 128, 0), 0);
    const index =
      state.syncTextures!.bytes.readUInt32LE(
        state.syncTextures!.dataOffset + (16 * 32 + 16) * 8,
      ) & 255;
    assert.equal(index, 1);
    await assert.rejects(
      terrain.plan({
        operations: [
          {
            op: "palette.update",
            replacements: [{ slot: 2, texture: "InventedMissingTexture" }],
          },
        ],
      }),
      /TEXTURE_DEPENDENCY_UNAVAILABLE/,
    );
  } finally {
    await f.cleanup();
  }
});

test("noise is deterministic; Gaussian smoothing reduces height variance and preserves outside region", async () => {
  const f = await fixture();
  try {
    const ops: TerrainOperation[] = [
      { op: "height.noise", area, amplitude: 0.3, wavelength: 1, seed: 42 },
    ];
    const p1 = await f.terrain.plan({ operations: ops });
    const p2 = await f.terrain.plan({ operations: ops });
    assert.equal(p1.id, p2.id);
    const smoothed = await f.terrain.plan({
      operations: [
        ...ops,
        {
          op: "height.smooth",
          area,
          radius: 3,
          iterations: 2,
          method: "gaussian",
        },
      ],
    });
    const a = await f.terrain.state("", p1.id),
      b = await f.terrain.state("", smoothed.id);
    const variance = (s: typeof a) => {
      const values = [];
      for (let y = 8; y < 24; y++)
        for (let x = 8; x < 24; x++) values.push(s.heights.z(x, y));
      const mean = values.reduce((x, y) => x + y) / values.length;
      return (
        values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
      );
    };
    assert.ok(variance(b) < variance(a) * 0.5);
    assert.equal(a.heights.z(0, 0), b.heights.z(0, 0));
    const image = await f.terrain.preview(smoothed.id);
    assert.equal(
      Buffer.from(image.imageBase64, "base64").subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
    );
  } finally {
    await f.cleanup();
  }
});

test("native ramps/cliffs/holes are preserved; unsupported structural editing fails before changes", async () => {
  const f = await fixture("city");
  try {
    const original = await f.terrain.state();
    const p = await f.terrain.plan({
      operations: [
        {
          op: "height.raise",
          area: { type: "rectangle", minX: 0, minY: 0, maxX: 144, maxY: 216 },
          amount: 0.1,
        },
      ],
    });
    const result = await f.terrain.state("", p.id);
    let protectedCount = 0,
      changed = 0;
    for (let y = 0; y < 217; y++)
      for (let x = 0; x < 145; x++) {
        if (original.heights.protected(x, y)) {
          protectedCount++;
          assert.equal(result.heights.z(x, y), original.heights.z(x, y));
        } else if (result.heights.z(x, y) !== original.heights.z(x, y))
          changed++;
      }
    assert.ok(protectedCount > 0);
    assert.ok(changed > 0);
    for (const name of [
      "t3Terrain.xml",
      "t3HardTile",
      "t3SyncCliffLevel",
      "t3CellFlags",
      "t3Water",
    ])
      assert.equal(p.files.find((f) => f.file === name)!.changedBytes, 0);
    await assert.rejects(
      f.terrain.plan({ operations: [{ op: "ramp.create", parameters: {} }] }),
      /NATIVE_TERRAIN_OPERATION_UNAVAILABLE/,
    );
  } finally {
    await f.cleanup();
  }
});

test("flat native water table supports grid rectangles and rejects unaligned edits", async () => {
  const f = await fixture("city");
  try {
    const source = await fs.readFile(path.join(f.root,"t3Water"));
    const state = await f.terrain.state();
    assert.equal(state.water?.coverageKnown,true);
    assert.equal(state.water?.at({x:140,y:100}).length,1);
    const caps = await f.terrain.capabilities(); assert.equal("waterEntries" in caps && caps.waterEntries,true);
    await assert.rejects(f.terrain.plan({operations:[{op:"water.update",index:0,area}]}),/8_CELL_GRID/);
    const plan = await f.terrain.plan({operations:[{op:"water.remove",index:0}]});
    assert.equal((await f.terrain.state("",plan.id)).water?.count,5);
    assert.deepEqual(await fs.readFile(path.join(f.root,"t3Water")),source);
  } finally { await f.cleanup(); }
});

test("stale plans and external edits after staging are rejected; discard leaves disk untouched", async () => {
  const f = await fixture();
  try {
    const p = await f.terrain.plan({
      operations: [{ op: "height.raise", area, amount: 0.5 }],
    });
    const staged = await f.terrain.apply(p.id, { dryRun: false });
    const disk = await fs.readFile(path.join(f.root, "t3HeightMap"));
    const changed = Buffer.from(disk);
    changed[34] ^= 1;
    await fs.writeFile(path.join(f.root, "t3HeightMap"), changed);
    await assert.rejects(
      f.terrain.save(staged.transaction!.transactionId!, { dryRun: false }),
      /STALE_BINARY_TRANSACTION/,
    );
    const rolled = await f.terrain.rollback(
      staged.transaction!.transactionId!,
      false,
    );
    assert.equal(rolled.discarded, true);
    assert.deepEqual(
      await fs.readFile(path.join(f.root, "t3HeightMap")),
      changed,
    );
    await assert.rejects(f.terrain.preview(p.id), /STALE_TERRAIN_PLAN/);
    const next = await f.terrain.plan({
      operations: [{ op: "height.raise", area, amount: 0.5 }],
    });
    assert.notEqual(next.id, p.id);
    await assert.rejects(
      f.terrain.plan({
        operations: [
          { op: "height.raise", area: { ...area, minX: -1 }, amount: 1 },
        ],
      }),
      /OUT_OF_BOUNDS/,
    );
    await assert.rejects(
      f.terrain.plan({
        operations: [{ op: "height.raise", area, amount: NaN }],
      }),
    );
  } finally {
    await f.cleanup();
  }
});

test("strict XML recipe compiles known operations and rejects unknown commands/attributes", () => {
  const recipe = parseTerrainRecipe(
    '<TerrainRecipe version="1" seed="42"><Area id="a" shape="rectangle" min="4 4" max="28 28"/><Raise area="a" amount="0.5"/><Smooth area="a" smoothRadius="2" preserveCliffs="true" preserveRamps="true"/></TerrainRecipe>',
  );
  assert.equal(recipe.operations.length, 2);
  assert.equal(recipe.operations[0].op, "height.raise");
  assert.throws(
    () =>
      parseTerrainRecipe(
        '<TerrainRecipe version="1"><Area id="a" shape="circle" center="8 8" radius="4"/><Unknown area="a"/></TerrainRecipe>',
      ),
    /UNKNOWN_TERRAIN_RECIPE_OPERATION/,
  );
  assert.throws(
    () =>
      parseTerrainRecipe(
        '<TerrainRecipe version="1"><Area id="a" shape="circle" center="8 8" radius="4"/><Raise area="a" amount="1" typo="ignored"/></TerrainRecipe>',
      ),
    /UNKNOWN_RECIPE_ATTRIBUTE/,
  );
});

test("placement location plans include terrain + Objects atomically and snap doodads to planned ground", async () => {
  const f = await fixture();
  try {
    await fs.cp("src/tests/fixtures/browse-placement-map", f.root, {
      recursive: true,
    });
    const browse = new BrowseWorkspace(
      f.workspace,
      new DataWorkspace(f.workspace),
    );
    const placement = new PlacementWorkspace(f.workspace, browse);
    const terrain = new TerrainWorkspace(f.workspace, browse, placement);
    placement.terrain = terrain;
    const existingIds = new Set(
      new PlacementDocument((await f.workspace.readRaw("Objects")).text)
        .list()
        .map((o) => o.id),
    );
    const p = await terrain.createLocation({
      locationType: "forest",
      area: { ...area, z: 0 },
      objectCount: 5,
      seed: 42,
      terrain: { style: "forest", materials: { base: "BelShirDirtLight" } },
    });
    assert.equal(p.objects, 5);
    const staged = await terrain.apply(p.plan.id, { dryRun: false });
    assert.ok(staged.transaction?.transactionId);
    const objects = new PlacementDocument(
      (await f.workspace.readRaw("Objects")).text,
    ).list();
    const additions = objects.filter((o) => !existingIds.has(o.id));
    assert.equal(additions.length, 5);
    for (const object of additions.slice(-5)) {
      const position = object.position!.split(",").map(Number);
      const sample = await terrain.sample([{ x: position[0], y: position[1] }]);
      assert.ok(Math.abs(position[2] - sample.samples[0].height) < 0.0001);
    }
    await assert.rejects(
      f.workspace.save("Objects"),
      /BINARY_TRANSACTION_STAGED/,
    );
    await terrain.save(staged.transaction!.transactionId!, { dryRun: false });
    assert.ok(
      (await fs.readFile(path.join(f.root, "Objects"), "utf8")).includes(
        'Type="AgriaTree"',
      ),
    );
  } finally {
    await f.cleanup();
  }
});
// Keep the parser import exercised independently of Workspace.
import { PlacementDocument } from "../modules/placement/document.js";
test("binary parsers reject truncated payloads and unknown versions", async () => {
  const f = await fixture();
  try {
    const state = await f.terrain.state();
    const broken = new Map(state.sources);
    broken.set("t3HeightMap", state.heights.bytes.subarray(0, 100));
    assert.throws(() => parseState(broken), /SIZE_MISMATCH/);
    const bytes = Buffer.from(state.heights.bytes);
    bytes.writeUInt32LE(999, 4);
    broken.set("t3HeightMap", bytes);
    assert.throws(() => parseState(broken), /UNSUPPORTED_HMAP_VERSION/);
  } finally {
    await f.cleanup();
  }
});

test("binary transaction compensates an interrupted multi-file commit even without backups", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-bytes-"));
  const workspace = new Workspace(root);
  const a = Buffer.from([255, 0, 128, 1]),
    b = Buffer.from([254, 0, 129, 2]);
  await fs.writeFile(path.join(root, "a"), a);
  await fs.writeFile(path.join(root, "b"), b);
  const rename = fs.rename;
  try {
    fs.rename = async (from, to) => {
      if (String(to) === path.join(root, "b"))
        throw new Error("Injected second rename failure");
      return rename(from, to);
    };
    await assert.rejects(
      workspace.binary.apply(
        ["a", "b"],
        () =>
          new Map([
            ["a", Buffer.from([1])],
            ["b", Buffer.from([2])],
          ]),
        { dryRun: false, stage: false, backup: false },
      ),
      /Injected second rename failure/,
    );
    assert.deepEqual(await fs.readFile(path.join(root, "a")), a);
    assert.deepEqual(await fs.readFile(path.join(root, "b")), b);
    assert.deepEqual((await fs.readdir(root)).sort(), ["a", "b"]);
  } finally {
    fs.rename = rename;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("committed binary rollback restores exact bytes and removes files created by the transaction", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-byte-undo-"));
  const workspace = new Workspace(root);
  const original = Buffer.from([255, 128, 0, 50]);
  try {
    await fs.writeFile(path.join(root, "original"), original);
    const applied = await workspace.binary.apply(
      ["original", "new"],
      () =>
        new Map([
          ["original", Buffer.from([7])],
          ["new", Buffer.from([9])],
        ]),
      { dryRun: false, stage: false },
    );
    assert.ok(applied.transactionId);
    await workspace.binary.rollback(applied.transactionId!, true);
    assert.deepEqual(
      await fs.readFile(path.join(root, "original")),
      Buffer.from([7]),
    );
    await workspace.binary.rollback(applied.transactionId!, false);
    assert.deepEqual(await fs.readFile(path.join(root, "original")), original);
    await assert.rejects(fs.stat(path.join(root, "new")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

import { TERRAIN_STYLES } from "../modules/terrain/recipes.js";
import type { TerrainStyle } from "../modules/terrain/types.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { dispatchGuiApi } from "../gui/api.js";
test("all advertised style recipes and geometric features produce reparsable plans", async () => {
  const f = await fixture();
  try {
    for (const style of Object.keys(TERRAIN_STYLES) as TerrainStyle[]) {
      const p = await f.terrain.generate({
        area,
        style,
        seed: 42,
        materials: { base: "BelShirDirtLight" },
      });
      assert.equal(p.valid, true, style);
      assert.equal((await f.terrain.validate(p.id)).valid, true, style);
    }
    for (const feature of [
      "road",
      "river",
      "lake",
      "mountain",
      "valley",
      "plateau",
      "crater",
      "coast",
      "transition",
    ]) {
      const p = await f.terrain.feature(feature, {
        center: { x: 16, y: 16 },
        radius: 6,
        texture: "BelShirDirtLight",
        height: feature === "mountain" ? 0.2 : undefined,
        depth: 0.2,
      });
      assert.equal(p.valid, true, feature);
    }
  } finally {
    await f.cleanup();
  }
});

test("whole-map donor stamps preserve native bundles and reject subsequent donor changes", async () => {
  const f = await fixture();
  try {
    const donor = path.join(f.root, "donor");
    await fs.mkdir(donor);
    for (const name of await fs.readdir(f.root))
      if (name !== "donor")
        await fs.copyFile(path.join(f.root, name), path.join(donor, name));
    const donorWorkspace = new TerrainWorkspace(new Workspace(donor));
    const edit = await donorWorkspace.plan({
      operations: [{ op: "height.raise", area, amount: 0.2 }],
    });
    await donorWorkspace.apply(edit.id, { dryRun: false, stage: false });
    const stamp = await f.terrain.plan({
      operations: [{ op: "stamp.apply", donorDirectory: "donor" }],
    });
    assert.ok(
      stamp.files.find((f) => f.file === "t3HeightMap")!.changedBytes > 0,
    );
    const native = await fs.readFile(path.join(donor, "t3HeightMap"));
    assert.equal(
      (await f.terrain.state("", stamp.id)).heights.bytes.equals(native),
      true,
    );
    native[34] ^= 1;
    await fs.writeFile(path.join(donor, "t3HeightMap"), native);
    await assert.rejects(f.terrain.preview(stamp.id), /STALE_TERRAIN_DONOR/);
  } finally {
    await f.cleanup();
  }
});

test("terrain GUI API defaults to dry-run and uses the same plan as its preview", async () => {
  const f = await fixture();
  try {
    const schema = await SchemaRegistry.loadBundled(),
      browse = new BrowseWorkspace(f.workspace, new DataWorkspace(f.workspace)),
      placement = new PlacementWorkspace(f.workspace, browse),
      authoring = { browse, placement, terrain: f.terrain };
    const planned = await dispatchGuiApi(
      f.workspace,
      schema,
      {
        method: "POST",
        pathname: "/api/terrain/plan",
        body: { operations: [{ op: "height.raise", area, amount: 0.2 }] },
      },
      authoring,
    );
    assert.equal(planned.status, 200);
    const id = (planned.body as { id: string }).id;
    const old = await fs.readFile(path.join(f.root, "t3HeightMap"));
    const applied = await dispatchGuiApi(
      f.workspace,
      schema,
      { method: "POST", pathname: "/api/terrain/apply", body: { planId: id } },
      authoring,
    );
    assert.equal(applied.status, 200);
    assert.equal((applied.body as any).transaction.dryRun, true);
    assert.deepEqual(await fs.readFile(path.join(f.root, "t3HeightMap")), old);
    const preview = await dispatchGuiApi(
      f.workspace,
      schema,
      {
        method: "GET",
        pathname: "/api/terrain/preview",
        query: new URLSearchParams({ planId: id }),
      },
      authoring,
    );
    assert.equal(preview.status, 200);
    assert.ok((preview.body as any).imageBase64);
    const bad = await dispatchGuiApi(
      f.workspace,
      schema,
      {
        method: "POST",
        pathname: "/api/terrain/plan",
        body: { operations: [{ op: "height.raise", area, amount: "bad" }] },
      },
      authoring,
    );
    assert.equal(bad.status, 400);
  } finally {
    await f.cleanup();
  }
});

test("standalone placement ground snapping records terrain hashes and rejects a changed surface", async () => {
  const f = await fixture();
  try {
    await fs.cp("src/tests/fixtures/browse-placement-map", f.root, {
      recursive: true,
    });
    const browse = new BrowseWorkspace(
        f.workspace,
        new DataWorkspace(f.workspace),
      ),
      placement = new PlacementWorkspace(f.workspace, browse);
    placement.terrain = new TerrainWorkspace(f.workspace, browse, placement);
    const p = await placement.addUnit({
      id: "Marine",
      position: { x: 16, y: 16, z: 0 },
      snapToTerrain: true,
    });
    assert.equal(p.operations[0].op, "add");
    if (p.operations[0].op === "add")
      assert.ok(p.operations[0].object.position.z > 7);
    const raw = await fs.readFile(path.join(f.root, "t3HeightMap"));
    raw[34] ^= 1;
    await fs.writeFile(path.join(f.root, "t3HeightMap"), raw);
    await assert.rejects(
      placement.preview(p.id),
      /STALE_PLACEMENT_PLAN: terrain/,
    );
  } finally {
    await f.cleanup();
  }
});

test("texture replacement transfers only the requested layer weight", () => {
  const bytes = Buffer.alloc(64 + 64 * 64 * 4);
  bytes.write("MASK");
  bytes.writeUInt32LE(102, 4);
  bytes.writeUInt32LE(64, 12);
  bytes.writeUInt32LE(64, 16);
  const masks = new TextureMasks(bytes);
  masks.set(0, 0, 0, 6);
  masks.set(0, 0, 1, 5);
  masks.set(0, 0, 2, 4);
  masks.replace(0, 0, 0, 3, 1);
  assert.deepEqual(masks.weights(0, 0), [0, 5, 4, 6, 0, 0, 0, 0]);
});
