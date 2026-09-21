# SC2Editor MCP alpha.18 — самостоятельное создание карт

Дата: 14 сентября 2026. 10 модулей, 164 MCP-команды: UI 41, Cutscene 20, Text 6, Data 5, AI 5, Browse 11, Placement 19, Terrain 31, Map 15, Script 11.

## Практический результат

Добавлено создание нового проекта карты из локально зарегистрированной native-заготовки. Codex может проверить и зарегистрировать источник, создать новую карту с поддерживаемым ландшафтом, затем открыть созданный каталог и использовать прежние модули для объектов, данных, интерфейса, текстов, катсцен и Galaxy. GUI-триггеры исключены из разработки.

Полная самостоятельная генерация произвольной карты с нуля не завершена. Этот релиз закрывает вариант «из исходной заготовки» для поддерживаемого conventional native-profile. Исходные объекты, скрипты, зависимости и неизвестные компоненты наследуются. Пустая карта, однажды сохранённая целевым редактором с нужными размером/tileset/игроками, будет удобной основой. Такой пустой Editor-verified template в текущем корпусе не найден и в пакет не включён.

## Изменения

- map.blueprint.inspect: известная foundation validation, полный content fingerprint плюс archive metadata, размеры/tileset, inherited Objects и Galaxy-файлы. Недостаточный conventional Terrain bundle отклоняется.
- map.blueprint.register/list: локальный content-pinned registry, 64 записи/256 KiB; исходный каталог остаётся источником. Хешы source и registry проверяются при создании. Дубликаты ID и небезопасные/невалидные записи отклоняются.
- map.create: disposable snapshot → landscape → terrainOperations → MapInfo patch → known offline validation → публикация нового каталога. Dry-run выполняет реальные преобразования и возвращает тот же contentSha256. Ошибки до публикации сохраняют source/destination. Размеры, players/variants и сценарное содержимое наследуются.
- Native completeness admission: для принятого template-profile требуются conventional Terrain XML/height/masks/sync/cliff/texture-sync/cell-flags/hardtile/fluff/vertex-color/water файлы. Это правило текущего workflow, не доказательство всех допустимых оптимизированных native profiles.
- terrain.components.inspect: CellFlags v101/102 размеры/payload/raw histogram; SyncCliffLevel conventional CLIF v100 размеры/payload; VertCol v103/104 fixed fields/sub-data boundaries/trailing bytes. Неизвестные версии остаются preserve-only. Значение raw flags, цветовых sub-data и согласованность cliff geometry не объявлены проверенными.
- Известные повреждённые envelopes блокируют Terrain plan/validate, Map validation и blueprint registration. Metadata symlink paths отклоняются общим workspace path guard.
- Созданные карты и staging под .sc2mcp-* исключены из родительских Layout/Text/Cutscene/Data/Browse/asset индексов; native .sc2mcp-locales остаётся eligible. Это предотвращает смешивание исходной и новой карты.
- HTTP использует тот же strict contract: GET /api/map/blueprints, GET /api/map/blueprint?directory=..., POST /api/map/blueprint/register, POST /api/map/create, GET /api/terrain/components.
- Package/lock/MCP/HTTP/build-info текущей сборки alpha.18. Map/Terrain schema generators используют общий APP_VERSION.

Подробные JSON-запросы, порядок открытия нового проекта, сохранение и export — docs/MAP_CREATION_RU.md в исходном и portable-пакетах.

## Оба EXE

| Файл | SHA-256 |
|---|---|
| SC2Editor_x64(2).exe | 9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164 |
| SC2_x64.exe | 83dc73ea273594fc6d74b496200c5ea80c4e4bc378912fef88d37b4226c20db2 |

Редактор byte-identical прежнему input. Выполнены read-only PE sections/entrypoint/string/address scan и bounded objdump disassembly для двух файлов. В середине/конце .text энтропия выборок ~7.997 bit/byte; начало .text даёт множество некорректных инструкций. Entry-point bootstrap местами декодируется, но это не Terrain writer. Прямых xrefs из кода к отобранным Terrain-строкам не обнаружено.

Эти признаки позволяют предполагать кодирование/защиту основной секции; механизм не установлен. Полная декомпиляция Terrain бизнес-логики не выполнена. Распознанные имена не превращены в выдуманные native writers. Для дальнейшего восстановления полезен доступный декомпилированный проект или образ памяти с декодированными функциями; текущие статические EXE сами по себе не дали подтверждённого cliff/ramp/pathing writer. EXE не запускались и не изменялись.

Скрипт воспроизводимого анализа: scripts/analyze-map-executables.ts; результаты: generated/map-executable-analysis.json. Сопоставление с published format research — дополнительный источник, проверяемый по native bytes: https://github.com/sc2-arcade-watcher/sc2-file-format-docs . Для VertCol подтверждены границы, а семантические названия полей/цветовой кисти не приняты автоматически.

## Проверено

- Полный набор: 268 PASS, 0 FAIL, 0 SKIP; TypeScript build/release и ESLint PASS.
- Восемь новых tests: restart registry; dry-run/create manifest equivalence; сценарное/opaque preservation; stale content/list/metadata/drafts; failed generation без публикации; malformed native grids; root output isolation; HTTP strict parity; MPQ export/reopen (несколько assertions объединены в cases).
- Три дополнительных native envelopes проходят четыре исходные карты: Nydus, Ant, City, Warships. Source fixture SHA/untouched preservation checks сохранены.
- Portable JavaScript smoke: initialize/164 tools, ten-module coverage, Galaxy recipe/connect/stage/save, lighting, grouped UI save, readiness, actual blueprint register/create + matching dry-run и output isolation, HTTP health/status.
- Реальный пример: Nydus Conspiracy, 32×32, BelShirEx1, 44 eligible native entries. map.create изменил MapInfo, t3HeightMap, t3SyncHeightMap; остальные исходные entries сохранены. SC2Map экспортирован, повторно извлечён, хешы каждого native entry сверены. В нём унаследованы исходные MapScript/Triggers/данные сценария, поэтому он не является пустой заготовкой или готовой новой игрой.

Windows launcher/native Windows helper, SC2Editor save/reopen, Galaxy target compiler и game runtime: NOT_EXECUTED. Portable smoke выполняет JS на Linux. Архивный content equality не доказывает игровые rendering/pathing/behavior semantics.

## Что ещё нужно для цели «идеал»

| Приоритет | Работа | Критерий готовности |
|---|---|---|
| 1 | Минимальная пустая native foundation | Editor-saved blank donor, все component roots/versions/dependencies/default player state, открытие/save/reopen без неожиданной регенерации |
| 2 | Cliff topology + ramps | XML cliff cells/ramp transforms + height base/masks + hardtile geometry + sync height/cliff consistency; controlled Editor donor pairs и реальный unit traversal |
| 3 | Native pathing | PaintedPathingLayer и SyncPathingInfo codecs, runtime grid, связи footprint/cliffs/ramps/holes; путь юнитов/строительство подтверждены |
| 4 | Complex water | Не только flat rectangles: bodies/layers/shoreline/waves/geometry; native load/save и rendering probes |
| 5 | Surface layers и environment | VertCol brush semantics, terrain holes/hard surfaces/foliage, полный lighting state/fog/sky/postprocess/cycle |
| 6 | Map settings/resize | Players/teams/variants/dependencies; согласованная перестройка Terrain/Objects/Regions/Cameras/sync grids |
| 7 | Другие прежние модули | Full Data layers/defaults/index/removal semantics, Regions/Cameras/footprints, typed Galaxy AST/resources/compiler, завершение gated AI и UI/Cutscene/Text semantic graphs |
| 8 | Целевые проверки | Windows launcher/helper; Editor open/save/reopen component diffs; compiler; SC2 behavior/rendering/pathing probes |

goalComplete=false. Отчёт перечисляет реальные оставшиеся ограничения; этот релиз не заявляет полной эквивалентности всем функциям редактора.
