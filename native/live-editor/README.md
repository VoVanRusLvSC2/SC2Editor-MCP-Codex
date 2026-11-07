# Visible Editor adapters

These are original project-owned optional adapters. They do not contain private
SC2GameToolkit/SC2EditorToolkit sources or replace the hidden acceptance bridge.

- `Program.cs`: exact visible Editor inventory and ordinary file-drop handoff.
  `npm run live:build` uses the installed .NET Framework compiler.
- `MemoryData.cs`: bounded named-mapping IPC. Only explicit `memory-*` commands
  load the separate Data plugin; inventory/file-drop do not load it.
- `memory_loader.cpp`: exact x64 Editor PID/start/build validation and loading of
  the immutable sibling plugin. No arbitrary DLL path or game process target.
- `memory.cpp`: GUI-thread dispatch through a chained Data-window procedure and
  the original Modify Value/inline editor. No SC2 address offsets or archive I/O.
- `memory_protocol.h`: fixed versioned request layout. Operations 0–6 are inspect,
  prepare view, select field, open owned edit, read owned edit, commit, cancel.

`npm run live:memory:build` requires Visual Studio 2022 C++ tools and CMake. The
source fingerprint selects an immutable output directory. The ignored manifest
contains exact binary SHA-256 values; the helper verifies them before loading.
The tested Editor version is 5.0.17.98310 with English Data controls.

Use the public `live.memory.read/set` MCP tools, not raw native commands, for
authoring. TypeScript owns archive/document identity, snapshots, cross-client
leases, final readback and uncertain outcomes. The native adapter also validates
its selected source, unit, exact raw field filter and complete inline value.
Native list text may be clipped and is never treated as the complete numeric value.
Only an unchanged token/generation-owned inline editor can be cancelled; manual
input is preserved. Never dismiss unrelated save, dependency or user dialogs.

The plugin remains resident until Editor exits. MCP closes its retained helper
through EOF and does not terminate Editor or forcibly unload active DLL handlers.
Do not distribute compiled native binaries, local maps or private runtime files
in source commits. See [the live guide](../../docs/LIVE_EDITOR.md) for supported
fields, dirty-state side effects and separate checkpoint/memory evidence.
