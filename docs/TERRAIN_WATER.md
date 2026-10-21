# Terrain water - alpha.13

`t3Water`00: WATR v110, zero bodyCount, exact length 32 + 56 × count. Each record contains UTF8 CWater name up to 39 bytes and four coordinates. Native City and GitHub thethingrevivalremade samples contain 6 and 18 rectangles on a grid of 8 cells, respectively. Complex body/wave sections are saved without editing. Support for this limited profile relies on real files and SC2Mapster description; it does not confirm the work of the editor/wave.

`terrain.water.inspect` shows records, profiles and local CWater states. Available materials are searched through `terrain.assets` with `kind: "water"`; new material is inherited from an authorized parent. Use existing map material or extracted and declared dependencies.

`terrain.water.plan` accepts a water.* package of operations. `terrain.apply` with `dryRun:false, stage:true` creates a draft, `terrain.save` with `dryRun:false` saves the group. By default, commands do not write to disk.

```json
{
  "operations": [
    {"op":"water.material","id":"CodexLake","parent":"Default","height":6,"color":[0.1,0.3,0.5,0.4],"uvRate":[0,-0.001,0,0],"refractionDistortion":0.02},
    {"op":"water.create","template":"CodexLake","area":{"type":"rectangle","minX":8,"minY":8,"maxX":24,"maxY":24}}
  ]
}
```

`Default` in the example should be allowed in the current map/dependencies. Alternative: create water with `sourceIndex` of the existing record. Specify exactly one of template/sourceIndex. `water.update` accepts index, area and optional template replacement; `water.remove` is index. Coordinates should lie inside the map and multiples of 8; intersecting rectangles are deflected.

The material supports stateIndex (default 0), height, RGBA color, uvRate, reflectionDistortion, refractionDistortion, framesPerSec and isLava. Changing existing material affects all records with that name. For an individual lake, create a new id with parent. Opaque fields, comments, other states and the native attribute/child XML form are saved. Connecting WaterData.xml00 to GameData.xml and gada component is in the same group. New must be available; modifying existing material is not supported.

```xml
<TerrainRecipe version="1">
  <Area id="lake" shape="rectangle" min="8,8" max="24,24"/>
  <WaterMaterial id="CodexLake" parent="Default" height="6"
                 color="0.1,0.3,0.5,0.4" uvRate="0,-0.001,0,0"/>
  <Water area="lake" template="CodexLake"/>
</TerrainRecipe>
```

XML is transmitted to `terrain.recipe.plan`. UpdateWater and RemoveWater are also available. Terrain lake/river can add water via sourceWaterIndex only for a rectangular area on a grid of 8 cells; an arbitrary bedbed polygon into a native water body is not converted.

Diagnostic water preview shows rectangular dimensions. Scatter excludes them conservatively as a whole: water level, real shore boundaries, shader clipping and passability are not proven. Maps with unread water are not issued as dry. Before saving, the original bytes, directory and, if Browse is present, the exact bytes / list of other indexed files are checked by the group separately.

Sources: SC2Mapster/SC2GameData commit 6dd323aae4209a01f110719a00b4e8f7a88389bc (Core/Liberty WaterData.xml); willuwontu/thethingrevivalremade.SC2Map commit 206d6644f56a2818969b4dc323d117a8e84484; custom map City. SHA-256 and gzip samples - src/tests/fixture/water-native/U. A summary of additional hulls are excluded after the Galaxy-I hull.

In GUI Terrain, Add water, Move/change water, Remove water and Water material settings are available. Material fields are shown for water actions, existing local IDs are offered after Inspect map. The Align area inward button aligns the selected area inwards by 8 cells. Then the usual Create plan → Stage → Save / Discard is used.

Alpha.13: 228 PASS, 0 fail/skip, build/lint PASS; MCP/HTTP smoke PASS on Linux Node. 14 tables contain 199 observable entries, of which all 175 entries of nine Nova cards passed byte-exact no-op update. Editor/game/Windows execution and visual GUI verification are not performed.
