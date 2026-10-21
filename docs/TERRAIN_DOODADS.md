# Terrain and Doodads - alpha.9

Processing of existing terrain bundles and mass placement plans has been accelerated; server architecture preserved. Added two sets and one abbreviated XML workflow.

## Decorations on the surface

`placement.scatterDoodads` creates a **plan, doesn't write files. Selects dependency-ready Doodads through Browse, sets the weighted mix of types, seed, scale/rotation range, and calculates Z from one terrain snapshot. By default, eliminates water, holes, protected native boundaries/ramps, and proximity to existing Unit/Doodad centers.

```json
{
  "area": { "type": "rectangle", "minX": 4, "minY": 4, "maxX": 28, "maxY": 28 },
  "objects": [{ "id": "AgriaTree", "weight": 3 }, { "id": "CharDuneRock", "weight": 1 }],
  "count": 60, "seed": 42,
  "minimumDistance": 1.5, "maxSlope": 0.4,
  "avoidExisting": true, "avoidWater": true,
  "scaleRange": { "min": 0.85, "max": 1.15 }
}
```

The example requires the appropriate directories available: IDs are taken from fixture, they are not guaranteed to be available on any map. First use Browse and terrain.inspect. If the ID is not available, the request is rejected.

Additional fields:

| Field. | Meaning. |
| --- | --- |
| `terrainDirectory` | Catalog of terrain inside the current workspace |
| `minHeight`, `maxHeight` | Permissible sampled surface height |
| `minSlope`, `maxSlope` | Permissible slope; maximum by default 0.5 |
| `textures:[{id,minWeight}]` | Any given texture must have a local nibble weight ≥ minWeight (1-15) |
| `heightOffset` | Displacement Z relative to the surface |
| `avoidProtected` | Exclusion of holes/native boundaries/conservative field ramps; holes are always forbidden |
| `avoidExisting` | Consider previous Unit/Doodad centers at minimumDistance |
| `exclusionZones` | Circle/rectangle exclusion zone |
| `rotationRange` | Min/max native numerical rotation; standard range 0.2π |
| `maxAttempts` | Candidates' budget is a maximum of 1,250,000; usually count x 250 |

Each object selection contains exactly one id/key/query, optional weight. Count is limited to 5000, types - 32. Weight determines the probability of selection, not an exact quota. Seed reproduces points and parameters. If the budget does not allow you to place the entire count, the request ends with an error without a partial plan/record. Summary counts only candidates who have passed spatial/exclusion checks and tested on Terrain.

If the water is not decoded or the component is missing, the standard avoidWater rejects the request. It can be explicitly turned off by consciously accepting an unknown water coating. Texture filter requires available masks. Slope and water borders - diagnostics; model footprints, navigation and game collisions are not confirmed.

The MCP result contains the first 10 operations, totalOperations, and truncated. The full plan is stored in the server and applied by ID. Preview shows the first 50 operations and limited text diff; truncating the response does not change the saved plan.

`placement.preview` with plan.id → `placement.apply` with planId. Default apply - dry-run. To directly record the entire Objects/ComponentList transaction:

```json
{ "planId": "<returned plan.id>", "dryRun": false, "stage": false, "backup": true }
```

This is a placement plan: apply it through placement.apply. Standalone ground-based plans are rejected if based on an unwritten Terrain draft. First save/discard Terrain and create a new placement plan; for general commit use `placement.createLocation` with terrain.

## Linking existing facilities

`placement.snapToTerrain` prepares changes to the selected Unit/Doodad by native ID:

```json
{ "objectIds": [100, 101], "terrainDirectory": "", "maxSlope": 0.5, "avoidWater": true, "heightOffset": 0 }
```

Stores IDs, XY, Rotation, Scale, and unknown XML regions. For Doodads, includes the observed native HeightAbsolute=1 flag so that Z is set as absolute height. Unable/Unplaceable IDs, holes, excessive slope, and forbidden water reject the entire request. Application - through placement.apply, with the old dry-run/backup/stage rules. New ground-snapped Doodads and combined also get HeightAbute=1. Its round-runitor/ssolution location requires non-proven location.

## GUI and XML

The Terrain tab contains the section Doodads on selected area: real IDs by comma, Count, Minimum distance, Maximum slope.It uses the selected area and seed, plans scenery, shows review and allows Apply Doodads + backup. Terrain stage to be saved or canceled first.

`terrain.recipe.plan` accepts `{xml:"<TerrainRecipe ...>...</TerrainRecipe>"}` and compiles XML to a Terrain plan in one call. Preview/apply remain separate. `terrain.recipe.parse` is saved for individual XML diagnostics.

## Measurements and verifications

| Local operation. | Alpha.8 | Alpha.9 |
| --- | ---: | ---: |
| Constructing XML 1000 consecutive objects | 943 ms. | 7.5 ms |
| Scatter 5000 centers, distance=1, area 200×200 | 367 ms | 17.7 ms |
| Local noise+paint, radius=6, native 137×137 vertices | 161 ms | 41.2 ms |

One measurement of each scenario in the current environment, without imports/read fixture. This is not the time of a full MCP request or write to disk. The relationship depends on the task, JIT, load and machine. All three outputs of SHA-256 coincided with alpha.8. [Full report](../generated/terrain-doodads-performance.json); repeat: `npm run benchmark:terrain -- generated/terrain-doodads-performance-baseline.json`.

Optimization uses one XML append/reparse on a sequential add-run, spatial buckets with precise distance verification, limited brush/sync traversal area, lookup maps palettes and native protection cache as part of an operation.

186 PASS tests: legacy modules, byte-exact results, allocation/mixed ordering, filters/water, existing-object preservation, stale terrain and dry-run, API/real stdio MCP. [Current report](../generated/terrain-doodads-test-report.json). Visual GUI, Windows launcher, SC2Editor open/save and gametime not executed. Native structural cliffs/ramps/pathing, arbitrary water levels and MPQ write-back remain blocked.


## Confirmation on the card with the player and computer (11.10.2026)

When opening `AgriaHumanVsBot_v3.SC2Map`, the user confirmed the display of the hosted objects after fixing `Objects.version`: the native FourCC is `plob`, as well as registration in ComponentList. The erroneous `objs` is now rejected by the version file generator. The format is described in [Version file](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/version-file.md#type-tags); `plob` is independently read from two existing maps.

The user also showed the difference between the editor and the game: `ObjectUnit/Position` with a Z equal to the ground height, added this height a second time in the editor. Therefore, `placement.addUnit` with `snapToTerrain:true` writes Z = 0, and `placement.snapToTerrain` for units records only `heightOffset`. For Doodads, the absolute ground height plus displacement is retained and `HeightAbsolute=1`. Explicit placement does not store the transmitted Z. On `AgriaHumanVsBot_v4.SC2Map`, only 47 objects are changed; the decor coordinates are saved.

## Measured visual workflow

Use `terrain.measure` for model/actor/placement dimensions, `terrain.palette_preview`
for the existing catalogue with images at a shared scale, and `terrain.prefab` /
`terrain.assemble` for measured ready groups. See
[Measured decor and visual palettes](DECOR_VISUAL_WORKFLOW.md) for evidence,
short commands, reserved routes and geometry-versus-pathing limits.
