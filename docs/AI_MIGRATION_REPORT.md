# A.I. Module portability - SC2Editor MCP 1.1.0-alpha.7

September 13, 2026.Transfer completed; completeness of SC2Editor/runtime not announced.

## Source and architecture

Active project: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex`.

Found a real previous implementation in `/workspace/scratch/0f9999397929/sc2editor-mcp-ai-work/project/sc2-ui-mcp-starter`, also there is `SC2Editor-MCP-v1.1.0-alpha.5-ai-source.zip`. 7 AI source files, schemas/evidence, scripts, 12 previous tests, docs/examples. Current improved Data/Text/UI/Cutscene/Browse/Placement saved.

SHA-256 core/workspace.ts in both branches is the same: `03265336883f7dd8dcabe5f26ca2ef687aedb3d0780b4bcecb8794451bef3582`. Core Workspace has not changed; capabilities are supplemented by AI. Version increased alpha.6 → alpha.7 on the same sequence of development releases, not on the level of compatibility.

AiDocument uses existing scanner and minimal span patches. AiWorkspace uses common Workspace.applyRawTransaction for CustomAI + sibling ComponentList. AiSchemaRegistry stores different evidence/coverage. Data gives inherited Unit metrics; Browse checks Unit existence and declared dependency availability. Reference file fingerprints and draft hashes are updated; modifiedshot does not reread XML.

The AI context is added with the latest optional argument createUiServer, the old parameters are not shifted. GUI creates AI/Data/Browse/Placement on one Workspace; A.I. Module is added to the existing UI and Browse/Placement. Launcher is the old, not new EXE.

## MCP tools

| Tool | Implementation | Checks/restrictions |
| --- | --- | --- |
| ai.context | Selective definitions/waves, graph, optional native/raw metadata, read-only bindings | Extracted empty/Definition and synthetic waves; stdio. Native IR built for document before projection; composition semantics inferred |
| ai.query | Definition/wave/reference filters, timing/unit filters, limits | Synthetic populated cases. Legacy reference search presence does not prove declared dependency; write validation uses Browse |
| ai.describe_type | 9-node / 27-property registry, EXE evidence | Downloaded registry and tool schema. Runtime functions - evidence, non-executable tools; defaults not proven |
| ai.apply | 250 operations, aliases, dry-run/stage/disk, diff, backup, two-file atomic apply | Creation/mutations, late-op rollback, safety gates, GUI API, stdio. Populated wave/composition opt-in, no persistent journal or crashproof global filesystem transaction |
| ai.validate | Partial L1–L4 XML/schema/reference/semantics | Missing Unit, player/time, duplicate IDs, Trigger links. L5 UNAVAILABLE, L6 UNTESTED |

Operations: definition/wave create/update/rename/clone/delete/reorder; composition.patch; native.add/set/remove. Duplicate definition.creates an error, not upsert. Ambiguous selectors require nativeType/nodeId/occurrence. Recursive native.add does not bypass unconfirmed gate. Preview returns disk hashes and sourceSha256; expected Sha256 +SourceS draftha256 protects when re-apply selected.

## Without Trigger/Terrain

Only workspace CustomAI and its sibling ComponentList.SC2Components are allowed to write. You cannot arbitrarily redirect the recording to Triggers/Terrain. Old Trigger rename patching code is excluded. aidef/aidefwave is readable for; rename/delete safety of related objects is blocked even with force, native.remove, validate:false, allowInvalid:true. Definition with wave Trigger binding is also protected. Internal AI references can be updated.

Top-level Trigger/Terrain tools are not registered; no surface tabs.Old Cutscene Galaxy helpers are saved, but are not issued as Trigger Editor MCP.

GUI: metadata/filter, Definition builder, AiOperation[] editor, mandatory reviewed preview before apply button, diff/validation, dry-run enabled, backup and both hash guards. This is not a visual timeline copy of Blizzard AI Editor.

## EXE / evidence

EXE: `/workspace/scratch/0f9999397929/upload/SC2Editor_x64(1).exe`.

Build 5.0.16.97563; 76,470,480 bytes; SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`.Reread-only scan: 38/38 tokens, missing: []. Previously status said 39, but script contains 38 - corrected. EXE was not executed/changed. Decompilation: NOT_AVAILABLE_LOCALLY; there was no repeated complete decompilation.

| Conclusion | Evidence | Actual verification |
| --- | --- | --- |
| AIData/Definition/Wave/scalar names exist | PROVEN_BY_EXE | NUL-terminated offsets in generated/ai-editor-evidence.json; nesting does not follow from names |
| AIData + Direct Definition Id was observed in map extracts | PROVEN_BY_REAL_MAP, inherited extraction provenance | UA3.CustomAI; byte-exact regression; SHA-256 a65627504be38b2f2db8585212356d386d223c688acc2891ec4411cf20ed1ece |
| Empty AIData observed | PROVEN_BY_REAL_MAP, inherited extraction provenance | SC2BW.CustomAI; byte-exact regression; SHA-256 871b36549f0b3430cb22dca60c2da0b4796b56ec5c3b8305d3ad7e0c95e11541 |
| ComponentList aiai → CustomAI | Inherited original-audit evidence | Original ComponentList extract not separately found; current synthetic integration, not new Editor round-trip |
| Wave under Definition, CreateUnits/Unit Type/Count | INFERRED / UNKNOWN_NEEDS_RESEARCH | Synthetic tests, explicit opt-in, not PROVEN_BY_ROUNDTRIP |
| Boolean/time/player/ranges | INFERRED constraints + EXE-exact names | Typed regression; defaults/enums/engine parity unknown |
| Unknown preservation / write safety | Implementation regression proof | Hashes/spans, dry-run/drafts, late failure, backups |
| Editor open/save and gaming behavior | UNKNOWN | NOT_EXECUTED |

The original samples are in nearby research/customai-samples; exact base64 bytes and hashes are included in src/tests/fixtures/ai-observed-documents.json.

## Results

157 tests / 157 pass / 0 fail / 0 skipped = 135 baseline + 12 previous AI + 10 migration regressions. the former Trigger-write test is replaced by read-only test, rather than declared saved Trigger capability.

TypeScript build, ESLint, GUI JS syntax, AI JSON schemas, UI schema audit, Windows portable cross-build: PASS. Native x64 launcher is structurally verified, Windows is not running. AI + old tools are actually listed/called through stdio child process; GUI dispatcher is automated, browser visual QA is not executed. Additional compiled portable app is verified under Linux Node: stdio ai.query + all 7 name and GUI HTTP ai; it is not running through Windows QSS tester; it is not a visual browser.

[Full log.](../generated/ai-migration-test-report.json) Old Browse/Placement demo remains synthetic, not new real-map PASS. Repeated XML parse/byte regression executed; populated Editor wave round-trip, Editor open/save, visual, runtime, Windows launcher execution and GUI browser visual: NOT_EXECUTED separately.

Build: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex/release/SC2-UI-Workbench-Windows/SC2-UI-Workbench.exe` Requires all portable ZIP and Node.js 20+; Windows runtime is not bundled in Linux cross-build.

Packages: SC2Editor-MCP-v1.1.0-alpha.7-source.zip; SC2Editor-MCP-v1.1.0-alpha.7-Windows-portable-node-required.zip.

## Demonstration carried out

`npm run ai:demo` restored exact UA3.CustomAI bytes to a working copy of component-directory, performed ai.context → definition.create dry-run → diff → backup apply with two hash guards → reopen/validate. Original Definition raw slice remained byte-identical, backup SHA-256 coincided with the original. XML parse and available L1–L4: PASS; editor/game: NOT_EXECUTED. This is extracted native guards → synthetic CustomAI component, incomplete and non-extimized scenario extract SC2.

Copy: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex/examples/ai/runs/demo-BeR4R9`. [Real request/preview/apply/answers](../examples/ai/runs/demo-BeR4R9/DEMONSTRATION.json).

## Modified/Added Files

- src/modules/ai/{types,document,references,schemaRegistry,validator,workspace,tools}.ts.
- src/index.ts, src/mcp/uiServer.ts, src/core/capabilities.ts.
- src/gui/{api,server}.ts and public/{index.html,app.js}.
- src/tests/aiModule.test.ts, src/tests/browsePlacementTransport.test.ts, src/tests/fixtures/ai-observed-documents.json.
- scripts/{discover-ai-module,benchmark-ai-efficiency,generate-ai-schemas,verify-ai-migration,demo-ai-migration}.ts; scripts/build-windows-portable.mjs; windows/README-WINDOWS.md.
- generated/{ai-editor-evidence,ai-module-schema,ai-tools,ai-migration-test-report}.json.
- examples/ai/{CustomAI,ZergPersonalityApply.json,README.md} is a theoretical writer honestly gated.
- README.md, README_LEGACY.md, CHANGELOG.md; docs/{ARCHITECTURE,PROJECT_STATUS,CODEX_GUIDE_RU,AI_MCP,AI_CODEX_GUIDE_RU,AI_MODULE_FORMAT_REPORT,AI_IMPLEMENTATION_STATUS,AI_MIGRATION_REPORT}.md.
- Portable build output is updated; other source/core and original maps are not overwritten.

## Readiness

Port/transport/GUI API and secure CustomAI editing are real and regression-tested. Catalog/dependency use current Data/Browse restrictions. Completed waves/composition - research gated writer, production format and script-generator parity are not proven. Visual timeline, native MPQ/CASC, defaults/enums, persistent journal and L5/L6 checks remain. Trigger/Terrain has been deliberately excluded so far.
