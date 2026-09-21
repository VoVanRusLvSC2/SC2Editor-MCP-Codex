# Native SC2Map archive backend

StormLib source is vendored at the revision in STORMLIB-REVISION.json, including its bundled compression/crypto sources and license. The helper supports inspect/extract/pack through sc2-mcp-storm-v1; TypeScript owns snapshotting, hashing, reopening and publication.

Build on Windows x64 with CMake 3.25+ and Visual Studio C++ tools, or Linux x64 with CMake and GCC/Clang:

```sh
npm run archive:build
```

Set SC2_MCP_CMAKE to an absolute CMake executable if needed. Outputs are native/bin/windows-x64/sc2-mcp-archive.exe and native/bin/linux-x64/sc2-mcp-archive. Portable builds require and include the Windows binary. No separate StormLib DLL is needed; Windows system UCRT is required. The supplied Windows binary was cross-compiled with Zig, PE-checked, and not executed on Windows.

Raw helper operations:

```text
sc2-mcp-archive inspect <map.SC2Map>
sc2-mcp-archive extract <map.SC2Map> <new-directory>
sc2-mcp-archive pack <directory> <new-map.SC2Map> <entries.tsv>
```

Use the TypeScript adapter/MCP for pack: it constructs the TSV, copies a stable snapshot, reopens the result and verifies names/locales/content SHA-256 before publishing. Raw helper pack does not offer those publication guarantees. TSV fields are name, local path, compound locale/platform, flags and filetime. Neutral entries use their normal path; nonneutral entries use .sc2mcp-locales/<LCID>/<path> plus extraction metadata.

Internal listfile/attributes are rebuilt. Old signatures are not reused as valid signatures. Neutral SC2 archives use MPQ v4 (format field 3); nonneutral locale/platform variants use MPQ v2 (format field 1) because HET/BET creation normalizes locales. Entry identity and content are checked after reopening. Prefixed archives, unrecoverable names, collisions, unsafe paths, symlinks and unsupported layouts are rejected rather than silently rewritten. Size limits: 100,000 entries, 512 MiB per entry, 4 GiB aggregate. MPQ support is separate from SC2Editor/game acceptance and from CASC access.
