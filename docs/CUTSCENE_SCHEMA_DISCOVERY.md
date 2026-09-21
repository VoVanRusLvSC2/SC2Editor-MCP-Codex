# Cutscene schema discovery

## Source precedence

1. Installed SC2Editor and differential saves.
2. Local decompilation/property descriptors/serialization routines.
3. Installed Core/Liberty/Swarm/Void/Campaign data and `natives.galaxy`.
4. Real Blizzard `.SC2Cutscene` corpus.
5. Real user scenes.
6. Official documentation.
7. Community documentation as supporting evidence only.

The generator never treats a prompt list as a complete whitelist. Every XML element and attribute observed in the corpus becomes a registry entry with provenance and count. Unknown nodes remain generic and lossless.

## Current environment audit

| Source | Result |
|---|---|
| User-supplied `SC2Editor_x64.exe` | Read-only static scan complete: `5.0.16.97563`, x64, 76,470,480 bytes |
| Executable identity | SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`; branch string `SC2.5.0.a` |
| `E:\SK2\Decompilator Blizzards\SC_editior_ksp.rep` | Not mounted |
| SC2GameData tree | 2,179 `.SC2Cutscene`/`.StormCutscene` paths enumerated |
| Heroes native game-data mirror | 1,488 materialized `.StormCutscene`; 96,040 objects parsed |
| Animation/light evidence | 11,112 animation blocks and 2,356 `CCutsceneNodeLight` objects |
| Corpus no-op round trip | 1,488/1,488 byte-identical; 0 XML failures |
| EXE registry evidence | 61 type/class candidates, 299 properties, 59 RTTI classes, 8 enum groups |
| Generated merged registry | 52 native types, 646 properties, 59 observed property-track identifiers |
| Camera cluster | 24/24 Editor properties matched to corpus XML |
| Native-format regression fixtures | 2 verified excerpts parsed |
| `natives.galaxy` fixture | 142 related functions and 45 constants indexed |

## Run on the SC2 machine

```powershell
npm run cutscene:discover -- `
  "C:\Program Files (x86)\StarCraft II\Mods" `
  "C:\Program Files (x86)\StarCraft II\Campaigns" `
  --natives "C:\path\to\Core.SC2Mod\base.SC2Data\TriggerLibs\natives.galaxy" `
  --editor-dump "E:\SK2\Decompilator Blizzards\SC_editior_ksp.rep" `
  --editor-build "your-editor-build" `
  --game-build "your-game-build"
```

Output is `generated/cutscene-schema.json`. Runtime MCP merges it with a small verified bootstrap registry. Re-run after a game build change.

Run the supplied-Editor PE discovery separately after the corpus scan:

```powershell
npm run cutscene:discover:editor -- "C:\Program Files (x86)\StarCraft II\Support64\SC2Editor_x64.exe"
```

This writes `editor-build.json`, `cutscene-object-types.json`, `cutscene-properties.json`, `camera-property-matrix.json`, `cutscene-tangent-modes.json`, `editor-rtti-cutscene.json`, `cutscene-schema-gap.json`, and supplementary `ui-editor-evidence.json`. It also merges evidence into `cutscene-schema.json`. The executable is opened read-only and is never copied into a release/archive.

The bundled registry therefore supports observed StormCutscene animation/light serialization immediately. Because this materialized corpus comes from the same engine's Heroes data rather than the user's installed current SC2 build, installed-Editor differential discovery still has higher authority when the two disagree.

```json
{
  "objectType": "CCutsceneElementBookmark",
  "property": "bookmarkName",
  "xmlName": "bookmarkName",
  "valueType": "String",
  "keyframeable": false,
  "observedInCorpus": 2,
  "discoveredFrom": ["real/file.SC2Cutscene"],
  "confidence": "confirmed",
  "coverage": "SUPPORTED"
}
```

Syntactic types such as integer, decimal, GUID reference, color tuple and asset-looking link are inferred conservatively from names and observed values. Enum semantics, defaults and units are not invented; they remain absent until extracted from Editor metadata or established by differential tests. Every EXE property records its file offset, RVA, display key, internal-name evidence, corpus match and confidence.

For each Editor property: save A, change exactly one field, save B, run semantic/XML diff, record native field/type/default/unit/keyframe support, and add the pair to the property matrix.

Use `npm run cutscene:diff-experiment -- before.SC2Cutscene after.SC2Cutscene` for an A/B save pair, then `npm run cutscene:matrix` to rebuild `generated/cutscene-property-matrix.json`. The 42 display-derived EXE names remain editor-only, and tangent integer IDs remain unknown, until serializer/deserializer or differential evidence agrees.

## Evidence strength

- `corpus-confirmed`: the Editor display field has an exact native XML attribute match in the 1,488-file corpus.
- `adjacent-internal-string`: the display key is paired with a lower-camel internal token in the same registry cluster.
- `exe-internal-cluster`: an internal EnvironmentLight field and its display field occur in the same ordered registry block.
- `display-derived`: the display key is real, but the XML name remains a candidate. It is never promoted to typed serialization merely because lower-casing looks plausible.

The current executable does not expose direct absolute pointers to these localization strings, and the targeted RIP-relative scan recovered no direct code references. Therefore factory/vtable/property-constructor addresses are explicitly null rather than fabricated. The RTTI/type tokens and property string clusters remain strong static evidence, but complete class inheritance and default/range flags still require COL recovery or Editor A/B saves.
