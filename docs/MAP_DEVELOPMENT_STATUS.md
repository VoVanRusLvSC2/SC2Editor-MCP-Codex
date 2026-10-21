# Implementation of the plan, alpha.13

Water: flat v110 water rectangles and CWater material/state authoring are implemented; Includes and Components are saved together. MCP and GUI actions are available. 228 PASS tests. 199 entries were studied on 14 native/GitHub tables; 175 Nova records passed byte-exact no-op. Complex body/wave sections and cliffs/ramps/pathing remain without writers. [Detailed instructions](TERRAIN_WATER.md)00.

Below is the historical account of stage alpha.12; the flat water operations disabled in it are replaced by a limited writer in alpha.13.

# Implementation of the plan, alpha.12

User clarification: development of GUI triggers is excluded; scripts remain after Terrain, editor / game at the end.

Done:

1. Water audit: unconfirmed conversion of 56-byte records to "ponds" removed. Writers rejected; raw floats available for study, coverage unknown.
2. Complete archive backend: StormLib, Linux x64 and Windows x64 helper, build script and portable bundling.
3. Export: Independent committed snapshot, temporary package, re-extract, reconciliation of the full set of user records and SHA-256, source files and target archive prior to publication.
4. Four originals went through the full entry roundtrip: 85 + 525 + 44 + 285 = 939 entries. Unknown user files are not lost; archive as a sequence of compressed bytes may differ.
5. MapInfo v39: bound core-prefix reader, integrity check on all four maps, boundary writer/fog/minimap with opaque tail.
6. Eleven map.* tools in total composition root. Import/export, native clone, inspect/validate, plan/apply/save/discard. Source paths remain inside Workspace.
7. Guard full manifest for metadata plan is saved until byte-group save and inherited at restage.
8. Persistent prepared/committed journal for Workspace text/byte commits and process lock. Interrupted group recovers at startup/before mutation; external unknown content causes conflict before recovery.SIGKILL checked between rename, SIGKILL after all rename to commit marker and competitive increment of two processes.

Incomplete: pure map.create, full DocumentHeader/player/variant/defaults design, universal directory/dependency pin outside map.*, init/resize/derived Terrain, cliff/ramp/body/pathing writers, vertex colors and script.* Journal checked at process stop; power-loss certification not met. Drafts/commit undo remain process-local.

The reason you can't promise a clean map yet is that the sources are script maps, not a proven clean blueprint. The native serialization code from the EXE copy provided is not restored. There is no non-zero bodyCount water and no PaintedPathingLayer sample. The current clone is not issued as a clean map generation.

Windows helper - x64 PE, cross-compiled; run on Windows NOT_EXECUTED. SC2Editor/game didn't start. JSON reports and automated tests confirm the file part, not the actual work of all types in the engine.

The next necessary block: completion of native defaults / document; then Terrain init / derived / resize.
