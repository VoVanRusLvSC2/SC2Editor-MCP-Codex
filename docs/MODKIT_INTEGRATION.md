# ModKit: Data, CASC and map preview

Our MCP uses public Host/SDK and SC2 bootloader from [ModKit](https://github.com/hometlt/ModKit) and [ModKit-Blizzard](https://github.com/hometlt/ModKit-Blizzard). `map.preview` uses their world renderer, not the `terrain.preview` technical picture.

Install the optional local runtime with `npm run modkit:setup`. Node.js 22+, Git and npm/GitHub access are needed during installation. Reviewed sources are Core `7e3c856ba290b8abde55b1f7e4d93383179e8b9f` (image/model extensions) and Blizzard `78104889bed092d901516044bd90734df8d5caac`. Host/SDK platform packages retain Blizzard's declared vendor snapshot ABI; this is not an upgrade of the entire Core platform. Their hashes, revisions and local compatibility patches are recorded in `.modkit-runtime/ModKit-Blizzard/sc2-mcp-runtime.json`.

Once installed, restart MCP. `modkit.runtime` shows the state. The other directory is `SC2_MODKIT_HOME`; the installed game is `SC2_CASC_ROOT`.

The retained loader records its loaded receipt digest. A runtime receipt changed
in the same process requires an MCP restart; it cannot silently combine cached ESM
modules with newly installed files. On 2026-10-21 a fresh outer MCP suite passed
Data/Marine field reads, terrain-only and effective-catalog navigation, model and
texture preview, PNG/image delivery and source preservation. The catalog resolved
10 footprints and reduced walkable/buildable cells. `counts.blockers` counts special
blocker entities, not every occupied footprint cell. Static navigation still does
not certify the game pathfinder. The bounded preview omitted models beyond its
explicit budget; native rendering parity remains unverified.

## Teams.

```json
{"tool":"map.preview","args":{"directory":"MyMap","output":"both","mode":"render","includeImage":true}}
```

Result: separate HTML with lossless gzip-compression of embedded data with WebGL, source models/textures, rotation, scale, movement and object/coordinate selection. PNG shows geometry by default`render`); `topdown` The CPU frame size is limited to 768×768; its lighting, shadows and post-processing are different from the GPU. HTML retains the true WebGL renderer ModKit. Parity with the SC2 engine is not certified. `modelFacets` Separately counts models with geometry, materials, skeleton, animations, and textures: a successful file conversion alone does not prove a correct picture. `cliffPieces` and `rampPieces` Consider placed models of ledges and ramps.

```json
{"tool":"data.modkit.query","args":{"directory":"MyMap","refs":[{"namespace":"Unit","entityId":"Marine"}],"fields":["LifeMax","Race"]}}
```

These are effective values from the original ModContext ModKit, with dependency chain, inheritance, arrays, sources, and unloaded modes. `view: "authoring"` returns the author's index; `view: "exists"` returns the presence; `view: "ids", namespace: "Unit"` is the identifiers page. Pass `fields` and small `refs` to get less text. The field format belongs to ModKit. Existing `data.plan/apply/save` retains their verified write path and are not replaced by this reading.

After installation, the usual `casc.search`, `casc.file.inspect`, `casc.read_text`, `casc.read_bytes`, `casc.mount` You can use the reader ModKit. `SC2_CASC_BACKEND=native` selects the previous CascLib; `modkit` Requires runtime installed, no hidden rollback.Content/encoding keys are taken from public methods `CascReader.resolveFile/resolveContentKey`; only missing TypeScript declarations of these existing methods are added. The previous MD5 content key check and SHA256 of our cache are saved. The locale and nameType flags are not published by this adapter: zero values should not be considered actual native flags. One full file of this adapter is limited to 64 MiB. CDN is disabled.

In the `workflow` profile, tools are available via `modkit.tools`, `modkit.enable_tools` and `modkit.batch`. `map-builder` `map.preview` and `data.modkit.query` are available immediately. Paths are returned by default and diagnostics are brief; images are added only with `includeImage: true`.

## Status and limitations

It uses one adapter and one ContentSources directory for Data and map. ModKit reads the MPQ/CASC itself and determines the order of dependencies. Saved input bytes are copied into a separate packet with SHA256; preview does not change the source map. Unsaved text drafts should be saved. Reads are serialized; re-viewing the same map uses stored geometry. Changing the map, CASC builds and configured dependency directories changes the cache. The cache on the disk does not yet have automatic cleaning.

Compatibility of public audits is corrected by isolated patches. `scripts/modkit/compatibility.patch` Disables only the additional publication of the RLE metadata of the grid review, the API of which is not in the published Core; the geometry and drawing of the native review are saved. For hidden paths, the previous VFS signature with recursive bypass is used. The patch also supplements the declarations of the two existing public CASC Reader methods, without changing their implementation. `platform-patches.mjs` Corrects URIs of converted UVMs, as described below. The rest of the build errors are not ignored. `complete: false`Lack of resources and cut-off layers do not turn into success with full support.

Licenses and authorship of ModKit are retained. Runtime contains original source and notices; M3 has parts of GPL-2.0-only. Local results may contain resources of the installed game, they are not added to Git. Runtime is installed separately from the standard Windows portable package; installer and adapter are included in the package. Accurate parameters and compatibility should be checked using `modkit.runtime`.

## What's left ours

Integration is limited to CASC, reading Data, and `map.preview`. Existing modules are not entirely replaced. "Better" below means a specific saved capability; the overall superiority of one project over another is not proven.

| Part part | ModKit | Save in our MCP |
|---|---|---|
| Data | ModContext: Dependencies, Effective Values, Inheritance and Field Sources | `data.plan/apply/save`, schema verification, transactions, pre-verification and writing in the existing way; field selection and response size limitation for AI |
| CASC | Reader of the installed game on Node.js; general resource directory for Data and map | Check active build before/after reading, original MD5 content key, SHA256 cache, secure paths, existing mount/reference commands |
| CASC metadata | Content/encoding keys confirmed; API locale flags are not returned | CascLib is saved via `SC2_CASC_BACKEND=native`: actual localeFlags and alternative native reader. |
| Map. | Real world scene, source models, textures, native cliff/ramp pieces | Map creation, TERRAIN, object placement and map writing remain ours; HTML/PNG and MCP image are connected via a shared adapter, reading uses immutable snapshot |
| AI work | Library APIs | `modkit.batch`, tool selection, short answers, limited sampling and reuse of an already loaded scene |

Our existing v61 cutscene render has been saved separately, and his work on materials, DDS mip chains, and lighting is not being replaced by this map viewer. No comparison of two renders on the same frames has been done, so there is no claim of visual superiority.

CASC Local Verification October 19: Same NativeLib.galaxy, build 5.0.17.98310. Content/encoding keys and first 24 bytes matched.First search: CascLib 3603 ms, ModKit 2794 ms; inspect: 1 and 3 ms. These are single measurements with disk caches, not a steady speed rating. CascLib returned localeFlags 4294967295, ModKit adapter - unavailable value 0.Details: local `work/modkit-integration/casc-comparison.json`.

## Correcting invisible bases and ledges

The first frame was mistakenly built from the old `Agria_Vasya_Fedya_Test`, without the native cliff cells, and the check was moved to the packed `Agria_Vasya_Reinforcements_v8.SC2Map` with native ledges and ramps.

In addition, a defect was found in the Host: URI of the converted UVM that retained the name of the original `.m3`. In larger files, the UVM profile is located further than the 64 KiB recognition window. So the regular glTF codec beat the UVM and did not publish the skeleton, animations and materials. The isolated fix `scripts/modkit/platform-patches.mjs` retains the `.uvm` extension in the synthetic URI, checks the exact replacement location and refuses to change the unknown code. It is used during installation, and the hashes of the modified files are written in provenance. This is not a replacement of the model parser or renderer.

On the actual CommandCenter, UVM confidence changed from 0.01 to 0.98; 23 materials, 142 skeleton elements, and 34 animations recovered. CPU frame v8 visually checked: both command centers and ledge walls are visible. The scene contains 93 cliff pieces, of which 6 ramp pieces. The number of pieces is not equal to the number of `<cc>`00 of the original map: generation rules screen out cells without a separate wall and add ramp angles.

The source of the result and limitations remain clear. `complete: false` persists in the absence of optional Regions/navigation/pathing components; individual effects and features of the materials may not be reproduced.

## Candidates for the Future of ModKit PR

1. Fix synthetic UVM URI in Core Host. Minimum source patch prepared in `scripts/modkit/upstream-host-uvm.patch` and verified in recorded revision. Replay: large UVM, profile outside 64 KiB, URI `memory+uvm:...m3`; regular glTF loses rig/material facets. Corrected URI selects UVM. This is a confirmed defect suitable for small PR.
2. The missing TypeScript declarations of the existing `CascReader.resolveFile/resolveContentKey`. runtime-free, are included in our compatibility.patch.
3. Separate offer: limited data samples with sources and paging, render facets report and integration of native locale metadata. Our adapter shows the benefits of such an API, but the transfer still requires coordination of the architecture with the authors of ModKit.

PR is not created and nothing is sent to upstream.Write protection, build/cache integrity and transactions remain in our project regardless of acceptance of future PR.

Verification of this build: normal/release TypeScript builds and lint modified files pass; 58 profile tests pass without passes. `casc.search/read_bytes`Selected data fields and two calls `map.preview` The first full HTML+PNG v8 took 61 s, the second HTML with the saved scene took 8.5 s; the warm reading of two Data fields is 1.1 s, the response text is 1842 bytes. This is the time of this computer in parallel checks. The actual paid model tokens are not available to tools; MCP counters reflect only the volume of calls and answers. Local evidence: `work/modkit-integration/{tests-visual-fix.log,mcp-acceptance.json,uvm-regression.json}`.

## TERRAIN Expansion – October 19

The missing public format/navigation APIs of the same fixed version of ModKit are connected. Their binary parsers, serializers, footprint calculation and route search are used directly. Our agreed height, texture, water, concealment, cliffs and ramp editors are saved. Upstream only added explicit package exports `map/format`00, `map/navigation`, `map/overview`; this is part of the reproduced `compatibility.patch`, without a second set of parsers.

| Opportunity | Command/Operation | Real boundaries |
|---|---|---|
| Prohibition of passage, construction ban, clear-path override | `terrain.pathing.paint`, `terrain.pathing.fill` | `CellAttribute_Pnp/Pnb/Pcl` masks, rectangle/circle/polygon/corridor brushes. `block=255`, `erase=0`. Filling bypasses neighboring cells with the same paint byte; the cliff alone does not limit this filling |
| Missing CellAttribute mask | Parameter `template` in the brush or `templates` in terms | The verified native header of the donor is copied; the grid of the target card begins empty. Header is not guessed, someone else's passability is not tolerated. |
| Static navigation and PNG | `terrain.navigation.preview` | Terrain, cliff/ramp, painted masks and footprint of hosted objects. Data/CASC, inheritance, local directory changes and dependencies read ModContext. `catalog=false` disables this download |
| Raw paint layers | `painted.set` in `terrain.modkit.plan_file` | Two byte channels `PaintedPathingLayer`/`PaintedCreepLayer`, native grid 512×512. |
| Vertex-color | `vertexColor.set` | Values of existing stroke entry/index in decoded VTCL. An arbitrary RGBA brush over an unknown structure is not stated |
| Fine surface decor | `fluff.add`, `fluff.set`, `fluff.remove` | Native DLFT records x/y/type 0...7; separate format, not arbitrary Actor model |
| Full native groups of road/hard plates | `hardTile.replace`, `hardTile.repair` | Replace full groups of HRDT v102 while retaining explicit opaque fields; fix repeat group keys. Incomplete decoded layout is rejected. Road spline generator not added |
| Path cache | `pathing.hints` | Raw uint16 values `t3SyncPathingInfo`. Upstream does not confirm their independent influence in the game; CellAttribute is used for prohibitions. |
| Palettes and texture block sets | `palette.author` | Original authoring updates terrain XML, CTerrain/CTerrainTex and GameData registration. Texture masks bytes remain the same: channel order needs to be set meaningfully. |
| Selection of a native diagonal ramp | `terrain.ramp.fit` | Up to 16 options for crossing points and uphill direction.This is the selection of a suitable donor profile, not free generation of any mesh. |
| Transfer/expansion of the native ramp | `ramp.template` | Original placement/widening; agreed HMAP, SMAP height/mask, CLIF and LFCT. Whole two-cell lattice; widening only qualified diagonal profiles; v115 identity XY/Z and supported versions of companions. Opaque Terrain/hard-tile handles are rejected |
| Mass decor | `terrain.decorate` | Delegation to our `placement.scatterDoodads`: seed, weighted palette, height/slant/texture/water/distance/exclusion zones, up to 5,000 objects per request |
| Relation of objects to the surface | `terrain.objects.snap` | Our `placement.snapToTerrain` retains the difference between unit offset Z and absolute doodad Z. |

General commands: `terrain.modkit.capabilities`, `terrain.modkit.inspect`, `terrain.modkit.plan`, `terrain.modkit.plan_file`, `terrain.modkit.apply`. For a large request, a JSON file is more profitable: up to 100 operations / 1 MiB. `inspect` returns the page, not the entire binary layer; for HRDT, the `blockIndex` parameter opens the entries of one group. Large lists are not sent to the model.

For our height/texture/water/cliff brushes, the old `terrain.plan_file → terrain.apply → terrain.save` cycle remains. For added operations: `terrain.modkit.plan_file → terrain.modkit.apply(dryRun:false) → modkit.save(file)`. `modkit.save` now actually retains a whole group of binary transactions; before this general command only saved text draft, contrary to the description. SHA-checking of source, disk and donor, backup and idempotent reapply are saved. The scheduling itself does not change the files.

An example of a brush on an existing mask:

```json
{
  "directory": "maps/MyMap",
  "layer": "noPathing",
  "mode": "block",
  "area": {
    "type": "circle",
    "center": { "x": 30, "y": 20 },
    "radius": 4
  }
}
```

These are `terrain.pathing.paint` arguments; the result is `planId`. Before applying, you can call `terrain.navigation.preview` with the same directory and planId. The data palette-changing plan must first be saved or used by `catalog=false`: the analysis does not mix the new terrain/catalog plan with the old efficient Data. Unsaved Objects/Data are also deflected when the directory is included. Snapshot Data is immutable; pure terrain binary drafts can be analyzed separately from the saved directory.

`terrain.decorate` and `terrain.objects.snap` return Placement plans: apply via `placement.apply`, then `modkit.save` on the returned Objects file (`ui.save`) is the same existing placement coordinator, not the second scatter/writer.

### What we have saved and what we can offer upstream

Our agreed terrain companions, precise object height semantics, seeded scatter with filters, short MCP plans, guarded apply/save and dependency control remain on top of ModKit. For these tasks, a ready-made common format-reader does not replace an already working authoring workflow. Realistic future PR: public API terrain exports, atomic coordination companions with donor-ramp transfer, limited preview/plan responses and integration test examples. This is an addition to the confirmed UVM URI fix above; PR has not yet been created.

### Checking on a real map

Fresh stdio MCP imported a copy of `Agria_Vasya_Reinforcements_v8.SC2Map`, added a CellAttribute-ban, saved the group, reread native bytes, added three fluff records, checked the fill in dry-run, checked the map and exported the archive with reopening Test copy: `work/ModKit_Terrain_Test.SC2Map`.The original Agria didn't change.

Navigation read 34 entities and 8 footprints from Data/CASC in two rounds, with no unresolved dependencies. 21 obstruction objects found. Prior to prohibition: 2037 available / 1839 buildable cells; after: 1941 / 1743. Between identical points (27,27) and (37,37) the route was before editing and was not after it. PNG saved together with receipt `work/modkit-integration/terrain-mcp-acceptance.json`00.

Local time: the first navigation PNG with a cold catalog load is 29 s, the second after changing the map is 7.7 s; brush 160 ms, pour 124 ms, apply 184–303 ms, save 285–373 ms, export 1.4 s. These figures include the corresponding operation of the MCP on this computer; they are not a comparison of engines or a guarantee of time. `modkit.usage` text counters are not equal to the paid model tokens.

Tests check the original native round-trip, preservation of unknown bytes, rejection of opaque VTCL/HRDT, flood fill, footprint of buildings/resources/decor, NoDoodadFootprint, diagonal fitting/widening and coordinated transfer of companions, stale/dry-run/save and catalog registration. Checks run with installed ModKit pintime; without it, dependent native tests are clearly missed.

The result of the local extension check: 180 profile tests and 34 transaction tests passed, no errors; one previous archive/shell fixture was missed. All 11 new terrain tests were performed with ModKit, without gaps. Normal/release build and lint modified files pass. Logs: `work/modkit-integration/terrain-{build,release-build,lint,tests-all,transaction-tests}.log`. For the current desktop connection, you need to restart MCP: it was not interrupted, reception was carried out in a fresh separate stdio process of the same build.

`engineValidated=false`: Editor and game did not run. PNG shows a static ModKit model, not the exact path of a particular live unit. Dynamic state, accurate movement radius, engine collision/pathing rebuild and all SC2 Editor brushes are not declared. Unsupported raw format remains available for diagnosis or receives an explicit recording failure.
