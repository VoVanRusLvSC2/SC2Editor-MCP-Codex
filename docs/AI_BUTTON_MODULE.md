# AI Button module for SC2EditorToolkit

`SC2EditorToolkit.exe` connects the separately packaged AI Button module to an
already running StarCraft II Editor. Click **AI** on that Editor's toolbar to
open the chat. The module reuses the existing configured `sc2editor` MCP server,
provider accounts and current-document tools; it does not install or replace
that server or create a map copy.

The upstream extension is pinned by repository commit in `ai-button-release.json`.
Its original DLL/loader and bridge remain separate under `modules/ai-button`.
The installed Editor executable is not patched. This is an extension window,
not a registered native Editor module.

## Requirements and use

- Windows x64 and Editor **5.0.17.98310** with a visible window.
- Installed Node.js **18.14+**, discoverable by the already-running Editor or
  installed under the standard Program Files Node.js directory.
- A compatible signed-in Codex installation or separately configured Claude API
  access. Claude additionally needs its upstream SDK setup; see the module README.
- A configured `sc2editor` MCP server for map authoring. Loading the toolbar
  button alone does not verify an MCP connection or map-editing capability.

Run `SC2EditorToolkit.exe`. A single visible Editor is selected automatically;
with multiple Editors, choose one explicitly. The original loader checks its
version and toolbar, then confirms attachment. No Editor or map is started,
closed or saved by this launcher. An unknown loader result is not retried.

For explicit targeting or read-only package verification:

```powershell
powershell -NoProfile -File .\SC2EditorToolkit.ps1 -EditorPid 1234
powershell -NoProfile -File .\SC2EditorToolkit.ps1 -ValidateOnly
```

`ValidateOnly` verifies declared file hashes without contacting an Editor or AI
provider. Hashes detect mismatched/corrupt module files; the manifest is not a
cryptographic signature or a replacement for trusting the package source.

## Build and package

```powershell
npm run ai-button:build
npm run ai-button:test
npm run ai-button:package -- C:\Tools\SC2EditorToolkit-AI
```

The builder obtains the exact pinned upstream source in an ignored work folder
and runs its original Windows build and native tests. Visual Studio C++ x64
tools, Windows SDK and Git are required. Alternatively pass the path of an
existing clean checkout at that exact commit to `ai-button:build`.

The module is installed locally in the ignored
`native/bin/windows-x64/ai-button/<revision>` directory; updates never replace a
DLL loaded from an earlier revision. Packaging accepts a **new** destination
directory. It copies only the
declared runtime, bridge and notices; it excludes upstream C++ sources, debug
symbols, tests, account data, maps and private GameToolkit runtime files.
The small AI module package uses an existing MCP installation; it is not a full
MCP distribution. The full Windows portable builder includes this module when
it was built first, alongside the existing Workbench EXE.

Module/file validation and compilation are distinct from live attachment,
provider authentication and successful map edits. Test those separately with
the actual Editor and configured MCP.
