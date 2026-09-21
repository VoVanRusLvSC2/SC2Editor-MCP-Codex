# Localization and string tables

`text.*` works with native SC2 `Key=Value` tables such as `GameStrings.txt`, `ObjectStrings.txt`, `TriggerStrings.txt` and `EditorStrings.txt`.

## Locale mapping

The MCP request explicitly maps locale IDs to project-relative files:

```json
{
  "stringFiles": {
    "enUS": "enUS.SC2Data/LocalizedData/GameStrings.txt",
    "ruRU": "ruRU.SC2Data/LocalizedData/GameStrings.txt",
    "deDE": "deDE.SC2Data/LocalizedData/GameStrings.txt"
  }
}
```

No locale whitelist exists. `text.context` discovers locale-shaped directories already present in the workspace. `text.setLocalized` writes only locales explicitly included in `values`; it does not create translations or directories silently.

## Minimal patch guarantee

Updating `Cutscene/Kaldir/StormWarning` changes only the value bytes on that line. Existing BOM, CRLF/LF choice, comments, order, unrelated keys and unknown content remain unchanged. A missing key is appended using the file's existing newline style.

Native new lines inside a value must be represented as `<n/>`; literal CR/LF in a single entry is rejected.

## References

Inline `<s val="…">` references are checked against local and indexed Core styles. `style.rename` updates inline references only in the string files supplied to the same transaction. This explicit file list prevents an expensive or surprising rewrite across every dependency.

Core/dependency string tables remain read-only by policy when editing a map. Add local keys/overrides in the selected component directory rather than modifying installed `Core.SC2Mod`.
