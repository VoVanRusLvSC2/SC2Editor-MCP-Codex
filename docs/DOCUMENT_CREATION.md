# Creating an Empty Map Base and Fashion

The `document.*` creates a new framework of parameters: a regular mod, extension mod, an empty Arcade map with or without Terrain. It does not require a registered card or copy someone else's scenario. It creates a flat initial grid with a selected texture for the surface; further landscape generation and game script are performed by existing modules separately.

The implementation is available locally in the `codex/document-foundation` branch. Research and source game data are not published. SC2 Editor does not start; the result is verified by native codecs, real SDK calls and pack/reopen MPQ. The matching of all internal defaults with the editor and game launch has not yet been confirmed.

## Supported parameters

| Basis | Parameters |
| --- | --- |
| Dependent Mod | destination, name, locales, ordered dependencies |
| Extension Mod | Same parameters; separate `Flags/ExtensionMod` in DocumentInfo |
| Empty Arcade Map | Same; width/height 32..256 in step 8, including rectangular maps |
| Map with Terrain | CTerrain from selected dependencies; initial texture from his palette; baseHeight 0..12 |
| Map without Terrain | Complete MapInfo, structural bootstrap and empty metadata; t3 components missing |

Source-backed local profile: Header H2CS v8, version markers v2, MapInfo v39, Terrain XML v115, HMAP101/SMAP102/MASK102/RTXT101/LFCT102/CLIF100 and empty auxiliary meta tables. Generated freshdata/locale strings and complete empty player/variant/lighting structures. Header has its own content stamp; its identity to all native publish/hash semantics is not declared. Product `0x5332`00 is installed separately from Extension tag.

For the map, there is only an empty `InitMap` - a system entry point without gameplay initialization. Author objects, triggers, libraries and scripting functions are not added. Melee/Training initialization is not added.

## Teams.

| Team team. | Appointment |
| --- | --- |
| `document.capabilities` | Real profiles and limitations |
| `document.types` | What parameters are applicable to each species |
| `document.dependencies.list` | Source specifications of Liberty/Swarm/Void presets |
| `document.dependencies.inspect` | Deployed graph, implicit core, missing/cyclic sources |
| `document.terrain_sets.list` | Paginated CTerrain choices from selected graph |
| `document.terrain_sets.get` | Palette/cliff definitions/provenance of a specific CTerrain |
| `document.plan` | Fresh bytes and manifest without user destination recording |
| `document.validate_plan` | Re-check the model and sources |
| `document.create` | Dry-run/private materialization or creation of components/packed output |
| `document.inspect` | Strict re-checking of the established basis by manifest |

Schematics: [document-tools.json](../generated/document-tools.json). `document` profile combines UI, Document, CASC, Map, Terrain, Settings, Text, Data and Browse. `all` retains the remaining previous modules and includes Document. Old narrow profiles are not overridden.

## Examples

Create a regular mod:

```json
{"tool":"document.plan","arguments":{
  "kind":"mod","modType":"dependent","destination":"mods/MyMod","name":"Мой мод",
  "locales":["ruRU","enUS"],
  "dependencies":{"mode":"standard","expansion":"void","campaign":false}
}}
```

For extension mod, only `modType:extension` is changed. This is not a publishing operation on Blizzard services.

First, find out the palette of the selected CTerrain:

```json
{"tool":"document.terrain_sets.get","arguments":{
  "dependencies":{"mode":"standard","expansion":"liberty","campaign":false},"id":"Agria"
}}
```

Then prepare an empty map:

```json
{"tool":"document.plan","arguments":{
  "kind":"map","mapType":"arcade","destination":"maps/EmptyAgria","name":"Пустая карта",
  "locales":["ruRU","enUS"],
  "dependencies":{"mode":"standard","expansion":"liberty","campaign":false},
  "map":{"width":128,"height":96},
  "terrain":{"enabled":true,"tileSet":"Agria","initialTexture":"AgriaDirt","baseHeight":8},
  "initialization":"empty"
}}
```

Plan returns ID, manifests, content SHA, resolved dependencies, and diagnostics. Changes to selected packages or installed build block creation.

```json
{"tool":"document.validate_plan","arguments":{"planId":"document_..."}}
{"tool":"document.create","arguments":{"planId":"document_...","dryRun":false,"output":"components"}}
```

For a packed file, use `output:packed`. Destination `maps/EmptyAgria` gives `maps/EmptyAgria.SC2Map`; mod gives `.SC2Mod`. If the destination already has the correct extension, output components use an additional `.components`. You cannot create two outputs from one plan after either one appears: you need a new destination/plan.

DryRun by default is true, actually writes private temporary components, reads them back and, for packed output, packs/reopens MPQ. User destination is published only after all checks. Existing outputs are not replaced; packed publication uses exclusive hardlink. Original map/game files do not change.

## Sources and follow-up

Standard dependency closure uses bounded native expansion chain Core→Liberty→Swarm→Void and the selected campaign layer. Packages are checked against real CASC ROOT; required TerrainData are read from CKey/SHA checks. This is not a check for the presence of absolutely all game assets. Custom entries require local component directories inside MCP root; `bnet:` ID and `file:` specification are stored separately. Cycles, duplicate condition entries, explicit bnet format and several multierencies direct dependency policies are rejected.

CTerrain resolver supports ordered overrides, direct arrays, parent inheritance and `##id##` substitution. Required indexed/remove/token shapes outside of this subset are marked unsupported, and the plan for such a set is rejected.

The created component-directory becomes the new `SC2_UI_ROOT`. Then the old Terrain/Settings/Data/Script tools are available. For Data/Browse installed dependency views, the usual `casc.mount` is connected; the creation of a document does not declare each found packet automatically active in the previous solvers. Custom local dependencies must be placed so that SC2 can allow the stored file specification.

`document.inspect` verifies **unchanged basis**. After copyright editing, the expected SHA fundamentals are changed; then use the usual validators of the corresponding module. Service `.sc2mcp-document.json` is excluded from MPQ and parent indexes. General `ui.test_readiness` is focused on map with Terrain; for mod and no-terrain foundation, use `document.inspect` and the necessary Data/Text/Script checks.

## Inspections and limitations

Checked native Header reader on existing fixture, all its truncated prefixes, exact 44-byte marker, fresh complete MapInfo, initial rectangular grids, inheritance/tokens, strict schemas, mod subtype, localisation, dryRun, full source guards, stale builds, cyclic/local dependencies, existing destinations, actual native MPQ pack/reopen and real SDK creation through installed SC2.

Not stated: full Editor New Document default fidelity, native publish identity semantics, Melee/Training profiles, cliffs/ramps/border generation, nav/collision rebuild, full-fledged engine material/lighting/minimap rendering, remote dependency downloads and game operation without separate verification. Minimap is a simple gray initial preview. On October 11, 2026, the user confirmed the opening of `EmptyAgriaFixedPacked.SC2Map` in SC2 Editor after fixing the generator.

[The plan and its boundaries](DOCUMENT_FOUNDATION_PLAN.md) · [Study](DOCUMENT_FOUNDATION_RESEARCH.md) · [General report](CAPABILITIES_REPORT.md).


## Correction of the stop on Loading Terrain (11.10.2026)

The first `EmptyAgriaPacked.SC2Map` card was checked by the container, but it hovered when Terrain was opened in the editor. There were two defects in the generator: there was no `heightMap/cliffCellList`, through which the native XML-reader allocates half a grid of ledges, and `t3SyncHeightMap` remained zero scale. The new `native-empty-v39-v115-local-2` profile always creates an empty `cliffCellList` of the size of `width*height/4` and a single Q12 scale of `[4096,4096,4096]` at offsets of 28/32/36.

The `terrainLoadContract` test rejects missed cliff/block grids, incorrect SMAP sizes and zero scale. The regression test reproduces both previous defects. The user confirmed the successful opening of the corrected card. This confirmation refers to the cumulative fix: separately, the effect of each defect on hanging was not measured.

XML-reader behavior source: [description of t3Terrain XML](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/t3terrain-xml.md#cliffcelllist-element), section `cliffCellList`. The old file was not overwritten, so you should open a new `EmptyAgriaFixedPacked.SC2Map` file for verification.


## Further author's work after the creation of the basis

`trigger.plan` creates the usual triggers directly at the root of the map when `create.library` is not specified or equal to an empty string. For an existing user library, you can still specify its ID. Root links are written without `Library=""`, names use `Trigger/Name/<Id>`. Standard SC2 definitions (`Ntve`) remain references to embedded actions and events, and a new resource library is not created.

`trigger.normalizeScriptLayout` now leaves `include` in the root CustomScript only a structural XML indent, which the editor removes when reading. Fixed five extra spaces discovered by the user. `include "Scripts/SmallSkirmish"` and the Galaxy file itself are saved in the example map.

On the map, the player versus the computer in `Objects` There are 47 units/resources and 70 scenery, and when you start, the script receives the bases through `UnitFromId`So it doesn't create second instances. The race in the parameters of both players is given by the token. `Terr`; names and messages have tables ruRU and enUS. The user confirmed the operation of the Galaxy and the attacks of the computer, then displaying objects in the editor on v3. To correct the relative height of units, a separate v4 was released.
