# CASC: Read the resources installed by StarCraft II

The `casc.*` module opens **real installed game**, disassembles CASC/MNDX and reads decoded bytes of files. A ready-made third-party dump is not necessary. C++ helper uses a fixed MIT-licensed [CascLib](https://github.com/ladislav-zezula/CascLib/tree/38a34665624b8775bb875274b36191b21c38d97b); TypeScript manages MCP, build source, cache, and Data/Browse views.

## Launch.

```powershell
npm ci
npm run build
$env:SC2_UI_ROOT = "K:\Maps\MyMap.SC2Map"
$env:SC2_CASC_ROOT = "C:\Program Files (x86)\StarCraft II"
$env:SC2_MCP_PROFILE = "casc"
node dist/index.js
```

`SC2_UI_ROOT` is a working card/mode, `SC2_CASC_ROOT` is an installed game with `.build.info`. Windows default is `C:/Program Files (x86)/StarCraft II`. The cache is the default in `<workspace>/.sc2mcp-casc-cache`; `SC2_CASC_CACHE` allows you to select a separate directory. Cache inside the game installation is prohibited.

The `casc` profile includes UI, CASC, Data, and Browse. Use `landscape`, `all`, or `SC2_MCP_MODULES=terrain,casc,data,browse,placement,map` to collaborate with the surface. Old narrow profiles retain their tool surfaces. Native reader runs lazily and keeps the index in one process.

## Teams.

| Team team. | What's he doing? |
| --- | --- |
| `casc.status` | Actual build, native index, availability, cache, and connected packages |
| `casc.search` | Pagination and search logical paths; `prefix` selects folder, `query` selects substring |
| `casc.file.inspect` | Size, local availability, CKey/EKey, assembly |
| `casc.read_text` | Real UTF-8 bytes via cache; SHA text pages and explicit truncation |
| `casc.read_bytes` | Up to 4,096 decoded bytes of offset resource; e.g. M3/DDS header |
| `casc.mount` | Retrieve selected metadata types in the cache view and connect to Data/Browse |
| `casc.galaxy.symbols` | Names/signatures top-level Galaxy declarations, with constant cache |
| `casc.cache.references` | List of imported reference materials |
| `casc.cache.verify_reference` | Check the SHA of each source directory file for the current CASC |

All the tools read the original game. `readOnlyHint:true` refers to game/map data; the service cache is created separately. There is no CDN fetch, no CASC record, no running text/scripts read from resources. An unavailable local payload returns a clear error.

```json
{"tool":"casc.search","arguments":{"prefix":"mods/liberty.sc2mod","query":"marine.m3","limit":10}}
{"tool":"casc.read_text","arguments":{"file":"mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml","maxChars":8000}}
{"tool":"casc.galaxy.symbols","arguments":{"file":"mods/core.sc2mod/base.sc2data/triggerlibs/natives.galaxy","query":"UnitCreate","limit":10}}
```

Search returns real names from ROOT manifest. `local:false` means no payload in the local installation. The number of ROOT names and the number of locally available paths vary; none of these counters prove that all files are read.

## Connecting GameData to the project

```json
{"tool":"casc.mount","arguments":{"packages":["mods/core.sc2mod","mods/liberty.sc2mod"],"kinds":["catalogs","triggers","strings","schemas"],"locales":["ruRU","enUS"],"maxFiles":1000}}
```

Packet paths are selected from `casc.search`. Types: `catalogs`, `triggers`, `strings`, `schemas`, `layouts`. For directories, native Includes/DocumentInfo and individual packages are saved. Data/Browse continue to use their map dependencies. Connected packages without a confirmed declaration are not declared automatically; implicit engine dependencies remain separately unknown.

After mount, the usual `data.query`, `data.context` and `browse.search` run.This is a reading of actual game XML. Full native inheritance/default/token/override behavior and existing XSD/GUI registries do not automatically become fully confirmed by the new build.

When missing/corrupt payload returns `PARTIAL_NOT_MOUNTED`; incomplete new root is not logged; ready-made mounts are restored at start-up after checking SHA files; Change build key removes old roots from Data/Browse. `.build.info` is included in tracked read set for Data operations using CASC views.

## cash

```text
.sc2mcp-casc-cache/
  <build-key>/
    files/<logical-path>                 реальные декодированные байты
    metadata/<logical-path>.json         источник, версия, CKey/EKey, size, SHA-256
    views/<package>/                    read-only input для Data/Browse
    mounts/<package-hash>.json           manifest проверенных view-файлов
    summaries/<path-hash>.json.gz        Galaxy symbol summary + исходный SHA
  references/                          отдельно импортированные справочники
```

Native reads perform strict BLTE checks. The full cached file is further verified by CKey/MD5 and receives SHA-256. Warm reads saved bytes and current identity; corrupted byte cache is rereadable. Simultaneous requests of a single file share a single download. Cache recording goes through a temporary file and rename. Traversal/ADS/control chars, symlink cache and assemblies mixing are prohibited.

Limits: full cached file 16 MiB; text page 24000 chars; byte range 4096 bytes; responses 32000 chars; index 1 million paths; mount up to 2000 selected files and 128 MiB. Characters are not declared model tokens. Large M3/DDS are read in narrow ranges; renderer/full decoding is not added.

## What is used from triggers.zip

There is no ready-made CASC storage reader or extracted game files. `galaxy/language/workspace/summary-cache.ts` and `galaxy/data/galaxy-script-api.v1.json` are extracted: per-archive gzip summaries code and reference for 3341 functions. Implementing your own summary cache uses source SHA and build instead of one size/mtime.

The public repository does not contain someone else's archive, its private prose/source copy, its pre-made directory or game bytes. The extracted reference inputs lie locally. On the verified SHA installation, all six declared reference sources differ; it remains `REFERENCE_SOURCE_MISMATCH` and does not replace real CASC data or authoring registry.

## Verified result

On Windows and installed SC2 **5.0.17.98310**: 780010 ROOT paths; 312145 marked index metadata as locally available. Through this MCP SDK read Core UnitData XML, Galaxy natives and M3 resource bytes from Liberty. Repeated byte read and symbol summary give cache hits. Mount Core connected 245 files (9878922 bytes); Data query read three CUn records from these game bytes.

This is a check of the specified build and selected reads. CDN downloads are not declared, all locales/packets/encrypted payloads, engine runtime, 3D rendering and full semantic authoring of all resources.

## Assembly of native helper

Windows/Linux x64 source:

```powershell
npm run casc:build
npm run casc:schemas
npm run windows:portable
```

Build requires CMake and C++ toolchain. CascLib revision is fixed in `native/casc/CASC-REVISION.json`; source is obtained through FetchContent. `SC2_CASCLIB_SOURCE` can specify a local checkout with the same revision. Windows contains a static C++ build runtime and is included in the portable along with the MIT license. Linux source path is provided; this check is performed on Windows.
