# Ассеты, стандартные анимации и построение локаций

Версия: `1.1.0-alpha.5`.

## Что теперь индексируется

`CutsceneAssetIndex` объединяет четыре источника, не считая ни один из них вечным абсолютным whitelist:

1. XML-каталоги карты, мода и распакованных dependencies. Индексируются все встреченные классы `C*` с `id`, а не только заранее выбранные `CModel/CActor`.
2. Реальные `.SC2Cutscene` и `.StormCutscene`. Из них извлекаются фактически использованные `modelLink`, `modelPath`, `soundLink`, `lightID`, conversation/texture references и animation tokens.
3. Пользовательские файлы карты/мода: `.m3`, `.m3a`, textures, sounds и movies.
4. `Assets.txt`, `Files.txt` или `FileList.txt`, если внешний CASC/MPQ extractor создал список путей.

Для `.m3/.m3a` встроенный read-only metadata reader разбирает section index и читает:

- `SEQS` — реальные названия animation sequences;
- `ATT_` — реальные attachment points.

Он не модифицирует модель и не пытается рендерить её. Если M3 доступен, `cutscene.animations.list.complete=true`. Если найден только catalog или уже существующая Cutscene, возвращается полезный, но честно помеченный partial list.

## Подключение стандартных и пользовательских ассетов

Корень текущей component-карты/мода из `SC2_UI_ROOT` индексируется всегда. Дополнительные распакованные dependencies задаются через `SC2_ASSET_ROOTS`.

PowerShell:

```powershell
$env:SC2_UI_ROOT = "E:\Maps\MyMap.SC2Map"
$env:SC2_ASSET_ROOTS = "E:\SC2Extracted\Mods\Core.SC2Mod;E:\SC2Extracted\Campaigns;E:\MyCinematicAssets"
node dist/index.js
```

Bash:

```bash
SC2_UI_ROOT=/maps/MyMap.SC2Map \
SC2_ASSET_ROOTS=/sc2/Mods/Core.SC2Mod:/sc2/Campaigns:/assets/custom \
node dist/index.js
```

Разделитель соответствует ОС: `;` в Windows и `:` в Linux/macOS. После копирования новой модели в уже запущенный workspace вызовите `cutscene.assets.refresh`.

Важно: установленный SC2 хранит многие штатные ресурсы в CASC. Текущий модуль индексирует component/extracted directories и не заявляет встроенное полное чтение CASC. Поэтому `cutscene.assets.status` нужно проверять перед заявлением «доступны все стандартные ассеты».

## Экономичный workflow для Codex

Для задачи «собери локацию на Зерусе или Колдире» не нужны десятки MCP-вызовов.

### 1. Один контекст с пакетным поиском

```json
{
  "categories": ["actor", "lighting", "animation-layer"],
  "assetQueries": [
    { "query": "Zerus", "types": ["Model", "Actor", "Doodad", "Terrain", "Texture", "Light"], "limit": 30 },
    { "query": "Kaldir", "types": ["Model", "Actor", "Doodad", "Terrain", "Texture", "Light"], "limit": 30 }
  ]
}
```

Это один `cutscene.context`. Поиск ранжируется по точному ID, началу ID, пути, catalog fields и provenance. Результат содержит `cutsceneUse`, например:

```json
{
  "catalog": "Model",
  "id": "<реальный ID из локального каталога>",
  "path": "Assets/Models/...m3",
  "dependencies": ["Campaign"],
  "cutsceneUse": {
    "nativeType": "CCutsceneNodeActor",
    "property": "modelLink",
    "value": "<точный catalog ID>"
  }
}
```

Нельзя подставлять придуманный ID только потому, что он похож на `ZerusTree`. Нужно использовать значение из результата.

### 2. Разрешение Unit/Actor в Model

Если найден Unit или Actor, один `cutscene.assets.inspect` рекурсивно проходит связи и inheritance:

```json
{ "catalog": "Actor", "id": "<ACTOR_ID_FROM_SEARCH>", "maxDepth": 8 }
```

Ответ содержит `definitions`, граф `edges`, `unresolved` и `placementCandidates`. Так Codex не должен угадывать, какой Model стоит за Unit/Actor.

### 3. Реальные анимации выбранной модели

```json
{
  "asset": {
    "catalog": "Model",
    "id": "<MODEL_ID_FROM_SEARCH>"
  }
}
```

Это вызов `cutscene.animations.list`. Ответ:

```json
{
  "animations": ["<real SEQS names>"],
  "attachmentPoints": ["<real ATT_ names>"],
  "complete": true,
  "sources": [{ "source": "workspace-file", "complete": true }]
}
```

Если `complete=false`, Codex может использовать только observed tokens или запросить распакованный M3; он не должен выдумывать `Walk`, `Stand` или `Talk`.

### 4. Одна транзакция для всей декорации

Каждая модель локации добавляется через `actor.add`, но все операции передаются одним `cutscene.apply`:

```json
{
  "file": "Cutscenes/ZerusLanding.SC2Cutscene",
  "operations": [
    {
      "op": "actor.add",
      "as": "backdrop",
      "name": "Zerus backdrop",
      "asset": { "catalog": "Model", "id": "<MODEL_LINK_FROM_SEARCH>" },
      "position": [0, 12, -2],
      "rotation": [0, 0, 0],
      "scale": [3, 3, 3]
    },
    {
      "op": "actor.add",
      "as": "customProp",
      "name": "My custom prop",
      "asset": { "catalog": "Model", "path": "Assets/Custom/MyProp.m3" },
      "position": [2, 4, 0]
    },
    {
      "op": "animation.layer.add",
      "as": "customPropAnim",
      "object": "@customProp"
    },
    {
      "op": "animation.add",
      "layer": "@customPropAnim",
      "anim": "<EXACT_NAME_FROM_ANIMATIONS_LIST>",
      "duration": 15000,
      "looping": true,
      "timeScale": 0.5,
      "weight": 2
    }
  ],
  "dryRun": false,
  "stage": false,
  "validate": true
}
```

`actor.add` использует:

- `modelLink` для catalog-backed Model;
- `modelPath` для пользовательского raw M3;
- native `position`, `rotation`, `scale`;
- все дополнительные schema-confirmed свойства `CCutsceneNodeActor` через `properties`;
- optional `duration`/`lockedToEnd`.

Массив `[x,y,z]` сериализуется детерминированно с шестью знаками после точки. Строка native vector также принимается без lossy преобразования.

## Что означает «локация на Зерусе/Колдире»

Cutscene Editor не получает готовый биом из слова `Zerus`. Bridge делает запрос к реально доступным dependencies и возвращает строительные блоки: модели окружения, doodads, actors, textures, lighting presets и sounds. Codex выбирает подтверждённые кандидаты, размещает их как `CCutsceneNodeActor`, добавляет scene lights/Director lighting и камеры.

Таким образом:

- одинаковый prompt на карте с Campaign dependencies найдёт больше штатных ассетов;
- на карте без нужной dependency resolver покажет `unresolved`, а не запишет выдуманную ссылку;
- пользовательская `.m3` внутри карты доступна по `modelPath` сразу после refresh;
- штатная модель предпочтительно используется по `modelLink`, чтобы SC2 применил catalog/dependency semantics.

## Публичные asset-команды

| Tool | Назначение |
|---|---|
| `cutscene.assets.status` | Корни, каталоги, source coverage, число M3 с exact metadata |
| `cutscene.assets.refresh` | Пересканировать после добавления custom asset/dependency |
| `cutscene.assets.search` | Ранжированный поиск всех доступных типов |
| `cutscene.assets.inspect` | Рекурсивный graph resolution и placement candidates |
| `cutscene.animations.list` | Exact M3 `SEQS` + `ATT_` или честный partial fallback |

## Текущая граница

Поддержка extracted/component assets и custom files реализована. Прямое чтение Blizzard CASC, визуальный 3D asset browser и model preview остаются отдельными следующими этапами. Пока CASC adapter не подключён, отсутствие ассета в результатах означает «его нет среди индексируемых локальных источников», а не «его не существует в SC2».
