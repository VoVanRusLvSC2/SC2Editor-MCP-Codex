# Text and Font Style schema discovery

## Pinned sources

1. Supplied read-only `SC2Editor_x64.exe` 5.0.16.97563, SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`.
2. Real `Core.SC2Mod/Base.SC2Data/UI/FontStyles.SC2Style`.
3. 319 local `GameStrings.txt`, `ObjectStrings.txt`, `TriggerStrings.txt` and `EditorStrings.txt` resources.
4. Existing 1,488-file StormCutscene corpus for `CCutsceneNodeText`.

The EXE is read only and excluded from packages.

## Font Style result

Core contains 2,839 styles, 176 constants and 9 font groups. Discovery found 21 distinct style value attributes, plus the structural `name` and `template` attributes:

| Type | Native attributes |
|---|---|
| Font | `font` |
| Integer | `height`, `shadowoffset`, `outlinewidth`, `characterspacing` |
| Decimal | `linespacing` |
| Enum | `hjustify`, `vjustify`, `glowmode` |
| Flags | `fontflags`, `styleflags` |
| Colors | `textcolor`, `disabledcolor`, `highlightcolor`, `hotkeycolor`, `hyperlinkcolor`, `glowcolor`, `highlightglowcolor`, `disabledglowcolor`, `outlinecolor` |
| Load metadata | `requiredtoload` |

The real Core schema comment confirms `outlinewidth` and `outlinecolor`; no guessed outline tag is used. It also specifies height, spacing and outline ranges. The Editor string cluster independently contains `outlinewidth`, `outlinecolor`, `linespacing`, `characterspacing` and Text error identifiers.

Confirmed style flags from Core documentation/observations and Editor-adjacent strings:

`Shadow`, `Glow`, `InlineJustification`, `Uppercase`, `TightGradient`, `Outline`, `Bold`, `Italic`, `HintingOff`, `HintingNative`, `HintingAuto`, `HintStyleNormal`, `HintStyleLight`, `HintStyleLCD`, `HintStyleLCDVertical`.

Observed `fontflags`: `Bold`, `Outline`. Unknown future flag tokens are preserved rather than replaced.

Observed justifications are `Left`, `Center`, `Right` and `Top`, `Middle`, `Bottom`. EXE also contains text-layout alignment tokens such as `UpperMiddle` and `AbsoluteMiddle`, but they are not promoted to Font Style enum values without a differential SC2Style sample.

## Generated artifacts

- `generated/text-font-style-schema.json`
- `generated/font-style-corpus.json`
- `generated/rich-text-schema.json`
- `generated/text-editor-evidence.json`
- `generated/cutscene-text-property-matrix.json`

Run:

```bash
SC2_TEXT_CORE_STYLE=/path/to/Core.SC2Mod/Base.SC2Data/UI/FontStyles.SC2Style \
SC2_TEXT_CORPUS_ROOT=/path/to/resources \
SC2_EDITOR_EXE=/path/to/SC2Editor_x64.exe \
npm run text:discover
```

Runtime MCP loads generated JSON and does not rescan the EXE.

## Conflicts and uncertainty

- Core's comment says height `[1, 200]`; the Editor error/range string cluster contains `1 - 256`. The registry currently accepts 1–256 and records runtime as untested. A controlled Editor differential save is still required to settle the exact UI limit.
- `shadowcolor` from secondary descriptions was not observed in the supplied Core style schema or the recovered native attribute string cluster, so it is not emitted.
- Localized `LocalizedData/FontStyles.SC2Style` files were not available in this workspace snapshot. The path is confirmed by the EXE, but locale-specific merge behavior remains unknown until a real file is added.
- The 38 tag candidates are corpus-observed tokens. Some are data/validator expressions embedded in text, not formatting tags; they remain preserve-only until classified.
