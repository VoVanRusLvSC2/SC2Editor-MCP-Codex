# SC2 rich text

SC2 strings use their own inline language. The parser recognizes nested/self-closing tags and preserves original spelling and quote syntax. It never treats the input as arbitrary HTML.

## Confirmed common markup

| Native form | Meaning/evidence |
|---|---|
| `<s val="StyleName">…</s>` | Inline Font Style |
| `<c val="ffffff">…</c>` | Literal/constant color |
| `<n/>` | New line |
| `<w>…</w>` | No-wrap span |
| `<IMG path="…" width="…" height="…"/>` | Inline image |
| `<ul …><li>…</li></ul>` | List |
| `<a href="…">…</a>` | Link/hyperlink token |
| `<d ref="…" precision="…"/>` | Data reference |
| `<k val="…"/>` | Hotkey token |
| `<lang …>` | Locale grammar rule |
| `<hour/>`, `<min2/>`, `<sec2/>` | Time fields |

Tag names are case-insensitive for semantic recognition, but exact input case (`IMG` versus `img`) is retained on round trip.

## Lossless behavior

Given:

```text
WARNING <s val ='WarningDisplay'><future x='1'>Attack</future></s><n/>
```

the unknown `future` tag becomes a preserved native tag node. Serialization returns the exact original string until an explicit operation changes its span.

Malformed nesting is reported at L1. The serializer still retains raw unmatched closing nodes, allowing inspection and repair without data loss.

## Range operations

Ranges are UTF-16 JavaScript string offsets into the current native value, before insertion. Use `text.inspect` first when markup already exists. `richText.style`, `richText.color` and `richText.noWrap` wrap a range; `richText.newLine` inserts `<n/>` at an offset.

These helpers do not normalize surrounding markup. For complex restructuring, set the complete native value with `text.set`; it will still be parsed and validated before commit.
