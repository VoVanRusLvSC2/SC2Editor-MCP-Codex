# Codex Manual: Text MCP

## Main rule

Don't write `FontStyles.SC2Style` and `GameStrings.txt` by hand. First one `text.context`, then one large `text.apply`.

## Creating a style and two translations

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
        "textcolor": "9fdcff",
        "styleflags": ["Shadow", "Outline"],
        "shadowoffset": 2,
        "outlinewidth": 2,
        "outlinecolor": "000000"
      }
    },
    {
      "op": "text.setLocalized",
      "key": "Cutscene/Kaldir/StormWarning",
      "values": {
        "enUS": "<s val=\"KaldirSubtitle\">The storm is coming.</s>",
        "ruRU": "<s val=\"KaldirSubtitle\">Приближается буря.</s>"
      }
    }
  ],
  "validate": true,
  "dryRun": false,
  "stage": true
}
```

After checking diff, save all returned files via shared `ui.save`, or use `stage:false` immediately.

## UI binding

In the same `ui.apply`, where the Label/Button/EditBox is created:

```json
{ "op": "text.bindStyle", "framePath": "@title", "style": "KaldirSubtitle" }
```

The operation generates `<Style val="KaldirSubtitle"/>`. For the new frame, first specify `as:"title"`, then refer to `@title`.

## Cutscene Text

```json
{
  "op": "text.add",
  "as": "caption",
  "name": "Caption",
  "text": "The storm is coming.",
  "position": [0, 0, 2],
  "duration": 5000,
  "lockedToEnd": true
}
```

Changing the content of the text over time uses a confirmed step-track:

```json
{
  "op": "text.animate",
  "object": "@caption",
  "keyframes": [
    { "start": 0, "value": "" },
    { "start": 1000, "value": "The storm is coming." }
  ]
}
```

Important: The actual `CCutsceneNodeText` of the current corpus doesn't have a validated `style`/`font`. Don't pass on a fictional attribute. For stylized game subtitles, use a validated UI/localized-string consumer or test differential Editor.

## Constants and inheritance

Save `#FontSizeMedium` as a reference if the user did not request literal. `text.inspect` will show both native and resolved value. When you change the standard Core style, create a local derived style; do not change the installed `Core.SC2Mod`.

## Forbidden.

- Silently replace the unknown flag/default
- Deploy `#Constant` to literal without request.
- rewrite the entire string table;
- to issue structural PASS for verification in the game;
- Invent `shadowcolor` or Cutscene `style` without native evidence
