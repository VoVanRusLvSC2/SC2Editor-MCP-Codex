# A.I. Module: Instructions for Codex

The `ai.*` edits native `CustomAI` rather than creating an external ML bot. It has been moved from the former SC2Editor MCP alpha.5 to the general alpha.7; the Trigger Editor and the surface are currently excluded.

## Fast workflow

First, `ai.context`: definitions/waves, diagnostic information, dependencies, Unit references and read-only Trigger bindings. Do not download native XML unnecessarily. For an unknown field, use `ai.describe_type`; evidence of the field name does not prove its scalar carrier or defaults.

```json
{"tool":"ai.context","arguments":{"file":"CustomAI","definitions":["Enemy"],"units":["Marine"],"includeNative":false,"limit":30}}
```

Creating a confirmed minimum Definition, dry-run:

```json
{"tool":"ai.apply","arguments":{"operations":[{"op":"definition.create","id":"EnemyAI","as":"enemy"}],"dryRun":true}}
```

The answer contains `files[].preview`, SHA-256, aliases, and validation. Then repeat the same request with `dryRun:false,stage:false,backup:true`, passing `expectedSha256` from `files[].beforeSha256` and `expectedSourceSha256` from `sourceSha256`. This protects the disk and current drafts. `stage:true` instead of writing leaves a common draft; you can save it to existing `ui.save` by checking diff and hashes.

For the study of existing waves:

```json
{"tool":"ai.query","arguments":{"kind":"waves","file":"CustomAI","text":"Wave","limit":20}}
```

## Composition and timing – only explicit research inclusion

Search the real Unit through `browse.search`; use the returned ID available locally or through the declared dependency. `wave.create` and `composition.patch` are not declared proven Editor format. `allowUnconfirmedStructure:true` is required; this is acceptance of the restriction, not the result of the editorial test.

```json
{"tool":"ai.apply","arguments":{"operations":[{"op":"definition.create","as":"enemy","id":"EnemyAI"},{"op":"wave.create","definition":"@enemy","id":"Wave01","properties":{"Time":60},"composition":[{"unit":"Marine","quantity":4}],"allowUnconfirmedStructure":true}],"dryRun":true}}
```

This example will only work with a Marine available in the target dependencies. Until differential Editor fixtures, you can't use it as a guaranteed game wave.

## The boundaries of the record

- Only `CustomAI` and neighboring `ComponentList.SC2Components` with `aiai` registration are allowed.
- `updateReferences:true` changes internal AI references, but not `Triggers`. Renaming/deleting objects with read-only Trigger bindings is blocked even at `force`, `validate:false` and `allowInvalid:true`.
- `native.*` does not lift the ban on Trigger/Terrain recordings. Unconfirmed new structures require explicit opt-in; unknown existing nodes/attributes persist.
- Repeated `definition.create` with the same ID does not create a double: error. Persistent request journal is not added.
- Graph prices/supply are taken from Data/catalogs; `complete:false` stands for incomplete data, zeros in total are not proven free value.
- The L5 Editor and L6 runtime did not run; parse/validation PASS does not replace them.

## GUI

Tab **A.I. Module**: Definition/Wave search, metadata, schema/evidence preparation, Definition preparation, full AiOperation[] editor, mandatory preview before the apply button, diff/validation. Dry-run is enabled; disk applies backup and checks past hashes. This is not a ready-made visual copy of Blizzard AI Editor.

See [implementation and limitations](AI_IMPLEMENTATION_STATUS.md), [native evidence](AI_MODULE_FORMAT_REPORT.md), [transfer report](AI_MIGRATION_REPORT.md).
