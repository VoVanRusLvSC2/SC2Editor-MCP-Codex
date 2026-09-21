# SC2Editor MCP

Alpha.18: `map.blueprint.inspect/register/list` и `map.create` создают новую карту из native-заготовки с генерацией поверхности до публикации. `terrain.components.inspect` проверяет дополнительные native grids/entry boundaries. [Создание карт и ограничения](docs/MAP_CREATION_RU.md). Полная генерация cliffs/ramps/pathing и native карты с нуля ещё не реализована.

Версия: **1.1.0-alpha.19**. Обзор фактических возможностей на 21 сентября 2026 года.

Alpha.13: вода на сетке 8 клеток, высота/RGBA/лава/UV/преломление через CWater, совместное сохранение каталога и Includes. [Руководство по воде](docs/TERRAIN_WATER_RU.md). Основа alpha.12: новый модуль `map.*`, комплектный MPQ backend для Windows/Linux x64, export с reopen/hash каждого entry, lossless MapInfo v39 и pin полного manifest до save. Сложные body/wave sections воды сохраняются без редактирования. Galaxy-скрипты поддерживаются отдельным модулем script.*; GUI-триггеры исключены. [Команды Map и ограничения](docs/MAP_MCP.md).

Workspace text/byte commits используют persistent recovery journal и process lock; прерванные группы восстанавливаются до следующей mutation/startup, внешние неизвестные изменения вызывают conflict. Drafts и commit undo остаются process-local. [Исполнение плана](docs/MAP_DEVELOPMENT_STATUS_RU.md).

Alpha.11: snapshots прочитанных зависимостей и их черновиков сохраняются до save; Data/AI preflight и проверки используют общий read context. 205 тестов. [Описание и ограничения](docs/DEPENDENCY_TRANSACTIONS_RU.md), [аудит восьми разделов alpha.10](docs/PROJECT_ARCHITECTURE_AUDIT_RU.md). Команда `ui.project_status` и GUI `Project coverage` показывают текущие ограничения. 100% полной семантики SC2 не заявляется.

SC2Editor MCP — мост между Codex/MCP-клиентом и файлами карт и модов StarCraft II. Он позволяет искать объекты, менять данные, интерфейс, тексты и катсцены, а также готовить размещение юнитов и декораций, редактировать рельеф и текстуры через структурированные запросы.

Это один существующий проект, один MCP-сервер и общий launcher. Модули используют общие XML-инструменты, schemas, проверки, diff и безопасную запись. Проект не заменяет игровой движок и не обещает автоматически управлять всеми окнами оригинального редактора.

Основной код написан на TypeScript и работает на Node.js; MCP transport — stdio, GUI — локальный web-интерфейс. JSON schemas и evidence reports поставляются вместе с проектом.

## Что уже есть

| Модуль | Что делает |
| --- | --- |
| `ui.*` | Интерфейс карты: фреймы, свойства, шаблоны, anchors, StateGroup, анимации, изображения и кнопки |
| `data.*` | Каталоги GameData: Unit, Actor, Model, Ability, Effect, Behavior, Weapon, Validator и другие типы |
| `text.*` | Локализация, text keys, Font Styles, константы, группы шрифтов и rich text |
| `cutscene.*` | Объекты сцены, камеры, анимационные блоки, свет, звук и другие структуры катсцен |
| `ai.*` | A.I. Module: native CustomAI definitions/waves, пакетная правка и проверки; Trigger bindings только read-only |
| `browse.*` | Поиск каталоговых объектов и путей к ассетам, источники, зависимости и связанные определения |
| `placement.*` | Отдельное размещение Unit/Doodad, группы объектов и создание тематической локации одним планом |
| `terrain.*` | Высота, текстуры, сглаживание, seeded стили, XML recipes, диагностический PNG и групповые byte transactions |
| `map.*` | Исследование основы карты/архива, import/export, полный clone, регистрация заготовок и создание карт, проверка MapInfo v39 и планирование/сохранение метаданных |

### UI

Работает с `SC2Layout`, `StormLayout` и связанными styles. Есть поиск фреймов, описание типов и свойств, создание/клонирование/удаление, применение шаблонов, anchors, StateGroup и анимационные структуры. Сложные таблицы свойств доступны через schema-aware операции.

Основной пакетный инструмент — `ui.apply`: до 100 операций с aliases, проверкой и diff. Есть правила для Blizzard-only фреймов и поиск подходящих существующих шаблонов; неизвестные XML-элементы не удаляются.

По существующему отчёту registry охватывает 892 типа фреймов и 1 918 объявленных typed properties. Это структурное покрытие схем, **не доказательство работы каждого типа в игре**.

### Data

Редактирует нативные `<Catalog>` XML в GameData. Поддерживает создание, клонирование, переименование и удаление объектов, parent, атрибуты, вложенные поля, массивы, `Link`, `value` и `index`. Неизвестные catalog classes остаются generic-представлениями: перечень типов не ограничен несколькими популярными каталогами.

Основной workflow: `data.context` → один `data.apply` с нужными операциями. До 500 операций в транзакции. `data.describe_type` показывает схему и evidence, `data.validate` проверяет структуру и доступные ограничения.

Есть компактные рецепты:

- `recipe.weaponBurn` — цепочка эффектов/бафа с периодическим уроном и визуальным Actor для горения после попадания;
- `recipe.unitTextureByVital` — обратимые состояния текстур по порогу здоровья, когда заданы реальные material slots и DDS-пути.

Это реализованные генераторы данных, а не доказанный запуск каждого рецепта в игре. Модель огня, материалы и dependency должны реально существовать в целевой карте.

По предыдущему сохранённому audit: 1 732 каталога, 165 161 объект, 529 наблюдавшихся C-типов и 10 509 путей полей. Полнота относится к исследованному корпусу; скрытые правила редактора, defaults и engine semantics не объявляются «100% готовыми».

### Text

Работает с локализованными string tables и Font Styles. Есть поиск и правка ключей по нескольким языкам, наследование styles, атрибуты, константы, font groups, поиск/импорт шрифтов и сохранение неизвестной rich-text разметки.

Основной workflow: `text.context` → `text.apply`. Один batch может менять styles и несколько локалей. UI и Text используют общий draft store.

По существующему registry: 2 839 Core Font Styles, 176 констант, 9 font groups и 21 наблюдавшийся style value attribute. Из 38 rich-text candidates 19 распространённых тегов разбираются семантически; остальные могут сохраняться без полной интерпретации. Проверка glyph coverage и точного визуального рендеринга пока не выполнена.

### Cutscene

Работает с `SC2Cutscene`/`StormCutscene`. Есть создание, чтение, составление и пакетное изменение сцен через `cutscene.context`, `cutscene.compose` и `cutscene.apply`.

Поддерживаются объекты Actor/Model, камеры и TargetCamera, director/shot tracks, анимационные слои и блоки, скорость/вес анимаций, свет и другие нативные структуры registry. Некоторые редкие типы/свойства имеют только preserve-only или editor-only evidence — это видно в coverage report.

Есть существующий поиск ассетов катсцен и чтение анимаций `SEQS`/attachment points `ATT_` из доступных M3/M3A. Это metadata reader, а не полноценный 3D renderer.

Текущий merged registry: 52 типа и 664 свойства — 531 supported, 118 Editor-only, 15 runtime-only; 9 типов preserve-only. Исторический discovery счётчик 646 не является текущим merged total. Полные семантики shots, defaults и tangent ID mapping требуют дополнительных проверок.

### Оптимизация и Doodads — alpha.9

Массовое добавление объектов собирает XML за один append/reparse на последовательную группу. Scatter и проверка расстояний используют пространственную сетку с точной финальной проверкой; seeded-последовательность сохранена. Height/texture brushes и обновление sync-текстур обходят ограниченную область, а не всю карту. Кэш защиты native geometry действует в пределах одного плана; sampler читает terrain snapshot один раз.

`placement.scatterDoodads` создаёт weighted смесь реальных Doodads с seed, scale/rotation range, ограничениями высоты, slope и текстур, исключением воды/дыр/защищённых областей и дистанцией от прежних центров объектов. `placement.snapToTerrain` готовит обновление Z выбранных существующих Unit/Doodad по ID. Неизвестный XML сохраняется; Doodads получают наблюдаемый native флаг HeightAbsolute=1. Plan/apply по-прежнему разделены, default apply — dry-run.

В Terrain GUI добавлены поля ID/количества/дистанции/склона и кнопки plan/apply декораций. `terrain.recipe.plan` компилирует XML-рецепт в план за один запрос. Standalone placement отклоняет незаписанный terrain draft; общая terrain/object transaction доступна через createLocation.

[Команды, примеры и измерения](docs/TERRAIN_DOODADS.md), [отчёт проверок](generated/terrain-doodads-test-report.json). Новые проверки: всего 186 PASS; Editor/runtime и визуальная проверка GUI не выполнены.

### Terrain

Добавлен `terrain.*` поверх native `t3Terrain.xml`, `t3HeightMap`, `t3TextureMasks` и поддерживаемых sync-компонентов. Есть inspect/sample/analyze, реальная палитра, поиск материалов через Browse, операции высоты и текстур, Gaussian/edge preserving smoothing, 10 seeded стилей и команды road/river/lake/mountain/valley/plateau/crater/coast/transition.

JSON и строгий XML DSL компилируются в изолированный план. Preview возвращает диагностический PNG; apply по умолчанию dry-run, затем групповой stage/save с SHA-256, backup и восстановлением байтов. Дыры, границы разных mask/cliff levels и область существующих ramps защищены от height brushes. Плоский профиль WATR v110 поддерживает water.create/update/remove на сетке 8 клеток; water.material изменяет CWater states и подключает каталог. Прямоугольники используются как консервативные исключения для размещения, а не доказательство реально затопленного грунта.

`placement.createLocation` с параметром `terrain` возвращает общий Terrain-план и привязывает новые объекты к запланированной поверхности. Для отдельных `placement.addUnit/addDoodad` есть `snapToTerrain:true`. Model footprints, collision и pathing не проверяются.

В GUI есть вкладка **Terrain**. Native cliffs/ramps/pathing и water bodies пока не поддерживаются. MPQ import/export доступны через `map.*` и archive CLI. Sync-стратегия проверена структурно на native компонентах четырёх карт; эквивалентность SC2Editor/runtime не доказана.

[Инструкция для Codex](docs/TERRAIN_CODEX_GUIDE_RU.md), [tools и формат](docs/TERRAIN_MCP.md), [schemas](generated/terrain-tools.json), [демонстрация на копии компонентов](generated/terrain-demo-report.json).

### A.I. Module

Перенесена прежняя реализация из соседней alpha.5 AI-ветки. Пять tools: `ai.context`, `ai.query`, `ai.describe_type`, `ai.apply`, `ai.validate`. Lossless `CustomAI`, definitions, waves, композиция, timing, clone/rename/delete/reorder, aliases и до 250 операций в общей atomic transaction. Использует существующий core и Data inheritance; Unit availability проверяется через Browse при совместном запуске.

Подтверждены оболочка `AIData` и direct `Definition Id`; registry содержит 9 native nodes и 27 properties с разными evidence. Точные имена EXE не доказывают serialization/defaults. Создание заполненных waves/composition остаётся за `allowUnconfirmedStructure:true`; их Editor/runtime compatibility не подтверждена.

Записываются только `CustomAI` и соседний `ComponentList.SC2Components` (`aiai`). Ссылки `aidef/aidefwave` в Triggers читаются для безопасности, но не изменяются. Rename/delete с такими входящими ссылками блокируются даже через force или выключенную обычную validation. Trigger Editor не перенесён. AI не изменяет Terrain; для него добавлен отдельный модуль `terrain.*`.

[Инструкция для Codex](docs/AI_CODEX_GUIDE_RU.md), [tools](docs/AI_MCP.md), [отчёт переноса](docs/AI_MIGRATION_REPORT.md).

### Browse

Отдельный поисковый слой поверх Data MCP, string tables, подключённых распакованных dependencies и файлов ассетов.

Ищет по ID, типу, локализованному имени, text key, части строки, filename, asset path и связанным IDs. Есть фильтры, ranking с объяснением, pagination и компактные результаты. Подробности запрашиваются отдельно.

Инструменты:

`browse.index`, `browse.status`, `browse.search`, `browse.get`, `browse.resolve`, `browse.related`, `browse.dependencies`, `browse.catalogs`, `browse.assets`, `browse.usage`, `browse.validate`.

Можно исследовать цепочки Unit ↔ Actor → Model → asset и Doodad → Model. Часть типов ссылок определяется эвристически и помечается `INFERRED`. Наличие строки `.m3` в каталоге не доказывает наличие соответствующего бинарного файла.

Зависимости читаются из `DocumentInfo` и сопоставляются с настроенными распакованными mod roots. Различаются локальные, объявленные, установленные, но не объявленные, и отсутствующие зависимости. Индекс кэшируется в памяти и обновляется по fingerprints; постоянного per-file индекса пока нет.

### Placement и Create Location

`placement.*` выбирает объект через Browse, а не угадывает ID из текста. Unit и Doodad имеют отдельные удобные операции:

`placement.scan`, `placement.addUnit`, `placement.addDoodad`, `placement.addBatch`, `placement.move`, `placement.rotate`, `placement.scale`, `placement.remove`, `placement.decorate`, `placement.createLocation`, `placement.preview`, `placement.validate`, `placement.apply`, `placement.rollback`.

Поддерживаются position X/Y/Z, rotation, scale, player для Unit, variation, выделение новых IDs и layouts `single`, `line`, `grid`, `circle`, `scatter`. Scatter детерминирован по seed и учитывает расстояние между новыми центрами объектов и исключаемые зоны.

**`placement.createLocation` — один план целой тематической расстановки**, а не только генератор леса. Темы: forest, desert, city, village, industrial, militaryBase, ruins, swamp, cave, alien, terran, protoss, zerg, mixedNature и custom.

Пресеты содержат поисковые слова, не выдуманные каталожные IDs. Для города/базы/посёлка дополнительно резервируются пересекающиеся свободные коридоры. После генерации возвращаются кандидаты, композиция, preview, проверки и diff; запись выполняется отдельно через apply.

Это **объектная декорация области**: она не рисует землю, cliffs или дороги, не вычисляет высоту поверхности и не доказывает проходимость/коллизии моделей. Игровые юниты добавляются отдельно. Если подходящих доступных Doodad definitions нет, операция отказывает, а не создаёт mocks.

## Безопасность

- Изменяющие MCP-инструменты по умолчанию используют dry-run; для реальной записи требуется `dryRun:false`.
- `stage:true` создаёт черновик. `stage:false` запрашивает запись на диск; это разные режимы.
- XML меняется минимальными source-span patches без сериализации всего документа. Неизвестные nodes/attributes, комментарии и нетронутые участки сохраняются.
- Есть diff, schema/runtime-adapter boundary, backup, проверка SHA-256 и rollback при обработанной ошибке транзакции.
- Placement фиксирует hashes Objects/ComponentList при создании плана и отклоняет устаревший план; проверяет дубли IDs и доступность выбранных definitions.
- Bounds должны быть заданы по проверенным размерам карты, когда native dimensions недоступны. Расстояние между центрами не заменяет pathing/collision check.
- Повтор одинакового placement-запроса не создаёт дубль в той же сессии. После перезапуска постоянного idempotency journal пока нет.

Atomic rename относится к отдельным файлам. Multi-file rollback при пойманной ошибке не является гарантией crash-atomic записи всей карты. Backup-откат имеет один уровень и не восстанавливает отсутствие нового файла, если для него не существовало backup.

## GUI и запуск

### Быстрые профили MCP

По умолчанию сервер сохраняет прежний полный набор инструментов. Чтобы не передавать клиенту схемы всех модулей, перед запуском можно выбрать профиль:

```powershell
$env:SC2_MCP_PROFILE = "ui"        # ui + text
$env:SC2_MCP_PROFILE = "cutscene"  # ui + cutscene + browse + data
$env:SC2_MCP_PROFILE = "data"      # ui + data + browse
$env:SC2_MCP_PROFILE = "terrain"   # terrain/map и зависимости
$env:SC2_MCP_PROFILE = "script"    # ui + Galaxy
$env:SC2_MCP_PROFILE = "authoring" # всё для карты, кроме AI
```

Точный набор задаётся через `SC2_MCP_MODULES=data,browse,script`; модуль `ui` добавляется всегда. `modkit.capabilities` показывает активный профиль. Большой Data-реестр загружается лениво при первом Data-запросе.

Декларативную XSD-схему каталогов следует индексировать один раз:

```powershell
npm run data:xsd:index -- "C:\path\to\catalogsData.xsd"
```

Команда сохраняет SHA-256 источника, компактный manifest и отдельный shard каждого именованного типа. `data.describe_type` объединяет declared XSD, наблюдаемый XML и evidence редактора, не загружая исходный многомегабайтный XSD в MCP-контекст.

GUI — прежний локальный web workbench, запускаемый общим launcher. Сейчас есть UI-workspace, вкладка **A.I. Module** с definitions/waves, AiOperation[] editor, preview/diff/apply и вкладка **Browse / Placement** с поиском, metadata, параметрами размещения, генерацией локации, preview/diff и apply. Отдельного EXE для новых модулей нет. Полноценный 3D-preview и отдельные полноценные GUI-вкладки каждого MCP-модуля не заявляются.

Требуется Node.js 20+. Используйте копию **распакованной component-directory** карты или мода, не путь к упакованному `.SC2Map`.

```bash
npm ci
npm run build
```

MCP server в PowerShell:

```powershell
$env:SC2_UI_ROOT = "E:\Maps\MyMap-components"
$env:SC2_ASSET_ROOTS = "E:\SC2Data\Mods\Core.SC2Mod;E:\SC2Data\Mods\Liberty.SC2Mod"
node dist/index.js
```

GUI:

```powershell
$env:SC2_UI_ROOT = "E:\Maps\MyMap-components"
npm run gui
```

Откройте `http://127.0.0.1:4312`. Для Browse можно дополнительно настроить `SC2_BROWSE_INSTALLED_ROOTS`; присутствие root не означает разрешённую dependency — проверьте `browse.dependencies`. На Linux roots разделяются `:`, на Windows — `;`.

Пример настройки MCP-клиента; пути замените своими:

```json
{
  "mcpServers": {
    "SC2Editor": {
      "command": "node",
      "args": ["E:/Tools/SC2Editor_MCP/dist/index.js"],
      "env": {
        "SC2_UI_ROOT": "E:/Maps/MyMap-components",
        "SC2_ASSET_ROOTS": "E:/SC2Data/Mods/Core.SC2Mod;E:/SC2Data/Mods/Liberty.SC2Mod"
      }
    }
  }
}
```

Форма настройки зависит от MCP-клиента; проект предоставляет stdio server, а не автоматически устанавливает конфигурацию Codex.

Windows portable собирается через `npm run windows:portable`. Linux cross-build требует установленный Windows Node.js 20+ или `runtime/node.exe`. Оригинальный SC2Editor и проприетарные стандартные SC2 assets в пакет не включаются.

## Пример: найти объект и создать локацию

Сначала поиск через `browse.search`:

```json
{"query":"Marine","catalogType":"Unit","placeable":true,"limit":5}
```

Для модели и связанных definitions вызовите `browse.related` с **реальным key из результата**, например:

```json
{"key":"<key из browse.search>","depth":3,"limit":30}
```

Создание preview лесной локации через `placement.createLocation`:

```json
{
  "locationType": "forest",
  "area": { "type": "circle", "center": { "x": 64, "y": 64, "z": 0 }, "radius": 20 },
  "objectCount": 20,
  "seed": 1234,
  "minimumDistance": 1.5,
  "scaleRange": { "min": 0.85, "max": 1.15 },
  "bounds": { "minX": 0, "minY": 0, "maxX": 128, "maxY": 128 }
}
```

Здесь координаты/bounds — пример для карты с проверенными такими размерами, не универсальная система размеров SC2. Для другой темы замените locationType на `desert`, `city` или иной пресет. Доступные ассеты определяются dependencies конкретной карты.

После просмотра `placement.preview` и diff, настоящий apply:

```json
{"planId":"<ID возвращённого плана>","dryRun":false,"stage":false,"backup":true}
```

Для безопасной проверки этого же запроса сначала используйте `dryRun:true`. Примеры Unit/group/Doodad/rollback и JSON schemas — в [Browse / Placement reference](docs/BROWSE_PLACEMENT_MCP.md).

## Что проверено

Текущий alpha.11 regression: **205 тестов, 205 passed, 0 failed**; TypeScript build и ESLint PASS. Portable HTTP/MCP smoke и ограничения платформы фиксируются в [отчёте](generated/project-portable-smoke.json). Исторические reports alpha.7/alpha.10 не являются текущим общим прогоном. Большой SC2 corpus sweep заново не выполнялся.

Browse/Placement демонстрация выполнялась на копии **синтетического fixture**, не полноценной реальной карты: четыре Unit в line, двадцать seeded Doodads, dry-run, diff, backup, apply, reparse и preservation checks. Изменённые реальной картой ассеты/terrain не имитировались.

| Проверка | Статус |
| --- | --- |
| Автоматические тесты, build/lint | PASS — сохранённый локальный прогон |
| XML reparse/unknown preservation на fixture | PASS |
| Исследование указанного EXE: версия/hash/strings | Выполнено read-only |
| Полный Browse/Placement сценарий на реальной карте | NOT_EXECUTED |
| Открытие/сохранение результата в SC2Editor | NOT_EXECUTED |
| Визуальная проверка и игровой runtime | NOT_EXECUTED |

Тестовые XML представлены как fixture evidence, а не `PROVEN_BY_REAL_MAP` или editor round-trip. Проверенный EXE: версия `5.0.16.97563`, SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`. Декомпиляция в последнем запуске — `NOT_AVAILABLE_LOCALLY`; она не выдумывалась и не выполнялась повторно.

## Чего пока нет

- Доказанного формата заполненных AI wave/composition, полного визуального AI timeline и L5/L6 validation.
- Trigger Editor MCP и полного редактирования GUI-триггеров. Отдельные Galaxy/runtime helpers не являются таким модулем.
- Native CASC/MPQ discovery/write-back: сохранён внешний archive-adapter protocol, production adapter здесь не поставляется.
- Native structural cliffs/ramps/pathing, произвольные уровни воды и генерация нового terrain bundle с нуля. Height/texture brushes и генерация областей существующей карты доступны.
- Подтверждённой проверки model collision, готового 3D asset renderer или редакторского round-trip для Placement.
- Доказательства «100% семантик всех модулей». Registry coverage, lossless editing, SC2Editor acceptance и runtime compatibility оцениваются отдельно.

## Проверки и документация

```bash
npm test
npm run lint
npm run schema:audit
npm run schema:audit:data
npm run browse:schemas
npm run browse:demo
npm run terrain:schemas
npm run terrain:demo
```

`browse:demo` без аргументов использует синтетический fixture и всегда создаёт рабочую копию. Запуск на настоящей распакованной карте требует доступных объявленных mod roots и адаптации демонстрационных координат. Полный повтор build/tests/lint/portable: `node --import tsx scripts/verify-browse-placement.ts`.

- [A.I. Module: инструкция](docs/AI_CODEX_GUIDE_RU.md) и [отчёт переноса](docs/AI_MIGRATION_REPORT.md)
- [UI: инструкция для Codex](docs/CODEX_GUIDE_RU.md)
- [Data: инструменты](docs/DATA_MCP.md) и [границы покрытия до L5](docs/DATA_PRE_L5_COVERAGE.md)
- [Text: инструкция](docs/TEXT_CODEX_GUIDE_RU.md) и [coverage](docs/TEXT_COVERAGE.md)
- [Cutscene: инструкция](docs/CUTSCENE_CODEX_GUIDE_RU.md) и [coverage](docs/CUTSCENE_COVERAGE.md)
- [Browse / Placement: инструкция](docs/BROWSE_PLACEMENT_CODEX_RU.md), [reference](docs/BROWSE_PLACEMENT_MCP.md), [evidence](docs/BROWSE_PLACEMENT_EVIDENCE.md), [отчёт](docs/BROWSE_PLACEMENT_REPORT.md)
- [Полный лог последних проверок](generated/browse-placement-test-report.json)
- [Архитектура](docs/ARCHITECTURE.md), [история изменений](CHANGELOG.md)

Главный принцип: **Browse находит существующее определение и показывает evidence; Placement готовит безопасный план размещения. Parse PASS не подменяет проверку в SC2Editor или игре.**

Terrain alpha.14: lighting preset assignment, ambient/HDR and Key/Fill/Back directional settings, combined landscape + lighting plans. [Освещение и границы Terrain](docs/TERRAIN_LIGHTING_RU.md). Editor/game acceptance remains unverified.
