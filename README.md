# SC2EditorToolkit

**Verified scope:** supported MCP authoring workflows and original Editor checks
on recorded fixtures. The pinned Toolkit 1.0.0/protocol15 integration has scoped
native compilation, Data, save/reopen and original Editor rendering evidence.
Compilation, save/reopen and exact saved-artifact gameplay have their own dated
acceptance records; the complete quality roadmap remains open. See the
[acceptance matrix and reproducible checks](docs/VERIFICATION.md) for evidence and
the features still awaiting engine/gameplay validation.

The public project name is **SC2EditorToolkit**. The existing repository URL,
`sc2editor-mcp` protocol identifier, environment variables and tool names remain
compatible; the historical source and license attribution are retained.

Current agent workflow: [Authoring protocol](docs/AUTHORING_PROTOCOL.md), [compact commands](docs/MCP_AUTHORING_SCRIPT.md), and [trigger organization](docs/TRIGGER_ORGANIZATION_PROTOCOL.md). Galaxy is the default logic language. Terrain profiles and reference palettes are available through `terrain.catalog`, `terrain.style`, and `terrain.compose`. Maintained documentation is English.

The source includes the [authoring reference catalog](resources/authoring-catalog/README.md),
[measured decor workflow](docs/DECOR_VISUAL_WORKFLOW.md), portable [agent rules](AGENTS.md)
and three scoped [project skills](.agents/skills/README.md). These are runtime and
authoring inputs, not optional local reports. Verify them with
`npm run catalog:verify` and `npm run docs:check-language`.

[Native Editor checks](docs/NATIVE_EDITOR.md) use the optional pinned Toolkit 1.0.0
backend; `map.preview` remains the fast ModKit preview. Native compilation,
save/reopen, rendered appearance and gameplay have distinct verification scopes.

[Private game tests](docs/NATIVE_GAME.md) can use a separately installed
SC2GameToolkit through `game.status/tools/attach/call/detach`. The integration
does not bundle its private sources or instrument delivered maps. Game launch
requires explicit local configuration; the existing Editor adapter is independent.

Original code: Copyright (c) 2026 **VoVanRusLvSC2**
(vladimir.lencmanis@gmail.com), under the [custom attribution license](LICENSE).
Projects using our code or modules must credit VoVanRusLvSC2 and identify
SC2Editor-MCP-Codex as their source in README, Credits or About, in addition
to retaining copyright and license notices. Surface Toolkit author: **vise**
(attribution provided by the project owner). Third-party components keep their
own licenses; see [credits](CREDITS.md), [license scope](THIRD_PARTY_LICENSES.md) and the
[source publication checklist](PUBLISHING.md).

A single MCP server and local workbench for StarCraft II map/mod files. TypeScript/Node.js implements semantic tools and shared transactions; the C++ backend in `native/` handles MPQ archives.

[Legacy guide](README_LEGACY.md) · [TERRAIN module](docs/TERRAIN.md) · [Repository structure](docs/REPOSITORY_STRUCTURE.md)

Installed SC2 resources can now be read directly through `casc.*`, with a verified build-specific cache and explicit Data/Browse mounts. [CASC guide](docs/CASC.md) · [Current capabilities and gaps](docs/CAPABILITIES_REPORT.md).

**Renderer v61:** original DDS 2D/cube mip chains, native material UV/detail-normal and reflection LOD handling, and scoped static sampler bias. Blue Director UI and the authored-property inspector are retained. [Changes](CHANGELOG.md); [historical v42 status](docs/RENDER_STATUS_V42.txt). SC2 engine parity remains unvalidated; native shadow passes and complete postprocessing remain unfinished.

**MCP frame capture:** [`cutscene.render` WebGL2 frame capture for MCP](docs/CUTSCENE_MCP.md#preview-and-frame-capture), using installed Edge/Chrome and the same player as interactive preview. Protocol/controller tests pass; actual browser capture of this version is not yet verified. Rebuild and reconnect MCP to load the new tool.

**Settings:** [map attributes, variants, players and game options](docs/SETTINGS.md). Portable packages include `SC2-MCP.cmd`; [MCP setup](windows/README-WINDOWS.md).

## Modules

| Module | Scope | Documentation |
| --- | --- | --- |
| UI | Layout frames, properties, anchors, states, animations | [UI guide](docs/CODEX_GUIDE.md) |
| Text | Localization, Font Styles and rich text | [Text](docs/TEXT_MCP.md) |
| Cutscene | Scenes, cameras, shots and animation tracks | [Cutscene](docs/CUTSCENE_MCP.md) |
| Data | Native Catalog XML, references and batch edits | [Data](docs/DATA_MCP.md) |
| AI | CustomAI metadata and bounded authoring | [AI](docs/AI_MCP.md) |
| Browse / Placement | Available assets, dependencies, Unit/Doodad/ObjectPoint plans | [Browse / Placement](docs/BROWSE_PLACEMENT_MCP.md) |
| Terrain | Height, textures, recipes, flat water, lighting and component inspection | [TERRAIN](docs/TERRAIN.md), [API](docs/TERRAIN_MCP.md) |
| CASC | Installed-game MNDX/BLTE reads, search, byte/semantic cache and metadata mounts | [CASC](docs/CASC.md) |
| Settings | Map attributes, native game variants, v39 players and game options | [Settings](docs/SETTINGS.md) |
| Document | Fresh empty dependent/extension mods and Arcade map foundations | [Document](docs/DOCUMENT_CREATION.md) |
| Map | MPQ import/export, MapInfo and template-based creation | [Map](docs/MAP_MCP.md) |
| Script | Galaxy and bounded GUI trigger authoring | [Script](SCRIPT-GUIDE.md), [Trigger](docs/TRIGGER_MCP.md) |

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
