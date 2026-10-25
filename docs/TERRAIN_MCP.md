# Terrain MCP

Rendering metadata such as sampled `protected` or `nativeMeshHole` is not a
building-placement verdict. A measured high plateau point with those flags was
accepted by the native SupplyDepot predicate. Use an explicit native placement
check at the actual intended footprint; do not infer a blocked site from the
label of a rendering flag or a model's bounds.

`placement.createLocation` can combine an irregular polygon, existing terrain
generation, authored roads and decoration in one terrain/Objects/ComponentList
transaction. Its `terrain.routes` entries accept points, width, optional texture,
and explicit `flatten`/height. Flattening defaults off. Painted/flattened strokes
must fit entirely inside the location, including round caps; cross-zone roads use
a separate `terrain.feature`/road plan. Protected areas remain in force.
Decoration pivots are excluded from reserved route corridors before placement.
This pivot check is not model-bound or engine-footprint clearance; use measured
groups and navigation/native review for those requirements. The existing basic
generation recipe still rewrites terrain inside its area; named incremental
ownership is provided by `terrain.compose` for object groups. The named intent
form of `terrain.landscape.plan` adds incremental height/texture/object ownership
and explicit overlay dependencies; see [incremental locations](LANDSCAPE_OWNERSHIP.md).

Terrain is part of the existing server and GUI. It edits supported **unpacked native component bundles**, not MPQ archives, and requires existing terrain. It does not construct a new map bundle from scratch. `SC2_UI_ROOT` identifies the unpacked map/mod root; `directory` selects terrain beneath that root.

For the new scoped `terrain.surface.*` inspection tools, see the [complete module guide](TERRAIN.md).

## Commands

| Command | Result |
| --- | --- |
| `terrain.inspect`, `terrain.capabilities` | Component hashes, formats, physical bounds, supported writers and explicit limitations |
| `terrain.load.inspect`, `terrain.load.repair` | Native allocation/Q12 checks and a restricted legacy level-one load repair plan; surface/gameplay payloads preserved |
| `terrain.sample`, `terrain.analyze` | Heights, slopes, mask and texture diagnostics; optional planned result |
| `terrain.palette.get`, `terrain.assets` | Actual palette/block sets and Browse catalog searches |
| `terrain.styles.list` | Ten deterministic recipe presets |
| `terrain.plan` | Isolated plan from 1–100 validated operations |
| `terrain.paint`, `terrain.blend` | Real texture brush plans; blend defaults to strength 0.5 |
| `terrain.cliff.repair`, `terrain.ramp.repair` | Bounded supported cliff normalization or diagnosed legacy direction repair; guarded plan, no automatic save |
| `terrain.hide`, `terrain.show`, `terrain.visibility.inspect` | LFCT v102 ground-hidden cell/area plans and bounded samples |
| `terrain.generate` | Area-based relief and painting recipe with seed/materials |
| `terrain.road`, `terrain.river`, `terrain.lake` | Corridor flattening/channel carving/lake basin; optional flat v110 water rectangles on the 8-cell grid |
| `terrain.mountain`, `terrain.valley`, `terrain.plateau`, `terrain.crater`, `terrain.coast`, `terrain.transition` | Geometric height/texture brush recipes |
| `terrain.recipe.plan` | Compile XML into a plan in one call |
| `terrain.recipe.parse` | XML DSL → request for `terrain.plan`; never writes |
| `terrain.preview` | Plan diff and diagnostic PNG: height, texture, water or cliff mask |
| `terrain.validate` | Supported-format reparse and source checks; Editor/runtime explicitly not run |
| `terrain.apply`, `terrain.save`, `terrain.rollback` | Dry-run, grouped staging, commit and in-session byte restoration |

Exact input definitions: [generated schemas](../generated/terrain-tools.json).

`terrain.save` accepts exactly one staged `transactionId` or applied `planId`.
An unchanged applied plan verifies its source bytes again and reports `unchanged`
without creating or committing another group. Compact Terrain commands use this
plan identity for both apply and save, including repeat/no-change operations.

## Operation batch

Supported operations: `surface.hide/show` (cell/area, native LFCT v102 hidden bit 0x04); `height.raise/lower/set/flatten/noise/slope/smooth`; `texture.paint/blend/replace/smooth/paint_rules`; `palette.update`; standalone `stamp.apply`. `water.create/update/remove` support only flat v110 grid rectangles; `water.material` edits CWater settings and links its catalog via Includes/Components in the same byte group. Complex body sections stay read-only. Areas support rectangle, circle, polygon and corridor; texture.blend defaults to strength 0.5; brushes allow strength, edgeBlend and protectedAreas. `maxSlope` is a sampled geometric constraint, not a pathing proof.

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

Optional `baseHeight` sets the flatten target in world units before relief;
omission keeps the current-median default. It supports irregular areas with
ordinary edge blending and protected masks, and is also available inside an
owned location's `config.terrain`. `heightMode:"preserve"` rejects this option.
Existing native height-range checks still apply; a smooth rise is separate from
discrete cliff levels, ramps, navigation and building footprints.

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

Native cliff/ramp edits support the explicit v115 identity profile: rectangular
two-cell cliff strokes and measured cardinal width-four ramps. Nonflat cliff
junctions require adjacent levels 1..3. Their CLIF sync words now use the full
coarse corner shape, matching 396 original native reference cells across 12
orientations. The two diagonal saddle orientations also use measured all-high
CLIF closure, low HMAP centers and high SMAP centers, with neutral scalar
reference signatures for both level1-to2 and level2-to3 joins. Native SMAP edge
smoothing has additional observed variants; this representation does not promise
byte identity to every native edge sample. Multi-level and void joins still fail
instead of writing guessed sync data. Supported strokes normalize fine HMAP edge/center levels using
one observed native 3x3 pattern per orientation and update SMAP. Coarse corners,
authored base heights and upper mask bits are preserved; measured ramp vertices
are protected, including a brush halo sharing their boundary. This is not an
arbitrary-topology repair or engine navigation/collision rebuild. Complex water
bodies/waves and unsupported binary profiles remain explicit limits. Map supplies
a verified-content archive backend through [Map](MAP_MCP.md).

`terrain.cliff.repair` plans a bounded normalization of already registered f=1
cliff cells. It fixes fine-vertex pits/spikes and CLIF/SMAP/LFCT sync using the
supported corner profile, without repainting coarse corners or base heights.
Unregistered freeform terrain is left alone; ramp contact and unmeasured cell or
junction profiles reject before any commit. It is not a general hole filler.

`terrain.ramp.place` plans a joined donor ramp in one shared transaction. Its
`prepare_closed` default measures whole-level high landing cells from the donor,
prepares them through the existing native cliff writer, then transfers ramp
support through original ModKit. The donor bounds must enclose the landing with
a low-level boundary. The target needs clear flat ground at the donor's lower
level (including `levelOffset`) and a two-cell margin. `adjoining=verify` checks
matching existing flat high and low landings before transferring support.

Native donor SMAP can contain edge smoothing even on flat HMAP vertices. The
qualified boundary band (within two cells of registered geometry) permits a
half-world-unit residual; flat interiors retain the strict quantized-height
check. Support vertices preserve the exact donor SMAP sample plus the requested
level translation. This is a restricted donor profile, not arbitrary SMAP repair.

Both modes reject incompatible HMAP/SMAP/CLIF landing channels, sculpted donor
landings, hidden ground, holes in flat landings and object centers in the guarded
envelope. Default preparation also rejects existing target topology and manual
height/mask changes in that envelope. Fresh unregistered maps may receive the
existing foundation's HMAP lane re-encoding; outside the envelope world heights
stay within one quantization unit and SMAP, CLIF and flags stay unchanged.
Registered maps preserve outside HMAP samples exactly. Native object footprints,
water interaction, navigation and rendering still require their separate checks.

The plan returns `planId`, changed `files` and measured adjoining/stroke details.
Use `terrain.modkit.apply` followed by `modkit.save` on a returned file; all changed
components save together with source/donor/Objects stale guards. The compact
command follows the same plan/stage/save lifecycle:

```text
terrain ramp.place donorDirectory=Donor rampIndex=2 bounds=96,14,128,42 offset=-80,0 cliffSetIndex=1
```

The lower-level `ramp.template` operation in `terrain.modkit.plan` transfers only
ramp support; it does not prepare or verify adjoining landings. Its
v115 identity profile accepts SMAP100 and the native SMAP102 header while keeping
unknown versions explicit. LFCT's geometric cutout bit travels with the original
ModKit cell mapping, including qualified widening; it is independent of an f=2
ramp registration. Smooth HMAP cliff offsets and SMAP samples use that same
mapping rather than reconstructing heights from rounded quarter-level metadata.
HMAP retains the qualified target base and requantizes the donor offset only as
required by the target descriptor. Other target LFCT bits remain intact. The dimension guard
reads LFCT dimensions at offsets24/28 and MASK dimensions at12/16; reserved words
are preserved. These adapter checks are separate from native rendering.

Template translations `offsetX`/`offsetY` use even native-cell units.
`levelOffset` uses ModKit quarter-level units: a value of4 raises one complete
native cliff level (two world units for the qualified profile). Do not multiply
the existing SMAP delta by another factor of4. `extraHalfWidth` uses even lateral
strips and remains limited to qualified native diagonal profiles. These lattice
constraints reject in the MCP schema before loading a donor.

Native cliff/ramp generation also synchronizes SMAP's low-byte level label with
HMAP while retaining independent SMAP upper bits. This label remains low at a
measured saddle even when its SMAP height uses the high-side correction. Native
geometry ownership covers the updated label vertices, including coarse corners
of repaired cells. Landscape recipe revision4 invalidates owned older plans so
they rebuild through the same guarded transaction; manual edits still conflict.
Review the plan and persist through the ordinary `terrain.apply`/save transaction.
The compact equivalent is `terrain cliff.repair rect=14,20,16,22` in
`modkit.author`. Cliff-paint synchronization halos also retain authored base
heights outside the stroke.

Ramp direction is the native enum (south=0, north=1, west=2, east=3), not an
eight-heading compass angle. Diagonal native records use values4..7, not8.
The pinned ModKit runtime's writer guards are corrected during installation;
see its `nativeRampPatch` receipt. This source-enum correction is separate from
qualified MCP geometry profiles and native traversal acceptance.
The previous rotated generator could produce open
side caps even when ground movement worked. `terrain.ramp.repair` repairs that
specific legacy profile by changing only its `dir` attribute, after matching all
measured frames and terrain channels. Hand-edited or unknown profiles reject.
Use the same guarded plan/apply flow, or `terrain ramp.repair index=0` in the
compact authoring interface. This does not rebuild navigation caches.

Mixed height/native-geometry plans flush ordinary SMAP height deltas before each
native operation and start a fresh height baseline afterward. Native ramp donor
residuals must not receive the cliff displacement twice. `changedVertices` counts
actual final world-height changes, including native-only plans. The
[operation-order checkpoint](verification/terrain-operation-order-2026-10-22.json)
compares combined and sequential MCP edits and includes exact-archive ground
traversal and reviewed native views; it does not certify arbitrary topology.

Native geometry keeps additional cliff-cell and cliff/ramp-list attributes.
Unknown nested rows, embedded text or comments inside those regenerated lists
reject before staging instead of being silently discarded. This preservation
contract does not establish the engine semantics of unknown attributes.

### Geometry selection and refusal boundaries

Choose the supported authoring operation before changing a junction. The format
guards below describe implementation boundaries; native appearance, movement and
point predicates still require their own exact-map evidence.

| Operation/profile | Supported authoring scope | Refusal or preservation boundary |
| --- | --- | --- |
| Native cliff strokes | Qualified v115 identity transform, two-cell grid, adjacent levels1..3, measured corner/saddle normalization | Multi-level/void or unmeasured junctions reject. Coarse outline, base heights and independent mask bits are retained. |
| Cardinal ramp creation | Measured width-four frames, native directions0..3, coherent adjacent one-level landings | Missing boundary, uneven side rails, unmeasured widths/frames and protected ramp intersections reject. |
| Registered cliff repair | Existing registered f=1 cells using the measured fine-height/sync profile | Unregistered freeform depressions remain unchanged. Ramp contact rejects; this operation cannot infer that an intentional hole should be filled. |
| Legacy ramp repair | Exact measured legacy frame/channel signature with the diagnosed direction mismatch | Edited or unknown channels reject; the accepted change is the direction attribute, not a guessed new mesh. |
| Joined donor placement | Qualified measured donor support, enclosed low boundary, coherent flat landing channels, even translation/widening lattice and a two-cell margin | Hidden/holed/sculpted donor landings, manual target height/sync changes, existing topology or guarded object centers reject before commit. Verification mode requires already matching landings. |
| Terrain transactions | Complete related components with source/donor/Objects fingerprints | Unknown regenerated row contents and stale dependencies reject before replacement. Refusals preserve the original inputs. |

The refusal tests explicitly check byte preservation for manual target channels,
donor companions and unknown XML. See
[native geometry regressions](../src/tests/terrainNativeGeometry.test.ts) and
[joined transaction regressions](../src/tests/terrainRampJoined.test.ts).
A passing refusal test establishes that particular guard, not a newly observed
native rendering result. Keep test version/source identities when reusing it.

Visual bounds, point passability/connectivity, sampled single-unit movement,
concurrent formations and exact building placement are different measurements.
Neither a successful Save As nor one reached endpoint certifies every unit
footprint, water interaction, existing opaque cache or navigation rebuild.

Four user-supplied native maps provide compressed component fixtures with SHA-256 manifests. `npm test` exercises parsing, preservation, sync edits, stale plans, grouped save/rollback, styles/features, placement and GUI API/stdio integration. `npm run terrain:schemas` rebuilds schemas; `npm run terrain:demo` generates a diagnostic PNG and stage/save/restore report on a disposable fixture copy. That historical demo does not produce a playable SC2Map. The EXE evidence contains strings/addresses, not recovered serialization or a decompilation claim. Native acceptance is scoped to the exact recorded fixtures, not inferred from those static reports.

Validation summary: [test report](../generated/terrain-test-report.json), [portable HTTP smoke](../generated/terrain-portable-smoke.json). Browser visual inspection and Windows launcher execution were not run here. Format references: [sc2-file-format-docs](https://github.com/sc2-arcade-watcher/sc2-file-format-docs), based on reverse engineering; corpus mismatches are resolved conservatively (SMAP is interleaved in all supplied maps).

Terrain also supports [terrain-aware Doodad scatter and existing-object snapping](TERRAIN_DOODADS.md), bounded traversal and compact plan responses. Current validation: [Doodad report](../generated/terrain-doodads-test-report.json). Prior reports are historical evidence.

Water commands: `terrain.water.inspect` and `terrain.water.plan`. See [water guide and XML example](TERRAIN_WATER.md). The current Terrain tool schemas, including `terrain.surface.*`, are generated by `npm run terrain:schemas`. See the [complete module guide](TERRAIN.md).
