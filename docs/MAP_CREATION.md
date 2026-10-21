# Making maps from native workpiece - alpha.18

Codex can create a new card directory from a registered workpiece, form a supported surface, then use Placement/Data/UI/Text/Cutscene/AI/Script and package the result into SC2Map.

## Preparation

`SC2_UI_ROOT` is a general working directory. Import the original SC2Map to `templates/Base` via `map.import` or use a ready-made component-directory. For a clean new scenario, a blank card saved by a target editor with the right size, tileset, dependencies and players is preferred. One workpiece can be used repeatedly. The script card is also usable, but its objects and scripts will be inherited.

```json
{"tool":"map.blueprint.inspect","arguments":{"directory":"templates/Base"}}
```

Inspect verifies MapInfo v39, document roots, sizing matching and the presence of a full conventional Terrain bundle. Returns shared SHA-256, existing objects and Galaxy files. `cleanTemplateVerified:false`00 means that cleanliness and game launch are not certified. Missing mandatory components of the accepted creation profile block registration.

```json
{"tool":"map.blueprint.register","arguments":{"id":"Base32","directory":"templates/Base","dryRun":false}}
```

Registry stores a link to the original directory and content hash. Its limit is 64 entries, 256 KiB. Do not change the registered workpiece; for a new option, register a new ID. `map.blueprint.list`00 shows the saved records, re-check is performed when you create.

## Creation

An example for a suitable palette: style searches for existing material by topical words. If it is not available, pass `materials.base` with the ID from `terrain.palette.get`; automatic inventing of texture is not used.

```json
{
  "tool":"map.create",
  "arguments":{
    "blueprintId":"Base32",
    "destinationDirectory":"maps/MyMap",
    "landscape":{"style":"desert","seed":42,"relief":0.5},
    "metadataPatch":{"fogMaskStyle":"Dark"},
    "dryRun":true
  }
}
```

Then repeat the same query with `dryRun:false`. `expectedBlueprintSha256` is optional: you can transfer the hash from the inspect to explicitly control the selection. The saved hash is checked always. Changes to the file, file list, archive metadata or registry, and pending drafts of the source card block the operation.

Dry-run does all the conversions in the temporal copy and returns `contentSha256`, `changedFiles`, dimensions and diagnostics. The actual creation uses the same transformations. The new directory is published after verification; the existing destination is rejected. The processed error leaves the source card and destination intact. The interrupted process can leave the service staging directory; it is excluded from the index and components of the parent project.

`terrainOperations` accepts up to 100 regular Terrain operations: you can add roads through corridor, site leveling, noise/smoothing, texture rules, supported water or local catalog edits. First, landscape is performed, then terrainOperations, then metadataPatch. Stamp is not accepted inside: select the desired native donor as a workpiece. During the time, you use the existing palette and local catalog dependencies. New external assets are allowed by conventional Browse/Terrain/Data teams after creating with customized roots installed/deency.

If the workpiece is the root of MCP workspace (`directory:""`), use `destinationDirectory:".sc2mcp-output/MyMap"`. Created maps in this tree do not fall into the parent Layout/Text/Cutscene/Data/Browse indices. Once created, open the new map catalog as a separate project.

## Completion of the map

In the created project, the previous modules are available: `terrain.*`, `placement.*`, `data.*`, `browse.*`, `ui.*`, `text.*`, `cutscene.*`, `ai.*`, `script.*`. GUI-triggers are not edited. `placement.createLocation` with a parameter can form a joint plan of objects and surface.

Save full transaction groups → `ui.test_readiness` → disassemble diagnostics → `map.export` → open/save/reopen map in SC2Editor → Galaxy compilation → game launch. `map.create` returns component-directory; packaging is done via map.export. Example for root project:

```json
{"tool":"map.export","arguments":{"archive":".sc2mcp-output/MyMap.SC2Map","dryRun":false}}
```

## Terrain checks and restrictions

`terrain.components.inspect` checks CellFlags v101/102, SyncCliffLevel conventional CLIF v100 and VertCol v103/104. Grid sizes, payload lengths and variable entries boundaries are checked on four native maps. Unknown versions remain PRESERVE_ONLY. Raw flag histogram is not a cross-country grid. VertCol sub-data remains opaque: the correct structure does not prove the meaning of color data. Famous envelopes block Terrain, blueprint plan and map registration.

| Opportunity | De facto status |
|---|---|
| A new map from a suitable native blank | Implemented with the preservation of the original content |
| Relief/noise/smoothing/texture/palette | Supported operations and 10 styles implemented |
| Breaks / ramps of the existing workpiece | Native data is saved; no new topology is generated |
| PaintedPathingLayer/SyncPathingInfo | Retained; writers and engine path checking missing |
| Water. | Flat WATR v110 rectangles on 8-cell grid and CWater; complex bodies/shoreline opaque |
| Lighting | CTerrain binding and basic CLight/cycle fields; full fog/sky/postprocess not completed |
| Card size/players/variants | Inheritable; arbitrary resize and complete parameter editor are not implemented |
| Clean native map with no source files | Not implemented |
| Windows/SC2Editor/compiler/runtime | NOT_EXECUTED in the current Linux environment |

The following native gates are: minimum empty foundation; cliff-cell/hardtile/ramp codecs and agreed sync rebake; painted pathing + sync pathing; complex water; player/variant/dependency semantics; target Editor/game oracle.
