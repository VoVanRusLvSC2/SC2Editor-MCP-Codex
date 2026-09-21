# AI MCP workflow

Use one `ai.context` call to resolve the current component, definitions, units, players, points and Trigger bindings. Then send one batch to `ai.apply`; it already validates, returns minimal per-file diffs and uses one atomic transaction.

Public tools:

- `ai.context`
- `ai.query`
- `ai.describe_type`
- `ai.apply`
- `ai.validate`

Alpha.7 integrates these five tools into the same server as UI/Text/Cutscene/Data/Browse/Placement. Only CustomAI and sibling ComponentList are writable; Trigger links are read-only. `updateReferences:true` updates internal CustomAI references only. Trigger-bound definition/wave rename/delete is blocked even with force or normal validation opt-outs. Trigger/Terrain top-level tools are not registered. GUI has an A.I. Module metadata/batch tab, not an Editor timeline replica.

For reviewed apply, pass `expectedSha256` from files[].beforeSha256 (disk) and `expectedSourceSha256` from preview sourceSha256 (effective disk/drafts). GUI pins both. See [Russian guide](AI_CODEX_GUIDE_RU.md) and [migration/test report](AI_MIGRATION_REPORT.md).

All writes default to `dryRun: true`. With `dryRun: false, stage: false`, changed files are written through temporary files with backups and rollback. If `CustomAI` is absent, the transaction creates its minimal `AIData` envelope and adds the native `aiai` component entry.

Example:

```json
{
  "file": "CustomAI",
  "operations": [
    { "op": "definition.create", "as": "enemyAI", "id": "ZergPlayer3" },
    {
      "op": "wave.create",
      "definition": "@enemyAI",
      "id": "Wave0400",
      "properties": { "SourcePlayer": 3, "TargetPlayer": 1, "Time": 240 },
      "composition": [{ "unit": "Zergling", "quantity": 12 }],
      "allowUnconfirmedStructure": true
    }
  ],
  "dryRun": true
}
```

`allowUnconfirmedStructure` is intentionally required because a populated Editor-produced XML fixture was not available. See `AI_MODULE_FORMAT_REPORT.md` before enabling it. Generic `native.*` operations can edit exact structures found in a user map without normalizing unrelated data.
