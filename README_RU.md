# SC2Editor MCP

Наш код: Copyright (c) 2026 **VoVanRusLvSC2**
(vladimir.lencmanis@gmail.com), [отдельная лицензия с атрибуцией](LICENSE).
Проект, использующий наш код или модули, обязан указать в README, Credits или
«О программе», что использует модули SC2Editor-MCP-Codex от VoVanRusLvSC2,
а также сохранить copyright и условия лицензии. Автор Surface Toolkit:
**vise** (указан владельцем проекта). [Авторство и пример упоминания](CREDITS.md),
[сторонние лицензии](THIRD_PARTY_LICENSES.md),
[состав исходников для GitHub](PUBLISHING_RU.md).

MCP-сервер для работы с файлами карт и модов StarCraft II. Основной код — TypeScript/Node.js; C++ backend в `native/` читает и собирает MPQ. GUI использует ту же рабочую область и транзакции.

**TERRAIN:** [устройство, команды, примеры и границы поддержки](docs/TERRAIN_RU.md). В существующий модуль добавлен Surface Toolkit из `SC2_Surface_Toolkit_SC2GameData.zip`: обзор компонентов, сырые сетки, структурные проверки, предварительный просмотр правок и чтение terrain-каталогов. Инструменты называются `terrain.surface.*`.

**CASC:** [чтение установленного SC2 и кэш](docs/CASC_RU.md). [Отчёт: что работает и чего ещё нет](docs/CAPABILITIES_REPORT_RU.md).

**SETTINGS:** [атрибуты, варианты игры, игроки и options карты](docs/SETTINGS_RU.md). Готовый пакет содержит `SC2-MCP.cmd`; [подключение к MCP-клиенту](windows/README-WINDOWS.md).

**DOCUMENT:** [создание пустой основы карты и мода](docs/DOCUMENT_CREATION_RU.md). Локальная реализация включает 10 MCP команд; Editor/runtime проверка не выполнялась.

**Исходный план document-модуля:** [создание пустой основы карты и мода](docs/DOCUMENT_FOUNDATION_PLAN_RU.md), [исследование декомпиляции и DMP-derived данных](docs/DOCUMENT_FOUNDATION_RESEARCH_RU.md). План сохраняет исходные research gates; фактические профили описаны в руководстве создания.

## Модули

| Пространство команд | Назначение | Руководство |
| --- | --- | --- |
| `ui.*` | SC2Layout/StormLayout, фреймы, свойства, anchors, states и анимации | [UI](docs/CODEX_GUIDE_RU.md) |
| `text.*` | Локализация, Font Styles и rich text | [Text](docs/TEXT_CODEX_GUIDE_RU.md) |
| `cutscene.*` | Сцены, камеры, shots и анимационные дорожки | [Cutscene](docs/CUTSCENE_CODEX_GUIDE_RU.md) |
| `data.*` | GameData Catalog XML, поля, ссылки и пакетные изменения | [Data](docs/DATA_MCP.md) |
| `ai.*` | CustomAI и разрешённые связанные компоненты | [AI](docs/AI_CODEX_GUIDE_RU.md) |
| `browse.*` | Поиск доступных каталогов, ассетов и зависимостей | [Browse](docs/BROWSE_PLACEMENT_MCP.md) |
| `placement.*` | Unit/Doodad/ObjectPoint, scatter и привязка к поверхности | [Placement](docs/BROWSE_PLACEMENT_CODEX_RU.md) |
| `terrain.*` | Рельеф, текстуры, вода, свет, планы и анализ native-компонентов | [TERRAIN](docs/TERRAIN_RU.md) |
| `casc.*` | Реальные ресурсы установленной игры, поиск/чтение, кэш по сборке и Data/Browse mounts | [CASC](docs/CASC_RU.md) |
| `settings.*` | Attributes, native game variants, параметры игроков и options MapInfo v39 | [Settings](docs/SETTINGS_RU.md) |
| `document.*` | Fresh dependent/extension mod и пустая Arcade map, зависимости и initial flat grids | [Document](docs/DOCUMENT_CREATION_RU.md) |
| `map.*` | MPQ import/export, MapInfo и создание карты из заготовки | [Map](docs/MAP_MCP.md) |
| `script.*`, `trigger.*` | Galaxy и ограниченные операции GUI-триггеров в профиле script | [Script](SCRIPT-GUIDE-RU.md), [Trigger](docs/TRIGGER_MCP_RU.md) |

`modkit.capabilities` показывает активные модули. `modkit.save`/`modkit.discard` сохраняют или отменяют всю группу черновиков, содержащую указанный файл. `ui.project_status` показывает известные возможности и ограничения.

## Запуск на Windows

Нужен Node.js 20+. Команды выполняются из корня репозитория:

```powershell
npm ci
npm run build
$env:SC2_UI_ROOT = "K:\Maps\MyMap.SC2Map"
$env:SC2_MCP_PROFILE = "terrain"
node dist/index.js
```

`SC2_UI_ROOT` указывает на распакованную карту/мод или общий каталог с отдельно выбранными папками карт. Упакованный SC2Map сначала импортируется через `map.import`. stdout сервера занят MCP-протоколом.

Профили: `all`, `ui`, `cutscene`, `data`, `terrain`, `casc`, `settings`, `landscape`, `document`, `script`, `authoring`, `minimal`, `focused-data`, `focused-script`, `focused-authoring`. По умолчанию `all`. `SC2_MCP_MODULES` задаёт точный список через запятую и имеет приоритет; при таком выборе добавляется UI.

GUI: `npm run gui`, затем `http://127.0.0.1:4312`. [Описание workbench](docs/GUI_WORKBENCH.md). Windows-пакет: `npm run windows:portable`; [инструкция EXE](docs/WINDOWS_EXE.md).

## Работа с TERRAIN

Основные команды: `terrain.paint`, `terrain.blend`, `terrain.generate`, `terrain.mountain`, `terrain.plan` с noise/smooth/raise; `terrain.hide` и `terrain.show` скрывают/восстанавливают грунт. Все возвращают сохраняемый plan. Скрытие визуально подтверждено пользователем на предоставленной `p.SC2Map`.

1. `terrain.surface.overview` — увидеть состав native-компонентов и неизвестные форматы.
2. `terrain.surface.component.inspect` или узкий sample — проверить нужную сетку/секцию.
3. `terrain.plan`, `terrain.generate`, `terrain.recipe.plan`, water/lighting plans — подготовить поддерживаемые изменения.
4. `terrain.preview` и `terrain.validate` — проверить план.
5. `terrain.apply` с явными параметрами dry-run/stage → `terrain.save` — сохранить группу с проверкой SHA и резервной копией.

`terrain.surface.plan.cell` возвращает только диагностический preview сырых байтов и зависимых слоёв. Он не создаёт сохраняемый Terrain plan и не меняет черновики.

## Проверки и структура

```powershell
npm test
npm run lint
npm run build:release
npm run terrain:schemas
```

[Структура репозитория и что хранится в Git](docs/REPOSITORY_STRUCTURE_RU.md), [архитектура](docs/ARCHITECTURE.md), [текущий статус](docs/PROJECT_STATUS.md), [история изменений](CHANGELOG.md).

Поддержка native cliffs/ramps, сложных water bodies и конечной игровой проходимости остаётся неполной. Зелёные локальные тесты не подтверждают открытие/сохранение в SC2 Editor или игровой runtime; ограничения указаны у соответствующих команд.
