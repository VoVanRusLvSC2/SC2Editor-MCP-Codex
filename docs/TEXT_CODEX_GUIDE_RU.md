# Руководство Codex: Text MCP

## Главное правило

Не пиши `FontStyles.SC2Style` и `GameStrings.txt` вручную. Сначала один `text.context`, затем один большой `text.apply`. Отдельный вызов нужен только для редкого schema lookup.

## Создание стиля и двух переводов

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

После проверки diff сохрани все возвращённые файлы через общий `ui.save`, либо сразу используй `stage:false`.

## Привязка к UI

В том же `ui.apply`, где создаётся Label/Button/EditBox:

```json
{ "op": "text.bindStyle", "framePath": "@title", "style": "KaldirSubtitle" }
```

Операция генерирует `<Style val="KaldirSubtitle"/>`. Для нового frame сначала задай `as:"title"`, затем ссылайся на `@title`.

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

Изменение содержимого текста по времени использует подтверждённый step-track:

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

Важно: у реальных `CCutsceneNodeText` текущего corpus нет подтверждённого `style`/`font`. Не передавай выдуманный атрибут. Для стилизованных игровых субтитров используй подтверждённый UI/localized-string consumer либо проведи differential Editor test.

## Константы и наследование

Сохраняй `#FontSizeMedium` как ссылку, если пользователь не просил literal. `text.inspect` покажет одновременно native и resolved value. При изменении стандартного стиля Core создавай локальный производный стиль; не меняй установленный `Core.SC2Mod`.

## Запрещено

- молча заменять неизвестный flag/default;
- разворачивать `#Constant` в literal без запроса;
- переписывать целиком string table;
- выдавать структурный PASS за проверку в игре;
- придумывать `shadowcolor` или Cutscene `style` без native evidence.
