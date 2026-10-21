# Terrain: Instructions for Codex

Up-to-date TERRAIN and the new `terrain.surface.*`: [full-time](TERRAIN.md).

Use an existing MCP server and an unpacked map with native t3 components. First, `terrain.inspect`, `terrain.capabilities`, `terrain.palette.get`; coordinates from actual bounds. The module does not create a terrain bundle from scratch and does not write MPQ.

1. For a point change, call `terrain.plan` with operations. For a style area, `terrain.generate`. For a road, mountain, crater, and other shapes, the corresponding `terrain.*` command.
2. Show `terrain.preview`, check `terrain.validate`, file composition and warnings. Preview is a diagnostic PNG, not a game render.
3. `terrain.apply` is the default dry-run. For a draft, pass `dryRun:false, stage:true`.
4. Save **the whole group** via `terrain.save` with returned `transaction.transactionId` and `dryRun:false`. Or write directly via apply from `stage:false`.
5. `terrain.rollback` with the same transactionId and `dryRun:false` cancels the group or restores saved bytes. The log is available only in the current process and is limited to eight commit entries. After the restart, the `.sc2uimcp.bak` file is available, there is no automatic journal undo.

Styles: forest, desert, city, snow, jungle, swamp, volcanic, badlands, coastal, space_platform. These are recipes for basic relief and painting. Specify `materials.base` from the real active palette; optional rock is used on the slopes. Auto-selection is based on the ID of available materials, not on their visual evaluation. If there is no suitable material, use `terrain.assets`, dependencies resolution via Browse and `palette.update`; do not invent IDs.

Supports rectangle/circle/polygon/corridor, strength, edgeBlend, protectedAreas, seeded noise and gaussian/edge_preserving smoothing. Height brushes retain base/mask, protect holes and boundaries of different levels, as well as the conservative area of existing ramps.

XML: transfer the contents of the [forest-road.xml](../examples/terrain/forest-road.xml) directly to `terrain.recipe.plan`; or use `terrain.recipe.parse`, then `terrain.plan`. This is our strict TerrainRecipe DSL, not native XML cards. The `smoothRadius` setting specifies the filter radius; the radius of the Area is the radius of the area. JSON example: [raise-smooth.json](../examples/terrain/raise-smooth.json).

For `placement.addUnit/addDoodad` objects, `snapToTerrain:true` is supported. For the overall result, use `placement.createLocation` with `terrain:{style, materials, relief, ...}`: new objects are tied to the planned height, and the returned `plan.id` is stored via **terrain.apply/save/rollback**. Distance restrictions and slope exclusions do not replace model collision/pathing; specify and verify the result.

Water create/update/remove blocked: 56-byte table is not proven as water bodies, raw floats are not used as coverage. sourceIndex/sourceWaterIndex does not include an unconfirmed writer. River/lake cuts the bed/trench without creating a water polygon. Native cliffs/ramps/pathing and water bodies are blocked. Stamp replaces all compatible terrain bundle and does not rearrange previous Objects/triggers.

For GUI: Terrain Tab → Inspect → Area and Style/Brush → Plan → Preview → Stage → Save. Discard cancels the staged group. MCP rollback can restore commit in the current session.

Tests on the native components of the four cards confirm sizes, saves bytes and supported structures. Used read-only analysis provided by SC2Editor 5.0.16.97563. This does not prove the opening/saving of the modified card in Editor or work in the game; such checks are not_EXECUTED yet. Full commands, formats and boundaries: [TERRAIN_MCP.md](TERRAIN_MCP.md).

For decorations with surface filters, use `placement.scatterDoodads`; to update the height of existing objects - `placement.snapToTerrain`. [Detailed examples](TERRAIN_DOODADS.md).
