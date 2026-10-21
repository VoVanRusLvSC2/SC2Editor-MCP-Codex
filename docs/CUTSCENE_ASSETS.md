# Assets, Standard Animations and Location Construction

Version: `1.1.0-alpha.5`.

## What's indexed now

`CutsceneAssetIndex` combines four sources, not counting any of them as perpetual absolute whitelist.

1. XML map, fashion and unpacked dependencies. All `C*` classes with `id` are indexed, not just the pre-selected `CModel/CActor`.
2. Real `.SC2Cutscene` and `.StormCutscene` are extracted from them actually used `modelLink`, `modelPath`, `soundLink`, `lightID`, conversation/texture references and animation tokens.
3. Custom map/mode files: `.m3`, `.m3a`, textures, sounds and movies.
4. `Assets.txt`, `Files.txt`, or `FileList.txt` if an external CASC/MPQ extractor has created a path list.

For `.m3/.m3a`, the built-in read-only metadata reader disassembles the section index and reads:

- `SEQS` is the real name for animation sequences.
- `ATT_` is a real attachment point.

It doesn't modify the model or try to render it. If M3 is available, `cutscene.animations.list.complete=true`. If only a catalog or an existing Cutscene is found, a useful but honestly labeled partial list returns.

## Connecting Standard and User Assets

The root of the current component card/mode from `SC2_UI_ROOT` is always indexed. Additional unpacked dependencies are specified via `SC2_ASSET_ROOTS`.

PowerShell:

```powershell
$env:SC2_UI_ROOT = "E:\Maps\MyMap.SC2Map"
$env:SC2_ASSET_ROOTS = "E:\SC2Extracted\Mods\Core.SC2Mod;E:\SC2Extracted\Campaigns;E:\MyCinematicAssets"
node dist/index.js
```

Bash:

```bash
SC2_UI_ROOT=/maps/MyMap.SC2Map \
SC2_ASSET_ROOTS=/sc2/Mods/Core.SC2Mod:/sc2/Campaigns:/assets/custom \
node dist/index.js
```

The separator corresponds to `;` in Windows and `:` in Linux/macOS. After copying the new model to an already running workspace, call `cutscene.assets.refresh`.

Important: the installed SC2 stores many full-time resources in the CASC. The current module indexes component/extracted directories and does not state a built-in full read of CASC. Therefore, `cutscene.assets.status` should be checked before stating "all standard assets are available."

## Cost-effective workflow for Codex

The task of “gathering a location on Zerus or Caldier” does not require dozens of MCP calls.

### 1.One Context with Packet Search

```json
{
  "categories": ["actor", "lighting", "animation-layer"],
  "assetQueries": [
    { "query": "Zerus", "types": ["Model", "Actor", "Doodad", "Terrain", "Texture", "Light"], "limit": 30 },
    { "query": "Kaldir", "types": ["Model", "Actor", "Doodad", "Terrain", "Texture", "Light"], "limit": 30 }
  ]
}
```

This is one `cutscene.context`. Search is ranked by exact ID, origin ID, path, catalog fields and provenance. The result contains `cutsceneUse`, for example:

```json
{
  "catalog": "Model",
  "id": "<реальный ID из локального каталога>",
  "path": "Assets/Models/...m3",
  "dependencies": ["Campaign"],
  "cutsceneUse": {
    "nativeType": "CCutsceneNodeActor",
    "property": "modelLink",
    "value": "<точный catalog ID>"
  }
}
```

You can't substitute an invented ID just because it looks like `ZerusTree`. You need to use the value from the result.

### 2. Unit/Actor Resolution in Model

If a Unit or Actor is found, one `cutscene.assets.inspect` recursively passes the connections and inheritance:

```json
{ "catalog": "Actor", "id": "<ACTOR_ID_FROM_SEARCH>", "maxDepth": 8 }
```

The answer contains `definitions`, `edges`, `unresolved`, and `placementCandidates`.

### 3. Real animations of the selected model

```json
{
  "asset": {
    "catalog": "Model",
    "id": "<MODEL_ID_FROM_SEARCH>"
  }
}
```

This is a `cutscene.animations.list` call.

```json
{
  "animations": ["<real SEQS names>"],
  "attachmentPoints": ["<real ATT_ names>"],
  "complete": true,
  "sources": [{ "source": "workspace-file", "complete": true }]
}
```

If `complete=false`, Codex can only use observed tokens or request unpacked M3; it must not invent `Walk`, `Stand`, or `Talk`.

### 4.One transaction for the entire decoration

Each location model is added via `actor.add`, but all operations are transmitted by one `cutscene.apply`:

```json
{
  "file": "Cutscenes/ZerusLanding.SC2Cutscene",
  "operations": [
    {
      "op": "actor.add",
      "as": "backdrop",
      "name": "Zerus backdrop",
      "asset": { "catalog": "Model", "id": "<MODEL_LINK_FROM_SEARCH>" },
      "position": [0, 12, -2],
      "rotation": [0, 0, 0],
      "scale": [3, 3, 3]
    },
    {
      "op": "actor.add",
      "as": "customProp",
      "name": "My custom prop",
      "asset": { "catalog": "Model", "path": "Assets/Custom/MyProp.m3" },
      "position": [2, 4, 0]
    },
    {
      "op": "animation.layer.add",
      "as": "customPropAnim",
      "object": "@customProp"
    },
    {
      "op": "animation.add",
      "layer": "@customPropAnim",
      "anim": "<EXACT_NAME_FROM_ANIMATIONS_LIST>",
      "duration": 15000,
      "looping": true,
      "timeScale": 0.5,
      "weight": 2
    }
  ],
  "dryRun": false,
  "stage": false,
  "validate": true
}
```

`actor.add` uses:

- `modelLink` for catalog-backed model
- `modelPath` for custom raw M3
- native `position`, `rotation`, `scale`;
- all additional schema-confirmed properties of `CCutsceneNodeActor` via `properties`;
- optional `duration`/`lockedToEnd`.

The `[x,y,z]` array is serialized deterministically with six characters after the dot. The native vector string is also accepted without lossy conversion.

## What does "location on Zerus/Coldier" mean?

Cutscene Editor does not get the biome from the word `Zerus`. Bridge makes a query to the real dependencies and returns the building blocks: environment models, doodads, actors, textures, lighting presets and sounds. Codex selects confirmed candidates, places them as `CCutsceneNodeActor`, adds scene lights/Director lighting and cameras.

Thus:

- the same prompt on the map with Campaign dependencies will find more full-time assets;
- on a map without the necessary dependency resolver will show `unresolved`, rather than write down a fictional link;
- User `.m3` inside the card is available on `modelPath` immediately after refresh.
- The standard model is preferably used according to `modelLink` for SC2 to apply catalog/dependency semantics.

## Public asset teams

| Tool | Appointment |
|---|---|
| `cutscene.assets.status` | Roots, directories, source coverage, M3 number with exact metadata |
| `cutscene.assets.refresh` | Rescan after adding custom asset/dependency |
| `cutscene.assets.search` | Ranked search for all available types |
| `cutscene.assets.inspect` | Recursive graph resolution and placement candidates |
| `cutscene.animations.list` | Exact M3 `SEQS` + `ATT_` or honest partial fallback |

## Current boundary

Support for extracted/component assets and custom files is implemented. Direct reading of Blizzard CASC, visual 3D asset browser and model preview remain separate next steps. Until the CASC adapter is connected, the absence of an asset in the results means "it does not exist among indexed local sources" rather than "it does not exist in SC2."
