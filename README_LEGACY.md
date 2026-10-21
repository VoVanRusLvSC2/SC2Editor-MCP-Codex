# SC2Editor MCP

Our code: Copyright (c) 2026 **VoVanRusLvSC2**
(vladimir.lencmanis@gmail.com), [singularity](LICENSE).
A project using our code or modules must be listed in README, Credits or
About the program that uses the SC2Editor-MCP-Codex modules from VoVanRusLvSC2,
As well as retaining copyright and license terms, Surface Toolkit wrote:
**vise** (indicated by the project owner). [Authorship and example of mention](CREDITS.md),
[third-party license](THIRD_PARTY_LICENSES.md),
[source composition for GitHub](PUBLISHING.md).

The MCP server for working with StarCraft II map and mod files. The main code is TypeScript/Node.js; the C++ backend in `native/` reads and collects MPQ. The GUI uses the same workspace and transactions.

**TERRAIN:** [device, commands, examples and support boundaries](docs/TERRAIN.md). The existing module added Surface Toolkit from `SC2_Surface_Toolkit_SC2GameData.zip`: component review, raw grids, structural checks, edit preview and terrain directory reading tools called `terrain.surface.*`.

**ModKit / map.preview:** [Data, CASC and interactive map preview from ModKit](docs/MODKIT_INTEGRATION.md). Additional runtime: `npm run modkit:setup`, Node.js 22+.

**CASC:** [Reading the established SC2 and cache](docs/CASC.md). [Report: What works and what doesn’t yet](docs/CAPABILITIES_REPORT.md).

**Render v61:** Original mip levels of DDS 2D/cube, native UV and mixing of detailed normals, LOD reflections and bias of static textures. Blue Director UI and preset property inspector retained. [Changes in changes](CHANGELOG.md)00; [Historical status v42 (TXT)](docs/RENDER_STATUS_V42.txt). Match with SC2 engine not yet confirmed; native shadow passage and full post-processing not yet complete.

**Shoot capture via MCP:** [`cutscene.render` – a frame of WebGL2 directly in MCP](docs/CUTSCENE_MCP.md#preview-and-frame-capture). Example: `{"file":"MyScene.SC2Cutscene","time":3000,"width":1280,"height":720}`. Needs Edge/Chrome installed; after source update and build, reconnect MCP. Capture transfer checked by protocol/controller tests, the actual browser capture of this version has not yet been verified.

**SETTINGS:** [attributes, game options, players and options cards](docs/SETTINGS.md) The finished package contains `SC2-MCP.cmd`; [connection to the MCP client](windows/README-WINDOWS.md).

**DOCUMENT:** [creating an empty map base and fashion](docs/DOCUMENT_CREATION.md) Local implementation includes 10 MCP commands; Editor/runtime verification has not been performed.

**Original document module plan:** [creating an empty map base and fashion](docs/DOCUMENT_FOUNDATION_PLAN.md), [Decompilation and DMP-derived data](docs/DOCUMENT_FOUNDATION_RESEARCH.md) The plan retains the original research gates; actual profiles are described in the creation manual.

## Modules.

| Team space | Appointment | Management |
| --- | --- | --- |
| `ui.*` | SC2Layout/StormLayout, frames, properties, anchors, states and animations | [UI](docs/CODEX_GUIDE.md) |
| `text.*` | Localization, Font Styles and rich text | [Text](docs/TEXT_CODEX_GUIDE.md) |
| `cutscene.*` | Scenes, cameras, shots and animation tracks | [Cutscene](docs/CUTSCENE_CODEX_GUIDE.md) |
| `data.*` | GameData Catalog XML, Fields, Links, and Packet Changes | [Data](docs/DATA_MCP.md) |
| `ai.*` | CustomAI and Permitted Linked Components | [AI](docs/AI_CODEX_GUIDE.md) |
| `browse.*` | Search for available directories, assets and dependencies | [Browse](docs/BROWSE_PLACEMENT_MCP.md) |
| `placement.*` | Unit/Doodad/ObjectPoint, scatter and surface binding | [Placement](docs/BROWSE_PLACEMENT_CODEX.md) |
| `terrain.*` | Relief, textures, water, light, plans and analysis of native components | [TERRAIN](docs/TERRAIN.md) |
| `casc.*` | Real resources of the installed game, search/reading, cache build and Data/Browse mounts | [CASC](docs/CASC.md) |
| `settings.*` | Attributes, native game variants, player options and options MapInfo v39 | [Settings](docs/SETTINGS.md) |
| `document.*` | Fresh dependent/extension mod and empty Arcade map, dependencies and initial flat grids | [Document](docs/DOCUMENT_CREATION.md) |
| `map.*` | MPQ import/export, MapInfo and map creation from workpiece | [Map](docs/MAP_MCP.md) |
| `script.*`, `trigger.*` | Galaxy and limited operations of GUI triggers in the script profile | [Script](SCRIPT-GUIDE.md), [Trigger](docs/TRIGGER_MCP.md) |

`modkit.capabilities` shows active modules. `modkit.save`/`modkit.discard` retains or cancels the entire group of drafts containing the specified file. `ui.project_status` shows the known capabilities and limitations.

## Run on Windows

Node.js 20+ commands are executed from the root of the repository:

```powershell
npm ci
npm run build
$env:SC2_UI_ROOT = "K:\Maps\MyMap.SC2Map"
$env:SC2_MCP_PROFILE = "terrain"
node dist/index.js
```

`SC2_UI_ROOT` indicates an unpacked map/mode or shared directory with separately selected card folders. The packaged SC2Map is first imported via `map.import`. the server stdout is occupied by the MCP protocol.

Profiles: `all`, `ui`, `cutscene`, `data`, `terrain`, `casc`, `settings`, `landscape`, `document`, `script`, `authoring`, `minimal`, `focused-data`, `focused-script`, `focused-authoring`By default. `all`. `SC2_MCP_MODULES` sets the exact comma list and has priority; this choice adds UI.

GUI: `npm run gui`, then `http://127.0.0.1:4312`. [Description of workbench](docs/GUI_WORKBENCH.md). Windows package: `npm run windows:portable`; [manual](docs/WINDOWS_EXE.md).

## Working with TERRAIN

The main commands are `terrain.paint`, `terrain.blend`, `terrain.generate`, `terrain.mountain`, `terrain.plan` with noise/smooth/raise; `terrain.hide` and `terrain.show` hide/restore the ground. All return the stored plan. The concealment is visually confirmed by the user on the provided `p.SC2Map`.

1. `terrain.surface.overview` - see the composition of native components and unknown formats.
2. `terrain.surface.component.inspect` or narrow sample - check the desired grid/section.
3. `terrain.plan`, `terrain.generate`, `terrain.recipe.plan`, water/lighting plans - prepare supported changes.
4. `terrain.preview` and `terrain.validate` - check the plan.
5. `terrain.apply` with explicit dry-run/stage parameters → `terrain.save` – save the group with SHA verification and backup.

`terrain.surface.plan.cell` returns only the diagnostic preview of raw bytes and dependent layers. It does not create a stored Terrain plan and does not change drafts.

## Audits and structure

```powershell
npm test
npm run lint
npm run build:release
npm run terrain:schemas
```

[The structure of the repository and what is stored in Git](docs/REPOSITORY_STRUCTURE.md), [architecture](docs/ARCHITECTURE.md), [status](docs/PROJECT_STATUS.md), [history](CHANGELOG.md).

Support for native cliffs/ramps, complex water bodies, and end-to-end playability remains incomplete. Green local tests do not confirm opening/saving in SC2 Editor or game runtime; limitations are specified by the respective teams.
