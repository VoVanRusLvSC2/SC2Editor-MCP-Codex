# Incremental location plans

`terrain.landscape.plan` retains its existing landscape recipe and optional
lighting request. The additional `intent` form coordinates named locations
through the existing terrain generator, route reservations and placement planner.
It plans one atomic Terrain + Objects + ComponentList + ownership transaction.
It does not introduce another terrain codec or a renderer.

Before raising terrain, inspect `terrain.analyze.heightEditing.commonRange`.
It intersects the representable fine-height ranges of selected unprotected,
visible vertices while preserving their stored coarse/base channel. A null range
means no common target height is available. This is not an engine pathing result.
`document.plan.foundation.heightEditing` reports the corresponding budget for a
new flat foundation. In the current fresh profile, base height 8 leaves about one
unit of upward room; base height 4 leaves about five. Choose the initial height
before creation rather than altering the native channel interpretation. Native
requantization remains unsupported; out-of-range plans fail before staging.

For a decoration-only zone, set both `heightMode: "preserve"` and
`textureMode: "preserve"` and omit `materials` and nonzero relief. Existing
texture masks and height channels are then retained and not claimed by that
zone. This prevents tree/understory passes from repainting authored soil or
clearings. Explicit route texture/flatten edits remain separate and still apply;
omit them when preserving the entire surface. Empty terrain-operation plans are
valid guarded no-ops, including a location consisting solely of placed objects.

Use `terrain.measure` before sizing infrastructure or building pads. The default
passport accepts placeable Doodads. An explicit `representation: "Actor"` also
resolves declared Unit/effect Actors through their Model and CASC mesh; pass an
exact Actor key when dependencies provide several definitions. This read-only
mode does not make Unit Actors eligible for Doodad palettes or measured groups.
`objectId` still refers to an existing Doodad. Measurements cover rest geometry,
not animated envelopes, Actor playback or engine building footprints. Random
Model scales and unresolved/ambiguous assets continue to fail explicitly.

`placement.addBatch` keeps every requested placement but resolves and returns
catalog candidate metadata once per distinct source key. Repeated houses or
troops no longer repeat the same catalog description in the plan response.
This reduces response bytes and repeated catalog queries; it is not a measurement
of client billing tokens. Bulk movement/removal also retain sequential XML
semantics while parsing and editing the component once per consecutive run.

```json
{
  "intent": {
    "zones": [{
      "id": "west_forest",
      "purpose": "Woodland beside the service route",
      "condition": "operational",
      "config": {
        "locationType": "custom",
        "candidateIds": ["AgriaTree", "Bush", "Rock"],
        "area": {"type": "rectangle", "minX": 20, "minY": 20, "maxX": 44, "maxY": 44, "z": 0},
        "objectCount": 40,
        "minimumDistance": 1.5,
        "seed": 42,
        "terrain": {
          "style": "forest",
          "materials": {"base": "AgriaGrassYellow", "rock": "AgriaRock"},
          "routes": [{"points": [{"x": 32, "y": 24}, {"x": 32, "y": 40}], "width": 4, "texture": "AgriaDirtRough"}]
        }
      }
    }]
  }
}
```

Resolve the example Actor/TerrainTex IDs against the actual target dependencies
before use. `candidateIds` is an exact Actor palette, including placeable-Doodad
and dependency checks. It does not add fuzzy search results or infer Model IDs as
Actors. The existing query-based location selection remains available; mixing
exact IDs with explicit queries/candidate overrides rejects.

Save a request as a workspace JSON file and use
`terrain.landscape.plan_file({file:"plans/locations.json"})`, or the compact form:

```text
terrain landscape file=plans/locations.json
```

`modkit.author` plan mode makes no writes. Its save mode uses the ordinary
`terrain.apply` and applied-plan `terrain.save` operations. Compact receipts show
rebuilt/unchanged zone IDs, object counts, changed files and bounded issues;
complete source hashes remain in the guarded plan rather than being repeated
in every response.

Keep the MCP connection alive across requests. Browse reuses the parsed catalog
while rechecking its recorded file bytes, effective drafts and filtered directory
memberships. Those reads are replayed into the current transaction's stale guards.
Same-size edits with restored timestamps invalidate the content fingerprint.
Objects/Triggers edits do not require the unrelated catalog-link index to rebuild;
the separate Data reference tools still inspect those consumers. Cold catalog
interpretation is distinct from warm request timings.

## Ownership and dependencies

Definitions and measured brush coverage are stored in `.sc2mcp/locations.json`.
Height/texture coverage records include unchanged writes, so a later manual edit
cannot be overwritten merely because the previous brush produced the same value.
Texture ownership preserves the other half of a shared mask byte. Structure,
palette and generator-revision guards prevent interpreting old records with an
incompatible component layout.

Repeated equal requests produce no file changes. A partial intent updates only
its named zones; stored definitions of the other zones remain available.
Changed zones and their transitive `dependsOn` overlays are rebuilt in dependency
order from their recorded preimages. Terrain is completed before any placement,
so every new member samples the final overlay surface. Existing object IDs are
reused by stable scatter/group slots; IDs reserved by other owners cannot be
consumed by a growing parent. Older independent records retain their original
serialized fields during a partial migration.
Unselected independent zones and their manual edits are preserved, without
claiming those zones were revalidated.

A changed child may alter ground under an existing ancestor's objects. Affected
objects receive height-only resnaps in the same guarded group, preserving their
IDs and explicit member ground offsets. Manual changes to those objects reject
the resnap. The receipt lists `resnapped` owners separately from `rebuilt` and
`unchanged`. New route conflicts with a stored ancestor require including that
parent in a reviewed request; the tool does not silently delete its decoration.

Overlapping ownership requires a declared overlay dependency. Missing parents,
cycles, changed owned terrain/objects and unknown component layouts reject before
staging. Do not declare a false dependency merely to bypass an ownership error:
it means the later zone intentionally overlays the earlier one and will be rebuilt
when that parent changes. Generation-semantics changes must increment
`LANDSCAPE_RECIPE_REVISION`.

The ownership record belongs to the same binary transaction as terrain, Objects
and ComponentList. Ordinary grouped save/stale guards apply to every component.
Replanning after unrelated changes preserves current unowned bytes. A stale
already-staged plan must be discarded/replanned rather than forced through.

## Current scope

The supported owned channels are height, texture masks/dominant sync cells,
generated decoration and measured groups, plus the measured native cliff/ramp
profile described below. Arbitrary native topology remains unsupported.

`purpose` and `condition` record design intent. They do not automatically select
damage models or establish aesthetic quality. Choose appropriate palettes and
measured groups explicitly. Routes reserve random decoration pivots; measured
members additionally check their complete declared horizontal rectangles against
all stored routes, exclusions and the location boundary, including concave edges.
Random pivots avoid the declared rectangles of rebuilt groups. These checks do
not establish engine footprints, animation envelopes or complete mesh support.
Use `config.terrain.heightMode:"preserve"` for texture/decor passes over existing
relief; omit `relief` or set it to zero. The default `"generate"` retains the
earlier level/noise/smooth recipe. Preserve mode emits no height operations or
height ownership, while explicit route flattening is still a deliberate edit.
Unowned objects are retained and are not automatically resnapped after height
changes. Unknown water coverage rejects owned placement.

The initial interface targets the component bundle at the workspace root, with
up to 32 stored zones and 100 generated terrain operations per atomic plan.
The ownership record is bounded to 64 MiB. Model clearance, pathing, buildability,
native rendering and the three-style visual acceptance corpus remain separate
checks in the roadmap. `src/tests/landscapeOwnership.test.ts` verifies ownership
and transactions, not an SC2 visual-quality score.

## Owned native cliffs and ramps

Use `config.terrain.topology` inside a named location intent:

```json
{
  "id": "west_plateau",
  "config": {
    "locationType": "custom",
    "area": {"type":"rectangle", "minX":0, "minY":0, "maxX":32, "maxY":32, "z":0},
    "objectCount": 0,
    "terrain": {
      "style": "city",
      "heightMode": "preserve",
      "textureMode": "preserve",
      "relief": 0,
      "topology": {
        "cliffs": [{"area":{"type":"rectangle", "minX":8, "minY":8, "maxX":24, "maxY":24}, "level":2}],
        "ramps": [{"id":"entrance", "center":{"x":26, "y":15}, "direction":"west"}]
      }
    }
  }
}
```

The map must provide the measured v115 identity/even-grid profile and the selected
cliff set. Cliff rectangles use the two-cell lattice and adjacent levels 1..3;
ramps use the existing cardinal width-four donor profile. Their full native
coverage/halo must fit the location. Protected areas conservatively reserve their
bounding rectangles for native cell writes. Unsupported joins, uneven ramp rails,
opaque caches and unhandled list payload reject before staging. This does not
rebuild engine navigation or certify collision/buildability.

Geometry is generated after ordinary height shaping and before textures/routes;
all decoration then samples the final dependency stack. The ledger records native
cliff rows by cell index, generated ramps by their positioned frame, CLIF words,
HMAP/SMAP coverage and only the low LFCT mesh-cutout bit. Native component headers
are read guards. Additional row/list attributes and higher LFCT bits are retained.
Variable-length XML lists are reconciled by owned rows, never replaced as a
whole-map ownership patch. Even deliberately unchanged/absent cells are guarded.

Changing a region removes its verified owned postimages, restores preimages and
rebuilds its dependants. An empty topology removes that region's generated native
geometry while retaining an underlying owner's geometry. Ancestor decorations
resnap even when the replacement emits no height operation. Unrelated native
rows/regions and their manual edits remain independent. A changed owned row,
ramp, binary field or stale transaction blocks replacement.

A first flat foundation may need a one-time channel/quantization preparation.
It belongs to the complete atomic transaction and is reported separately as
`foundationPreparation`, including changed raw vertices and maximum world-height
quantization delta. It is not claimed as one region owning the whole map.
Repreparing an existing location ledger is rejected if it would invalidate stored
preimages. Native per-zone execution cannot silently trigger global preparation.
Whole-transaction rollback retains the original foundation through the ordinary
backup mechanism. Existing independent ledger records remain unchanged.

The legacy unnamed `placement.createLocation` path does not silently ignore this
field; use `terrain.landscape.plan` with `intent` for owned native topology.
`src/tests/landscapeNativeOwnership.test.ts` covers regional rebuild, native
coverage, manual-edit preservation, absent cells, stale groups and ancestor
resnaps. Native rendering/gameplay acceptance remains tied to recorded fixtures.

## Measured groups without expanded member JSON

Each `config.groups` entry supplies a unique `id`, `anchor`, `angle`, `maxSlope`
and measured `members`. Copy the members from `terrain.prefab`'s `composeArgs`;
retain Actor keys, variation, ground offset and `boundsFrame:"member"`. Horizontal
bounds are required. They are supplied visual measurements, not engine collision
shapes or proof that a model asset has not changed since an earlier measurement.
Up to sixteen groups are accepted, with 500 members per group and 5000 total
generated objects per zone. `objectCount:0` disables random scatter; with groups
it selects a measured-only location, and with no groups it creates a terrain-only
region for paving, wear or other functional texture/height work. No dummy decor
is inserted. Member identity is the group ID plus member index;
changing random-scatter counts does not renumber group members.
These location groups are Doodads; `includeUnits:true` is unsupported. Add units
explicitly through the existing placement tools.

`modkit.batch` can pass measurements internally. There is no need to print or
rewrite a long member array. The following steps illustrate the data flow; fill
the location's existing terrain/area fields with the target map's values:

```javascript
[
  {id:"measured", tool:"terrain.prefab", args:{
    tileset:"Agria", recipe:"base_entrance", clearance:6, includeImage:false
  }},
  {id:"location", tool:"terrain.landscape.plan", args:{intent:{zones:[{
    id:"outpost", config:{ /* target area, terrain and palette */
      groups:[{id:"gate", anchor:{x:32,y:28}, angle:0, maxSlope:0.5,
        members:{$from:"measured.composeArgs.members"}}]
    }
  }]}}},
  {id:"apply", tool:"terrain.apply", args:{
    planId:{$from:"location.id"}, dryRun:false, stage:true
  }},
  {id:"save", tool:"terrain.save", args:{
    planId:{$from:"location.id"}, dryRun:false
  }}
]
```

The batch uses complete internal results while returning bounded receipts. These
are sequential calls; the location's apply/save is its complete atomic group,
not an atomic rollback of every earlier call in an arbitrary batch. Use the
ordinary plan/review workflow before committing a new composition.
