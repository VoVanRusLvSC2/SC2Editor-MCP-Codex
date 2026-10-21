# Terrain: Lighting and Landscape - alpha.14

3 MCP commands were added, total Terrain 30, project 144 tools in 9 modules.

- `terrain.lighting.inspect`: active tileset, local CTerrain/Lighting, CLight and its states. These dependencies are shown separately: localBinding is not the complete result of inheritance.
- `terrain.lighting.plan`: preset assignment and lighting settings with one plan.
- `terrain.landscape.plan`: Relief/texture generation and optional lighting in one plane on an existing map. Without area automatically selects the physical boundaries of the map; protected cliffs/ramps/holes remain protected.
- `terrain.assets` with `kind:"lighting"`: Search for available CLight through Browse and declared dependencies.

## Example

```json
{"operations":[
  {"op":"lighting.preset","id":"CodexNight","parent":"Agria","ambientColor":[0.12,0.18,0.3],"exposure":1.2,"whitePoint":1.85,"directional":[{"index":"Key","color":[0.65,0.75,1],"direction":[0.4,-0.5,-0.7],"intensity":0.45}]},
  {"op":"lighting.assign","id":"CodexNight"}
]}
```

Parent Agria should be allowed in your card/dependencies. Preset names are not made up. New id with parent isolates changes; editing an existing id affects all of its links. `stateIndex`00 by default 0; supported explicit index and native no index for zero state. AmbientColor and DirectionalLight retain representation as attribute or daughter.

First, `terrain.apply(planId, dryRun:false, stage:true)`, then `terrain.save(transactionId, dryRun:false)`. LightData.xml, TerrainData.xml, GameData Includes, and ComponentList are stored by one group. Source files and dependencies are protected from stale plans, including post-staging changes. The common dependency verification code is still called STALE_WATER_DEPENDENCIES, and is also used by lighting.

XML DSL:

```xml
<TerrainRecipe version="1">
  <LightingPreset id="CodexNight" parent="Agria" ambientColor="0.12,0.18,0.3" exposure="1.2" whitePoint="1.85"/>
  <Lighting id="CodexNight"/>
</TerrainRecipe>
```

Directional settings are available through JSON; XML supports background/HDR. In the GUI, you can assign an existing preset or specify it for Generate style. The rest of the settings are available through MCP.

## Confirmation and boundaries

Native map City of Tempest: heightMap tileSet=Citytile, CTerrain Citytile contains Lighting=Agria, LightData.xml contains Agria/AgriaNight/ArcadeCityLight. Fixtures of two directories are included in src/tests/fixtures/lighting-native; the original map is saved without modifications.

Verified Core LightData.xml SC2Mapster/SC2GameData, commit 6dd323aae4209a01f110719a00b4e8f7a88389bc, path mods/core.sc2mod/base.sc2data/GameData/LightData.xml. Confirmed ToDInfoArray, AmbientColor, Param HDRExposure/HDRWhitePoint, DirectionalLight Key/Fill/Back and Color/Direction/ColorMiplier.

Do not change the tileSet in t3Terrain.xml for the sake of lighting: only the corresponding CTerrain/Lighting connection, the remaining fields/unknown elements are saved. A clean map from scratch is not yet supported: you need an extracted map kit or a proven blueprint. Existing commands generate, mountain, valley, plateau, roadter, road, coast, transition, river/lake, create_location allow you to build a landscape in it. River/lake without water-operation form only the relief.

**Terrain does not yet cover the entire editor:** structural creation of cliffs/ramps/pathing, complex body/wave water, full day/night tuning, full fog/sky/postprocess and engine preview remain unsupported. Native unknown data is saved. GUI triggers are excluded; Galaxy scripts remain the next step. SC2Editor launch and game not executed.
