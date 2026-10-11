# Готовый SC2Editor MCP для Windows x64

Для MCP используется `runtime\node.exe` с `app\dist\index.js`, либо `SC2-MCP.cmd`. Установка npm/Node.js для переносного пакета не нужна. `SC2-UI-Workbench.exe` запускает дополнительный web GUI; для MCP stdio он не требуется.

## MCP-клиент

В настройках вашего MCP-клиента задайте:

```json
{
  "command": "C:/Tools/SC2Editor-MCP/runtime/node.exe",
  "args": ["C:/Tools/SC2Editor-MCP/app/dist/index.js"],
  "env": {
    "SC2_UI_ROOT": "K:/Maps/MyMap-components",
    "SC2_CASC_ROOT": "C:/Program Files (x86)/StarCraft II",
    "SC2_MCP_PROFILE": "all"
  }
}
```

Замените пути пакета и рабочей папки карты. Root — распакованные компоненты карты или папка, внутри которой импортируются карты. Упакованный файл сначала открывается через `map.archive.inspect`/`map.import`, редактируется в компонентах и сохраняется через `map.export`. Bundled StormLib backend уже включён.

По умолчанию `all` сохраняет доступ ко всем существующим модулям и добавляет CASC/Settings. Для работы только с картой профиль `landscape` включает работающую поверхность, чтение реальной игры через CASC, Settings, Map, Data, Browse, Placement, Text и UI. `all` включает также остальные существующие модули: Cutscene, AI, Script/Trigger. Узкие прежние профили сохранены. Первая команда — `modkit.capabilities`.

CASC читает установленную игру; служебный кэш `.sc2mcp-casc-cache` лежит в рабочей папке. Reader запускается лениво. Для старта/работы файловых команд SC2 Editor не нужен. Для текущего выпуска редактор не запускался.

Руководства: `docs\TERRAIN_RU.md`, `docs\CASC_RU.md`, `docs\SETTINGS_RU.md`. Реальные ограничения: `docs\CAPABILITIES_REPORT_RU.md`. Native cliffs/ramps/pathing rebuild, team/alliance reconstruction и полная engine validation пока отсутствуют.

Из исходников: `npm ci`, затем `npm run windows:portable`. GUI запускается `SC2-UI-Workbench.exe`, выбирает component-directory и открывает `http://127.0.0.1:4312`.
