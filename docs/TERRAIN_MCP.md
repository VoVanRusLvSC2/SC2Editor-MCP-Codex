# Terrain MCP — alpha.9

Terrain is part of the existing server and GUI. It edits supported **unpacked native component bundles**, not MPQ archives, and requires existing terrain. It does not construct a new map bundle from scratch. `SC2_UI_ROOT` identifies the unpacked map/mod root; `directory` selects terrain beneath that root.

## Commands

| Command | Result |
| --- | --- |
| `terrain.inspect`, `terrain.capabilities` | Component hashes, formats, physical bounds, supported writers and explicit limitations |
| `terrain.sample`, `terrain.analyze` | Heights, slopes, mask and texture diagnostics; optional planned result |
| `terrain.palette.get`, `terrain.assets` | Actual palette/block sets and Browse catalog searches |
| `terrain.styles.list` | Ten deterministic recipe presets |
| `terrain.plan` | Isolated plan from 1–100 validated operations |
| `terrain.generate` | Area-based relief and painting recipe with seed/materials |
| `terrain.road`, `terrain.river`, `terrain.lake` | Corridor flattening/channel carving/lake basin; optional flat v110 water rectangles on the 8-cell grid |
| `terrain.mountain`, `terrain.valley`, `terrain.plateau`, `terrain.crater`, `terrain.coast`, `terrain.transition` | Geometric height/texture brush recipes |
| `terrain.recipe.plan` | Compile XML into a plan in one call |
| `terrain.recipe.parse` | XML DSL → request for `terrain.plan`; never writes |
| `terrain.preview` | Plan diff and diagnostic PNG: height, texture, water or cliff mask |
| `terrain.validate` | Supported-format reparse and source checks; Editor/runtime explicitly not run |
| `terrain.apply`, `terrain.save`, `terrain.rollback` | Dry-run, grouped staging, commit and in-session byte restoration |

Exact input definitions: [generated schemas](../generated/terrain-tools.json).

## Operation batch

Supported operations: `height.raise/lower/set/flatten/noise/slope/smooth`; `texture.paint/blend/replace/smooth/paint_rules`; `palette.update`; standalone `stamp.apply`. `water.create/update/remove` support only flat v110 grid rectangles; `water.material` edits CWater settings and links its catalog via Includes/Components in the same byte group. Complex body sections stay read-only. Areas support rectangle, circle, polygon and corridor; brushes allow strength, edgeBlend and protectedAreas. `maxSlope` is a sampled geometric constraint, not a pathing proof.

```json
{
  "operations": [
    { "op": "height.raise", "area": { "type": "circle", "center": { "x": 16, "y": 16 }, "radius": 8 }, "amount": 1.5, "edgeBlend": 3 },
    { "op": "height.smooth", "area": { "type": "circle", "center": { "x": 16, "y": 16 }, "radius": 10 }, "method": "edge_preserving", "radius": 2, "strength": 0.4, "edgeBlend": 3 }
  ]
}
```

Call `terrain.plan` with that request, review `terrain.preview` and `terrain.validate`, then:

```json
{ "planId": "<returned plan id>", "dryRun": false, "stage": true }
```

Pass this to `terrain.apply`. Use the returned `transaction.transactionId` with `terrain.save`:

```json
{ "transactionId": "<returned transaction id>", "dryRun": false, "backup": true }
```

Direct disk commit uses `terrain.apply` with `dryRun:false, stage:false`. `terrain.rollback` uses the transaction ID and `dryRun:false`; it discards a staged group or restores committed bytes. Plans and the last eight commit journals live in the current process. File backups survive restart; the journal does not. Undo refuses subsequent external edits. Group commits use temporary writes and compensating rollback on handled failures; crash-wide multi-file atomicity is not guaranteed.

## Styles and materials

`forest`, `desert`, `city`, `snow`, `jungle`, `swamp`, `volcanic`, `badlands`, `coastal`, `space_platform` generate flatten/noise/smoothing/painting recipes with different relief defaults. They are base variants, not complete biome simulations. They do not automatically create trees, buildings, cliffs or liquid.

```json
{
  "style": "forest", "seed": 42,
  "area": { "type": "rectangle", "minX": 4, "minY": 4, "maxX": 28, "maxY": 28 },
  "materials": { "base": "BelShirDirtLight" },
  "relief": 0.7, "edgeBlend": 3
}
```

Texture IDs must exist in the active palette for affected blocks. Without an explicit base, generation searches actual palette IDs using style terms and rejects an unresolved material. A palette replacement preserves slot positions; newly referenced IDs must resolve as dependency-ready `TerrainTex` through Browse. It does not add texture sets or change tileset/cliff dependencies.

## XML recipes

This is a project DSL, **not native StarCraft II terrain XML**. Unknown nodes/attributes, DTDs, nested operation nodes and invalid values fail. Areas have IDs. Generate requires an explicit baseTexture. `smoothRadius` controls the smoothing kernel; a circle's `radius` controls its area.

```xml
<TerrainRecipe version="1" seed="42">
  <Area id="forest" shape="rectangle" min="4 4" max="28 28"/>
  <Generate area="forest" style="forest" baseTexture="BelShirDirtLight" relief="0.7"/>
  <Road points="6 16;16 16;26 20" width="4" texture="BelShirDirtLight"/>
  <Smooth area="forest" method="edge_preserving" smoothRadius="2" strength="0.25"/>
</TerrainRecipe>
```

Use `terrain.recipe.plan` directly, or parse with `terrain.recipe.parse` and pass its returned request to `terrain.plan`, then review/apply as above. XML supports Area, Generate, Raise, Lower, Flatten, SetHeight, Noise, Smooth, Paint, Blend and Road. JSON exposes the wider operation set.

## Placement integration

`placement.addUnit/addDoodad` accepts `snapToTerrain:true`, optional terrainDirectory and maxSlope. The plan pins sampled terrain hashes and rejects holes/excessive slopes. Existing object move and mixed addBatch do not expose ground snapping.

`placement.createLocation` accepts the existing location request plus `terrain:{style, seed, materials, relief, ...}`. The placement area supplies the terrain area; the outer seed takes precedence. It returns a combined plan in `plan`, which must be committed through `terrain.apply/save/rollback`. New object Z values sample planned ground. Model footprints, collisions and native pathing are unverified; callers should provide exclusion areas and sensible budgets.

## Native format and validation limits

| Component | Supported shape |
| --- | --- |
| t3Terrain.xml | Writer versions 114/115; lossless palette source-span edits |
| t3HeightMap | HMAP 101, 32-byte header, 6-byte base/fine/mask vertices |
| t3SyncHeightMap | SMAP 102, 64-byte header, interleaved int16 height + int16 secondary records |
| t3TextureMasks | MASK 102, eight tiled 64×64 four-bit layers |
| t3SyncTextureInfo | RTXT 101, preserved opaque secondary fields |
| t3Water | WATR 104–110 preserved; flat v110 8-cell rectangles reference-supported; body/wave sections opaque |

Height writes require supported sync data and unit scale. Existing base/mask fields remain intact. Holes, neighboring mask-level boundaries and conservative native ramp regions are protected. Sync height preserves the native residual and adds the quantized height delta; sync texture selects the dominant layer over affected cell pixels. These strategies have reference/corpus evidence, **not proven SC2Editor equivalence**. Bilinear sampling is a diagnostic approximation near native geometry.

Flat-table rectangle authoring is bounded to the observed 8-cell grid and rejects overlap. Catalog height/color/UV/lava settings support isolated parent-based materials. Extents conservatively exclude placement; actual wet ground, clipping and rendering remain unverified. Whole-map stamps require matching dimensions/transform/tileset/cliff sets, available textures, matching water table names and stale-donor checks. Existing Objects/triggers are retained and may require repositioning.

Native cliff/ramp creation/removal, pathing painting, complex water bodies/waves and vertex color painting are unsupported and fail explicitly. Other binary components remain opaque. Alpha.12 supplies a verified-content archive backend through [Map](MAP_MCP.md).

Four user-supplied native maps provide compressed component fixtures with SHA-256 manifests. `npm test` exercises parsing, preservation, sync edits, stale plans, grouped save/rollback, styles/features, placement and GUI API/stdio integration. `npm run terrain:schemas` rebuilds schemas; `npm run terrain:demo` generates a diagnostic PNG and stage/save/restore report on a disposable fixture copy. It does not produce a playable SC2Map. The EXE evidence contains strings/addresses, not recovered serialization or a decompilation claim. SC2Editor open/save, visual acceptance and in-game runtime remain NOT_EXECUTED.

Validation summary: [test report](../generated/terrain-test-report.json), [full regression log](../generated/terrain-regression-tests.log), [portable HTTP smoke](../generated/terrain-portable-smoke.json). Browser visual inspection and Windows launcher execution were not run here. Format references: [sc2-file-format-docs](https://github.com/sc2-arcade-watcher/sc2-file-format-docs), based on reverse engineering; corpus mismatches are resolved conservatively (SMAP is interleaved in all supplied maps).

Alpha.9 adds [terrain-aware Doodad scatter and existing-object snapping](TERRAIN_DOODADS.md), bounded traversal and compact plan responses. Current validation: [alpha.9 report](../generated/terrain-doodads-test-report.json). Earlier alpha.8 reports above are retained as historical evidence.

Water commands: `terrain.water.inspect` and `terrain.water.plan`. See [Russian guide and XML example](TERRAIN_WATER_RU.md). Terrain now registers 27 tools.
