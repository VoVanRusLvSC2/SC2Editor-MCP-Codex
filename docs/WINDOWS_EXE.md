# Windows EXE and portable distribution

## Delivered launcher

`SC2-UI-Workbench.exe` is a native PE32+ x86-64 Windows GUI executable. It imports only four standard `KERNEL32.dll` functions, uses Unicode Windows paths, switches its working directory to the EXE location, and starts the adjacent signed-readable PowerShell launcher. It does not contain a hidden downloaded payload.

The PowerShell layer:

1. finds bundled `runtime\node.exe`, Node from PATH, or `%ProgramFiles%\nodejs\node.exe`;
2. rejects Node older than 20;
3. displays the standard Windows folder chooser;
4. remembers the last component directory in `%APPDATA%\SC2UIWorkbench`;
5. starts the local GUI server on `127.0.0.1:4312`;
6. opens the default browser;
7. stops the server when the user closes the launcher message.

The launched workbench can attach `GameUI/UIContainer`, its lower/console/upper layers, or any explicitly entered descriptor path and `file`. These choices use the same generic frame operation as MCP; the EXE does not contain a one-container-only editor.

## Packages

The cross-built RC package includes the real EXE, launcher, compiled application, Schema Registry and production Node dependencies. Because the build environment is Linux and has no Windows `node.exe`, this package uses an installed Node.js 20+.

To make the same folder fully self-contained, run on Windows:

```powershell
.\windows\build-portable.ps1
```

or:

```powershell
npm install
npm run windows:portable
Compress-Archive -Path .\release\SC2-UI-Workbench-Windows\* `
  -DestinationPath .\release\SC2-UI-Workbench-Windows-x64.zip -Force
```

When the build runs under Windows Node, it copies that exact executable to `runtime\node.exe`. The resulting folder no longer requires a system Node installation.

## Verification performed in this environment

- PE signature: `MZ` and `PE\0\0`;
- machine: AMD64 (`0x8664`);
- format: PE32+;
- subsystem: Windows GUI;
- import table parsed successfully;
- fixed image base with relocations marked stripped;
- production application copied with only runtime dependencies;
- portable application started with its bundled app tree using the available Node runtime;
- HTTP `/api/health` reported 892 frame types and 1,918 properties;
- static workbench page loaded successfully;
- two automated PE/launcher regression tests.

The native launcher could not be executed under Windows in this Linux environment, so the report distinguishes PE structural verification from an actual Windows double-click test.

## Packed maps

The EXE chooser accepts unpacked/component directories. Binary `.SC2Map` and `.SC2Mod` files still require the configured archive adapter described in [RUNTIME_AND_ARCHIVES.md](RUNTIME_AND_ARCHIVES.md). The GUI does not silently treat an MPQ file as a directory.
