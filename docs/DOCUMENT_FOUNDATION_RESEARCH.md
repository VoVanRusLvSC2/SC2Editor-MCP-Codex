# Exploring the Creation of a Map Base and Fashion

In SC2 Editor, document creation consists of type selection, dependency adjustment, and, for the map, the initial Terrain configuration. This is a separate task from editing the finished map. The sources studied allow you to specify the model of the new module and determine the mandatory fresh writers; they do not yet confirm the full serializer of all initial states.

The main result is [Implementation of the document module](DOCUMENT_FOUNDATION_PLAN.md). Verified scalar facts, offsets, SHA and source boundaries are in [document foundation evidence](../generated/document-foundation-evidence.json). Raw archives, game XML, recovered C bodies and machine listings remain in the ignored `work/document-foundation-research`.

## Sources and versions

| Source | Volume tested | What does he confirm? |
| --- | --- | --- |
| Sent sanitized ZIP | 2545 entries; eight selected metadata/DMP-derived partitions match bytes to local set | Available canonical symbols, source provenance, state of studied dump |
| Canonical reverse database | Schema 48, SC2Editor 5.0.16.97563 | Master lines, address areas and code body candidates |
| Original recovered C export | Seven target addresses are verified using the read-only pseudocode index | Page transitions, mod branch and noted export damage; parts of bodies missing |
| Offline runtime-ghidra image | Bonded CFG four target functions; image SHA fixed | Noreturn annotations, factory calls, request fields |
| CASC set-up game | SC2 5.0.17.98310; EditorLayout, EditorData, localization, native mod metadata and TerrainData | Current controls, subtype flag, real directories and component manifests |
| Native DocumentHeader | supplied map, native mod, native extension mod | H2CS v8 profile, dependency and locale sections up to EOF |
| Current MCP | Composition main e4a6ff8 and existing Map/Terrain/Settings writers | What you can reuse and what you can’t to build a foundation from scratch |

The archive does not contain the raw `.DMP`. It contains its disassembled JSON/SQLite evidence. Further verified known SC2 directories, exports recovered and the original location of the dump; available raw SC2Editor dump is not found there. Inaccessible alien temp folders and dump of other applications are not investigated as SC2 evidence.

DMP provenance points to dump on August 21, 2026. Its active document list contains maps already opened; viewed stack/global/editor graph exports do not contain positive named NewDocument evidence. From this image, you can not extract and declare the state of the wizard when creating an empty map. General graph/RTTI snapshot does not replace code/body/profile verification.

## Master and transitions

EditorLayout from Core contains `NewDocumentDialog` with 35 labels.

- Type pane: five types of documents and description.
- Dependency pane: Standard/Custom, expansion, Campaign checkbox, custom list, streaming status and automatic multiplayer policy.
- Map pane: Width/Height, derived playable size and size description, Use Terrain, Texture Set, Initial Texture, shared TerrainHeightControl, reset.

In recovered `0x9eff80` getter runs through five radio entries. `0x786880` saves the selected type and checks dependencies before continuing. For ordinal 3/4, the last page has index 1; for the rest, index 2. Together with labels, this confirms the "type → dependencies" scheme for the mod and an additional map page for the card. UI layouts describe the controls available, but do not themselves define native binary defaults.

The creation families diverge in `0x785fc0`: the map request is sent to the `0x3b0c40` factory, the mod request is `0x3b0f70`. They allocate various objects, initialize the common component and perform a further setup chain. Only the name of the factory address is not considered restored by ABI. The plan uses file serialization, rather than calling these addresses in a working editor.

## Ghidra export error and machine sequels

In exported C functions, general allocation/string-init/free helpers are labeled `Subroutine does not return`. Therefore, for example, the body of the mod factory shows only allocation, and the part of the New Document map branch ends immediately after string initialization.

Bonded machine CFG restores call/fallthrough/conditional jump continuations, eliminates padding and does not declare indirect receiver type by numbers. New Document creation, mod factory, map factory and map parameter transfer. Sources and exact byte spans C export are recorded separately; the absence of indexed body in map transfer is stored as a separate status.

Code addresses and static metadata differ. Generated report indicates recovered RVA, source ghidra VA and coordinate offline image; static string tokens use native static RVAs. Automatic application of `+0xF00000` to all addresses, runtime invocation by someone else's build and transfer offset to installed 5.0.17 without verification is not allowed.

## Extension mod

In New Document creation ordinal 4 sets an additional request bit 1. In a mod factory, this bit becomes the `0x8` argument for a general metadata setup. It is the **setup argument**, not the arbitrary bit in the packed DocumentHeader.

The real installed-game `mods/mutators/mutatoraggressivedeployment.sc2mod/documentinfo` contains `Flags/Value = ExtensionMod`. There is also `PublishPrivate`, a proprietary icon and content dependency: these values refer to the studied mod and are not defaults of any new extension mod.

The conventional mod, extension mod and maps studied have the same value of prefix word Header on offset 8: 21298. Consequently, adding `0x8` to this word on the basis of an intermediate factory argument is mistaken. A separate DocumentInfo Flags writer should create ExtensionMod token; remaining header fields are investigated independently.

Native mod manifests do not declare `mapi` or `terr`. This implies a separate mod foundation profile and a separate validation branch. The presence of `.SC2Mod` in the folder name does not allow it to be interpreted as a zero-size card.

## Parameters of the map base

Reading Width/Height in machine transfer records `selectedIndex*8+32` in request fields `+0x20/+0x24`. The exact set of points, the initial selected index and the reset preference still need to be associated with the populate path. The current independent MapInfo v39 codec accepts no more than 256 cells; the first planned profile is limited to 32..256 in 8 increments and explicit size.

Use Terrain sets/clears the request bit 1 in another field (`+0x1c`): it is a ** different object and another role**, not an extension bit mod request.

CTerrain string falls into request `+0x28`, initial texture into `+0x58`, shared height control fills `+0x88`. String offsets refer to request, not to `t3Terrain.xml` disk serialization. For this version, the source default base height is 8.0; initial floated strength/variability is 50/50. Random Height control exists, but the user has limited the current stage to an empty base, so its generation is not included.

The p.SC2Map user map is a reference of supported formats, not a blank blank. It has 128×128 cells, Terrain v115 and BelShirEx1, but it already has modified cell flags/cliffs and full-time melee actions. It is not suitable for "copy and get an empty card."

## Initial Actions by the Editor

Core EditorData contains DefaultTrigger with map-init event and four melee initialization actions. This explains why a new editor map can include Triggers and a generated MapScript even without an author's script. The p.SC2Map read contains such a staff structure.

For `initialization:empty`, the minimum required script/trigger shell must be defined separately, neither run nor port the melee initialization to an empty profile. Self-authored script, units and landscape are added later and are not included in the current framework.

## Dependencies

The current lines of the wizard directly specify incompatible multiplayer combinations: automatic expansions eliminates explicit multiplayer dependency, fixed multiplayer requires an appropriate package, several multiplayer packages are not accepted.

CASC confirms the actual package metadata and TerrainData. Not every builtin package has a separate DocumentInfo in the ROOT: implicit/native dependency tables are also needed. In XML, you should save direct dependency specs in order; expanded closure and actual local availability return separately. The `bnet:...,file:...` corroborates [DocumentInfo research](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/document-info.md) format, but this source does not list the entire Editor Flags schema.

From Liberty/Void extracted 24/60 authored CTerrain rows. There are inheritance, default rows and repeated overrides. Resolver should not add two lists and declare each row ready tileset. Required blend textures and related definitions are checked after dependency ordering and inheritance resolution. Names missing in the selected graph are not accepted just because they are found in the general CASC index.

## Real Header profile

The three files studied have magic H2CS and version 8. Parser with bounds checks read 48-byte prefix, count by offset 44 and an exactly specified number of dependency CStrings, followed by localized metadata table. In the table - uint16 byte lengths, UTF-8/value and four bytes of locale FourCC. Each file is disassembled to an accurate EOF.

This is **observable profile**, not universal serializer. Prefix contains additional fields and repeated identity/hash values; their fresh values cannot be taken from someone else's document. Localized strings are not dependencies. Native H2CS dependency count/encoding differs from the given [game-client Header reader description](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/document-header.md); it is impossible to transfer its writer without fixture layout check.

## What remains to be learned before implementation

| Node. | It already is. | The following specific evidence |
| --- | --- | --- |
| Type dispatch | 5 labels, 3/4 skip map pane, different factories | Exact init policy for Arcade/Melee/Training and applicability of dependency mode |
| Mod subtype | Factory bit flow and real Flags/ExtensionMod | Common DocInfo defaults writer and its relationship to marker/header fields |
| Dependencies | UI restrictions, native direct specs, current CASC sources | Preset table, expanded order, optional multiplayer persistence and missing package policy |
| Header v8 | Native parsing to EOF on three files | Fresh prefix/identity/hash/localization builder, zero-content profile |
| Version files | Existing 44-byte fixture and format references | Writer tags, build/identity/hash update rules |
| MapInfo | Verified v39 core reader/hash and selected player field patches | Complete init + serializer for players/teams/bitsets/lighting without donor tail |
| Initial Terrain | Existing edits and component readers, CTerrain sources | Flat allocator defaults of all layers, borders, sync consistency |
| Empty content | Logical roots and DefaultTrigger origin | What Empty Roots/Bootstrap Are Required for Kind; How to Avoid Default Gameplay |
| Publication | Existing guarded map template creation and MPQ compare/reopen | Separate new-document staging/publication by kind without clone semantics |

These items are included in the implementation plan with checks and capability gates. The absence of a runtime writer can not be closed with the generic raw operation marking or a single synthetic round-trip.

## Reproduction

`scripts/analyze-document-foundation.py` reads source code in read-only mode and generates factual report. Python, `pefile` and `capstone` are required for offline machine checks. Args accept paths to sanitized reverse directory, original ZIP, pseudocode index/root, matching offline image, local CASC researchshots and supplied component snap directory. All paths are transmitted explicitly; bodies/dumps are not added to Git.

Example of team form:

```text
python scripts/analyze-document-foundation.py
  --reverse <sanitized-reverse-directory>
  --archive <supplied-zip>
  --pseudocode-root <recovery-root>
  --pseudocode-index <read-only-index.sqlite>
  --offline-image <matching-runtime-ghidra.exe>
  --map-components <supplied-map-components>
  --research work/document-foundation-research
  --output generated/document-foundation-evidence.json
```

The script does not run SC2 Editor, does not read the running process, does not call the factory address, and does not change the original game/map files. Re-run on the same sources should produce the same JSON. In the plan/coverage, the fact of the study is separated from the future ability of `document.create`00 to create a file.
