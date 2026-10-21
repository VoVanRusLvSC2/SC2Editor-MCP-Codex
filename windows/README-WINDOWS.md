# SC2Editor MCP for Windows x64

The portable package uses `runtime\node.exe` with `app\dist\index.js`, or the
`SC2-MCP.cmd` launcher. Installing npm or Node.js is unnecessary for the portable
package. `SC2-UI-Workbench.exe` opens the optional web GUI; stdio MCP does not need it.

## MCP client configuration

```json
{
  "command": "C:/Tools/SC2Editor-MCP/runtime/node.exe",
  "args": ["C:/Tools/SC2Editor-MCP/app/dist/index.js"],
  "env": {
    "SC2_UI_ROOT": "K:/Maps/MyMap-components",
    "SC2_CASC_ROOT": "C:/Program Files (x86)/StarCraft II",
    "SC2_MCP_PROFILE": "workflow"
  }
}
```

Replace the package and workspace paths. The root is an unpacked component
folder or a workspace into which maps are imported. Inspect/import a packed map
with `map.archive.inspect` and `map.import`, edit its components, then export it
with `map.export`. The bundled StormLib archive backend is included.

Start with `modkit.capabilities`. The workflow profile keeps compact authoring,
batching and discovery entry points visible while retaining underlying modules.
Use `modkit.author_help` for short commands; Galaxy is the default logic mode.
The `all` profile exposes the full set of schemas. `document` focuses on creating
a document foundation; `landscape` includes terrain, CASC, settings, map, data,
browse, placement, text and UI. Existing focused profiles remain available.

CASC reads the installed game and maintains a local workspace cache. Readers
start lazily. File-based MCP operations do not require opening SC2 Editor.
Static validation does not replace actual Editor/game acceptance.

Guides: `docs\AUTHORING_PROTOCOL.md`, `docs\TERRAIN.md`, `docs\CASC.md`,
`docs\SETTINGS.md`, and `docs\DOCUMENT_CREATION.md`. Consult capability reports
for exact supported subsets. Native terrain editing and previews are available;
engine navigation rebuilding and visual parity still require separate checks.

Build from source with `npm ci` followed by `npm run windows:portable`. The GUI
launcher selects a component directory and opens `http://127.0.0.1:4312`.
