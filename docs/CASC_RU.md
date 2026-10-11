# CASC: чтение ресурсов установленного StarCraft II

Модуль `casc.*` открывает **настоящую установленную игру**, разбирает CASC/MNDX и читает декодированные байты файлов. Готовый сторонний дамп для этого не нужен. C++ helper использует закреплённую MIT-licensed [CascLib](https://github.com/ladislav-zezula/CascLib/tree/38a34665624b8775bb875274b36191b21c38d97b); TypeScript управляет MCP, источником сборки, кэшем и Data/Browse views.

## Запуск

```powershell
npm ci
npm run build
$env:SC2_UI_ROOT = "K:\Maps\MyMap.SC2Map"
$env:SC2_CASC_ROOT = "C:\Program Files (x86)\StarCraft II"
$env:SC2_MCP_PROFILE = "casc"
node dist/index.js
```

`SC2_UI_ROOT` — рабочая карта/мод, `SC2_CASC_ROOT` — установленная игра с `.build.info`. Windows default — `C:/Program Files (x86)/StarCraft II`. Кэш по умолчанию лежит в `<workspace>/.sc2mcp-casc-cache`; `SC2_CASC_CACHE` позволяет выбрать отдельный каталог. Кэш внутри установки игры запрещён.

Профиль `casc` включает UI, CASC, Data и Browse. Для совместной работы с поверхностью используй `all` либо `SC2_MCP_MODULES=terrain,casc,data,browse,placement,map`. Старые узкие профили сохраняют свои поверхности инструментов. Native reader запускается лениво и держит индекс в одном процессе.

## Команды

| Команда | Что делает |
| --- | --- |
| `casc.status` | Фактическая сборка, native index, доступность, кэш и подключённые пакеты |
| `casc.search` | Пагинация и поиск logical paths; `prefix` выбирает папку, `query` — подстроку |
| `casc.file.inspect` | Размер, локальная доступность, CKey/EKey, сборка |
| `casc.read_text` | Реальные UTF-8 байты через кэш; страницы текста с SHA и explicit truncation |
| `casc.read_bytes` | До 4096 декодированных байтов ресурса по offset; например M3/DDS header |
| `casc.mount` | Извлечь выбранные metadata kinds в кэш-view и подключить к Data/Browse |
| `casc.galaxy.symbols` | Имена/сигнатуры top-level Galaxy declarations, с постоянным сжатым кэшем |
| `casc.cache.references` | Список импортированных справочных материалов |
| `casc.cache.verify_reference` | Проверить SHA каждого исходного файла справочника по текущему CASC |

Все инструменты читают исходную игру. `readOnlyHint:true` относится к game/map data; служебный кэш создаётся отдельно. Нет CDN fetch, записи CASC или запуска текста/скриптов, прочитанных из ресурсов. Недоступный локальный payload возвращает явную ошибку.

```json
{"tool":"casc.search","arguments":{"prefix":"mods/liberty.sc2mod","query":"marine.m3","limit":10}}
{"tool":"casc.read_text","arguments":{"file":"mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml","maxChars":8000}}
{"tool":"casc.galaxy.symbols","arguments":{"file":"mods/core.sc2mod/base.sc2data/triggerlibs/natives.galaxy","query":"UnitCreate","limit":10}}
```

Поиск возвращает реальные имена из ROOT manifest. `local:false` означает отсутствие payload в локальной установке. Число ROOT names и число locally available paths различаются; ни один из этих счётчиков не доказывает прочтение всех файлов.

## Подключение GameData к проекту

```json
{"tool":"casc.mount","arguments":{"packages":["mods/core.sc2mod","mods/liberty.sc2mod"],"kinds":["catalogs","triggers","strings","schemas"],"locales":["ruRU","enUS"],"maxFiles":1000}}
```

Пути пакетов выбираются из `casc.search`. Виды: `catalogs`, `triggers`, `strings`, `schemas`, `layouts`. Для каталогов сохраняются native Includes/DocumentInfo и отдельные package roots. Data/Browse продолжают использовать свой resolver зависимостей карты. Подключённый пакет без подтверждённой декларации не объявляется engine-active автоматически; неявные engine dependencies остаются отдельно неизвестными.

После mount работают обычные `data.query`, `data.context` и `browse.search`. Это чтение actual game XML. Полное native inheritance/default/token/override поведение и существующие XSD/GUI registries не становятся автоматически полностью подтверждёнными новой сборкой.

При missing/corrupt payload возвращается `PARTIAL_NOT_MOUNTED`; неполный новый root не регистрируется. Готовые mounts восстанавливаются при запуске после проверки SHA файлов. Смена build key убирает старые roots из Data/Browse. `.build.info` входит в tracked read set при Data-операциях, использующих CASC views.

## Кэш

```text
.sc2mcp-casc-cache/
  <build-key>/
    files/<logical-path>                 реальные декодированные байты
    metadata/<logical-path>.json         источник, версия, CKey/EKey, size, SHA-256
    views/<package>/                    read-only input для Data/Browse
    mounts/<package-hash>.json           manifest проверенных view-файлов
    summaries/<path-hash>.json.gz        Galaxy symbol summary + исходный SHA
  references/                          отдельно импортированные справочники
```

Native reads выполняют strict BLTE checks. Полный cached file дополнительно проверяется по CKey/MD5 и получает SHA-256. Warm read проверяет сохранённые байты и текущую identity; повреждённый byte cache перечитывается. Одновременные запросы одного файла делят одну загрузку. Запись кэша идёт через временный файл и rename. Пути с traversal/ADS/control chars, symlink-кэш и смешение сборок запрещены.

Лимиты: full cached file 16 MiB; text page 24000 chars; byte range 4096 bytes; ответы 32000 chars; index 1 million paths; mount до 2000 selected files и 128 MiB. Символы не объявляются модельными токенами. Большие M3/DDS читаются узкими диапазонами; renderer/полное декодирование не добавлены.

## Что использовано из triggers.zip

В архиве нет готового CASC storage reader или извлечённых game files. Извлечены `galaxy/language/workspace/summary-cache.ts` и `galaxy/data/galaxy-script-api.v1.json`: код per-archive gzip summaries и reference на 3341 функции. Реализация собственного summary cache использует SHA исходника и build key вместо одного size/mtime.

Публичный репозиторий не содержит чужой архив, его private prose/source copy, готовый справочник или игровые байты. Извлечённые reference inputs лежат локально. На проверенной установке SHA всех шести объявленных источников справочника отличаются; он остаётся `REFERENCE_SOURCE_MISMATCH` и не заменяет реальные CASC-данные или authoring registry.

## Проверенный результат

На Windows и установленном SC2 **5.0.17.98310**: 780010 ROOT paths; 312145 помечены index metadata как locally available. Через настоящий MCP SDK прочитаны Core UnitData XML, Galaxy natives и байты M3-ресурса из Liberty. Повторный byte read и symbol summary дают cache hits. Mount Core подключил 245 файлов (9878922 bytes); Data query прочитал три CUnit records из этих game bytes.

Это проверка указанной сборки и выбранных reads. Не заявлены CDN downloads, все локали/пакеты/encrypted payloads, engine runtime, 3D rendering и полное семантическое authoring всех ресурсов.

## Сборка native helper

Windows/Linux x64 source:

```powershell
npm run casc:build
npm run casc:schemas
npm run windows:portable
```

Сборка требует CMake и C++ toolchain. CascLib revision закреплена в `native/casc/CASC-REVISION.json`; source получают через FetchContent. `SC2_CASCLIB_SOURCE` может указать локальный checkout с той же ревизией. Windows build содержит static C++ runtime и включается в portable вместе с MIT license. Linux source path предусмотрен; эта проверка выполнена на Windows.
