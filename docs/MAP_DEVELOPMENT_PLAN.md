# Plan: self-creation of SC2Map and full Terrain

Update alpha.13 from 2026-09-14: implemented flat water.create/update/remove on the native grid of 8 cells, water.material for CWater states, joint WaterData/Includes/Components transactions, MCP water.inspect/plan, XML WaterMaterial/Water/RemoveWater and GUI-actions of water. Additional enclosure: 9 native Nova cards (175 entries) and GitHub-card (18); together with researched 2 waves/pathite maps, all completed with clean ents.


Date: September 13, 2026 The plan is based on alpha.11 after a fresh static analysis of the provided SC2Editor_x64.exe and the components of the four source cards; execution continued in alpha.12. EXE editor did not start.

Execution Update: 11 `map.*`, Windows/Linux x64 archive helper commands added to the StormLib fixed revision, pack→reopen→content SHA-256 and MapInfo v39 core-prefix reader/writer with verification* Four source cards: 939 user entries checked. Persistently prepared/committed journal and lock process; checked process stoppage between rename and competition of two processes. Writers water bodies disabled as unconfirmed; non-empty, proven script*, blueprinted; and TRAM-free coverage is not yet supported below.

The order is fixed: ** the basis of the new map → full Terrain → scripts → final check in the editor and game**. Development of GUI triggers is excluded by user specification. Until the last stage, all checks are performed on files and through MCP.

## 1. The outcome we're going to get to.

I have to get a description of the map, create a new project, form a consistent set of native components, edit it through MCP and produce a ready-made `.SC2Map`.

First, we close the creation and the landscape. The game events, the winning conditions, the scripting logic and the script generation will be a separate step, the editorial and game verification will complete the entire cycle; it cannot be replaced in advance by successful XML parsing or MPQ packaging.

The first purpose of compatibility is provided by build 5.0.16.97563, MapInfo 39, Terrain 114/115 and explored variants of related binary components. Support for other versions is added through explicit profiles. "100%" means all claimed functions and rows of the matrix of this profile, with proof of verification; this is not a promise of support for all unknown engine variants.

## 2.What is established by the analysis of EXE and maps

### EXE: Confirmed and Restricted

- x64 architecture, version 5.0.16.97563.
- SHA-256: `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`. After analysis, the hash matched.
- PE contains dialog lines for creating `NewDocumentDialog`, `MapSizeWidthMenu`/`MapSizeHeightMenu` dimensions, `MapInitTextureButtons` initial texture, and playable bounds.
- For cliffs/ramps found `CTerrCmdAddCliff`, `CTerrCmdChangeCliffSet`, `CTerrCmdAddRamp`, `CTerrCmdRemoveRamp`, `cliffSetList`, `rampList`, `cliffCellList`, references to CliffData and CliffMeshData.
- For pathing, `PaintedPathingLayer`, `t3CellFlags`, add/remove/fill operations, ground, unpathable, no-build, dense, cliff, shallow/deep water, no-fly, and `GenerateWaterPathing` types are found.
- For water, the height and type settings are found, the `t3Water` component.
- For the archive, the diagnostic strings `SFileCreateArchive`, `SFileOpenArchive`, `SFileReadFile`, checksum/MD5 messages were found. This is the presence of text in the binary, not the found export automation.

| Component | RVA lines in this EXE |
|---|---|
| MapInfo | `0x36B13D8` |
| DocumentInfo | `0x36B13C8` |
| t3Terrain.xml | `0x36B1260` |
| t3HeightMap / t3SyncHeightMap | `0x36B1270` / `0x36B1290` |
| t3SyncCliffLevel / t3SyncTextureInfo | `0x36B1190` / `0x358E3D0` |
| t3CellFlags / t3HardTile | `0x36B12D8` / `0x36B12B0` |
| t3Water / PaintedPathingLayer | `0x36B12D0` / `0x36B1308` |
| t3VertCol / t3FluffDoodad | `0x36B12A0` / `0x36B12C0` |

The scanner used did not find validated references from the instructions to the selected lines: 0 verified instruction references. Therefore, the serialization functions, the values of all bits and the rearrangement algorithms from this analysis ** are not restored ** The scanner checks the limited link patterns and does not prove the absence of internal functions.

A static review of the import table showed only USER32.dll/MessageBoxW and the anomalous size of the import directory. Together with the lack of links found, this suggests protection, packaging or indirect addressing. The type of protection is not established; the actual import of the process was not investigated. No named export of card creation or writer Terrain was found.

The exact `t3SyncPathingInfo` token has not been found, nor has it been found in four maps, nor should it be a mandatory part of the hunch format. Local research specifications are useful as hypotheses, but the pseudocode and offsets from them must have origin and independent confirmation.

### Native maps: a fresh analysis of the original archives

| Sample. | MapInfo | Terrain | HigherMap grid | Ramps | t3Water |
|---|---:|---:|---|---:|---|
| Ant Colonies | 39 | 114 | 137×137 | 0 | 110, 32 bytes, both counters 0 |
| City of Tempest | 39 | 114 | 145×217 | 46, directions 0-7 | 110, 368 bytes, table 6, bodies 0 |
| Nydus Conspiracy | 39 | 115 | 33×33 | 0 | 110, 32 bytes, both counters 0 |
| Warships Takeover | 39 | 115 | 257×257 | 0 | 110, 32 bytes, both counters 0 |

All MPQ header is on offset 0, the wFormatVersion field is 3. In StormLib constants, it is MPQ_FORMAT_VERSION_4, that is, MPQ v4. The table sizes are the heightMap vertices, they can not be declared the size of the cards in cells without checking. For example, 257 vertices correspond to 256 intervals on the axis.

In XML, cliffs are stored in `cliffCellList/cc`; the absence of a tag with the literal name `cliffCell` does not mean the absence of cliffs. City allows you to explore all eight directions of the ramp; the value dir=0 occurs in the native sample and should not be prohibited due to the previous hypothesis.

`PaintedPathingLayer` was not found in the samples selected. Its presence in EXE does not reveal the layout of the file. Water bodies with a non-zero counter are not among the samples: rows of a table measuring 56 bytes cannot automatically be considered full-fledged bodies of water.

The extraction was done by a research reader for the selected entries. This is not a complete MPQ roundtrip or proof of support for all compressions/encryption. The JSON report contains source hashes, selected components, headers and observations; EXE and full maps are not included in the reportable ZIP.

## Current status of the project

alpha.11 contains 8 modules and 128 MCP commands. There is already height/texture editing, noise, smoothing, styles, XML, diagnostic previews, Placement, Data, Text, UI, Cutscene, AI and Browse. There is a common Workspace and source byte/hash saving protection. Latest release check: 205 tests, build/lint and portable MCP HTTP - PASS. Windows Editor/game - NOT_EXECUTED; in this work, the entire test set was not re-run because the code was not changed.

The main gaps regarding the objective:

| Direction | What remains? |
|---|---|
| New map | There is no complete map.create and writer MapInfo; copying donor Terrain does not create an arbitrary new map |
| Packaging | There is an external adapter protocol, but there is no complete working MPQ backend and check the reopened result. |
| Terrain | There is no complete change to cliff topology, native ramps, real water bodies, complete pathing, vertex color painting. |
| Coherence | There is no general graph for rebuilding Terrain derivative files |
| Transactions | You need journal/recovery, lock between processes, control file list changes and all binary readsets |
| Automatic assembly | There is no general declarative plan for a new map with a parameter compatibility check. |

Current water operations require an audit: the supported case of bodyCount=0 and 32+N×56 bytes does not confirm the creation of a real water region.

## 4.Stage A - the basis of the new map and SC2Map

### Register of evidence and formats

**Do:** For each field, fix build, source, offset/layout, confirmation method, and confidence. Separate "meeting line," "read in native map," "author confirmed," "engine verified." Prepare a four-card component body, including: `cc`, ramp and synchronized files.

On EXE, continue the targeted analysis of the read/creation chains only where it is possible to prove links: if the static copy does not give the code, continue the work on the case and independent readers; dynamic research of the editor postpone to the final stage; For unknown fields, leave the preservation of the original bytes and prohibition of unconfirmed recording.

**Ready:** Every transaction being executed has a verifiable basis; the unknown is not turned into a false default. **Dependence:** No.

### A1.Complete MPQ backend

**Solution:** small native helper on StormLib via the existing ArchiveAdapter; TypeScript remains the control layer. StormLib has an MIT license and API/constances for MPQ v4 and SC2 compression methods used. Lock a specific revision and retain the license; do not depend on the third-party CLI installed by the user.

** Make:** enumerate/inspect/extract/create/verify, JSON protocol and structured errors, Windows x64 binary in portable delivery; Linux build for local validation. Consider locale/platform, path normalization, encrypted/compressed entries, internal listfile/attributes, header/user-data and unknown archive members. Archive without recoverable full list of records do not declare lossless.

The modified card does not have to save the old signature as valid. System spreadsheets/checksums should be re-formed according to the profile. Workspace files, drafts, backups and reports should not be included in the package.

**Ready:** extract→pack→reopen on all four sources stores the contents of each user entry listed, including unknown ones, and correctly recreates service structures. Compare hashes of the contents of records, rather than requiring the same hash of the entire MPQ after compression. Incorrect result does not replace the target file. **Dependence:** A0.

### MapInfo and map document

** Make:** lossless reader/writer MapInfo v39: sizes, playable/camera bounds, tileset and other validated fields; unknown areas save. Then DocumentInfo, DocumentHeader and ComponentList: dependencies, logical roots, locales and indexes.

ComponentList is a list of component types/roots rather than a simple list of MPQ files. For example, GameData/GameText may refer to a tree. The generator must agree on types, file tree, and links; a binary DocumentHeader also requires a separate validated writer or valid template with understandable limitations.

**Ready:** read→write saves bytes without editing; address editing does not change unknown fields; related sizes/borders/tileset aligned. Unsupported version gives a clear error. **Dependence:** A0.

### A3 MapBlueprint and Minimum Clean Card

** Make:** a profile of a pure native project: mandatory components, defaults, dependencies and locales. First, a proven clean template with a limited size is allowed; then, generation from parameters without copying the script map.

The maps provided are script samples not verified by blank templates. You can't transfer their Objects, Regions, Data, and scripted Triggers to the "new empty map." If the format requires Triggers/scripture framework, only a proven minimum non-game framework is allowed; game logic generation remains at a late stage.

Initial height, cliff level, texture palette, masks, sync buffers and optional components must match the native profile. If clean defaults have not yet been proven, the result is called an experimental rather than a finished new card.

**Ready:** A clean project has a proven manifest, does not contain a donor script and is independently read. template limitations are visible in capabilities. **Dependencies:** A1, A2.

### A4. Map commands and creation from parameters

** Proposed contract:** `map.inspect`, `map.blueprint.list`, `map.plan`, `map.create`, `map.validate`, `map.export`. `map.resize` add after the general rearrangement of the grids to B1.

`map.plan` takes schemaVersion, compatibility profile, size, boundaries, tileset, dependencies, locales, initial height/cliff level/texture and outcome path. Returns the normalized plan, required components, capability gaps and change list. `map.create` executes the same proven plan in the new Workspace; `map.export` packs only committed snapshot and rechecks the package.

**Ready:** MCP creates a new map by parameters, opens with the same tools, edits and exports. No unwritten drafts are exported silently. Sizes are initially limited to proven profiles, arbitrary allowable sizes are included after B1. ** Dependencies:** A3; full version is also B1.

### A5 Single Transaction and Recovery

** Make up to mass Terrain writers:** Preparation log/commit/recovery, Workspace lock between processes, pin files and directory listing, single readset for XML/binary components/catalog dependencies. Secure file absence too. Check that file set, source bytes or dependencies have not changed after plan.

**Ready:** External editing or new file is detected; an accident restores the agreed state when saved.Temporary packet is published only after full commit/verify. **Dependencies:** Existing Workspace; A4 integration.

## 5.Stage B - Full Terrain

### General Terrain model.

** Make:** Separate vertex grid, cell grid, cliff/block grid and other resolutions; specify coordinate transformations and units. The model contains heights, cliff levels/sets, topology, ramp records, texture palette/weights, masks, water, authored pathing, vertex colors and associated placements.

XML/HMAP/sync/flags/hard-tile/texture-mask/water files are not supposed to be the same in dimension. Each is given version, stride, extent and proven invariants. Reader must store unknown entries/attributes.

**Ready:** All samples have internal coordinates consistent; no-op serialization retains components. **Dependence:** A0.

### B1 Reconstruction of Derivatives, Init and Resize

** Make:** Explicit dependency graph: height change/cliff/ramp/texture/water → dirty regions → necessary sync/flags/hard tiles/masks/XML. For unknown local rules, first secure complete restructuring of the validated component; incremental optimization enable later.

Empty grid generation and resize use the same constructor. Resize takes into account bounds, palettes, objects, areas, ramps and water; elements abroad are handled by an explicit plan policy.

**Ready:** After each operation, the independent reader sees the agreed sizes/references. Remodeling without changing the model doesn't make any sense changes. A4 gets multiple proven sizes, including rectangular. **Dependencies:** B0, A5.

### B2. Cliffs

**Commands:** `terrain.cliff.inspect`, `paint`, `raise`, `lower`, `setLevel`, `setType`, `validate`.

**Restore topology levels and rules, cliffSet/material/mesh selection, `cliffCellList/cc`, corner/edge variants, boundaries and hard tiles/sync/pathing pairing.

**Ready:** create and remove plateaus, internal/external angles, junctions, and multiple confirmed cliff types; adjacent cells and derived files aligned. Preview shows cliff levels/contours separate from elevation. **Dependence:** B1.

### B3. Ramps

**Commands:** `terrain.ramp.list`, `plan`, `create`, `update`, `delete`, `validate`.

**Do:** Start with 46 native City entries and directions 0-7. Explore hi/lo/base/mid, left/right variants, width/geometry and cliff identifiers; do not consider their meaning proven only by names. Check the permissible difference and neighborhood; rebuild heights, cliff cells, hard tiles and pathing.

**Ready:** All eight directions are created and deleted; ramp connects the desired levels, does not leave dangling records. cliff change under ramp is a general check and has an explicit re-create/deviate policy. **Dependence:** B2.

### B4: Real water bodies

**First:** audit current water commands and limit capabilities if 56-byte records are wrongly named bodies of water.The name/four floats do not prove the region, height or meaning of the parameters.

**Research:** You need a non-zero bodyCount source and preferably a "height only", "boundary only", "type only" pair. There is no such source now. Search in the available materials / case; if not, the writer bodies remain research-blocked until the final stage of obtaining native certificates.

**Teams after proof:** `terrain.water.body.list/create/update/delete`, `setLevel`, `setType`, `validate`. Separate bodies, waves, and other tables; link height, contour/region, material, shore, and pathing. For versions 104-110, first read/preserve; included on separate validated versions.

**Ready:** A real body of water is created with a given level/boundary/type and undergoes re-reading. Wave entry clone does not fulfill this criterion by itself. **Dependencies:** B1, non-zero body data; final engine validation is D.

### B5. Pathing

**Commands:** `terrain.pathing.inspect`, `paint`, `erase`, `fill`, `noFly.create/update/delete`, `validate`, `preview`.

**Do:** Set real persisted components and bits/enums. Separate hand-painted layer, Terrain geometric constraints, no-fly zones, and overlay footprints of hosted objects. Learn ground, unpathable, no-build, cliff, dense, shallow/deep water - only with validated coding of each type.

Direct editing of t3CellFlags requires saving unknown bits. The missing PaintedPathingLayer is created only after restoring layout. Do not invent the mandatory t3SyncPathingInfo. Engine navigation mesh and dynamic unit pathing are not passed off as fully restored static flags.

**Ready:** Manual constraints are maintained regardless of the derived layer; cliffs/ramps/water and footprints give a consistent result on the offline model. Preview shows the channel and the origin of the restriction. Real patency/construction is checked in D. **Dependencies:** B1; final integration of B2–B4.

### B6 Textures, colours and decoration

** Make:** bring the existing brushes/smooth/noise/style to work with the full model: palette replacement, weight and normalisation, texture/block sets, work near cliffs/ramps, texture masks. Add vertex-color painting for confirmed layout t3VertCol. Fluff/decor and cliff doodads edit through the established format and Placement, saving related records.

Altitude anti-aliasing must take into account the topology/ramp protected areas. Art style becomes a set of heights, materials, cliffs, water and decor parameters, rather than bypassing validation.

**Ready:** Repeated seed gives the same content of components; material does not go beyond the palette, normalization is correct, decor does not overlap the specified passages. **Dependencies:** B1-B5 on the channels used.

### B7: Assembling a map from a declarative plan

** Proposed commands: ** `map.build.plan`, `map.build.execute`, `map.build.report`.

The plan contains topology/biomes/passes/ponds/start points/decor and assignments to existing modules. First normalized and validated, then executed in one checkpoint. Unsupported operation returns the gap before writing. Natural language is translated into this verifiable plan; it doesn't go directly to binary writers.

**Ready:** One team builds a new map with Terrain, placements and available module contents, exports the package and gives manifest/report. Galaxy scripts are added in a separate subsequent step; development of GUI triggers is excluded. **Dependencies:** A4–A5, B1–B6.

## 6 Checks and the value of "ready"

| Level. | Verification | When |
|---|---|---|
| L1 | Header/layout/versions/sizes, bounded reading, no-op roundtrip | Now, while developing writers |
| L2 | Consistency of all components, indexes, references and boundaries | Now, after every operation. |
| L3 | Pack→reopen→enumerate→read/hash of all expected entries | Now, when exporting. |
| L4 | MCP create→edit→save→export→reopen, recovery/conflicts | Now, before we move on to scripts. |
| L5 | Editor open/save/reopen, comparison of normalization and visual results | Right at the end. |
| L6 | Game launch: pathing, construction, cliffs/ramps/water and game logic | At the very end, after L5. |

The matrix covers Terrain 114 and 115, several tilesets and sizes, a rectangular map, borders, all 8 ramp directions, different confirmed cliff types, empty and filled water, each supported pathing channel, combinations of ramp+water+painted pathing, export of unknown components and conservation errors.

For each status line: `NOT_IMPLEMENTED`, `RESEARCH_BLOCKED`, `OFFLINE_PASS`, `EDITOR_PASS`, `GAME_PASS`. The number of tests per se is not considered a percentage of coverage of functions. Before L5/L6, it is permissible to say "file-ready" but not "100% verified in-game."

## 7 Late stages

**C — Scripts:** A separate `script.*` module for Galaxy: file/includes research, map scripting framework creation, functions/types/variables and entry points, placement/region references, dependency-aware plan, script generation and verification. Without GUI triggers and Triggers document editing. The existing native Triggers component is stored as opaque data when working with other people's cards. Detailed contract is planned after A/B to rely on ready-made IDs.

**D is the final check:** The editor opens/saves the maps undamaged; compares the components it has changed and returns the corrections to the writers; then the game checks the patency, ramps, water, construction, placements and scripts. If there are unknown layouts on B4/B5, we get native control samples and close the studies until full coverage is announced.

So the final test is indeed the last, and the absence of non-zero water samples now remains a clear limitation of the plan: promising a completed water writer before obtaining evidence would be wrong.

## Specific development queue

| № | Work. | Verified result |
|---:|---|---|
| 1 | A0, corpus and water capabilities audit | Register of known/unknown fields; accurate description of current support |
| 2 | A1, MPQ helper | Four Archives Complete Entry Roundtrip |
| 3 | A2, MapInfo/document | Lossless No-Op and Addressed Metadata |
| 4 | A5, preservation/recovery | Consistent multi-file commit and conflict |
| 5 | A3+A4 limited to clean blueprint | New clean map via MCP in a proven profile |
| 6 | B0+B1, grids/init/derived/resize | Multiple size generation and coordinated components |
| 7 | B2, cliffs | Complete change of levels/topology/types |
| 8 | B3, ramps | Create/update/delete in areas 0-7 |
| 9 | B4, water | Confirmed bodies or honest research-blocked status |
| 10 | B5, pathing | Confirmed manual/geometric channels and no-fly |
| 11 | B6, registration | Full integration of textures/styles/colors/decor |
| 12 | B7 and L1-L4 | Automatic assembly of a new card, package and report |
| 13 | C, scripts | Galaxy script on top of finished map, no GUI triggers |
| 14 | D, L5-L6 and corrections | Confirmed compatibility with editor and game |

Numbers are order of execution; A/B identifiers link work to dependencies; Water/pathing research can be done in the early stages, but only write after confirmation; deadlines have not yet been set: the main unknown volume is the recovery of bodies/pathing and native defaults, not the number of MCP commands.

## 9.The sources

Local primary sources: provided by EXE and the four original SC2Map. The evidence for the current analysis is in the accompanying ZIP: `editor-map-terrain-evidence.json`, `native-map-component-evidence.json`, summary files, PE inspection and reproducible analyzers. Re-run requires source files and local research helpers of the project; the reported ZIP itself is not a standalone decompiler.

For the selected archive backend, the official sources are checked:

- StormLib API, versions, compression and verify flags: https://github.com/ladislav-zezula/StormLib/blob/master/src/StormLib.h
- Implementing the Archive: https://github.com/ladislav-zezula/StormLib/blob/master/src/SFileCreateArchive.cpp
- License: https://github.com/ladislav-zezula/StormLib/blob/master/LICENSE

The references to the master reflect the validation of 13.09.2026; the implementation requires a fixed revision; Terrain local specifications without confirmed origin are not used as proof of the restored EXE code.
