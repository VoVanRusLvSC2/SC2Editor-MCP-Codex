# Current project status

The current public product name is **SC2EditorToolkit**. Start with the
[verified-scope matrix and public evidence](VERIFICATION.md), which distinguishes
dated observations from current source scope. Inherited command-card guards now
reject known slot/cell/shared-face conflicts; zero-speed movement availability
has a bounded warning. Two new launches verify normal movement and native kill-XP
progression. Original Editor load/compile and 1328 regression checks passed, with
one Windows platform skip. Reviewed HUD frames have nine command icons and no
hotkey modal; the small level burst stays in frame. Main-unit ability animation
and other presentation profiles remain unverified. The preceding targeted
ability checkpoint has four successful corpus launches and separate impact/audio.
Regional
native ownership has three exact
ordinary archives, six clean game launches and 48 ground traversals. A local
portable passed schema/fingerprint checks and private-source exclusion. The full
roadmap remains incomplete; use `npm run evidence:status` for explicit unresolved
requirements and historical source drift. The pinned Editor Toolkit is
0.10.0-rc.1 (protocol 11); private GameToolkit is v0.1.0-dev.11.

The public module selections share one Workspace and transaction coordinator.
Script also registers `trigger.*` authoring. `modkit.capabilities` reports the
current surface; individual tools report format and engine limitations.

## Authoring source update — 2026-10-21

The source distribution includes compact authoring commands, the complete bundled
reference catalog, measured decor palettes/prefabs, trigger organization and GUI
runtime fixes, Data actor/effect recipes, native Editor-load metadata preparation,
English instructions and three project skills. Catalog observations and geometry
measurements do not establish engine pathing, visual quality or rendering parity.

The optional bridge now pins Toolkit 0.9.2-rc.1 (native protocol 11). A single
version/protocol/package-hash pin drives setup, runtime discovery and handshake;
mixed installations fail before launch. The earlier 0.9.1 Win32 126 startup
failure no longer reproduces in the new private-copy arena test: native load/Data,
original GUI generation/compilation, Save As/Close/disk reopen and all 60 component
comparisons passed. Source hashes stayed unchanged. A new whole-map native PNG
was inspected and shows terrain, units and decor. These are local fixture results;
gameplay, all-map rendering coverage and ability presentation remain separate
checks. Saved-camera A/B/A captures passed native core-parameter readback; the
resulting close views were inspected separately from the whole-map export.
See [native checks](NATIVE_EDITOR.md), [authoring protocol](AUTHORING_PROTOCOL.md),
[decor workflow](DECOR_VISUAL_WORKFLOW.md) and [skills](../.agents/skills/README.md).

The dated validation sections below are historical evidence, not certification of
every later module or map.

Terrain includes ten `terrain.surface.*` read-only tools from the supplied Surface Toolkit: scoped component inspection, raw grid sampling, structural validation, preview-only byte edits and authored catalog inspection. These tools observe staged drafts and detect changes in their observed read set. [Terrain implementation and limits](TERRAIN.md).

The repository retains required runtime registries, native fixtures, specifications and regression tests. Obsolete standalone ALPHA summaries and one-off ALPHA reports were removed; [repository structure and cleanup scope](REPOSITORY_STRUCTURE.md).

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

[How CASC works](CASC.md) · [What works and what remains](CAPABILITIES_REPORT.md).

## Separate map Settings and portable MCP — 2026-10-11

Settings adds eleven MCP tools for Attributes definitions/values/defaults, native variant clone/fields/existing bindings, MapInfo v39 player parameters and thirteen known option bits. Existing module implementations are retained; composition/registration, coverage and new profiles are extended. The new landscape profile combines Terrain, CASC, Settings and existing auxiliary modules.

- Four existing native MapInfo fixtures decode 9/14/13/10 player records; suffix preservation and core integrity are checked.
- Sixteen new Settings regressions pass, including actual SDK multi-file plan/stage/save.
- Full suite: 561 tests, 560 PASS, 0 failures, 1 existing Unix shell fixture skipped on Windows.
- Windows portable contains bundled Node, MPQ/CASC helpers and SC2-MCP.cmd for stdio.
- Settings Editor/game validation: NOT_EXECUTED; no Editor was launched for this work.
- Team/alliance reconstruction, player counts, fresh variants without native templates and new standard namespace bindings remain unsupported.

[Settings workflow and source evidence](SETTINGS.md).

Final Windows portable SDK verification: PASS. All twelve modules register; Terrain/CASC/Settings expose 46/9/11 tools. Actual installed-game XML read and warm cache hit, native Terrain hide/show stage/save, Settings player and variant stage/save, and packed MPQ export/reopen all pass. SC2 Editor was not launched. The package includes VALIDATION.json with the verification scope.

## Local empty-document implementation — 2026-10-11

Document adds ten tools for from-scratch dependent/extension mods and empty Arcade map foundations with optional initial flat terrain. Existing module writers are retained. Sources are read through CASC/local component snapshots; creation pins build, files and full local dependency manifests. Engine bootstrap contains no gameplay initialization.

Native-exact default fidelity and Header publish/hash identities remain PARTIAL/UNCERTIFIED. Melee/Training, automatic multiplayer policies and native border/nav/cliff generation are not enabled. No Editor was launched. Results remain local at the user request. [Usage and actual limits](DOCUMENT_CREATION.md).

Local document validation: development build and ESLint PASS; complete suite 579 tests / 578 PASS / 0 failures / 1 existing Unix shell skip. Eighteen document regressions pass, including installed-game real SDK creation and native packed-map reopen. Header decoder rejects every truncated prefix of the independent native fixture. Portable verification is recorded separately after the release build.

Windows document portable verification: PASS. All thirteen modules register and ten document tools are available. With the bundled Node/CASC/MPQ helpers, SDK calls created dependent and extension mod component directories, an empty 64×48 Agria map and a packed map. Directory inspection and native packed-map reopen passed. Native-exact defaults/engine acceptance remain explicitly unverified.
