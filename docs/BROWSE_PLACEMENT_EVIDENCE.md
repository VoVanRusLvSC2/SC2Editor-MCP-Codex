# Evidence and limitations — 2026-09-13

## Actual source audit

The implementation continues the existing `sc2editor-mcp` package, not a new repository or experimental executable. Baseline: `1.1.0-alpha.5`, one TypeScript package, existing core/schema/MCP/GUI and ui/cutscene/text/data modules. Baseline source used: `/workspace/scratch/0f9999397929/sc2editor-mcp-data-only/project/sc2-ui-mcp-starter`. Active working copy: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex`. No git repository/AGENTS.md was found in that project; original source and test-map archives were not edited.

Relevant registries and evidence already existed in `schema/`, `generated/data-editor-schema.json`, `data-observed-schema.json`, `editor-build.json`, `editor-rtti-cutscene.json`, `text-editor-evidence.json`, `ui-editor-evidence.json`; existing lossless editing and adapter tests were retained. `generated/editor-build.json` retains its historical source path; the new evidence file records the actual EXE checked now.

| Item | Actual finding |
| --- | --- |
| Used EXE | `/workspace/scratch/0f9999397929/upload/SC2Editor_x64(1).exe` |
| Size | 76,470,480 bytes |
| Version | 5.0.16.97563, SC2Edit Retail, x64 |
| SHA-256 | `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164` |
| Decompilation database/export | `NOT_AVAILABLE_LOCALLY` |
| New read-only EXE verification | `generated/browse-placement-evidence.json` |
| Local secondary format reference | `/workspace/scratch/0f9999397929/research/sc2-map-editor-mcp/packages/sc2-core/src/mapdata/objects.ts` and corresponding mutation/tests/docs |
| Standard unpacked SC2 catalog/assets corpus | `NOT_AVAILABLE_LOCALLY` in this workspace; callers must configure available unpacked roots |
| MPQ archive adapter | Not configured; existing protocol preserved |
| SC2Editor automation / Windows runtime | Not available in this Linux session |

Real archives found include `/workspace/scratch/0f9999397929/research/maps/RG-test.SC2Map`, `Tya-Zerg-Defense.SC2Map`, `aaUberlisk.SC2Map`, `research/EditorTest-2012.SC2Map`, and Blizzard tutorial attachments/maps under `research/blizzard-tutorials`. They were located but not extracted, rewritten or falsely counted as placement test passes. No real before/after editor pair was available as an unpacked Objects corpus.

No full EXE decompilation was repeated. Existing reports were read first; a supplementary read-only PE/string scan used the existing project's extractor. Exact vocabulary offsets are recorded in generated JSON. For example, PlacedObjects=57366824, ObjectDoodad=57366840, ObjectUnit=57366856, UnitType=57367168, HeightAbsolute=57367888 (decimal file offsets). Presence in a serialization-looking string cluster corroborates vocabulary; it is not recovery of the writer's rules.

## Rule-by-rule evidence table

| Rule / claim | Classification | Evidence and boundary |
| --- | --- | --- |
| EXE version/hash/architecture | PROVEN_BY_EXE | Current PE resources/header and SHA-256 |
| PlacedObjects/ObjectUnit/ObjectDoodad/UnitType/HeightAbsolute names exist | PROVEN_BY_EXE | Exact strings and offsets, vocabulary only |
| CActorDoodad exists in editor | PROVEN_BY_EXE | Exact class-name strings; not proof every Actor is placeable |
| Objects component is plain XML with PlacedObjects | INFERRED | Local reference code describes real maps; our fixture round-trip is not independent real-map evidence |
| ComponentList `plob` maps to Objects | INFERRED | Same secondary reference and fixture |
| ObjectUnit uses UnitType; ObjectDoodad uses Type | INFERRED | Reference samples plus EXE vocabulary; actual editor writer not tested here |
| Position is comma-separated X,Y,Z | INFERRED | Reference sample and fixture parser; coordinate origin/axis/terrain rules not recovered |
| Rotation is radians | INFERRED | Reference example 5.514; exact runtime unit not independently tested |
| Scale is X,Y,Z triple | INFERRED | Reference examples and fixture tests |
| Z / terrain-relative height defaults | UNKNOWN | Z is written literally; HeightAbsolute semantics not recovered |
| Owner Player / Variation / HeightAbsolute flag | INFERRED | Reference samples; arbitrary tint/flags/custom names disabled |
| IDs are positive signed32; max+1 is safe allocation strategy | INFERRED | Conservative reference-supported policy, not recovered editor allocation algorithm |
| Existing order retained; new objects appended | INFERRED | Chosen source-span editing policy, no editor-save ordering proof |
| Required attributes/default omission rules | UNKNOWN | This writer emits ID/type/position, optional demonstrated fields; completeness is not proven |
| Editor-save normalization/order/version upgrades | UNKNOWN | Editor save not executed |
| Catalog objects/text/path literals in fixture | INFERRED | Synthetic regression data, not standard game install evidence |
| XML bytes outside selected edits survive fixture operations | INFERRED | Automated fixture regression/round-trip tests; not PROVEN_BY_REAL_MAP/EDITOR_ROUNDTRIP |
| Dependency declarations resolve configured roots | INFERRED | Synthetic DocumentInfo integration tests; remote/version conflict handling unavailable |
| Editor-open/save, visual placement, runtime acceptance | UNKNOWN | NOT_EXECUTED |

`PROVEN_BY_REAL_MAP`, `PROVEN_BY_ROUNDTRIP` and `SUPPORTED_BY_DECOMPILATION` are intentionally not awarded to placement semantics in this run. Automated parser reparse is reported separately from an editor round-trip. Returned placeable representations carry INFERRED evidence rather than invented certainty.

## Remaining gaps

- No native CASC/MPQ reader, archive rewrite or automatic installation mounting; browse currently needs unpacked catalogs/loose assets. It does not bundle proprietary standard assets.
- Cached index is in memory, with snapshot-level rebuild on invalidation, not persistent per-file incremental indexing. New staged files not present on disk require save/refresh. Paths/mtime/size fingerprints cannot detect an external same-size edit with forged unchanged mtime.
- Inheritance uses existing Data MCP's parent-chain semantics. Engine defaults, same-ID layered merges, ambiguous inherited parents and dependency version conflicts remain limitations.
- Some typed value links are heuristics marked INFERRED; Model material/texture dependency decoding is not implemented. Asset reference paths do not prove binary asset availability.
- Usage covers indexed definitions, not every map/archive/Trigger/Galaxy object ID reference. Removal warns instead of claiming reference repair.
- Bounds require caller-supplied verified dimensions. Spacing concerns planned centers only; no existing-object collision, model footprint, terrain height or pathing proof.
- Location presets are object-based search/layout recipes. They do not paint terrain, make fully functional cities, create road terrain, or place gameplay units automatically.
- Plans/idempotency/undo are not restart-persistent. Backup rollback is one generation and cannot recover absence of newly created files without a pre-existing backup.
- GUI API and stdio MCP are tested; browser visual QA, Windows executable launch and SC2Editor open/save were not performed here.

The code is a functional alpha foundation, not fulfillment of all real-map/editor/runtime completion criteria. To close those criteria, supply unpacked standard dependency catalogs/assets and a real component map (or configure the existing archive adapter), then run the supplied demo on a copy and perform editor open/save/in-game probes separately.
