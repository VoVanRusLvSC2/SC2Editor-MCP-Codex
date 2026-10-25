# Incremental location plans

`terrain.landscape.plan` retains its existing landscape recipe and optional
lighting request. The additional `intent` form coordinates named locations
through the existing terrain generator, route reservations and placement planner.
It plans one atomic Terrain + Objects + ComponentList + ownership transaction.
It does not introduce another terrain codec or a renderer.

## Inspecting and refining existing zones

Use `terrain.landscape.inspect` to list up to eight owned zones, their current
`requestHash`, definition integrity, purpose, condition, dependencies, object counts and measured-group
summaries. It reads ownership state without loading all terrain grids and never
returns binary preimages, terrain patches or object fingerprints. A selected zone
also reports the current dependency rebuild closure. This is stored intent and
ownership information; it does not validate manual edits or native appearance.

For a config value, supply `zone` and `field`, for example `clusterRadius`,
`area`, `groups`, `terrain.materials` or `terrain.routes`. All existing config
keys and explicit `terrain` keys are supported. Array fields use `itemOffset`
and `itemLimit` (default 20, maximum 100). `field:"groups",group:"relay"` pages
that group's complete measured members. Entries are never shortened; the field
has a 32 KiB value budget and the complete response has a 96 KiB limit. Inspect
`total`, `returned`, `nextOffset`, `truncated`, `omitted` and
`oversizeItemBytes`. Select a narrower terrain field or group when a whole value
is too large. A truncated page is not a complete replacement array.

`terrain.landscape.zone.plan` edits one existing zone using the hash returned by
inspection:

```json
{
  "zone": "west_trees",
  "expectedRequestHash": "<64-character requestHash from inspection>",
  "changes": {"config": {"clusterRadius": 8}}
}
```

`changes` accepts `purpose`, `condition`, `dependsOn` and the complete existing
`config` schema as optional fields. Only `config` and `config.terrain` merge with
stored values. Omitted fields retain their values; defaults do not reset them.
Every other object or array is replaced as a whole, including `area`, `groups`,
`materials`, `routes`, `topology`, exclusions and dependency lists. For example,
editing material patches requires the complete intended `terrain.materials`
object; editing one measured member requires the complete intended `groups`
array. There are no arbitrary JSON paths, zone renames or implicit removals.

Use `unset:["clusterRadius","terrain.materials"]` to remove optional config
fields and return to the existing generator's omission behavior. The schema
lists the removable fields explicitly. Required/defaulted fields are set
normally; replace `groups`, `dependsOn` or `terrain.routes` with `[]` to clear
them. Setting and unsetting the same field rejects.

The expected hash is compared against the same ledger read used to build the
plan. The stored hash must also match the normalized current definition; a
manual ledger edit retaining an old hash rejects. Inspect reports a definition
integrity mismatch explicitly. Review the complete intent before adopting such
a change or an older definition whose normalized defaults have changed. A
missing zone or stale hash rejects. The merged definition delegates to
the existing owned-landscape planner, preserving inherited route/pad bindings,
unselected zones, dependency rebuilds, stable object slots, ancestor resnaps and
manual-edit checks. The hash protects the selected definition; ordinary source
hashes additionally protect terrain, objects, catalog dependencies and bound
suite files through apply/save. Pending drafts still reject. Inspecting a zone
does not make a later plan immune to a changed dependency or source file.

Compact commands use the same schema and lifecycle:

```text
terrain landscape.inspect zone=west_trees field=clusterRadius
terrain landscape.zone zone=west_trees expectedRequestHash=<hash> changes.config.clusterRadius=8
```

Run the first command in plan mode. Run the second in plan mode for review,
or stage/save mode for the usual atomic Terrain apply/save. Continue to use
`terrain.landscape.plan` or `plan_file` when adding zones, reviewing several
conflicting zones together, or explicitly changing route/pad bindings. Neither
inspection nor refinement starts native workers. Re-export and reuse the
relevant acceptance suite, then inspect overview/gameplay images for art quality.

## Reservations from an existing test suite

An owned intent can declare `routeSource: {"file":"tests/routes.json",
"clearWidth":3}` beside its `zones`. The ordinary `terrain.landscape.plan` and
`plan_file` paths read the strict existing test manifest and reserve every
positive ground route plus each formation member's offset lane. Reversed or
duplicate paths share a reservation. There are at most 50 combined unique
corridors. These reservations do not paint textures or flatten ground.

`clearWidth` is an explicit total design width in world units. It is independent
of the test's arrival tolerance and maximum observed deviation, and it does not
certify a unit footprint or collision clearance. Blocked crossings are reported
and excluded from positive reservations. The manifest's map reference is retained
for provenance; matching it to the current authoring map is not certified here.
The normal map-test planner still validates the exact exported archive.

The binding and resolved corridors are retained in the ownership ledger. Omission
inherits an existing binding; explicit `routeSource:null` removes it. Missing or
invalid bound files reject. A descriptive-only file change updates metadata
without rebuilding locations. A newly imposed corridor checks existing owned
measured bounds at their current transform, or scatter centers. A conflict in an
unselected zone rejects and names the zone to include in the reviewed request.
Explicitly reviewed scatter can regenerate with its existing IDs; a measured
group still needs a clear declared position. Nonconflicting unselected objects
and their manual transforms remain unchanged. A manually changed model/variant
needs review because its recorded measured bounds no longer establish clearance.
Unowned objects, animated envelopes and engine collision remain separate checks.

Source bytes are pinned through planning, apply and staged save. Changing the
manifest requires a new plan, including for metadata-only transactions. The
normal compact command stays `terrain landscape file=plans/locations.json`;
there is no extra source-code authoring or native worker launch.

## Building-pad reservations from a test suite

The same intent can bind selected native placement checks using explicit design
clearance dimensions:

```json
"padSource": {
  "file": "tests/acceptance.json",
  "pads": [{"id": "mainDepot", "clearWidth": 6, "clearHeight": 6}]
}
```

`pads` selects1..32 unique `game.pads` IDs from the existing strict test manifest.
Every selected check must declare `expected:"exact"`. Finalize the authored
anchor before binding a diagnostic `candidate` or `blocked` check; those
expectations do not identify an exact intended building location. Selection IDs
are not catalog IDs. Width and height are positive total world dimensions, each
at most256; neither defaults to render bounds or an inferred engine footprint.
The whole resulting rectangle must fit the terrain, not only its center.

The binding stores the source digest, selected catalog/owner and resolved
rectangles. Omission inherits it; `padSource:null` explicitly removes it. Metadata
changes alone preserve terrain/objects. Planning, apply and staged save retain
the same stale-source guards, including when route and pad bindings use one file.
New or enlarged rectangles review unchanged owned groups at their actual current
transforms and scatter at its centers. Conflicting unselected zones reject with
their IDs. Include a zone to regenerate its unchanged owned scatter with stable
IDs or explicitly move its measured group in the reviewed definition. Manual
object/model edits are preserved or require review, never silently replaced.

New scatter and measured groups exclude these rectangles through the existing
placement APIs. The reservation does not flatten, paint, alter native pathing,
remove unowned objects or execute a native query. Scatter mesh overhang/animation
and engine collision remain unverified. The manifest map reference is provenance,
not certified identity of the current authoring workspace. Export and run the
same `project.test.*` suite to check the actual map. A native predicate pass,
design clearance, route arrival and finished composition remain separate evidence.

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

For an owned smooth hill or clearing, `config.terrain.baseHeight` optionally sets
the target world height before seeded relief. Omit it to keep the existing
current-median behavior. A polygon outline and `edgeBlend` can shape an irregular
raised clearing; use zero relief on a maintained pad. Protected areas, holes and
native quantization limits retain their normal guards. `heightMode:"preserve"`
rejects a supplied `baseHeight`, including zero, instead of silently ignoring it.
This changes continuous height only: discrete native cliff levels, ramps,
navigation and buildability still require their separate supported operations
and checks. Heights outside the source's editable range fail before staging.

Organic material regions can use `config.terrain.materials.patches`:

```json
{
  "base": "AgriaGrassYellow",
  "patches": [
    {"texture": "AgriaDirt", "wavelength": 12, "strength": 0.75},
    {"texture": "AgriaFoliage", "wavelength": 7, "threshold": 0.12, "strength": 0.45}
  ]
}
```

This is the `materials` object, not a complete location request. All textures
must exist in the active native palette. Up to six ordered patches blend through
the existing native mask writer before the optional slope-based rock pass.
`wavelength` is in world units; `threshold` is a signed coherent-noise value,
not a requested area percentage. `transition` controls softness in noise-value
space. Defaults are wavelength 8, threshold 0, transition 0.35 and strength 0.65.
Each omitted patch seed derives deterministically from the effective generation
seed and its list position. Owned locations use `config.seed`; standalone terrain
generation uses its `seed`. An explicit signed 32-bit patch seed overrides it. Optional min/max
height and slope fields restrict a patch using the existing terrain samples.

Patches without `materials.base` retain the existing background instead of
inferring a new style texture. An explicit base repaints the region first.
Brush edges, protected areas, holes and hidden cells keep their ordinary guards.
The pattern uses world coordinates, so clipping the same pattern into adjacent
brushes does not restart it at each brush origin. Pattern masks are also available
as `pattern` on `terrain.paint`/`terrain.blend` and matching plan operations.
`textureMode:"preserve"` rejects patches just as it rejects base/rock writes.
Legacy requests without patches keep their existing operations and ledger shape.
This adds material variation, not a navigation rebuild or finished-art certificate.
Owned material patterns also protect declared route corridors from every location
in the intent, so a later litter/grass overlay preserves an earlier road. Explicit
route painting still runs in its owning zone. At most 50 combined explicit and
automatic protected masks are supported per patterned operation; larger intents
reject before staging. This protection does not change legacy solid fills.

For grouped vegetation, set optional `config.clusterCount` (1–32) and
`config.clusterRadius`. These connect the existing seeded scatter clustering to
owned locations and `placement.createLocation`; absent fields retain the previous
uniform layout and normalized request shape. Cluster centers stay inside the
declared area and outside exclusions/reserved route centers. Object spacing and
route exclusions still apply. A dense request that cannot fit rejects rather than
falling back to a uniform carpet or reducing its object count. These constraints
cover object centers, not engine collision footprints. Separate tree and understory
zones can use different grouping and spacing while preserving the surface.
Optional `config.clusterSeparation` sets a minimum world-space distance between
cluster centers. It is separate from the minimum distance between placed objects.
It can keep several canopy groups from collapsing into one patch. Centers still
obey the area and exclusions; an impossible center layout rejects instead of
reducing the number of groups. Omitted separation retains the existing layout.

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
`browse.status.fingerprintProfile` identifies the current
`content-inputs-bundled-schema-v2` profile. Bundled Data XSD inputs use stable
semantic roles plus their actual content digests, so relocating an otherwise
identical MCP package does not change catalog identity. Map and external catalog
paths, root precedence, file content and captured directory membership remain
part of that identity. Transaction guards still use the actual source paths.
Upgrading an older path-dependent ownership ledger requires one guarded
revalidation; inspect the complete plan and retain manual-edit conflicts. Do not
replace stored fingerprints directly or assume metadata revalidation repairs art.
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

Revision4 synchronizes native SMAP low-byte level labels with the generated HMAP
levels, including ramps and low saddle centers. Owned native vertex patches
cover the two SMAP height bytes and its level-label byte; the remaining upper
byte stays independent. Earlier zone revisions rebuild through the usual source,
manual-edit and dependency guards rather than treating the old output as current.

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
