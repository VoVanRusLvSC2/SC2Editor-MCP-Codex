# Implementation / test report — alpha.6

## Result

Browse and separate Unit/Doodad placement are integrated with the existing server/core/GUI. Universal `placement.createLocation` handles themes rather than exposing a forest-only API. 25 new MCP tools, generated input schemas, reproducible scripts and Russian instructions are included. This is a functional alpha, not a claim of editor/runtime-ready map generation.

## Files changed

- `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`
- `src/index.ts`, `src/mcp/uiServer.ts`, `src/core/capabilities.ts`
- `src/modules/browse/{types,workspace,tools}.ts`
- `src/modules/placement/{types,document,planner,workspace,tools}.ts`
- `src/gui/{api,server}.ts`, `src/gui/public/{index.html,styles.css,app.js}`
- `src/tests/{browseModule,placementModule,browsePlacementTransport}.test.ts`
- `src/tests/fixtures/browse-placement-map/` (synthetic catalogs, two locales, Objects and ComponentList)
- `scripts/{audit-browse-placement,demo-browse-placement,generate-browse-placement-schemas,verify-browse-placement}.ts`, `scripts/build-windows-portable.mjs`
- `generated/browse-placement-{tools,evidence,test-report}.json`
- `docs/ARCHITECTURE.md`, `docs/CODEX_GUIDE_RU.md`, `docs/BROWSE_PLACEMENT_{MCP,CODEX_RU,EVIDENCE,REPORT}.md`
- `examples/browse-placement/README.md`, `examples/browse-placement/runs/demo-72Uc1f/` (working copy, backups and response traces)

Core XML editing, Data/Text/Cutscene implementations and original schemas were reused, not rewritten. Existing aliases and CLI remain unchanged.

## Executed checks

Baseline: 111 automated tests passed. After integration and safety changes: 135 tests passed, 0 failed, 0 skipped, including 24 added tests. TypeScript build, ESLint and Windows portable cross-build passed. Reproduce all four checks with `node --import tsx scripts/verify-browse-placement.ts`; complete command logs and separate editor/runtime NOT_EXECUTED statuses are in `generated/browse-placement-test-report.json`. These are local automated checks, not SC2Editor acceptance.

| Requested check | Executed result / qualification |
| --- | --- |
| Unit search by ID, localized label | PASS — synthetic fixture |
| Doodad search, Unit/Actor/Model/path chain, Doodad/Model/path chain | PASS — synthetic fixture; no real asset binaries bundled |
| Multiple source roots, same IDs, missing/undeclared dependency | PASS — synthetic integration tests |
| Unknown catalog class | PASS — generic representation retained |
| One Unit and one Doodad | PASS — fixture Objects format |
| Batch line/grid/circle | PASS — deterministic position planner; Unit line apply also exercised |
| Scatter seed, exclusions, spacing | PASS — synthetic coordinates |
| Move/rotate/scale/remove | PASS — fixture source-span regression |
| Duplicate IDs / bounds | PASS — rejection tests |
| Dry-run, backup/apply/reparse | PASS — fixture copy only |
| Unknown XML attributes/children | PASS — fixture preservation regression |
| Repeat same plan/request | PASS — same server session only |
| Stale map between plan and apply | PASS — rejected without file mutation |
| Rollback dry-run / both staged components | PASS — fixture regression |
| Forest/desert/city createLocation | PASS — fixture candidates, seeded plan and reserved-city-corridor assertions |
| GUI routes and invalid numeric input | PASS — API integration; browser visual QA NOT_EXECUTED |
| Same launcher stdio MCP registration/call | PASS — child process initialization, tools/list, browse.search, placement.addUnit and dry-run apply alongside old tools |
| Actual EXE version/hash and vocabulary | PASS — read-only scan, no decompilation |
| Real MPQ-map full demo | NOT_EXECUTED — adapter and unpacked standard dependency corpus unavailable |
| SC2Editor open | NOT_EXECUTED |
| Editor save/reopen comparison | NOT_EXECUTED |
| Visual verification of placed objects | NOT_EXECUTED |
| Runtime/in-game | NOT_EXECUTED |

## Demonstration

Executed `npm run browse:demo`. Working copy: `examples/browse-placement/runs/demo-72Uc1f`. Actual traces: `DEMONSTRATION.json`, with search results, links/model path literals, plans, structured operations, source diffs, dry-run/apply results and scan.

The script found a Unit through the Marine query, not a hardcoded placement ID, and a Doodad through tree/rock/plant/light queries. It added a four-unit line and twenty seeded decorations with 1.5 center spacing, scale 0.85..1.15, explicit fixture bounds, dry-runs before writes, backups, reparse and preservation checks. XML/reparse passed and original object attributes/flags survived. Existing unknown child preservation is additionally covered by regression tests.

This demonstration is `SYNTHETIC_FIXTURE_NOT_A_REAL_MAP`. The real-map requirement is open. The copy is not a complete terrain-bearing map and must not be advertised as editor-openable. Use `npm run browse:demo -- /path/to/unpacked-real-map` with declared/catalog roots and adapted verified coordinates to run a real copy scenario.

## Readiness by subsystem

| Subsystem | Honest readiness |
| --- | --- |
| Asset discovery | Functional for unpacked physical/reference paths; native installed CASC/MPQ discovery absent |
| Catalog search | Functional ranked/localized fixture-tested alpha; full standard corpus not tested locally |
| Dependency resolution | Local declaration/transitive-root resolver; remote/version/layer ambiguity limited |
| Unit placement | Functional plain-XML fixture-tested alpha; real editor validation outstanding |
| Doodad placement | Functional CActorDoodad/plain-XML fixture-tested alpha; real editor validation outstanding |
| Automatic location generation | Functional seeded object-based presets; not terrain/collision-aware world generation |
| Lossless round-trip | Automated fixture XML reparse/preservation verified; real editor round-trip not performed |
| SC2Editor compatibility | NOT_VALIDATED |
| Runtime compatibility | NOT_VALIDATED |

## Build / audit paths

Source: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex`.
Portable build target: `release/SC2-UI-Workbench-Windows/SC2-UI-Workbench.exe` in that project. The Linux cross-build requires Windows Node.js 20+ installed or supplied in runtime/node.exe; Windows launcher execution is not tested here.
EXE audit/decompilation/hash and rule classifications: `BROWSE_PLACEMENT_EVIDENCE.md` plus `generated/browse-placement-evidence.json`.

No false PASS is assigned to map/editor/runtime checks that were not executed. The original source/maps remain intact; generated artifacts are supplied for continued real-map validation, not as a completion certificate.
