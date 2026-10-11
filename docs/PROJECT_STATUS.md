# Current project status

Twelve public module selections share one Workspace and transaction coordinator. Script also registers bounded `trigger.*` authoring. The current tool surface is reported by `modkit.capabilities`; format and engine limitations are reported by the relevant module.

Terrain includes ten `terrain.surface.*` read-only tools from the supplied Surface Toolkit: scoped component inspection, raw grid sampling, structural validation, preview-only byte edits and authored catalog inspection. These tools observe staged drafts and detect changes in their observed read set. [Terrain implementation and limits](TERRAIN_RU.md).

The repository retains required runtime registries, native fixtures, specifications and regression tests. Obsolete standalone ALPHA summaries and one-off ALPHA reports were removed; [repository structure and cleanup scope](REPOSITORY_STRUCTURE_RU.md).

Automated validation covers TypeScript builds, lint, codec/catalog regressions and real MCP SDK stdio calls. Neither synthetic tests nor available archive adapters establish SC2 Editor save/reopen, rendering, navigation or runtime acceptance. Refer to individual format/operation evidence before claiming compatibility.

## Validation on Windows — 2026-10-11

- TypeScript development and release builds: PASS.
- ESLint: PASS.
- Complete test suite after Terrain/CASC/Settings: 561 tests, 560 PASS, 0 failures, 1 existing Unix shell fixture skipped on Windows.
- Surface Toolkit regressions: 166 PASS; host and real SDK transport checks: 8 PASS.
- `terrain:schemas`: 46 Terrain tools, including 10 new scoped Surface tools.
- Windows portable build and SDK stdio smoke: PASS; overview and authored catalog tokens work with the bundled XML parser.

`.gitattributes` pins LF for generated text examples so byte-for-byte checks work on Windows. Runtime schema shards and synthetic component bytes are retained. The user visually confirmed hidden/restored ground on the two MCP-authored packed p.SC2Map copies. That is a narrow user check, not automated full Editor/runtime validation. Native cliffs/ramps/pathing regeneration remains incomplete.

## Actual installed-game CASC validation — 2026-10-11

CASC is a separate read-only game source with nine MCP tools, a verified per-build byte cache, compressed Galaxy summaries and explicit Data/Browse mounts. Original installation files and supplied maps are not written by these tools. The native helper runs local-only with strict BLTE checks; full cache files are checked against CKey/MD5 and SHA-256.

- Installed SC2 5.0.17.98310: 780010 indexed ROOT paths; index metadata marks 312145 as locally available.
- Real SDK calls read current UnitData XML, native Galaxy declarations and a Liberty M3 resource range.
- Warm byte and symbol-summary cache hits: PASS.
- Core metadata mount: 245 files, 9878922 bytes; existing Data query returns current game records.
- Six source-byte SHA checks for the imported triggers.zip reference differ; that reference stays separate and does not replace current game data.
- Sixteen CASC regressions: PASS; complete suite 545 tests/544 PASS/0 failures/1 existing shell skip.
- Native reproducible build, development/release builds, ESLint, Windows portable build and actual-game portable SDK smoke: PASS.
- Windows helper PE imports only KERNEL32/WS2_32; the C++ runtime is statically linked.

[How CASC works](CASC_RU.md) · [What works and what remains](CAPABILITIES_REPORT_RU.md).

## Separate map Settings and portable MCP — 2026-10-11

Settings adds eleven MCP tools for Attributes definitions/values/defaults, native variant clone/fields/existing bindings, MapInfo v39 player parameters and thirteen known option bits. Existing module implementations are retained; composition/registration, coverage and new profiles are extended. The new landscape profile combines Terrain, CASC, Settings and existing auxiliary modules.

- Four existing native MapInfo fixtures decode 9/14/13/10 player records; suffix preservation and core integrity are checked.
- Sixteen new Settings regressions pass, including actual SDK multi-file plan/stage/save.
- Full suite: 561 tests, 560 PASS, 0 failures, 1 existing Unix shell fixture skipped on Windows.
- Windows portable contains bundled Node, MPQ/CASC helpers and SC2-MCP.cmd for stdio.
- Settings Editor/game validation: NOT_EXECUTED; no Editor was launched for this work.
- Team/alliance reconstruction, player counts, fresh variants without native templates and new standard namespace bindings remain unsupported.

[Settings workflow and source evidence](SETTINGS_RU.md).

Final Windows portable SDK verification: PASS. All twelve modules register; Terrain/CASC/Settings expose 46/9/11 tools. Actual installed-game XML read and warm cache hit, native Terrain hide/show stage/save, Settings player and variant stage/save, and packed MPQ export/reopen all pass. SC2 Editor was not launched. The package includes VALIDATION.json with the verification scope.
