# Browse / Placement: Instructions for Codex

Continue to work on an existing SC2Editor MCP server. `browse.*` looks for definitions and assets; `placement.*` places selected directory objects. A normal .m3 file does not become Unit/Doodad just because it is found on a disk.

1. Work with a copy of the unpacked card. Specify SC2_UI_ROOT and unpacked mod roots in SC2_ASSET_ROOTS. Having root does not mean declared dependency: check browse.dependencies and DocumentInfo.
2. Call browse.search with query and type restriction. For Marine: catalogType=Unit, query=Marine. For decor: objectKind=Doodad, query=tree/rock/plant/fire. Use locale for a localized name.
3. Check availability, evidence and the browse.related chain. Use browse.get for detailed fields/inheritance. Choose a specific key; don't guess the ID and don't hide the ambiguity of the layers.
4. Create a placement.addUnit/addDoodad/addBatch plan. Choose line/grid/circle/scatter for a group. Use placement.createLocation for a whole location: forest, desert, city, base, ruins or custom - one plan, not a hundred individual calls.
5. Show placement.preview: operations, diff, validation. Specify proven bounds. Z is manually entered. Pathing, model collisions and surface height are not confirmed by this version.
6. placement.apply is the default dry-run. Only after selecting the user apply dryRun=false, stage=false, backup=true. stage=true is a draft; its saving does not occur automatically.
7. Re-call placement.scan/validate. To roll back, first placement.rollback dryRun=true, then when confirming dryRun=false. This is one backup level, not a permanent undo journal.

GUI: Browse/Placement tab in the previous launcher. Search → result selection → Plan Unit/Plan Doodad or Generate location preview → diff → Apply. Dry-run is enabled; you need to remove it for a real record. Only metadata-preview is available, not 3D.

If you receive a STALE_PLACEMENT_PLAN, do not bypass the hash guard: read the modified map and prepare a new request. Repeating the same request in the same session does not create a random take. After restarting, there is no such guarantee yet.

Don't call a fixture demonstration a real map; don't take XML parse as proof of discovery of SC2Editor. Open, editor-save, visual validation, and runtime mark independently. Examples of JSON and schemas are BROWSE_PLACEMENT_MCP.md and generated/browse-placement-tools.json.
