# Data + Scripts/Triggers authoring: up-to-date acceptance, 2026-09-29

Working tree: `E:\SK2\SC2Editor_MCP_Codex`. This document is ** the only current matrix F01-F22** for authoring. The old `docs/mcp-hardening/CONTINUATION_2026-09-29.md` files and other reports are from the previous stage. There have been numerous changes in the original tree; they have not been reset or committed.

PASS statuses mean only the adjoining verification. XML/static analysis status does not equal successful compilation of Editor or game behavior.

| ID | Status. | Evidence and boundary |
|---|---|---|
| F01 | PASS | `dataAuthoring.test.ts`: Three cases of the original `probe.mjs` through this `createProject` are rejected to staging. |
| F02 | PASS | The new unknown field is deflected strictly, the unchanged unknown XML is retained; permissive only with explicit `authoringPolicy:"compatibility"`. |
| F03 | PARTIAL | XSD inheritance, inline members, enum/facets, and typed links are validated for modified XML; full engine combinations/defaults are not proven. |
| F04 | PASS | Absent purpose and incomplete dependency scope give different codes; tested by the test. |
| F05 | PARTIAL | Existing effective model stores source/unknown, but runtime layer order, some reset/override forms are not proven. |
| F06 | PARTIAL | Numeric/enum/unindexed/nested fields and raw declarations are retained; the complete merge rule of each array is not proven. |
| F07 | PARTIAL | `data.batch` atomically creates/edits multiple directories and verifies future link/alias; dependency-aware clone and multi-file destructive plan are not yet available. |
| F08 | PARTIAL | Existing scope-aware function rename distinguishes between local shadow and field; the full Galaxy symbol table is not ready. |
| F09 | PARTIAL | Scenario C now receives VERIFIED_SUBSET for locals, scopes, while, operators, compound assignment and native calls; arrays, structures, for/do/switch and full language are not verified. |
| F10 | NOT_RUN | There is no Blizzard compiler/Editor adapter. `SC2Editor_x64.exe` is installed, but there is no verified headless interface; CLI flags were not invented. |
| F11 | PARTIAL | 3,196 NativeLib FunctionDef and 230 zero-arg native expressions are indexed; root serializer remains limited to supported forms. |
| F12 | PARTIAL | Nested typed return calls and IfThenElse with NativeLib SubFuncType are structurally validated; loop with variable, local and custom functions are not implemented. |
| F13 | PARTIAL | Existing graft retains a portion of closure/IDs; full copying of local strings/libraries and conflicts is not proven. |
| F14 | PASS | The GUI path changes Triggers, the Galaxy path changes the original .galaxy; the need for Editor regeneration and compiler NOT_EXECUTED is reported explicitly. |
| F15 | PARTIAL | Existing typed cross-reference rename updates GUI/Galaxy consumers and stores unrelated text; there is no single Data+GUI/Galaxy plan API. |
| F16 | PARTIAL | Known dynamic/unknown consumers block dangerous rename/delete; unknown external carriers remain the limit of analysis. |
| F17 | PARTIAL | `data.plan/apply_plan` pinning source, consumers and XSD; the general version of GUI/Galaxy/compiler/config is not assembled in one plan. |
| F18 | PARTIAL | Existing recovery/fault tests pass; failure in the middle of the *common* Data+GUI+Galaxy plan is not verified because there is no such plan. |
| F19 | PARTIAL | Five isolated component copies of A–E and `REPORT.json` have been prepared; the full terms of each script and Editor/game have not been checked. |
| F20 | PASS | Portable stdio initialize/list/call, 187 tools, strict data rejection/plan/batch. |
| F21 | PASS | Final `npm test`, `npm run lint`, `npm run build:release`, portable build/smoke: see the verification section below. |
| F22 | PASS | Editor/game explicitly NOT_RUN, XML is not presented as game proof. |

Real supported new forms: Data `object.create/clone`, existing field/array/native operations, future links in a single file and between catalog files via `data.batch`; typed XSD/facet/enum/reference checks for authored delta. Galaxy: lexical structure, includes/cycles/arity, numeric/string/bool argument types, simple assignments, return/conditions, rename. GUI: 3196 descriptions for search, nine original FunctionD root checks, 2Lype's serial returns, 2Lype's verifiable return language.

Migration: `data.apply` Now strict by default and rejects missing typed links, new unknown fields and erroneous XSD values. `authoringPolicy:"compatibility"`; the answer still contains `authoring.accepted/status/completeness/diagnostics`. `allowInvalid:true` and `validate:false` They don't turn off strict authoring. `validation.valid` stored for the old static area and does not mean Editor/game success. MCP Data rejection returns structured `accepted:false`, code and diagnostics. `data.plan` always strict, `data.apply_plan` checks the freshness, `data.batch` Always strict and returns the general diff.

Five copies are in `generated/authoring-scenarios-20260929-r2/{A,B,C,D,E}/components`, the report from SHA-256 is `generated/authoring-scenarios-20260929-r2/REPORT.json`. Recreate from the original native fixtures: `npm run build`, then `node scripts/prepare-mcp-hardening-editor.mjs generated/mcp-hardening/editor-authoring-20260929` in the new empty path, then `node scripts/prepare-authoring-scenarios.mjs` in the new empty output. Current output paths are already occupied; scripts deliberately refuse to overwrite them.

- **A:** `data.batch` creates separate Unit/Weapon/Effect/Behavior/Validator/Actor/Model directories and periodic damage. Negative: missing Effect rejected. BNet dependencies of original native fixture and real M3 asset untested; authoring `INCOMPLETE`, Editor/game `NOT_RUN`.
- **B:** `data.batch` creates AbilEffectInstant, two Damage, Set, Validator, cooldown and Unit binding. Negative: missing Effect rejected. BNet dependency scope `INCOMPLETE`, Editor/game `NOT_RUN`.
- **C:** script.plan/apply/save creates a Galaxy module with the parameter, local, while, if/else, return and native call. Bounded typecheck is now VERIFIED_SUBSET (unknown=0) for this form; incorrect return/native argument/condition/operator and output from the local scope are rejected by regressions. InitMap is absent in native fixture; compiler/Editor NOT_RUN.
- **D:** `trigger.plan/apply/save` creates Event and IfThenElse with typed condition, nested return call, then/else. Negatives are missing condition and wrong type of nested argument. Loop/local/custom function `NOT_IMPLEMENTED`; Editor `NOT_RUN`.
- **E:** `data.batch` creates Unit, `script.plan/apply/save` adds the well-known Galaxy carrier `UnitCreate`, `data.apply` typed rename updates the string argument. These are sequential operations, not one joint plan. E in an isolated copy removed BNet dependencies only for a static rename test; this is not Editor-ready real mod.

Checks after the last change (update to the actual exit code): `npm test` — 0, `npm run lint` — 0, `npm run build:release` — 0, `node scripts/build-windows-portable.mjs release/SC2-MCP-Authoring-20260929-r3` — 0, `node scripts/smoke-project-portable.mjs release/SC2-MCP-Authoring-20260929-r3/app` One test of Windows archive shell fixture is skipped by the original condition. `generated/project-portable-smoke.json`. Verification logs and per-step exit codes: `generated/authoring-acceptance-20260929/verification.json` and adjacent `npm-test.log`, `lint.log`, `release-build.log`, `portable-smoke.log`. The report records 345 tests (344 pass, 0 fail, 1 skip), SHA-256 of key inputs and outputs, and compiler/Editor/runtime NOT_RUN.

External versions of the Galaxy have been studied: [galaxy-parser](https://github.com/rameshvarun/galaxy-parser) (MIT, incomplete published grammar), [sc2-tools](https://github.com/Prometheus3375/sc2-tools) (MIT Python parser/typechecker, the documentation itself says "almost complete" and loss of formatting), [sc2-galaxy-toolkit](https://github.com/sc2-arcade-watcher/sc2-galaxy-toolkit) (work in progress). None is declared Blizzard compiler or included without a separate pinning/licence/compatibility test.

The following precise experiments are: (1) open A–E copies in a separate session of the installed Editor, fix load/save/reopen, regenerated Galaxy and diagnostics, then the game; (2) get Editor-saved golden for IfThenElse/loop/local/custom FunctionDef and compare SubFuncType/closure with our XML; (3) embed a full-fledged Galaxy parser/typechecker with aned source or expand your own and close your loop/array/struct; (4) implement a single Data+GUI/Galback rollback until these steps are met.
