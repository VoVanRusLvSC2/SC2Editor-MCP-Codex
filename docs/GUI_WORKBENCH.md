# SC2 UI Workbench

## Purpose

The workbench is the first visual client for SC2 UI MCP. It is not a separate raw XML editor and it is not an HTML imitation of the SC2 renderer. It exposes the same semantic operations used by MCP:

```text
Browser UI -> localhost JSON API -> Workspace -> LayoutDocument
                                      |          |
                                      |          +-> source-span minimal patches
                                      +-> SchemaRegistry / resolver / validator
```

This ensures that a property edited by a person and the same property edited by Codex follow the same staging, validation, diff and save rules.

## Starting the GUI

Install and build:

```bash
npm install
npm run build
```

Linux/macOS:

```bash
SC2_UI_ROOT=/path/to/unpacked-map-or-mod npm run gui
```

Windows PowerShell:

```powershell
$env:SC2_UI_ROOT = "E:\Maps\MyMap.SC2Map"
npm run gui
```

Then open:

```text
http://127.0.0.1:4312
```

For a packed map, configure an archive adapter and use:

```powershell
$env:SC2_UI_ARCHIVE_ADAPTER = "E:\Tools\sc2-ui-archive-adapter.exe"
npm run gui:archive -- "E:\Maps\MyMap.SC2Map"
```

After saving in the GUI, press Ctrl+C to repack atomically with a backup. Without the adapter, packed-map support remains disabled and visibly reported as such.

Optional variables:

```text
SC2_UI_GUI_HOST=127.0.0.1
SC2_UI_GUI_PORT=4312
```

The default host is localhost. Do not expose a writable map/mod directory on a public interface without adding authentication and origin protection.

## Current interface

### Files panel

- lists SC2Layout and StormLayout files;
- filters by path;
- opens staged or on-disk documents;
- creates a staged layout;
- can stage a matching DescIndex Include.
- attaches a root descriptor override using Core-derived GameUI container presets;
- accepts arbitrary custom descriptor path and `file` values instead of restricting projects to `GameUI/UIContainer`.

### Frames panel

- lists all frames with hierarchy indentation;
- filters by name, type, path or template;
- displays the current staged XML source;
- keeps descriptor names and escaped semantic paths distinct.

### Inspector

- displays frame path, type, class and inheritance;
- displays current properties and child count;
- displays a prominent locked-frame runtime warning;
- exposes all effective properties from SchemaRegistry;
- converts Boolean and numeric scalar input to typed values;
- switches table/compound properties to schema-described attributes, selectors and child ElementSpec values;
- stages anchors;
- creates schema-known child frames;
- returns template runtime classification.

### StateGroup and animation builders

- StateGroup builder loads condition/action enums from Schema Registry rather than hard-coding them;
- condition (`When`) and action attributes are entered separately, so property-driven states such as `toggled=True` are expressible;
- users can collect multiple states locally and stage the complete named group atomically;
- animation builder loads all known controller variants, supports multiple controllers, creates time/value keys, and can emit `OnShown -> Reset,Play`;
- controller `end` is editable and the Fade default uses SC2 alpha `0..255`;
- generic JSON attributes remain available for controller-specific fields without raw XML editing.

### Review panel

- validation output;
- minimal staged diff;
- activity/errors;
- discard without touching disk;
- save only after validation succeeds;
- backup plus atomic rename.

## Local JSON API

Discovery endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Version, workspace and schema counts |
| GET | `/api/files` | Layout/style file lists |
| GET | `/api/layout?file=...` | Source, frames, SHA and staged state |
| GET | `/api/frame?file=...&path=...` | Frame and effective type schema |
| GET | `/api/types?search=...` | Search frame types |
| GET | `/api/containers` | Core-derived container presets plus custom-path capability |
| GET | `/api/type?type=...` | Describe one type |
| GET | `/api/schema/coverage` | Full schema audit |
| GET | `/api/property/schema?type=...&property=...` | Scalar/table/complex property metadata |
| GET | `/api/schema/state` | State condition/action variants |
| GET | `/api/schema/animation` | Animation controller variants |
| GET | `/api/capabilities` | Runtime/archive capability truth |
| GET | `/api/validate?file=...` | Semantic validation |
| GET | `/api/diff?file=...` | Current staged minimal diff |

Mutation endpoints:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/file/create` | Create staged layout/style and optional Include |
| POST | `/api/frame/create` | Create schema-known frame |
| POST | `/api/frame/delete` | Delete one frame subtree |
| POST | `/api/property/set` | Set/remove typed scalar or generic attributes |
| POST | `/api/anchor/set` | Create or patch one anchor |
| POST | `/api/template/apply` | Apply template and return runtime classification |
| POST | `/api/apply` | Ordered atomic operations with aliases, validation and diff |
| POST | `/api/runtime/probe` | Execute configured SC2 runtime adapter and return captured report |
| POST | `/api/save` | Atomic save with backup |
| POST | `/api/discard` | Remove staged draft |

All browser mutations explicitly use:

```json
{"dryRun":false,"stage":true}
```

No normal editing control writes directly to disk.

## Container overrides

`Attach UI container` starts with `GameUI/UIContainer`, but it is a convenience picker rather than a whitelist. The presets come from Blizzard Core `Layout/UI/GameUI.SC2Layout`:

```text
GameUI/UIContainer
GameUI/UIContainer/FullscreenLowerContainer
GameUI/UIContainer/ConsoleUIContainer
GameUI/UIContainer/FullscreenUpperContainer
```

All four use `file=GameUI`. A user may enter another descriptor path and layout file name. The GUI sends the same generic `/api/frame/create` operation with no `parentPath`; child creation then targets the resulting escaped semantic path.

## Example property request

```http
POST /api/property/set
Content-Type: application/json
```

```json
{
  "file": "UI/Layout/GameUI.SC2Layout",
  "framePath": "GameUI~1UIContainer/MyWindow/AcceptButton",
  "property": "Enabled",
  "value": false,
  "dryRun": false,
  "stage": true
}
```

## Safety behavior

- Workspace paths cannot escape `SC2_UI_ROOT`.
- Request bodies are limited to 1 MB.
- Static file paths cannot escape the bundled GUI directory.
- CSP permits only same-origin scripts/styles/API calls.
- Locked types are blocked unless the API caller explicitly sets `allowBlizzardOnly`.
- Locked template compatibility never suppresses the runtime warning.
- Save is blocked in the browser when validation has errors.
- Existing files receive `.sc2uimcp.bak` before atomic replacement.
- Unknown XML is retained by the source-span document model.

## Next GUI milestones

1. Dedicated anchors canvas and numeric layout controls.
2. Template browser with ordinary/locked/incompatible filters.
3. Hookup tree viewer and missing-hookup repair assistant.
4. Node-graph presentation over the current StateGroup builder.
5. Timeline/curve presentation over the current animation builder.
6. SC2Style browser/editor.
7. Multi-file transaction review and persistent undo history.
8. Live preview over the external SC2 runtime adapter.

The future preview must be clearly labeled as engine-backed or approximate. A browser box model is not proof of SC2 pixel output.
