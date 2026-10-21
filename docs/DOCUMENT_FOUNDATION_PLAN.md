# Plan of the module for creating empty maps and mods

Status as of October 11, 2026: the basics are completed for the listed sources, ** new runtime module has not yet been added.** The proposed command space is `document.*`. Its task is to create a new blank document from the wizard parameters, with the right components, dependencies and initial data. The existing Terrain, Script, Trigger, Settings and Map retain their functions.

The current phase ends with either an empty component folder or a packaged SC2Map/SC2Mod. Landscape generation, object placement, and author script are performed later by other modules. The initial flat grid and one selected texture form the basis of the map with Terrain, because without them there is no surface document itself.

## It's already established.

| Question | Confirmed result | Ground |
| --- | --- | --- |
| Types of documents | Melee, Training, Arcade, Dependent Mod, Extension Mod | Decompilation lines, real markup and localization of the master from CASC |
| Master's Stages | Type → dependencies → map parameters; for two types of mod, the last step is skipped | Move forward to recovered RVA `0x786880`, five radio entries to `0x9eff80`, XML `NewDocumentDialog` |
| Difference between extension mod | `DocumentInfo/Flags/Value = ExtensionMod` | Real native mod from CASC; type ordinal 4 additionally asks bit 1, mod factory translates it into `0x8` argument |
| Map settings | Width, Height, Use Terrain, Texture Set, Initial Texture, Base Height | 35 wizard elements from the current EditorLayout and reading parameters in `0x9ede70` |
| Size | `32 + 8 × index`; current MapInfo writer limits size to 256 cells | Machine instructions `0x9edea2`, `0x9edebc`; valid MapInfo v39 codec |
| Initial altitude | In the studied factory 5.0.16: 8.0; also the initial parameters of random strength/variability 50/50 | Float constant `0x3530e3c`, creating a `0x785fc0` request; this is not a confirmation of all defaults 5.0.17 |
| Dependencies | Standard/Custom, expansion, campaign data and automatic multiplayer; combinations are limited | Real controls/EditorStrings and dependency pane checks |
| Empty map from scratch now | `map.create` creates a copy of the native blueprint | `MapWorkspace.capabilities`, `map.create`, current creation tests |
| An empty mod cannot be checked as a card. | Native mods may not contain MapInfo or Terrain | ComponentList of two game mods and a local mod folder |
| Header can not be assembled one XML | Header contains a separate list of dependency specifications and localized strings. | Three self-assembled H2CS v8 headsers to exact EOF |

[Detailed study and boundaries of evidence](DOCUMENT_FOUNDATION_RESEARCH.md). [Machine-readable results](../generated/document-foundation-evidence.json).

## What questions does the new module ask?

| Basis | Mandatory user parameters | Additional parameters |
| --- | --- | --- |
| Regular mod | Place and name of the document; standard preset or ordered custom dependencies | Locales, displayed name |
| Extension mod | Same parameters; subtype `extension` | Same settings; publication in Blizzard services is not included in the creation |
| Map. | Place and name; kind maps; dependencies; width and height | Terrain on/off; Terrain - available CTerrain, initial blend texture and base height; locales |

In the first delivery, the main profile of the card is an empty Arcade. Melee/Training remain separate profiles until their defaults, multiplayer rules and staff initialization are fixed. Their presence in the editor does not mean that you can use the same binary defaults.

To match the editor base, the model also stores `useTerrain` and a separate dependency setting method. A map without Terrain is a valid wizard item, and the mod does not receive a size field. For an empty profile, `randomHeight` is turned off: this operation refers to the subsequent operation of Terrain.

The name of the texture set and the source texture are selected from dependencies of the future document. They are not replaced by arbitrary strings from the general installed-game index. Already installed CASC allows you to get real directories and the origin of the record.

## Request model

Discriminated union is offered. `kind:mod`00 requires `modType:dependent|extension`; `kind:map` requires `mapType:arcade|melee|training` and size. `terrain` is only present on the card. `enabled:true` requires CTerrain and initial texture; `enabled:false` prohibits random additional values.

Dimensions of the first profile: as many as 32..256 in 8 steps, including rectangular maps. The full table of menu items and the initial selected size must be fixed with populate/reset code before claiming a precise match with the wizard. For a user query, the size is indicated explicitly. The limit 256 and the step formula are independently verified; tolerance of arbitrary size 33 is prohibited.

Examples of **future** `document.plan`, not the tools already available:

```json
{
  "kind": "mod",
  "modType": "dependent",
  "destination": "mods/MyDataMod",
  "name": "My Data Mod",
  "locales": ["ruRU", "enUS"],
  "dependencies": {"mode": "standard", "expansion": "void", "campaign": false}
}
```

```json
{
  "kind": "mod",
  "modType": "extension",
  "destination": "mods/MyExtension",
  "dependencies": {"mode": "custom", "entries": [
    {"file": "Mods/Void.SC2Mod", "bnet": "Void (Mod)/0.0/999"}
  ]}
}
```

```json
{
  "kind": "map",
  "mapType": "arcade",
  "destination": "maps/MyEmptyMap",
  "name": "My Empty Map",
  "dependencies": {"mode": "standard", "expansion": "void", "campaign": false},
  "map": {"width": 128, "height": 128},
  "terrain": {"enabled": true, "tileSet": "BelShirEx1", "initialTexture": "<ID из выбранного CTerrain>", "baseHeight": 8.0},
  "locales": ["ruRU", "enUS"],
  "initialization": "empty"
}
```

A specific dependency preset unfolds into a verified list; examples do not set a universal rule that one Void is enough for each document type. source texture ID is replaced by a result of `document.terrain_sets.get`. Connecting your own mod requires a real local/Battle.net specification and availability verification, rather than a fictional catalog ID.

## Module operation

1. Identify the document family and target format profile. The installed CASC build and the investigated editor build are accounted for separately.
2. Deploy dependencies, keep them order, find implicit Core and transitory sources; check for missing packets, duplicates, and cycles.
3. For a card with Terrain, allow CTerrain, inherited blend textures, cliff definitions, and lighting defaults from the selected dependency graph.
4. All defaults must have a source in a specific profile; unknown mandatory defaults block materialization.
5. Create documents in a new service folder that doesn't copy the user's script, its Objects, Triggers, localization, archive identity, or MapInfo's unknown tail.
6. Check XML, binary envelopes, links, sizes, content purity, Header/Info/version reconciliation, and no undescribed files.
7. When packed output, collect the MPQ with the same archive backend, reopen it and compare composition/bytes.
8. Reconfirm build/source fingerprints and publish new results atomically. Existing destination is rejected.

The result contains the component folder path, document kind/subtype, resolved dependencies, sizes and CTerrain, manifest SHA, serialization profile, diagnostics and verification boundaries. It becomes the usual root for existing modules. Changing root and then creating game content is a separate step.

## MCP teams

All the names below refer to the planned module.

| Team team. | Appointment |
| --- | --- |
| `document.capabilities` | What kind/build/format profiles are capable of creating a framework and which mandatory parts have not yet been confirmed |
| `document.types` | Document types, applicable parameters and initialization profiles |
| `document.dependencies.list` | Presets and available native/local packages with provenance |
| `document.dependencies.inspect` | Deployed graph, missing sources, cycles, multiplayer policy |
| `document.terrain_sets.list` | CTerrain from selected graph only, with pagination |
| `document.terrain_sets.get` | Initial Mixed Textures and Dependent Definitions of the Selected Set |
| `document.plan` | Full model and manifest without user recording, fingerprints sources |
| `document.validate_plan` | Re-check the model, mandatory defaults and sources |
| `document.create` | Execute fixed plan; dryRun by default; directory/packed output after checking |

`document.create` has arguments `planId`, `dryRun`, `output:components|packed`. With dryRun, real private materialization and the same checks are performed. This is creating a whole new folder, so you don't have to pretend that an existing file-stage/save group already contains an unpublished document.

## Components of the new framework

| Layer | Regular and extension mod | Map. |
| --- | --- | --- |
| DocumentInfo | XML metadata, ordered dependency specs; ExtensionMod flag for subtype extension only | XML metadata and the rules of the selected map profile |
| DocumentHeader | Product/build, dependency list, metadata/localization table, verified profile fields | Same as agreed with player/name/map metadata |
| ComponentList | Only components of the selected profile; logical roots are accounted for separately from the presence of files. | MapInfo is added; Terrain is its root; other roots are profile-only |
| Version markers | Type/version/metadata of each component created | Additional MapInfo/Terrain Markers |
| GameData | Empty Catalog/Includes profile without imported gameplay content | Same thing. |
| GameText | Name and necessary structural strings for selected locales | Additional initial player strings according to MapInfo profile |
| Triggers and script bootstrap | Empty library/container only if required in format | Empty shell only if required; no authored functions/actions |
| MapInfo | Not in the mod profile unless the writer path requires otherwise. | Full fresh v39 document: core, players, teams/bitsets, lighting, integrity hash |
| Terrain | Missing. | When enabled:true – complete flat terrain bundle |
| Preview/preload/Objects | Profile requirements; do not copy the scene | Empty/derived files only if created by this profile |

The presence of `gada`, `trig` or `text` in ComponentList does not prove that there is a common file of the same name. Current native examples show logical roots and optimized forms. Their rules must be part of the manifest builder.

Empty profile means zero author objects, trigger definitions/actions and script functions. Service structures, players, headers and flat grids are not considered game content. The available editorial DefaultTrigger contains melee initialization actions: you can not add it automatically to an empty base. Full reproduction of the standard Melee initialization is a separate future profile, without mixing with `empty`00.

## Writers that need to be added

**DocumentInfo.** Create an XML model with Flags, ModType, Dependencies and profile metadata. `Flags/ExtensionMod` must be stored separately from ModType. Do not transfer `PublishPrivate`, icon or campaign metadata from the studied game mod.

**DocumentHeader v8.** Real-life verified files of this set use 48-byte prefix, uint32 dependency count by offset 44, CString specifications, then localized strings with uint16 lengths and locale FourCC. All three are disassembled to EOF. You need to restore writer prefix, hashes/IDs and localization compliance, rather than insert random zeros or copy someone else's prefix. Documentation-client reader does not match this observable Editor game profile; it is not a ready-made contract.

**Version markers.** Full writer `.version`, product/type tags and related metadata. Existing source codecs for similar components and parse-only versions do not prove fresh serialization. Derived identity/hash/timestamps derive their own values of the new basis; original scenario identity is not inherited.

**Fresh MapInfo v39.** `MapInfoDocument.patch` retains the tail, `PlayersDocument.patch` replaces the spans. None creates the player/team/lighting tail from scratch. The new factory must create the entire structure, confirm initial players/teams/bitsets, and calculate the already proven core hash. You cannot issue a Width/Height record over an old card for creating a new document.

**Flat terrain.** Separate allocator initial bundle, without landscape algorithms. `t3Terrain.xml` specifies/quantization/CTerrain/textures/cliffs; HMAP and SMAP are created in concert; RTXT/MASK reflect one selected blend texture; LFCT/CLIF, HRDT, DLFT, VTCL and WATR receive confirmed states initial. Additional/creep/cell files are created only when confirmed. Initial profile/cliffs/heights are needed, and only the correct border loads are zero.

For W×H MapInfo: vertex grid usually `(W+1)×(H+1)`, cell grids `W×H`, texture-mask resolution is defined by native profile. Different resolutions cannot be replaced by one size. Current SMAP layout and some HardTile/VertCol payloads have limitations; allocator must not bypass their generic raw edits.

**Manifest and packed output.** New serializer selects components by kind, collects metadata/localization and MPQ without the old archive manifest. Current `map.validate` assumes MapInfo/Terrain and does not fit mod. `document.validate_plan` uses its own kind-aware foundation validator, and archive adapter is reused without changing the format of old operations.

## Dependencies and texture sets

Standard presets should have the source: editor table/installed package metadata and fixed build. Distinguish Liberty/Swarm/Void base mods, multiplayer mods and campaign packages. Transitive dependencies do not automatically become duplicates of direct dependencies in Header.

Automatic multiplayer has the rules of the wizard: if you allow additional expansions, you can not explicitly add multiplayer dependency; if you have a fixed multiplayer mode, you need the corresponding dependency; more than one multiplayer dependency is prohibited. The applicability of these rules to kind/mapType and the numerical stored mode values should be definitively linked to the path writer.

Dependency resolver stores separately direct specifications, ordered expanded closure, implicit engine inputs, and actual file availability. CASC mount is a way to retrieve files for tools, rather than proof that any package found is automatically active in a document.

CTerrain depends on this closure. Liberty/Void TerrainData studies contain 24/60 authored CTerrain rows; among them are default/generic entries and overrides. These are not 84 unique user sets available. You need to exclude non-resulting generic/default rows, allow parent/token/remove/override and show provenance. Full engine inheritance in the current Data module is not stated; the new allocator solver must refuse at an ambiguous mandatory field.

## Structure of implementation

```text
src/modules/document/
  schemas.ts                 запросы и discriminated unions
  tools.ts                   document MCP tools
  workspace.ts               plan, source guards, private materialization, publication
  profiles.ts                capability gates и подтверждённые defaults
  dependencyResolver.ts      direct/implicit/ordered closure и presets
  terrainSets.ts             CTerrain choices для заданной closure
  manifest.ts                компоненты по kind и output
  validation.ts              kind-aware cross-component checks и empty-content проверка
  codecs/
    documentInfo.ts
    documentHeader.ts
    versionMarker.ts
    mapInfoFactory.ts
    flatTerrainFactory.ts
```

In general `src/app/project.ts`, `server.ts`, `moduleSelection.ts` – only the creation/registration of a new module and an additional profile. `map.create` remains the same template workflow; Terrain/Script/Trigger/Settings writers are not overridden. The user is shown the usual parameters of the document; decompilation addresses remain in research evidence.

## Implementing procedures

| Phase | Specific result | Completion condition |
| --- | --- | --- |
| 1. Common codecs | DocumentInfo Flags/Dependencies, Header native v8, `.version`, locales, ComponentList | Independent native parsing, round-trip existing inputs, restored prefix/identity/hash rules and negative cases |
| 2. Mod profiles | Empty Dependent Mod and Extension Mod without Terrain/MapInfo | Own identity, correct Flags/ExtensionMod, consistent Header/Info/versions, no borrowed gameplay content |
| 3. Fresh MapInfo | Full factory v39 with profile defaults and correct tail | Sizes/hash/players/teams/lighting checked independently; save without donor tail |
| 4. Map foundation | Empty Arcade without Terrain and with flat Terrain for supported CTerrain | All initial grids are agreed, no noise/objects/scripts, no unverified mandatory defaults |
| 5. MCP and publication | Plans, dryRun, create, guards, own validator, packed output | Real SDK calls and archive reopen; errors do not publish partial results |
| 6. Additional profiles | Melee/Training, additional sizes/builds/tilesets | Separately confirmed rules/init defaults; do not include only on the presence of the enum label |

This is the order of implementation; steps are not a statement of an existing code.

## Checks and readiness criteria

- Independent native fixtures confirm every structure, flags and default.Synthetic encoder→same decoder is not the only proof.
- Kind validation: mod does not receive terrain options; no-terrain map does not require t3*; extension flag is retained after reopen and is not added to conventional mod.
- Empty content: no copyrighted Objects, extraneous triggers/functions, donor strings/IDs, AI/cutscene/UI/import payloads. If the format requires empty bootstrap, this is a separate verified structural shell.
- Header/Info: equality of direct dependency specifications, locale/key consistency, correct fresh prefix fields and marker identities. Do not search dependencies for all CString runs Header: after the announced list are localized lines.
- Map: rectangular dimensions; minimum/maximum/step; MapInfo hash; vertex/cell/texture grids; base-height consistency; initial texture indices/weights; empty ramps/doodads/water bodies according to profile.
- Failure cases: missing dependency, cycle, unknown tileset, texture outside CTerrain, unsupported profile, too large allocator, existing destination, symlink/path escape, stale CASC build and source files, process interruption.
- Publication: dryRun and create use the same model/set bytes; directory/MPQ output is the same logical manifest; packed archive is reopened and compared for each entry.
- Integration: existing Terrain/Settings/Data tools can read the supported map foundation; existing module/profile tests continue to run.

Current constraint - do not run SC2 Editor - is maintained. Offline-ready and engine-tested statuses are separate. For future releases, codec/materialization/archive/SDK operations without UI can be confirmed; Editor save/reopen and game runtime receive `NOT_EXECUTED`00 until there is separate factual confirmation.

## Boundaries of the current result

The wizard link, parameters, mod subtype, dependencies, and the list of writers to be selected have been disassembled. Full fresh serializers/defaults of all binary layers have not yet been restored and implemented. Therefore, the `document.*` commands are not yet available, and the current MCP should not be declared capable of creating an arbitrary blank map without blueprint.

Next work is steps 1-2, then fresh MapInfo and initial flat terrain. Once the framework is implemented, a separate user team can create a blank document with the selected parameters, and then existing Terrain and Script will add surface and game behavior.

## Local implementation after the study

2026-10-11: added 10 document.* commands for fresh local empty profiles. Common metadata/version codecs, complete empty MapInfo, initial flat allocator, bounded CASC/local dependency/CTerrain resolution, validators and exclusive new-destination publication. Full native default fidelity, publish identity semantics and additional Melee/Training profiles remain separate gates. Current guidance: [DOCUMENT_CREATION_RU](DOCUMENT_CREATION.md)00.
