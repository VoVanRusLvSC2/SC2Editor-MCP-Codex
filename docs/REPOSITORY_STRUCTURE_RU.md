# Структура репозитория

Проект — TypeScript MCP/GUI application с C++ MPQ/CASC backends. Публичных модулей тринадцать; `trigger.*` подключается вместе с Script. Единственный composition root — `src/app/project.ts`, сервер — `src/app/server.ts`, выбор инструментов — `src/app/moduleSelection.ts`.

| Каталог | Что хранится и зачем |
| --- | --- |
| `src/app/` | Сборка модулей, сервер, профили, capability/coverage checks |
| `src/core/` | XML source spans, Workspace, text/binary drafts, групповая запись, stale guards и recovery journal |
| `src/modules/` | UI-связанные и предметные модули; TERRAIN содержит новый `surface/` |
| `src/mcp/` | UI MCP server и подключение существующих модулей |
| `src/gui/` | HTTP API и браузерный workbench |
| `src/schema/`, `schema/` | Runtime registry и схемы UI |
| `src/tests/` | Тесты проекта и необходимые native/synthetic fixtures |
| `tests/terrain-surface/` | Перенесённые toolkit regressions и выбранные SC2GameData observations |
| `generated/` | Runtime registries, входные tool schemas и относящиеся к ним evidence |
| `scripts/` | Генерация схем, discovery, проверки, benchmarks и сборка portable |
| `native/` | C++ archive adapter, необходимые runtime binaries и лицензии StormLib |
| `windows/` | Launcher и Windows-инструкции |
| `examples/` | Воспроизводимые примеры |
| `docs/` | Текущие руководства, форматы, ограничения и архитектура |

Большинство файлов `generated/` — `data-xsd-index`: manifest и маленькие XSD shards, которые реально читает `DataXsdRegistry`. Это нужные runtime-данные. Galaxy, Trigger, AI, Cutscene, Text и Data registries также используются кодом/portable сборкой. Название generated само по себе не означает мусор.

## CASC

`src/modules/casc` владеет installed-game source, проверенным кэшем и metadata mounts. `native/casc` содержит helper source, pinned upstream revision и license; `native/bin/windows-x64/sc2-mcp-casc.exe` нужен runtime/portable. Game bytes и source ZIP references исключены из Git через `.sc2mcp-casc-cache/` и `work/`. [CASC guide](CASC_RU.md).

## TERRAIN

Подключение: профиль `terrain` → `registerTerrainTools` → существующие инструменты и `registerTerrainSurfaceTools`. Новый toolkit использует общий Workspace. Его format/core layer оставлен отдельным, чтобы исследовательские profiles не меняли действующий writer. [Полное описание](TERRAIN_RU.md).

## Очистка ALPHA

Удалены четыре отдельные устаревшие сводки из корня: `ALPHA15-PROGRESS-RU.md`, `ALPHA17-READINESS-RU.md`, `ALPHA18-MAP-CREATION-RU.md`, `CHANGELOG-alpha12.md`. Удалены десять одноразовых `generated/*alpha*` отчётов: старые preflight/verification, water/lighting/corpus и portable status. Их история доступна в Git.

Benchmark baseline нужен для сравнения результатов: он переименован в `generated/terrain-doodads-performance-baseline.json`, ссылка обновлена. В текущих именах tracked файлов ALPHA больше нет. Prerelease version в package metadata и записи общей истории сохраняют честный статус продукта.

README теперь описывает актуальные модули и ведёт в предметные руководства. Основной CHANGELOG, спецификации, native evidence, runtime registries и тестовые карты сохранены.

Из ZIP перенесены format/core sources, нужные тесты/fixtures, selected observations и notices. Не включены `dist/`, вложенные original ZIP, vendor mirror, старые build logs, EXE string dumps и непроверенные отдельные MCP templates. Исходный пользовательский ZIP сохранён в Downloads; распакованный вход находится в игнорируемой `work/` рабочей копии на K.

## Что не хранить в Git

Для публичной поставки используй [актуальный состав и ограничения](../PUBLISHING_RU.md)
и `npm run publication:audit`. Локальный исследовательский репозиторий содержит
уже отслеживаемые fixtures/evidence; `.gitignore` не исключает их из истории.
Сторонний renderer использует свой `vendor/blizzard-models/dist/`, поэтому
игнорирование корневого `/dist/` не распространяется на него. Название каталога
`generated/` также не является основанием для удаления runtime registries.

`node_modules/`, `dist/`, `dist-runtime/`, `release/`, `work/`, сборочные логи, cache/temp/backup files. Они исключены `.gitignore`. Новый отчёт следует коммитить только тогда, когда он нужен runtime, воспроизводимой проверке или объясняет неизвестный формат с указанием источника.
