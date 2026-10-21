# Historical capabilities snapshot - 2026-10-11

For the current supported scope, native DLL/MCP confirmation and unverified
features, use the [2026-10-21 acceptance matrix](VERIFICATION.md). The snapshot
below predates the native Editor bridge and later authoring improvements.

The main surface operations are ready for supported native components of the existing map. CASC now reads the installed game directly, and selected metadata packages connect to Data/Browse. Full availability of all features of the SC2 Editor/engine project does not declare.

| Section | It already is. | What remains? |
| --- | --- | --- |
| TERRAIN | Generate/landscape, height, noise/slides, slopes, flatten/smooth, painting and mixing, native hide/show by cell/area, preview, grouped stage/save/rollback | Native cliffs/ramps and rebuild nav/collision; arbitrary terrain versions/transform; full SC2 material rendering |
| Water/light | Supported flat WATR v110 rectangles, CWater states, CTerrain/CLight binding and limited fields | Complex water bodies/waves/shoreline generator; all lighting/ToD/fog/shader semantics |
| CASC | Actual local CASC/MNDX + strict BLTE reads, path search, CKey/EKey/SHA provenance, build-specific cache, mounts, compressed Galaxy summaries | CDN fetch/write; universal reading of unsupported/unavailable/encrypted payloads; checking other builds/platforms |
| Data | Catalog XML, selective context, arrays/links, schema-backed changes, native package data from CASC, dependency read guards | Full engine inheritance/defaults/token/removal/override behavior and update of all XSD/evidence for current build |
| Browse / Placement | Catalog/dependency search, loose assets, Unit/Doodad/ObjectPoint plans, scatter/snap and denial of hidden ground | Transparent VFS of all binary CASC assets in every old API; model footprints, exact collision/pathing check |
| Galaxy / Triggers | Galaxy structural reading/writes, native signature registry, bounded GUI trigger inspection/authoring; CASC reads current NativeLib/natives bytes | Complete compiler/semantic binding, all GUI function shapes, complete transformation of arbitrary scenarios |
| UI / Text / Cutscene | Existing semantic XML operations, styles/localization, scene/camera/track editing | All renderer/engine-specific semantics, full GUI replicas and universal in-game acceptance checks |
| Map / MPQ | Native import/export/reopen entry checks, templates/blueprints, MapInfo and metadata plans | Clean card from scratch without native donor; universal resize/rebuild; all MPQ/MapInfo options |
| Document | Fresh empty Dependent/Extension Mod, Arcade map with/without initial flat Terrain, native Metadata/MapInfo/versions, plans and guarded component/MPQ output | Full native defaults/Header identity semantics, Melee/Training, border/nav rebuild, engine acceptance remain unverified |
| Settings | Separate module: Attributes/values/defaults, clone/patch variants and existing bindings, control/AI/color/start/decal players, 13 game option flags; lossless plan/stage/save | Teams/alliances/player count, new standard bindings, options from scratch, other MapInfo versions, full-fledged engine acceptance |
| Assets | Real CASC paths, metadata and limited decoded byte ranges M3/DDS/audio/other files | M3/DDS/audio preview and engine asset resolver |

## Confirmations

- The user checked two MCP-authored `p.SC2Map` copies and confirmed the hiding/restoration of the soil. On the map native hide flag - LFCT v102 bit 0x04; the rest bytes/flags are saved.
- A real workflow SDK checks paint/blend/height-noise/hide/show → stage/save.Mix by default strength 0.5.
- Actual CASC build 5.0.17.98310: index 780010 logical paths, 312145 index-local paths; read game XML/Galaxy/M3, confirmed cache hits; Core mount 245 files/9878922 bytes available Data.
- The imported ZIP API for 3,341 functions remains reference-only: six source SHAs differ from those installed bytes.
- Development/release build, ESLint, individual CASC/Terrain regressions, full set and Windows portable are validated before publication; current results are recorded in [PROJECT_STATUS](PROJECT_STATUS.md).

## The new module and the following priorities

A separate **CASC* has already been added: it owns the installed-game source and cache, and Terrain/Data/Browse uses its data through its own APIs. [Device, commands and launch](CASC.md).

A separate **Settings** added for map settings: [commands and limitations](SETTINGS.md). The general `landscape` profile combines Terrain + CASC + Settings with existing auxiliary modules. Old narrow profiles are saved.

The following separate module makes sense for **Assets preview**: M3/DDS inspection/preview, animation/material metadata, provenance-aware resolving with dependency order in mind.

Further down the surface: native cliffs/ramps and navigation/footprint rebuild will require separate Editor fixtures and validated interlayer operations. Basic elevation, texture and hide/show brushes are already available for Codex.
