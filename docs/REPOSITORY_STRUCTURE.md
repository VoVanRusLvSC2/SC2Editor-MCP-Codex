# Structure of the repository

The project is a TypeScript MCP/GUI application with C++ MPQ/CASC backends.
`src/app/moduleSelection.ts` defines the current module selections;
`modkit.capabilities` reports the active surface. `trigger.*` connects with Script.
The composition root is `src/app/project.ts` and server registration is in
`src/app/server.ts`.

| Catalogue | What is stored and why |
| --- | --- |
| `src/app/` | Module assembly, server, profiles, capability/coverage checks |
| `src/core/` | XML source spans, Workspace, text/binary drafts, group entry, stale guards and recovery journal |
| `src/modules/` | UI-linked and subject modules; TERRAIN contains the new `surface/` |
| `src/mcp/` | UI MCP Server and Connecting Existing Modules |
| `src/gui/` | HTTP API and browser-based workbench |
| `src/schema/`, `schema/` | Runtime Registry and UI Schemes |
| `src/tests/` | Project tests and necessary native/synthetic fixtures |
| `tests/terrain-surface/` | Ported toolkit regressions and selected SC2GameData observations |
| `generated/` | Runtime registries, input schemas and related evidence |
| `scripts/` | Circuit generation, discovery, checks, benchmarks and portable assembly |
| `native/` | C++ archive adapter required runtime binaries and StormLib licenses |
| `windows/` | Launcher and Windows instructions |
| `examples/` | Reproduced examples |
| `docs/` | Current manuals, formats, constraints and architecture |
| `resources/authoring-catalog/` | Bundled decor, biome, vegetation, location and style references, with import provenance/checksums |
| `AGENTS.md`, `.agents/skills/` | Portable English project rules and scoped authoring workflows |

Most `generated/` files are `data-xsd-index`: manifest and small XSD shards that actually read `DataXsdRegistry`. These are the necessary runtime data. Galaxy, Trigger, AI, Cutscene, Text and Data registries are also used by code/generated build. The name itself does not mean garbage.

## CASC

`src/modules/casc` owns installed-game source, verified cache and metadata mounts. `native/casc` contains helper source, pinned upstream revision and license; `native/bin/windows-x64/sc2-mcp-casc.exe` requires runtime/portable. Game bytes and source ZIP references are excluded from Git via `.sc2mcp-casc-cache/` and `work/`. [CASC guide](CASC.md).

## TERRAIN

Connection: `terrain` → `registerTerrainTools` → existing tools and `registerTerrainSurfaceTools`. The new toolkit uses a common Workspace. Its format/core layer is left separate so that research profiles do not change the current writer. [Full description](TERRAIN.md).

## Alpha clean-up

Removed four separate, outdated reports from the root: `ALPHA15-PROGRESS-RU.md`, `ALPHA17-READINESS-RU.md`, `ALPHA18-MAP-CREATION-RU.md`, `CHANGELOG-alpha12.md`. Deleted ten disposable `generated/*alpha*` reports: old preflight/verification, water/lighting/corpus, and portable status.

Benchmark baseline is used to compare results: it is renamed `generated/terrain-doodads-performance-baseline.json`, the link is updated. In the current names tracked ALPHA files are no longer. Prerelease version in package metadata and entries of general history keep the honest status of the product.

README now describes topical modules and leads to subject guides. Basic CHANGELOG, specifications, native evidence, runtime registries and test maps are saved.

From ZIP moved format/core sources, necessary tests/fixtures, selected observations and notices. Not included are `dist/`, nested original ZIP, vendor mirror, old build logs, EXE string dumps and unverified individual MCP templates. The original user ZIP is saved in Downloads; the unpacked input is in the ignored `work/` working copy on K.

## What not to store in Git

Use [current composition and limitations](../PUBLISHING.md) for public delivery
and `npm run publication:audit`.The local research repository contains
already tracked fixtures/evidence; `.gitignore` does not exclude them from history.
The third-party renderer uses its `vendor/blizzard-models/dist/`.
Ignoring the root `/dist/` does not apply to it.
`generated/` is also not a reason to remove runtime registries.

`node_modules/`, `dist/`, `dist-runtime/`, `release/`, `work/`, assembly logs, cache/temp/backup files. These are excluded by `.gitignore`. A new report should be commissioned only when it is needed by runtime, a reproducible verification, or explains an unknown format with a source.
