# A.I. Module status — 1.1.0-alpha.7

Real prior alpha.5 implementation restored from neighboring sc2editor-mcp-ai-work. Seven modules share one package/server/launcher; core was not rewritten. See [migration report](AI_MIGRATION_REPORT.md).

## Implemented

- ai.context, ai.query, ai.describe_type, ai.apply, ai.validate.
- Lossless plain-XML CustomAI, native projection, unknown preservation.
- Definition/wave create/update/delete/clone/rename/reorder, composition.patch, native operations, aliases, up to 250 batch operations.
- Shared-core atomic CustomAI + sibling ComponentList aiai registration; default dry-run, drafts/diff, backup, disk and effective-source SHA-256 guards, handled-error rollback.
- Unit availability through integrated Browse declared dependency resolution; inherited catalog metrics through Data. Legacy standalone resolver verifies catalog presence only.
- Read-only aidef/aidefwave bindings; referenced rename/delete blocked even with force/native/validation opt-outs.
- Partial L1–L4 XML/schema/reference/semantic validation, not engine parity.
- Existing GUI A.I. Module metadata/filter, schema/evidence, Definition builder, full batch editor, reviewed preview/diff and backup apply. Not a visual timeline clone.

## Current verification

157/157 tests; TypeScript build, ESLint, GUI JavaScript syntax, five JSON tool schemas, UI schema audit and Windows portable cross-build passed. Real stdio exercised AI alongside the prior six modules. Extracted empty/Definition CustomAI byte regression is separate from synthetic populated waves.

## Evidence and limitations

- EXE build 5.0.16.97563, SHA-256 9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164; current read-only scan found 38/38 requested tokens. Previous status said 39; actual script lists 38.
- Registry: 9 nodes / 27 properties; names do not prove carriers, nesting/defaults/enums.
- AIData + direct Definition observed in previously extracted UA3.CustomAI. Component aiai evidence inherited from original audit; no new Editor differential pair.
- Populated Wave/CreateUnits/Unit nesting gated by allowUnconfirmedStructure:true; generic operations confer no compatibility proof.
- Trigger Editor, Trigger rename patches and Terrain editing intentionally excluded.
- Native MPQ/CASC adapter, full AI script-generator parity, complete defaults/enums, production wave serialization, persistent journal and visual timeline not supplied.
- L5 Editor open/save, visual QA, L6 game runtime, Windows launcher execution and GUI browser visual QA: NOT_EXECUTED.
- Decompilation: NOT_AVAILABLE_LOCALLY; no full repeat decompilation.

[Format research](AI_MODULE_FORMAT_REPORT.md), [Russian guide](AI_CODEX_GUIDE_RU.md), [machine-readable checks](../generated/ai-migration-test-report.json).
