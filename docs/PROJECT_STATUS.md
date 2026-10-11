# Current project status

Ten public module selections share one Workspace and transaction coordinator. Script also registers bounded `trigger.*` authoring. The current tool surface is reported by `modkit.capabilities`; format and engine limitations are reported by the relevant module.

Terrain includes ten `terrain.surface.*` read-only tools from the supplied Surface Toolkit: scoped component inspection, raw grid sampling, structural validation, preview-only byte edits and authored catalog inspection. These tools observe staged drafts and detect changes in their observed read set. [Terrain implementation and limits](TERRAIN_RU.md).

The repository retains required runtime registries, native fixtures, specifications and regression tests. Obsolete standalone ALPHA summaries and one-off ALPHA reports were removed; [repository structure and cleanup scope](REPOSITORY_STRUCTURE_RU.md).

Automated validation covers TypeScript builds, lint, codec/catalog regressions and real MCP SDK stdio calls. Neither synthetic tests nor available archive adapters establish SC2 Editor save/reopen, rendering, navigation or runtime acceptance. Refer to individual format/operation evidence before claiming compatibility.

## Validation on Windows — 2026-10-11

- TypeScript development and release builds: PASS.
- ESLint: PASS.
- Complete test suite: 519 tests, 518 PASS, 0 failures, 1 existing Unix shell fixture skipped on Windows.
- Surface Toolkit regressions: 166 PASS; host and real SDK transport checks: 8 PASS.
- `terrain:schemas`: 41 Terrain tools, including 10 new scoped Surface tools.
- Windows portable build and SDK stdio smoke: PASS; overview and authored catalog tokens work with the bundled XML parser.

`.gitattributes` pins LF for generated text examples so byte-for-byte checks work on Windows. Runtime schema shards and synthetic component bytes are retained. SC2 Editor/runtime validation has not been executed by this change.
