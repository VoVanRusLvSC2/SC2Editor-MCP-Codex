# Map module

`map.*` handles map foundation and archive operations in the shared server. It uses the same Workspace, paths and transaction queue as the other modules. GUI-trigger development is excluded; Galaxy scripts are edited by the separate script.* module. Existing scripts and opaque Triggers files are preserved by clone/import/export.

## Commands

| Tool | Purpose |
|---|---|
| map.blueprint.inspect / register / list | Inspect and register locally supplied native templates, pin all content and archive metadata |
| map.create | Create a new component directory with optional landscape/terrain/MapInfo edits before publication; real private dry-run |
| map.capabilities | Backend availability, MapInfo writer scope, explicit creation/resize gaps |
| map.inspect / map.validate | Complete eligible file manifest, known document roots, MapInfo integrity, Terrain dimension agreement |
| map.archive.inspect | Native archive enumeration: names, locales/platforms, flags, sizes and times |
| map.import | Extract into a new directory, preserve entry metadata |
| map.export | Export a committed map or authored local mod with the matching archive extension; reopen and compare every user entry name/locale/hash before publishing |
| map.clone | Full native scenario copy into a new sibling directory; not a clean-map generator |
| map.metadata.plan | Plan playable bounds, fog mask or minimap resolution |
| map.minimap.rebuild | Rebuild textured Minimap.tga with the original Editor; guarded queue, then stage/save |
| map.metadata.apply | Shared byte transaction, default dry-run and grouped staging |
| map.save / map.discard | Save/discard the complete staged byte group |

All file paths stay inside SC2_UI_ROOT. Using a parent workspace containing separate `input`, `maps` and `output` directories allows import, clone and export without path escapes.

After changing the landscape, `map.minimap.rebuild` replaces the default
`Minimap.tga` through the same byte transaction coordinator. It defaults to a
256px image from the original Editor, dry run and staging. With `dryRun:false`
the first call exports an owned archive and queues the native full-map render
(units excluded, doodads included). Poll `editor.job`, then repeat with `jobId`
in the same MCP session to stage its pixels. Use `map.save` with the returned
transactionId, or explicitly set `stage:false` to commit. A changed component,
dependency or input archive rejects; unrelated/cropped/unconfirmed capture jobs
cannot supply pixels. No silent approximate fallback is used.

`backend:"overview"` explicitly selects the old approximate gray ModKit overview
for drafts. It does not satisfy final standard textured minimap acceptance.
Neither backend changes fog, unit visibility, custom minimap paths or HUD
settings. Verify terrain appearance and dot/camera mapping in game separately.
Existing backups and transaction temporary files do not enter source snapshots.

## Creation from a template

Use `map.blueprint.inspect`, then `map.blueprint.register` with `dryRun:false`. `map.create` requires a blueprintId and a new destinationDirectory. It preserves all native scenario objects, scripts, data, dependencies and unknown components. Creation from a registered template is implemented; clean native serialization from nothing remains unsupported. Registered templates reference their source directory, so keep it available and unchanged. Changed templates need a new registration ID. Root templates create only under `.sc2mcp-output/`; generated output is excluded from the parent project index.

See [Russian creation guide](MAP_CREATION.md) for executable requests and limitations.

## Workflow

Extract a supplied native map:

```json
{"tool":"map.import","arguments":{"archive":"input/Source.SC2Map","directory":"maps/Source","dryRun":false}}
```

Then inspect and obtain the existing cell dimensions/playable bounds:

```json
{"tool":"map.inspect","arguments":{"directory":"maps/Source"}}
```

Plan a supported metadata change (bounds must fit the actual map):

```json
{"tool":"map.metadata.plan","arguments":{"directory":"maps/Source","patch":{"fogMaskStyle":"Dark","minimapResolution":2}}}
```

Apply the returned plan ID with `dryRun:false`, then save its returned transaction ID with `map.save` and `dryRun:false`. Pending text or byte drafts block export and clone. The plan pins file contents and the complete eligible file set; a new external entry or changed Terrain component blocks save. Guards are retained if a byte group is restaged through another byte operation. Drafts/plan IDs are process-local.

```json
{"tool":"map.export","arguments":{"directory":"maps/Source","archive":"output/Source.SC2Map","dryRun":false}}
```

If SC2_UI_ROOT is itself the component directory, export into the reserved output tree:

```json
{"tool":"map.export","arguments":{"archive":".sc2mcp-output/Result.SC2Map","dryRun":false}}
```

That tree is excluded from components. Ordinary files are never silently allowlisted away: unknown map content is preserved. Known MCP drafts/backups/journals/output metadata and MPQ internals are excluded or rebuilt.

Authored dependent and extension mods use the same guarded export path:

```json
{"tool":"map.export","arguments":{"directory":"mods/MyMod","archive":"output/MyMod.SC2Mod","dryRun":false}}
```

Mod export validates the local H2CS v8 Header with mod kind 2, DocumentInfo's
matching ordered dependencies and registered v2 component markers. It rejects
map metadata/terrain registrations and extension/type mismatches. It accepts
authored Data, GUI, script and unknown entries without comparing them to the
original empty foundation. Mod entries retain their committed bytes; map-only
placement/preload preparation is skipped. Registered GameData and GameText roots
are logical roots; other registered roots must resolve to component files.
Pending text/byte drafts, stale snapshots, unsafe paths and malformed archive
metadata still block publication. Existing outputs retain the usual backup
behavior. These checks do not establish native Editor or game acceptance.

The CLI uses the same backend and verification:

```sh
npm run archive -- extract Source.SC2Map components
npm run archive -- pack components Result.SC2Map
npm run archive:build
npm run archive:verify -- /absolute/input-dir /absolute/new-report-dir
```

## Backend and verification

StormLib 9.30.0 source is vendored at revision `44ebfbfc109d76e2a85bbd5d8b0c949df7e65c6f`. Native helper binaries are supplied for Windows/Linux x64. Windows helper is bundled in the portable app and does not require an external MPQ CLI or StormLib DLL. A Windows Node.js 20+ runtime is still required as before; the Linux-built package does not contain node.exe.

Neutral archives are written as MPQ v4 (raw format field 3). Nonneutral locale/platform variants use MPQ v2 (raw field 1) because HET/BET creation cannot preserve those variants. Compression is regenerated; encryption/offset-key/CRC intent and filetime are retained for known entries. Listfile/attributes are rebuilt; old signatures are not presented as valid. Content hashes compare uncompressed user entries, not the byte identity of compressed archives.

For the four supplied original maps, full extract→pack→reopen verified **939 user entries**: Ant 85, City 525, Nydus 44, Warships 285. Synthetic tests additionally exercise empty files, encryption, locale variants, unknown binary entries, rejected names and a corrupt external adapter. Editor/game were not run. Windows helper was cross-compiled and inspected as x64 PE, but not executed on Windows.

Prefixed archives and entries with unrecoverable original names are rejected. Locale carrier files live under `.sc2mcp-locales/<compound-LCID>/...` with extraction metadata. Unsupported/special/symlink paths and case collisions are rejected. External legacy adapters remain available through SC2_UI_ARCHIVE_ADAPTER; they must support extraction too, because publication now requires reopening and checking their result.

## MapInfo and limits

Reader supports the v39 sequential core prefix through game_options_flags. The integrity formula and variable field positions were checked against the four supplied originals. Writer changes bounds, fog and minimap resolution while preserving all following bytes; player/variant/author/camera/Header semantics are not promoted to editable support. Terrain base-height changes are blocked pending a derived-data rebuild.

MapInfo numeric magic `0x4d617049` has little-endian bytes `IpaM`. Dimensions are cells; Terrain height-map dimensions are vertices. The reader verifies their relationship. Logical ComponentList roots are not blindly equated to files: GameData/GameText and optimized attribute roots may resolve through native component rules. Unknown roots are reported, preserved and not guessed.

`map.create` and arbitrary resize are **not implemented**. The four inputs are scenario maps, not verified clean native blueprints. A clone preserves their contents and is explicitly `cleanMap:false`. Completing clean creation requires native defaults/DocumentHeader and player/variant construction plus Terrain init/derived components.

Water body edits are disabled: the observed 56-byte table and four float values have no proven body/coverage semantics. Water list exposes rawFloats; nonempty/opaque coverage is unknown and placement cannot use it as known water exclusion. The verified empty v110 component proves no water and supports placement. Native payload remains byte-preserved. Existing JSON water operations are recognized and return WATER_BODY_WRITER_UNAVAILABLE before staging.

Workspace text/byte commits now use a persistent prepared/committed journal and a process lock. On startup or before a mutation, interrupted prepared groups are restored after preflighting every target; unknown external edits raise RECOVERY_CONFLICT without restoration. Committed groups keep their after-state. Drafts and commit undo remain process-local. Process-kill and two-process read-modify-write tests cover this foundation; simultaneous visibility across readers and power-loss certification are not claimed. Filesystem hardlinks are required for atomic initialized lock creation; an interrupted stale-lock reclaim marker blocks mutation for inspection. Raw CLI archive operations use their separate publication guards rather than the Workspace lock.

Next order: clean defaults/document completion → Terrain grids/init/derived/resize → cliffs → ramps → populated water bodies → pathing → textures/colors/decor → map build → script.* → Editor/game verification. General directory/readset pinning outside map.* still needs completion.

Layout reference: https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/mapinfo.md . This is an independent research reference, not a claim that functions were recovered from the supplied protected EXE. Native fixture provenance and component hashes are in src/tests/fixtures/map-native.

## Separate map settings

Attributes, native game variants and selected MapInfo v39 player/options writes are provided by the separate settings.* module. The Map module keeps its original writer scope and opaque-tail preservation. See [Settings](SETTINGS.md); settings/landscape/all profiles expose the new tools.
