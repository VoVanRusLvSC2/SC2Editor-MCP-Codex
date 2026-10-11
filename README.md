# SC2Editor MCP

A single MCP server and local workbench for StarCraft II map/mod files. TypeScript/Node.js implements semantic tools and shared transactions; the C++ backend in `native/` handles MPQ archives.

[Русское руководство](README_RU.md) · [TERRAIN module](docs/TERRAIN_RU.md) · [Repository structure](docs/REPOSITORY_STRUCTURE_RU.md)

Installed SC2 resources can now be read directly through `casc.*`, with a verified build-specific cache and explicit Data/Browse mounts. [CASC guide](docs/CASC_RU.md) · [Current capabilities and gaps](docs/CAPABILITIES_REPORT_RU.md).

**Settings:** [map attributes, variants, players and game options](docs/SETTINGS_RU.md). Portable packages include `SC2-MCP.cmd`; [MCP setup](windows/README-WINDOWS.md).

## Modules

| Module | Scope | Documentation |
| --- | --- | --- |
| UI | Layout frames, properties, anchors, states, animations | [UI guide](docs/CODEX_GUIDE_RU.md) |
| Text | Localization, Font Styles and rich text | [Text](docs/TEXT_MCP.md) |
| Cutscene | Scenes, cameras, shots and animation tracks | [Cutscene](docs/CUTSCENE_MCP.md) |
| Data | Native Catalog XML, references and batch edits | [Data](docs/DATA_MCP.md) |
| AI | CustomAI metadata and bounded authoring | [AI](docs/AI_MCP.md) |
| Browse / Placement | Available assets, dependencies, Unit/Doodad/ObjectPoint plans | [Browse / Placement](docs/BROWSE_PLACEMENT_MCP.md) |
| Terrain | Height, textures, recipes, flat water, lighting and component inspection | [TERRAIN](docs/TERRAIN_RU.md), [API](docs/TERRAIN_MCP.md) |
| CASC | Installed-game MNDX/BLTE reads, search, byte/semantic cache and metadata mounts | [CASC](docs/CASC_RU.md) |
| Settings | Map attributes, native game variants, v39 players and game options | [Settings](docs/SETTINGS_RU.md) |
| Map | MPQ import/export, MapInfo and template-based creation | [Map](docs/MAP_MCP.md) |
| Script | Galaxy and bounded GUI trigger authoring | [Script](SCRIPT-GUIDE-RU.md), [Trigger](docs/TRIGGER_MCP_RU.md) |

The supplied Surface Toolkit is integrated into Terrain through ten `terrain.surface.*` tools. They expose component inventories, bounded raw samples, structural validation, preview-only byte edits and authored terrain catalog inspection. They share the existing workspace and observe staged drafts. Native cliff/ramp rebuild, full pathing semantics, complex water-body editing and engine validation remain unavailable.

Terrain authoring also exposes `terrain.paint`, `terrain.blend`, `terrain.hide`, `terrain.show` and visibility inspection. Ground hiding/restoration was visually confirmed by the user on the supplied p.SC2Map; pathing regeneration remains unavailable.

## Run

Requires Node.js 20+. In PowerShell:

```powershell
npm ci
npm run build
$env:SC2_UI_ROOT = "K:\Maps\MyMap.SC2Map"
$env:SC2_MCP_PROFILE = "terrain"
node dist/index.js
```

Use an unpacked map/mod; use `map.import` for MPQ input. stdout is reserved for MCP traffic. Profiles include `all` (default), `ui`, `cutscene`, `data`, `terrain`, `casc`, `settings`, `landscape`, `script`, `authoring` and focused variants. `SC2_MCP_MODULES` overrides the profile. `modkit.capabilities` reports the actual selection.

Existing authoring tools prepare plans/drafts, validate them and save complete groups with stale guards and backups. The new `terrain.surface.plan.cell` is an in-memory diagnostic and cannot be passed to `terrain.apply`.

GUI: `npm run gui`, then `http://127.0.0.1:4312`. [Workbench](docs/GUI_WORKBENCH.md). Windows portable build: `npm run windows:portable`; [EXE guide](docs/WINDOWS_EXE.md).

## Development

```powershell
npm test
npm run lint
npm run build:release
npm run terrain:schemas
```

Tests include source codec regressions and real SDK stdio checks for Terrain profile selection. [Architecture](docs/ARCHITECTURE.md), [status](docs/PROJECT_STATUS.md), [changelog](CHANGELOG.md).
