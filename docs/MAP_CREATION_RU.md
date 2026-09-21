# Создание карт из native-заготовки — alpha.18

Codex может создать новый каталог карты из зарегистрированной заготовки, сформировать поддерживаемую поверхность, затем использовать Placement/Data/UI/Text/Cutscene/AI/Script и упаковать результат в SC2Map. Протокол не создаёт неизвестные binary defaults и не удаляет содержимое исходного сценария автоматически.

## Подготовка

`SC2_UI_ROOT` — общий рабочий каталог. Импортируй исходный SC2Map в `templates/Base` через `map.import` либо используй готовую component-directory. Для чистого нового сценария предпочтительна пустая карта, сохранённая целевым редактором с нужными размером, tileset, зависимостями и игроками. Одну заготовку можно использовать многократно. Сценарная карта также пригодна, но её объекты и скрипты будут унаследованы.

```json
{"tool":"map.blueprint.inspect","arguments":{"directory":"templates/Base"}}
```

Inspect проверяет MapInfo v39, документные roots, соответствие размеров и наличие полного conventional Terrain bundle. Возвращает общий SHA-256, существующие объекты и Galaxy-файлы. `cleanTemplateVerified:false` означает, что чистота и игровой запуск не сертифицированы. Недостающие обязательные компоненты принятого creation-profile блокируют регистрацию.

```json
{"tool":"map.blueprint.register","arguments":{"id":"Base32","directory":"templates/Base","dryRun":false}}
```

Registry хранит ссылку на исходный каталог и хеш содержимого. Его предел: 64 записи, 256 KiB. Не изменяй зарегистрированную заготовку; для нового варианта зарегистрируй новый ID. `map.blueprint.list` показывает сохранённые записи, повторная проверка выполняется при создании.

## Создание

Пример для подходящей палитры: style ищет существующий материал по тематическим словам. Если его нет, передай `materials.base` с ID из `terrain.palette.get`; автоматическое придумывание текстуры не используется.

```json
{
  "tool":"map.create",
  "arguments":{
    "blueprintId":"Base32",
    "destinationDirectory":"maps/MyMap",
    "landscape":{"style":"desert","seed":42,"relief":0.5},
    "metadataPatch":{"fogMaskStyle":"Dark"},
    "dryRun":true
  }
}
```

Затем повтори тот же запрос с `dryRun:false`. `expectedBlueprintSha256` необязателен: можешь передать хеш из inspect для явного контроля выбора. Сохранённый хеш проверяется всегда. Изменение файла, списка файлов, archive metadata или registry, а также pending drafts исходной карты блокируют операцию.

Dry-run действительно выполняет все преобразования во временной копии и возвращает `contentSha256`, `changedFiles`, размеры и диагностику. Фактическое создание использует те же преобразования. Новый каталог публикуется после проверки; существующий destination отклоняется. Обработанная ошибка оставляет исходную карту и destination нетронутыми. Прерванный процесс может оставить служебный staging-каталог; он исключён из индекса и компонентов родительского проекта.

`terrainOperations` принимает до 100 обычных Terrain operations: можно добавить дороги через corridor, выравнивание площадок, noise/smoothing, texture rules, поддерживаемую воду или local catalog edits. Сначала выполняется landscape, затем terrainOperations, затем metadataPatch. Stamp внутри create не принимается: выбери нужного native-донора как заготовку. Во время create используются существующая палитра и local catalog dependencies. Новые внешние ассеты разрешай обычными Browse/Terrain/Data командами после создания с настроенными installed/dependency roots.

Если заготовка является корнем MCP workspace (`directory:""`), используй `destinationDirectory:".sc2mcp-output/MyMap"`. Созданные карты в этом дереве не попадают в родительские Layout/Text/Cutscene/Data/Browse индексы. После создания открой каталог новой карты как отдельный проект.

## Завершение карты

В созданном проекте доступны прежние модули: `terrain.*`, `placement.*`, `data.*`, `browse.*`, `ui.*`, `text.*`, `cutscene.*`, `ai.*`, `script.*`. GUI-триггеры не редактируются. `placement.createLocation` с параметром terrain может сформировать совместный план объектов и поверхности.

Сохрани полные transaction groups → `ui.test_readiness` → разбери diagnostics → `map.export` → открой/сохрани/переоткрой карту в SC2Editor → компиляция Galaxy → игровой запуск. `map.create` возвращает component-directory; упаковка выполняется через map.export. Пример для корневого проекта:

```json
{"tool":"map.export","arguments":{"archive":".sc2mcp-output/MyMap.SC2Map","dryRun":false}}
```

## Проверки Terrain и ограничения

`terrain.components.inspect` проверяет CellFlags v101/102, SyncCliffLevel conventional CLIF v100 и VertCol v103/104. Размеры сеток, длины payload и границы variable entries проверены на четырёх native-картах. Неизвестные версии остаются PRESERVE_ONLY. Raw flag histogram не является grid проходимости. VertCol sub-data остаётся opaque: корректная структура не доказывает смысл цветовых данных. Ошибки известных envelopes блокируют Terrain plan, map.validate и регистрацию blueprint.

| Возможность | Фактический статус |
|---|---|
| Новая карта из подходящей native-заготовки | Реализовано, с сохранением исходного содержимого |
| Рельеф/шум/сглаживание/текстуры/палитра | Реализованы поддерживаемые операции и 10 стилей |
| Обрывы/рампы существующей заготовки | Сохраняются native-данные; генерация новой topology отсутствует |
| PaintedPathingLayer/SyncPathingInfo | Сохраняются; writers и проверка engine pathing отсутствуют |
| Вода | Flat WATR v110 rectangles на сетке 8 клеток и CWater; complex bodies/shoreline opaque |
| Освещение | CTerrain binding и базовые CLight/cycle поля; full fog/sky/postprocess не завершены |
| Размер карты/players/variants | Наследуются; произвольный resize и полный редактор параметров не реализованы |
| Чистая native-карта без исходных файлов | Не реализовано |
| Windows/SC2Editor/compiler/runtime | NOT_EXECUTED в текущей Linux-среде |

Полное покрытие стандартных функций остаётся PARTIAL. Следующие native gates: минимальная пустая foundation; cliff-cell/hardtile/ramp codecs и согласованный sync rebake; painted pathing + sync pathing; complex water; player/variant/dependency semantics; целевой Editor/game oracle.
