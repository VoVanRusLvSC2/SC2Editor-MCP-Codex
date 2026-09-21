# Text MCP

Version: `1.1.0-alpha.5`. Editor evidence is pinned to SC2Editor `5.0.16.97563`, SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`.

`text.*` is a top-level module in the same MCP server. It owns shared SC2 Font Styles, style constants/font groups, localized string tables, font discovery/import and SC2 rich-text markup. UI and Cutscene remain separate consumers.

## Public API

- `text.context`: one batch lookup for styles, fonts, keys, locales, schema coverage and operation names.
- `text.inspect`: declared/effective Font Style or one localized entry plus its lossless rich-text AST.
- `text.schema.inspect`: all discovered properties, enum values, flags and provenance.
- `text.apply`: atomic batch mutation, validation and minimal per-file diff.
- `text.validate`: L1 syntax, L2 schema, L3 references and L4 semantics.
- `text.diff`: staged diff for one or more files.

There is no mandatory `text.save` call. Use `dryRun:false, stage:false` for a validated atomic write, or stage with `stage:true` and commit each returned file through the existing shared `ui.save`. The underlying draft store is shared, so UI and Text see the same staged `.SC2Style` content.

## Efficient Codex workflow

1. Call `text.context` once, with all style/font/key searches in arrays.
2. If a rare property is needed, call `text.schema.inspect` once.
3. Send one `text.apply` containing all style/constants/locales/rich-text operations.
4. `text.apply` already returns validation and minimal diffs. A separate validation call is optional.

Typical task: two MCP calls, regardless of the number of translated strings.

The checked-in efficiency benchmark (`npm run benchmark:text`) models 12 edits: the granular workflow needs 16 calls, while `text.context` + `text.apply` needs 2 (87.5% fewer). Validation, minimal diff and rollback guarantees are included in the apply call.

## Main transaction

```json
{
  "styleFile": "Base.SC2Data/UI/FontStyles.SC2Style",
  "stringFiles": {
    "enUS": "enUS.SC2Data/LocalizedData/GameStrings.txt",
    "ruRU": "ruRU.SC2Data/LocalizedData/GameStrings.txt"
  },
  "operations": [
    {
      "op": "style.add",
      "id": "KaldirSubtitle",
      "template": "StandardExtendedTemplate",
      "values": {
        "font": "#FontStandardExtended",
        "height": 28,
        "hjustify": "Center",
        "vjustify": "Middle",
        "textColor": "9fdcff",
        "shadow": true,
        "outline": true,
        "outlineWidth": 2,
        "outlineColor": "000000"
      }
    },
    {
      "op": "text.setLocalized",
      "key": "Cutscene/Kaldir/StormWarning",
      "values": {
        "enUS": "The storm is coming.",
        "ruRU": "Приближается буря."
      }
    }
  ],
  "validate": true,
  "dryRun": false,
  "stage": false,
  "backup": true
}
```

`style.add` accepts native property names and Codex-friendly case aliases. Arrays for `styleFlags`/`fontFlags` serialize with native `|`. `shadow:true` and `outline:true` are aliases for confirmed `styleflags` tokens. `outlineWidth` is exposed because `outlinewidth` is confirmed by both Core and Editor strings.

## Operations

| Family | Operations |
|---|---|
| Styles | `style.add`, `style.set`, `style.clone`, `style.setTemplate`, `style.rename`, `style.delete` |
| Constants/fonts | `constant.add`, `constant.set`, `constant.remove`, `fontGroup.set`, `font.import` |
| Content | `text.set`, `text.setLocalized`, `text.remove` |
| Rich text | `richText.style`, `richText.color`, `richText.noWrap`, `richText.newLine` |

Style rename updates local template references and all explicitly supplied string tables in the same transaction. Delete refuses to leave a known template or inline-style reference dangling. `font.import` is intentionally isolated as its own transaction because it copies binary data; it will not be silently combined with textual edits.

## UI consumption

The preferred UI transaction operation is:

```json
{ "op": "text.bindStyle", "framePath": "GameUI~1UIContainer/Title", "style": "KaldirSubtitle" }
```

It writes the real SC2 layout property `<Style val="KaldirSubtitle"/>`. Normal `ui.validate` then resolves the style against all workspace `.SC2Style` files.

## Cutscene Text

The supplied Editor and the 1,488-file native corpus confirm `CCutsceneNodeText`. `cutscene.apply` supports `text.add` and `text.animate`. The latter writes the corpus-observed step timeline (`CCutsceneNodePropertyValue` plus `CCutsceneElementPropertyValue`), not an invented numeric curve.

No Font Style reference was observed on any of the 55 real `CCutsceneNodeText` instances. Therefore this build does **not** invent a `style` or `font` attribute. A Cutscene Text node and a UI/subtitle styled string are separate native mechanisms until an Editor differential test proves a link.

## Safety

- Every textual transaction is evaluated on private in-memory copies first.
- Failed operation or failed validation commits no draft and no disk file.
- Multi-file direct writes use temporary files, optional `.sc2uimcp.bak` backups and rollback on write failure.
- Existing comments, unknown XML elements/attributes, quote style and untouched string-table lines remain unchanged.
- Unknown rich-text tags become raw AST nodes and serialize byte-for-byte.
- L5/L6 are not claimed: Editor load is `UNAVAILABLE`, runtime rendering is `UNTESTED` in this environment.
