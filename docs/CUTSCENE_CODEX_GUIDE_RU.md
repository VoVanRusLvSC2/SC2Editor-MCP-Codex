# Руководство Codex: создание и редактирование SC2Cutscene

Версия bridge: `1.1.0-alpha.5`, Editor schema: `5.0.16.97563`.

## 1. Главный принцип

Codex не пишет `.SC2Cutscene` вручную. Нормальный путь:

```text
намерение пользователя
→ cutscene.context
→ один cutscene.compose или cutscene.apply
→ schema/reference/semantic validation
→ minimal diff
→ atomic save
```

`compose/apply` работают с самой сценой Cutscene Editor. Galaxy playback не нужен для создания камеры, моделей, света, timeline или анимации. `cutscene.runtime.*` является отдельной необязательной границей проверки/интеграции.

## 2. Экономичный workflow

Новая сцена обычно требует двух вызовов:

1. `cutscene.context` с категориями и, если нужно, несколькими `assetQueries`.
2. `cutscene.compose` со всеми objects/operations и `dryRun:false, stage:false`.

Правка существующей сцены:

1. `cutscene.context` с `file`.
2. Один `cutscene.apply` со всеми операциями.

Отдельные `validate`, `diff`, `save` нужны только когда пользователь хочет staged review. `apply/compose` уже выполняют validation и возвращают semantic diff. Benchmark: 20 изменений — 2 tool calls вместо 24, экономия 91.7%.

## 3. Как выбирать нативные типы и свойства

Не угадывать. Использовать:

```json
{ "objectType": "CCutsceneNodeCamera" }
```

через `cutscene.schema.inspect`, либо запросить категории `camera`, `animation`, `lighting` сразу в `cutscene.context`.

Каждое поле имеет `coverage` и provenance:

- `SUPPORTED` — сериализация встречалась в native corpus или подтверждена сильнее;
- `EDITOR_ONLY` — Editor показывает поле, но точное XML/default/runtime поведение ещё не доказано;
- `SUPPORTED_PRESERVE_ONLY` — класс существует в EXE, но corpus-инстанса нет;
- `RUNTIME_ONLY` — Galaxy registry, не XML Cutscene;
- `UNKNOWN_NEEDS_RESEARCH` — использовать только raw/native evidence.

Не превращать `EDITOR_ONLY` в обещание L5. Оно доступно через generic schema property, но результат надо проверить в Editor.

## 4. Ассеты и локации Zerus/Kaldir

Сначала выполнить один batched context:

```json
{
  "categories": ["actor", "camera", "lighting", "animation"],
  "assetQueries": [
    { "query": "Zerus", "types": ["Model", "Actor"] },
    { "query": "Kaldir", "types": ["Model", "Lighting"] },
    { "query": "Umojan Marine", "types": ["Unit", "Actor", "Model"] }
  ]
}
```

Использовать возвращённый `cutsceneUse.modelLink` или `modelPath`; не придумывать ID. Для конкретной модели вызвать `cutscene.animations.list` только один раз. Если M3/M3A доступен, список `SEQS` точный; `complete:false` означает, что это лишь catalog/corpus fallback. `ATT_` attachment points возвращаются вместе со списком.

Пользовательские `.m3/.m3a` поддерживаются через `modelPath`, а дополнительные dependency roots задаются `SC2_ASSET_ROOTS`.

## 5. Камера

Создание камеры входит в общий batch:

```json
{
  "op": "camera.create",
  "as": "wide",
  "id": "Wide Camera",
  "nativeType": "CCutsceneNodeCamera",
  "duration": 15000,
  "lockedToEnd": true,
  "properties": {
    "position": "8.000000,-12.000000,2.000000",
    "fov": 45,
    "nearClip": 0.1,
    "farClip": 600,
    "shadowClip": 75,
    "depthOfField": 1,
    "focalDepth": 12,
    "falloffStart": 1,
    "falloffEnd": 8,
    "distance": 15,
    "pitch": 18,
    "yaw": 135,
    "roll": 0,
    "heightOffset": 1.5
  }
}
```

Для eye/target камеры выбрать `CCutsceneNodeTargetCamera` и поля `eyePositionX/Y/Z`, `targetPositionX/Y/Z`.

Cut создаётся `shot.add`. У native shot есть `start`; отдельный `end` в corpus не найден. Конец shot определяется следующим cut или концом сцены. Bridge не пишет выдуманный `end`.

## 6. Анимация, скорость и вес

```json
[
  {
    "op": "animation.layer.add",
    "as": "base",
    "object": "@marine",
    "name": "Base Animation"
  },
  {
    "op": "animation.add",
    "as": "walk",
    "layer": "@base",
    "anim": "Walk",
    "animId": 0,
    "duration": 6000,
    "originalDuration": 3000,
    "looping": true,
    "timeScale": 0.5,
    "weight": 2,
    "blendTime": 250,
    "blendOutTime": 250,
    "rightAligned": false,
    "lockedToEnd": true
  }
]
```

`timeScale=0.5` — скорость playback; `weight=2` — вес слоя/блока; `priority` — отдельное поле. `animId` и `rightAligned` найдены в Editor EXE. Имя `anim` выбирать из `cutscene.animations.list`, если M3 доступен.

## 7. Свет

Обычный scene light — `CCutsceneNodeLight`. Все corpus-поля (`type`, RGB, multiplier, attenuation/range, hotspot/falloff, shadow/specular, transforms) устанавливаются в `properties` операции `light.add`.

EnvironmentLight:

```json
{
  "op": "light.add",
  "as": "environment",
  "nativeType": "CCutsceneNodeEnvironmentLight",
  "name": "Kaldir Night",
  "properties": {
    "timeOfDay": 20,
    "hdrExposure": 0.8,
    "hdrBloomThreshold": 1.2,
    "hdrAmbientMultiplier": 0.35,
    "colorizationSaturation": 0.7,
    "ssaoOcclusionRadius": 3.5,
    "ssaoOcclusionPower": 1.4,
    "keyDirectionX": 0.2,
    "keyDirectionY": -0.8,
    "keyDirectionZ": 0.5
  }
}
```

Registry содержит 65 EnvironmentLight полей: HDR/tone mapping, colorization, terrain/creep, SSAO, key/fill/back. Полный список получать из schema, не копировать из prompt. Creation проходит L1–L4, но до Windows A/B test не считается L5 PASS.

`light.activate` добавляет событие Director active-light. Это отличается от создания самого light object.

## 8. Property curves и tangents

`property.animate` создаёт `CCutsceneNodePropertyValue` и `CCutsceneElementPropertyCurve`. Можно передать native `start`, `time`, `value`, `curveInValue`, `curveOutValue`, `curveInType`, `curveOutType`.

Editor подтверждает восемь названий tangent: Custom, Fast, Flat, Linear, Slow, Smooth, Step, Auto. Их integer ID пока не доказаны. Поэтому Codex не должен переводить имя в число по порядку списка. Разрешено сохранить уже существующее число или использовать число из подтверждённого differential example.

## 9. Fog, Text, Path, RTT и редкие типы

- Fog: `CCutsceneNodeFog`, подтверждены color XYZ, falloff, density, start height.
- Text: `CCutsceneNodeText`, native `text` плюс inherited object/timeline fields.
- Path: `CCutsceneNodePath` + `CCutsceneNodePathMarker`; FollowPath существует отдельным node/element.
- RTT: `CCutsceneNodeRTTChannel`; класс и `RTTChannel` поле подтверждены EXE, полный link workflow требует A/B test.
- ModelMaterial, HaloController, Attachment, LookAt, Conversation, Fade и Sound находятся в schema registry.

Если high-level alias отсутствует, использовать `object.add`, `timeline.add` или `property.set` внутри того же `cutscene.apply`. Это не требует нового MCP tool.

## 10. Unknown preservation

Если открыт Blizzard Cutscene и изменено одно поле камеры, неизвестные attributes/nodes не удаляются. No-op byte-identical. Изменение existing attribute заменяет только его value span. Добавление child использует существующий newline/indent. `raw.patch` — только последний escape hatch и откатывается при malformed XML.

## 11. Save и безопасность

- `dryRun:true` — только результат/diff;
- `stage:true` — draft в памяти;
- `stage:false` + `dryRun:false` — validation и atomic disk commit в одном вызове;
- staged `cutscene.save` использует optimistic SHA-256, `.sc2editormcp.bak`, temp file и atomic rename;
- ошибка любой операции откатывает весь batch.

## 12. Готовый проверяемый пример

- request: `examples/cutscene/editor_discovery/Request.json`;
- generated native XML: `examples/cutscene/editor_discovery/EditorDiscoveryDemo.SC2Cutscene`;
- генератор: `npm run cutscene:example:editor`.

Пример создаёт Director/shot, Camera, Marine, animation layer, animation speed/weight, EnvironmentLight и Fog одним набором операций. Его локальный validation: L1–L4 PASS, L5/L6 UNAVAILABLE.

## 13. Checklist Codex

```text
1. Создавай/редактируй сам SC2Cutscene через context + compose/apply.
2. Не используй Galaxy playback для построения сцены.
3. Не угадывай asset или animation ID.
4. Проси schema только для нужных object types/categories.
5. Собирай все изменения в один atomic batch с @aliases.
6. Не придумывай XML tags, shot.end и tangent IDs.
7. Сохраняй unknown native data.
8. Не называй L1–L4 validation Editor/runtime PASS.
9. Используй dry-run/stage или immediate atomic write с backup.
10. Сообщай пользователю все EDITOR_ONLY/PRESERVE_ONLY поля.
```
