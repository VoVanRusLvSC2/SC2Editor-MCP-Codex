# Создание пустой основы карты и мода

Модуль `document.*` создаёт новую основу из параметров: обычный mod, extension mod, пустую Arcade map с Terrain либо без него. Он не требует зарегистрированную карту и не копирует чужой scenario. Для поверхности создаёт ровную начальную сетку с выбранной текстурой; дальнейшая генерация ландшафта и игровой скрипт выполняются существующими модулями отдельно.

Реализация доступна локально в ветке `codex/document-foundation`. Исследование и исходные игровые данные не публикуются. SC2 Editor не запускается; результат проверяется native codecs, реальными SDK calls и pack/reopen MPQ. Совпадение всех внутренних defaults с редактором и игровой запуск ещё не подтверждены.

## Поддерживаемые параметры

| Основа | Параметры |
| --- | --- |
| Dependent Mod | destination, name, locales, ordered dependencies |
| Extension Mod | Те же параметры; отдельный `Flags/ExtensionMod` в DocumentInfo |
| Empty Arcade Map | То же; width/height 32..256 с шагом 8, включая прямоугольные карты |
| Map с Terrain | CTerrain из выбранных dependencies; initial texture из его palette; baseHeight 0..12 |
| Map без Terrain | Complete MapInfo, structural bootstrap и пустая metadata; t3 components отсутствуют |

В source-backed local profile: Header H2CS v8, version markers v2, MapInfo v39, Terrain XML v115, HMAP101/SMAP102/MASK102/RTXT101/LFCT102/CLIF100 и empty auxiliary tables. Генерируются fresh metadata/locale strings и complete empty player/variant/lighting structures. Header имеет собственный content stamp; его идентичность всем native publish/hash semantics не заявлена. Product tag `0x5332` установлен отдельно от ExtensionMod flag.

Для карты есть только пустой `InitMap` — системная точка входа без gameplay initialization. Авторских объектов, триггеров, библиотек и сценарных функций нет. Melee/Training initialization не добавлена.

## Команды

| Команда | Назначение |
| --- | --- |
| `document.capabilities` | Реальные профили и ограничения |
| `document.types` | Какие параметры применимы к каждому виду |
| `document.dependencies.list` | Source specifications стандартных Liberty/Swarm/Void presets |
| `document.dependencies.inspect` | Развёрнутый ordered graph, implicit Core, missing/cyclic sources |
| `document.terrain_sets.list` | Paginated CTerrain choices из выбранного graph |
| `document.terrain_sets.get` | Palette/cliff definitions/provenance конкретного CTerrain |
| `document.plan` | Fresh bytes и manifest без записи пользовательского destination |
| `document.validate_plan` | Повторная проверка модели и источников |
| `document.create` | Dry-run/private materialization либо создание components/packed output |
| `document.inspect` | Строгая повторная проверка созданной основы по manifest |

Схемы: [document-tools.json](../generated/document-tools.json). Профиль `document` объединяет UI, Document, CASC, Map, Terrain, Settings, Text, Data и Browse. `all` сохраняет остальные прежние модули и включает Document. Старые узкие профили не переопределяются.

## Примеры

Создать обычный mod:

```json
{"tool":"document.plan","arguments":{
  "kind":"mod","modType":"dependent","destination":"mods/MyMod","name":"Мой мод",
  "locales":["ruRU","enUS"],
  "dependencies":{"mode":"standard","expansion":"void","campaign":false}
}}
```

Для extension mod меняется только `modType:extension`. Это не операция публикации на Blizzard services.

Сначала узнать palette выбранного CTerrain:

```json
{"tool":"document.terrain_sets.get","arguments":{
  "dependencies":{"mode":"standard","expansion":"liberty","campaign":false},"id":"Agria"
}}
```

Затем подготовить пустую карту:

```json
{"tool":"document.plan","arguments":{
  "kind":"map","mapType":"arcade","destination":"maps/EmptyAgria","name":"Пустая карта",
  "locales":["ruRU","enUS"],
  "dependencies":{"mode":"standard","expansion":"liberty","campaign":false},
  "map":{"width":128,"height":96},
  "terrain":{"enabled":true,"tileSet":"Agria","initialTexture":"AgriaDirt","baseHeight":8},
  "initialization":"empty"
}}
```

Plan возвращает ID, manifests, content SHA, resolved dependencies и diagnostics. Изменения выбранных пакетов или installed build блокируют создание.

```json
{"tool":"document.validate_plan","arguments":{"planId":"document_..."}}
{"tool":"document.create","arguments":{"planId":"document_...","dryRun":false,"output":"components"}}
```

Для packed файла использовать `output:packed`. Destination `maps/EmptyAgria` даёт `maps/EmptyAgria.SC2Map`; mod даёт `.SC2Mod`. Если destination уже имеет правильное расширение, components output использует дополнительный `.components`. Создать два output вида из одного plan нельзя после появления любого из них: нужен новый destination/plan.

DryRun по умолчанию true, реально записывает private temporary components, читает их обратно и, для packed output, упаковывает/переоткрывает MPQ. Пользовательский destination публикуется только после всех проверок. Существующие outputs не заменяются; packed publication использует exclusive hardlink. Original map/game files не изменяются.

## Источники и последующая работа

Standard dependency closure использует bounded native expansion chain Core→Liberty→Swarm→Void и выбранный campaign layer. Пакеты проверяются по реальному CASC ROOT; required TerrainData читаются с CKey/SHA checks. Это не проверка наличия абсолютно всех game assets. Custom entries требуют local component directories внутри MCP root; `bnet:` ID и `file:` specification сохраняются отдельно. Циклы, duplicate direct entries, неправильный bnet формат и несколько explicit multiplayer dependencies отклоняются. Другие native conditional dependencies/automatic multiplayer policies не считаются полностью эмулированными.

CTerrain resolver поддерживает ordered overrides, direct arrays, parent inheritance и `##id##` substitution. Required indexed/remove/token shapes вне этого subset помечаются unsupported, а plan для такого набора отклоняется. Каталог всего SC2 не подменяет выбранную dependency closure.

Созданная component-directory становится новым `SC2_UI_ROOT`. Тогда доступны прежние Terrain/Settings/Data/Script tools. Для Data/Browse installed dependency views подключаются обычным `casc.mount`; создание документа не объявляет каждый найденный пакет автоматически активным в прежних resolvers. Custom local dependencies должны быть размещены так, чтобы SC2 мог разрешить сохранённый file specification.

`document.inspect` проверяет **неизменённую основу**. После авторских правок ожидаемые SHA основы изменяются; затем используют обычные validators соответствующего модуля. Служебный `.sc2mcp-document.json` исключён из MPQ и родительских индексов. Общий `ui.test_readiness` ориентирован на map с Terrain; для mod и no-terrain foundation использовать `document.inspect` и нужные Data/Text/Script checks.

## Проверки и ограничения

Проверены native Header reader на существующем fixture, все его truncated prefixes, exact 44-byte marker, fresh complete MapInfo, initial rectangular grids, inheritance/tokens, strict schemas, mod subtype, localisation, dryRun, full source guards, stale builds, cyclic/local dependencies, existing destinations, actual native MPQ pack/reopen и real SDK creation через установленный SC2.

Не заявлены: полный Editor New Document default fidelity, native publish identity semantics, Melee/Training profiles, cliffs/ramps/border generation, nav/collision rebuild, полноценные engine material/lighting/minimap rendering, remote dependency downloads и работа игры без отдельной проверки. Minimap — простой gray initial preview. 11 октября 2026 пользователь подтвердил открытие `EmptyAgriaFixedPacked.SC2Map` в SC2 Editor после исправления генератора. Сам агент редактором не управлял. Editor save/reopen и game runtime остаются непроверенными.

[План и его границы](DOCUMENT_FOUNDATION_PLAN_RU.md) · [Исследование](DOCUMENT_FOUNDATION_RESEARCH_RU.md) · [Общий отчёт](CAPABILITIES_REPORT_RU.md).


## Исправление остановки на Loading Terrain (11.10.2026)

Первая карта `EmptyAgriaPacked.SC2Map` проходила проверки контейнера, но зависала при открытии Terrain в редакторе. В генераторе были два дефекта: отсутствовал `heightMap/cliffCellList`, через который native XML-reader выделяет половинную сетку уступов, и в `t3SyncHeightMap` оставался нулевой масштаб. Новый профиль `native-empty-v39-v115-local-2` всегда создаёт пустой `cliffCellList` размером `width*height/4` и единичный Q12-масштаб `[4096,4096,4096]` на смещениях 28/32/36. Этот масштаб независимо подтверждён четырьмя картами, сохранёнными редактором.

Проверка `terrainLoadContract` отклоняет пропущенные сетки cliff/block, неправильные размеры SMAP и нулевой масштаб. Регрессионный тест воспроизводит оба прежних дефекта. Пользователь подтвердил успешное открытие исправленной карты. Это подтверждение относится к совокупному исправлению: отдельно влияние каждого дефекта на зависание не измерялось.

Источник поведения XML-reader: [описание t3Terrain XML](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/t3terrain-xml.md#cliffcelllist-element), раздел `cliffCellList`. Старый файл не перезаписывался, поэтому для проверки следует открывать новый файл `EmptyAgriaFixedPacked.SC2Map`.


## Дальнейшая авторская работа после создания основы

`trigger.plan` создаёт обычные триггеры непосредственно в корне карты, когда `create.library` не задан или равен пустой строке. Для существующей пользовательской библиотеки можно по-прежнему указать её ID. Корневые ссылки записываются без `Library=""`, названия используют `Trigger/Name/<Id>`. Стандартные определения SC2 (`Ntve`) остаются ссылками на встроенные действия и события, а новая библиотека ресурсов не создаётся.

`trigger.normalizeScriptLayout` теперь оставляет перед `include` в корневом CustomScript только структурный XML-отступ, который редактор удаляет при чтении. Исправлены пять лишних пробелов, обнаруженные пользователем. `include "Scripts/SmallSkirmish"` и сам файл Galaxy сохранены в примере карты.

На карте игрок против компьютера в `Objects` размещены 47 юнитов/ресурсов и 70 декораций. При старте скрипт получает базы через `UnitFromId`, поэтому не создаёт вторые экземпляры. Раса в параметрах обоих игроков задана токеном `Terr`; названия и сообщения имеют таблицы ruRU и enUS. Пользователь подтвердил работу Galaxy и атак компьютера, затем отображение объектов в редакторе на v3. Для исправления относительной высоты юнитов выпущена отдельная v4.
