# Changelog

## 1.1.0-alpha.20 — 2026-09-21

- Enrich pinned Galaxy native signatures with the official GUI action name, grammar, hint, FunctionDef identity and ParamDef identities from local `NativeLib.TriggerLib` and `TriggerStrings.txt` evidence.
- Correctly expose `Turn Ability Highlight On/Off` and `Turn Button Highlight On/Off` instead of presenting their internal Galaxy implementation identifiers as editor action names.
- Load and parse the 1.4 MB Galaxy native registry once per server process, build a fail-closed unique-name index and resolve context/validation calls by indexed lookup instead of repeatedly scanning all 2,200 functions.
- 277 regression tests executed: 276 PASS and one platform shell fixture skipped. Changed files pass ESLint; two unrelated pre-existing lint failures remain documented by the full lint run.

## 1.1.0-alpha.19 — 2026-09-21

- Add focused MCP module profiles through `SC2_MCP_PROFILE`/`SC2_MCP_MODULES`; retain `all` as the backward-compatible default and expose the active surface through `modkit.capabilities`.
- Defer large Data schema JSON parsing until the first Data query.
- Index `catalogsData.xsd` into a compact manifest and per-type shards; merge declared XSD evidence with observed Data schema descriptions and coverage.
- Make the checked-in Cutscene example deterministic and fix Windows-safe ESM fixture paths.
- 275 regression tests PASS, one platform shell fixture skipped; build and focused stdio transport tests PASS.

## 1.1.0-alpha.13 — 2026-09-14

- Add flat v110 water create/update/remove with observed 8-cell grid, overlap/UTF8/dependency checks.
- Add CWater material/state height, RGBA, UV, reflection/refraction, animation and lava fields with unknown XML preservation.
- Commit WaterData, GameData Includes, component manifest and water rectangles together; retain catalog read guards until save.
- Add terrain.water.inspect/plan and strict WaterMaterial/Water/UpdateWater/RemoveWater XML operations.
- 228 regression tests PASS, including real stdio water planning, mixed-file save and MPQ reopen verification. Complex body/wave sections and Editor/game acceptance remain unverified.

## 1.1.0-alpha.12 — 2026-09-13

- Add Map as the ninth module, with 11 tools for inspection, native archive import/export, cloning and bounded MapInfo metadata plans.
- Bundle pinned StormLib helpers; verify all 939 user entries across four supplied maps by extraction, packing and SHA-256 comparison.
- Add cross-process write locks and persistent prepared/committed recovery journals, including process-kill recovery tests.
- Block unverified water-body edits and retain opaque water data. Empty native water tables support confirmed dry-ground placement.
- 220 tests PASS. Clean-map creation, full Terrain, Galaxy script authoring and Editor/game acceptance remain unfinished. See CHANGELOG-alpha12.md.

## 1.1.0-alpha.11 — 2026-09-13

- Track preflight and validation text reads, exact external catalog snapshots and effective local drafts in per-request async contexts.
- Keep dependency read sets with staged text groups; verify before transformation, after validation and before rename.
- Wrap Data/AI preflight in the shared context; bypass AI/Browse caches during tracked editing and pin absence of root Triggers.
- Route Browse dependency XML/text/DocumentInfo through tracked reads without introducing writes to dependencies or Triggers.
- Add seven dependency tests: 205 total PASS. Directory enumeration, crash recovery and untracked binary/adapter reads remain explicit gaps.

## 1.1.0-alpha.10 — 2026-09-13

- Share project composition between MCP and GUI; load independent registries concurrently.
- Unify text, binary, Cutscene and font disk writes with one Workspace queue and UUID temporary files.
- Pin staged bytes/existence; reject external edits and mid-operation draft changes. Save/discard complete text groups, including joint layout/Include creation.
- Compensate handled multi-file failures without clearing drafts or intentionally overwriting newer external edits.
- Reject ordinary symlink destinations and invalid UTF8 text editing; report configured adapters separately from actual verification.
- Add ui.project_status, GUI Project coverage and reproducible all-module registration/coverage audit.
- Add twelve tests: 198 PASS; build/lint/portable MCP and HTTP smoke PASS. Full SC2 semantics and Editor/runtime/Windows execution are not claimed.

## 1.1.0-alpha.9 — 2026-09-13

- Batch consecutive placement additions into one XML append/reparse with sequential-compatible ID allocation and failure-safe run validation.
- Use exact-distance spatial buckets for seeded scatter and plan validation; preserve alpha.8 seeded output.
- Bound terrain brush and sync texture traversal; reuse protection checks and palette lookup maps. Add one-snapshot ground sampling for decoration filters.
- Add placement.scatterDoodads with weighted assets, seed, height/slope/texture filters, water/protected geometry exclusions and spacing from existing centers.
- Add placement.snapToTerrain for selected existing Unit/Doodad IDs, preserving XY/unknown XML and setting the observed Doodad HeightAbsolute=1 flag.
- Fix ground-plan cache hashes and reject standalone placements based on unsaved terrain drafts. Fix combined-location GUI API routing to Terrain preview/apply.
- Add terrain.recipe.plan, compact Doodad MCP responses and GUI controls for ground-aware decorations.
- Add eight regression tests and real stdio execution checks. 186 tests passed; local benchmark output hashes match alpha.8. Native Editor/runtime acceptance remains unverified.

## 1.1.0-alpha.8 — 2026-09-13

- Add Terrain as the eighth module to the existing MCP/GUI/Windows launcher. Support native component inspect/sample/analyze, palette and dependency-aware asset queries.
- Add bounded height/texture brushes, Gaussian and edge preserving smoothing, seeded style recipes, nine geometric feature commands, strict JSON schemas and TerrainRecipe XML DSL.
- Preserve opaque native bytes and XML spans; update supported sync records with explicit reference-based strategies. Block unsupported cliffs/ramps/pathing and arbitrary water levels.
- Add template-preserving rectangular water entry edits and compatible whole-map donor stamps with source/dependency guards.
- Add grouped binary staging, backup, checksum checks, compensating rollback and exact in-session undo, including new-file removal.
- Combine placement.createLocation terrain and object results in one transaction; support ground snapping for individual Unit/Doodad plans.
- Add compressed native fixtures from four maps, binary/GUI API/transport regression checks, reproducible schemas, XML example and diagnostic preview. SC2Editor open/save and runtime validation remain NOT_EXECUTED.

## 1.1.0-alpha.7 — 2026-09-13

- Restore the real previous alpha.5 A.I. Module into the existing seven-module server; keep all alpha.6 Browse/Placement and latest Data features.
- Add ai.context/query/describe_type/apply/validate, native CustomAI lossless editing, aliases and shared-core atomic aiai registration.
- Connect Unit availability to Browse declared dependency policy and cost/supply inheritance to Data; fingerprint reference cache invalidation.
- Add A.I. Module GUI metadata, batch editor, reviewed preview/diff, validation and backup apply; no standalone EXE.
- Exclude Trigger/Terrain editing. AI writes only CustomAI and sibling ComponentList; read-only aidef/aidefwave links block renames/deletes, including force/native/validation opt-outs.
- Harden recursive unconfirmed structure gates, component registrations, ambiguous selectors, integer validation and single-quote escaping.
- Preserve prior extracted CustomAI sample bytes, add migration regression/transport tests and current schemas/reports. Populated waves remain opt-in and L5/L6 not executed.

## 1.1.0-alpha.6 — 2026-09-13

- Add a Russian README covering all six modules, startup, examples, safety boundaries and actual validation status; include it in the portable package.

- Add `browse.*` over the existing Data MCP and string-table parser, with ranked/localized search, source layers, bounded graph navigation and generic unknown catalog objects.
- Resolve local `DocumentInfo` dependencies transitively against explicitly configured unpacked roots; distinguish installed, declared and missing mods.
- Add separate Unit/Doodad placement plans, mixed batches, deterministic layouts, minimal-span editing of `Objects`, validation, preview/apply/rollback.
- Add universal `placement.createLocation` presets, including settlement quadrants with reserved crossroads, instead of a forest-specific tool.
- Integrate both modules with the existing stdio server, launcher and GUI; keep dry-run enabled by default.
- Pin effective/disk hashes at plan creation, recheck dependency readiness, preserve unknown XML, and prevent repeated commits of the same request within one server session.
- Add reproducible schemas, evidence scan and fixture demonstration. This remains an alpha: native MPQ/CASC discovery, real-map placement demo, editor round-trip and runtime acceptance are not validated here.
