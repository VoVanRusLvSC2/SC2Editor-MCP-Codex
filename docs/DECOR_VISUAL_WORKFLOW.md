# Measured decor and visual palettes

The decor workflow extends `terrain.catalog` and its tileset packs. It does not introduce a second asset catalogue. All map authoring runs through MCP; the previews are derived files and require neither the SC2 Editor nor the game.

## Short commands

Send these as `modkit.author` scripts. Use one persistent workflow MCP process for a session.

```text
terrain palette_preview tileset=Agria section=vegetation limit=6 includeImage=false
terrain measure id=ChainLinkFenceStraight variation=0 includeImage=false
terrain prefab tileset=Agria recipe=base_entrance clearance=6 includeImage=false
terrain assemble zone=north_gate tileset=Agria recipe=base_entrance at=24,18 clearance=6 includeImage=false
terrain prefab tileset=Agria recipe=supply_cluster prop=SupplyTanks secondaryProp=Crate clearance=3 includeImage=false
```

`plan` is the default mode. `stage` stages the owned group; `save` invokes the existing complete-group save with stale guards. Reusing the zone replaces its recorded objects rather than adding duplicates. Manual changes to owned objects block replacement. Existing unrelated objects are preserved.

The ready groups are `base_entrance`, `service_yard`, `landing_pad`, `forest_edge`,
and `supply_cluster`. Override automatic tileset choices with scalar `fence`,
`light`, `prop`, `secondaryProp`, or `tree` Actor IDs. Set `anchor.x` / `anchor.y`,
or use `at=x,y` in short commands. Angles are radians. A seed makes the forest
layout repeatable. An explicit measured Actor can come from the declared target
catalog even when it was not observed in the tileset's reference maps; use bounded
`browse.search` and the existing palette/passport to verify it.

`supply_cluster` places one primary storage/utility object, three smaller props
and two lights in an asymmetric measured arrangement. `prop` and `secondaryProp`
select the two storage roles. Automatic choices keep distinct Actor keys and
exclude obviously damaged/wrecked IDs; explicit choices remain reviewable.
Its `clearance` is the depth of an open service apron approaching from local
negative Y, rather than a through-road width. Rotate the whole group with `angle`.
Inspect the returned reservation, actual dimensions and terrain support before
placement. This supplies a small coherent functional group, not a complete base
or certified vehicle/building footprint. Existing recipes keep their layouts.

When a verified model has multiple variants, use them deliberately rather than
repeating its default silhouette everywhere. `placement.setVariations` plans
explicit `{objectId, variation}` assignments for existing Units or Doodads in one
guarded transaction, without deleting IDs or rewriting references. The compact
command is `objects variants assignments='[{"objectId":12,"variation":1}]'`.
Plan mode is the default; stage/save use normal placement transactions.
Measure each chosen numeric variant and review its actual native appearance;
the attribute alone does not prove model availability, bounds or collision.
For an owned generated composition, update member variations in its intent;
directly changing owned objects becomes a manual edit which regeneration guards.

`terrain.style condition=operational` or `condition=abandoned` excludes positive
source-name/category hints of wreckage and structural damage. Curated utility
roles also participate in profile matching. An absent location has no candidates;
omitting `condition` retains the general review shortlist. Automatic composition
passes its declared condition into this selection. Explicit `objects` remain
author-selected and are not silently substituted. These are source hints, not
inspection of the model's real damage state; deadwood alone is not treated as a
destroyed structure. Reference tileset lists are observed candidates, not an
exhaustive list of all compatible declared-dependency Actors.

## Direct MCP tools

| Tool | Result |
| --- | --- |
| `assets.measure` | Raw CASC M3 passport with explicit scalar/vector scale, Z rotation and position; three geometry PNGs |
| `terrain.measure` | Exact target Actor -> Model -> CASC passport, effective scale factors, variation, pivot, bottom, attachments and three PNGs; optional placed `objectId` |
| `terrain.palette_preview` | A page of 1–12 existing tileset candidates, shared image scale, grid, ruler, dimensions and optional raw Marine reference |
| `terrain.prefab` | Measured members, reserved paths, connector evidence, top/isometric PNGs and reusable `composeArgs`; no map writes |
| `terrain.assemble` | The prefab planner plus normal terrain composition transaction, dry-run by default |

Direct visual calls return a PNG MCP image block by default. `includeImage=false` returns compact paths and metadata. `modkit.author` / `modkit.batch` intentionally return compact text receipts; call the visual tool directly when the client needs image pixels. Enable the tools with `modkit.enable_tools` in a focused profile. Restart an already running MCP process after updating the server to discover the new schemas.

Compact `map.preview` results retain the bounded `files.png` and `files.html`
artifact paths. Open those artifacts directly instead of searching the output
tree or requesting the full map payload. Inline image data and unrelated file
dictionaries are not added to compact responses.

The target catalogues must be mounted first, including inherited defaults from `mods/core.sc2mod`. Mount only metadata using `casc.mount`, with `kinds=["catalogs"]` and the map's declared packages. Mounting installed metadata does not add a dependency to the map.

## Measurement evidence

For organic ground, choose a small related set of soil, grass and litter textures
and blend regional `materials.patches` through the owned location workflow.
Use the area's purpose, slope and vegetation to choose where each belongs.
Keep maintained pads and traffic routes deliberate; scatter noise alone does not
design a base. Avoid turning long forest polygons into solid material bands.
Cluster radii should leave visible gaps at the intended canopy scale. Review
both the overview silhouette and a gameplay-scale view before accepting the
layout. See [coherent material patches](LANDSCAPE_OWNERSHIP.md).

- Bounds use referenced vertices in the first M3 mesh division. Nonuniform scale and Z rotation are applied before measuring. Unused vertices do not enlarge bounds.
- Model `ScaleMin` / `ScaleMax`, Actor `Scale`, placement scale and the explicit extra scale remain separately visible. Missing values use an explicitly reported identity assumption. A varying model scale is rejected rather than presented as an exact dimension.
- Variant selection uses the numeric `_NN.m3` suffix. A multi-variant passport requires an explicit variation; palette and prefab previews explicitly choose variation 0. Ambiguous catalogue definitions/packages fail with diagnostics.
- Bind attachment positions come from `ATT_` v1 bone references and inverse `IREF` matrices where available. Unsupported/missing bind data remains diagnostic. An attachment name alone does not prove a fence connector.
- Fence endpoint candidates and orientation come from measured AABB major axes. They are explicitly labelled geometric candidates. Group spacing uses those dimensions and an explicit gap; it does not assert authored socket continuity.
- The preview is untextured rest geometry, not the SC2 material/animation renderer. The reference Marine is raw M3 scale 1, not an independently certified engine-sized unit.
- Visual bounds are separate from navigation and building footprints. Footprint links are reported without inventing their occupied cells. Engine collision, animated envelopes, actor events and visibility need engine review.

Measured prefab members now declare `boundsFrame:"member"`: their horizontal
bounds include catalog scale but exclude placement scale/rotation. Composition
support samples apply the member's placement scale and rotation, then the group
transform. Older members without this field retain `"group"` semantics, where
bounds were already oriented/scaled in the group's local axes. Do not relabel old
bounds without recomputing them. The checks sample pivot and support corners;
they do not prove clearance across the complete mesh or an engine footprint.

## Group constraints and caching

The planner centres geometry using its actual pivot, adjusts the bottom to ground, preserves variation, records exact Actor keys, and reserves a corridor (or the landing square). Measured horizontal bounds cannot overlap the reserved area or other group bounds. Green polygons in group images show the reserved area. Geometry checks operate in local coordinates; world reservations also report their conservative rotated AABBs.

Assembly validates terrain at each pivot and each horizontal AABB corner: holes, protected cells, water, and excessive slopes block placement. This does not establish that the entire mesh lies on a flat support surface or that SC2 pathing is traversable. No texture painting or terrain flattening is implicit.

Geometry is cached by verified asset SHA-256 with a bounded 64 MiB / 24-entry memory cache. PNGs are cached by source hashes, transforms, view, shared scale, reference and reserved areas. Derived files live under `.sc2mcp-assets-preview/decor`. No geometry arrays or asset blobs are included in text responses. Use bounded pages and `includeImage=false` for selection, then request images only for the shortlist.

## Verification artifacts

Development tests: `src/tests/decorMeasurements.test.ts`. Real installed Agria resources and fresh MCP stdio calls: `work/decor-palette/MCP_RESULTS.jsonl`. The local verification report records measured timings and any limitations; these are not model-token or billing measurements.
