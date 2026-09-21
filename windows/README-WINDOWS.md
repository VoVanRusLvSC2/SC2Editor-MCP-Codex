# SC2Editor MCP / SC2 UI Workbench — Windows

## Start

Double-click `SC2-UI-Workbench.exe`.

1. Select an unpacked/component `.SC2Map`, `.SC2Mod`, or another directory containing SC2 UI files.
2. The launcher starts the local editor and opens `http://127.0.0.1:4312`.
3. Make staged changes, validate, inspect the diff, and use **Save + backup**.
4. Return to the launcher message and click **OK** to stop the local server.

The launcher remembers the last selected directory in `%APPDATA%\SC2UIWorkbench`.

The GUI's **Attach UI container** field offers `GameUI/UIContainer`, lower/console/upper presets, and accepts any other descriptor path with its `file` value. See `docs\REAL_EXAMPLE_RU.md`; the complete generated component tree is in `examples\UI`.

## Node runtime

If the package contains `runtime\node.exe`, it is fully portable. Otherwise it uses Node.js 20+ from PATH or `%ProgramFiles%\nodejs\node.exe`.

To create a self-contained build on Windows:

```powershell
npm install
npm run windows:portable
Compress-Archive -Path .\release\SC2-UI-Workbench-Windows\* -DestinationPath .\release\SC2-UI-Workbench-Windows-x64.zip -Force
```

The build copies the exact `node.exe` running npm into `runtime\node.exe`.

## Packed maps

The EXE folder picker opens component directories. For a packed binary map, configure `SC2_UI_ARCHIVE_ADAPTER` and use `npm run gui:archive -- MyMap.SC2Map`, or extract it first with the supported archive adapter workflow. The launcher does not disguise an unpacked directory editor as native MPQ support.

## Seven-module MCP alpha.7

The same package contains ui.*, cutscene.*, text.*, data.*, browse.*, placement.* and ai.*. Run `node app\dist\index.js` and set SC2_UI_ROOT to the component directory. GUI includes UI Editor, Browse / Placement and A.I. Module tabs; Cutscene/Text/Data also use the compact MCP APIs. AI writes only CustomAI + sibling ComponentList; Trigger bindings are read-only. Trigger/Terrain top-level modules are not included. Populated AI waves/composition remain explicit opt-in/unconfirmed; no Editor/game compatibility test was performed. See docs\AI_CODEX_GUIDE_RU.md and README_RU.md.
