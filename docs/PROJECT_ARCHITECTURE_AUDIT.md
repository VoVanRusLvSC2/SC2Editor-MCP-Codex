# Architectural audit - alpha.10

The architecture of the available source project, eight modules, writing, drafts, diagrams and tests are tested. This is not a new complete analysis of the SC2Editor machine code or run the editor.

## Corrected

- CreateProject for MCP/GUI; parallel loading of independent circuits.
- General queue of text/binary operations, UUID temporary files and write error compensation.
- Cutscene uses a shared Workspace instead of a separate state.
- Pin drafts are the source bytes and the existence of the file; external edit blocks saving without manual SHA.
- Text/Data/AI related files are saved/discarded by the entire group; partial modifications are prohibited.
- The direct commit clears the old draft; the identity team saves the prepared draft.
- Font import uses a common binary writer and no-destination check.
- Destination Symlink and non-UTF8 text are blocked prior to writing.
- Runtime/archive adapter is not a validation; .SC2Map directory is not an archive.
- For convenience: ui.project_status, /api/project/status, Project coverage button, npm run project:audit.

## Coverage of eight sections

Numbers are derived from current registries and actual registration. These aren't percentages of all the capabilities of the original editor.

| Section | Teams | Covered. | Gaps up to 100% |
| --- | ---: | --- | --- |
| UI | 40 | 892/892 known frame types, 1918 declared properties; generic editing and declared scalar validation | 58 observed-only properties without full typing; hidden rules and locked-frame behavior |
| Cutscene | 20 | 52 types: 43 supported, 9 preserve-only; 664 properties: 531 supported, 118 Editor-only, 15 runtime-only | Preserve-only does not mean semantic creation; playback/editor acceptance is not verified |
| Text | 6 | 21/21 known Font Style attributes; 2839 styles, 176 constants, 9 font groups; locale keys/rich text | Not all rich-text designs have semantic operations; glyph coverage, rendering/fallback untested |
| Data | 5 | Generic editing of all observed C-types/fields; consistency with historical 529 types/10509 field paths | 100% observed corpus does not equal all SC2 data; hidden enums/defaults/combinations |
| AI | 5 | 9 nodes/27 properties; root/direct Definition confirmed; 3 nodes gated, 4 preserve-only | 26 properties gated-unconfirmed; populated waves opt-in; Config/Script/runtime not confirmed |
| Browse | 11 | Catalogues, loose assets, localization, references, declared/installed layers | Full asset universe unknown; missing roots, untested MPQ/CASC adapter; no engine 3D preview |
| Placement | 16 | Unit/Doodad XML, seeded scatter/spacing, ground snap, joint location plans | Other native object types do not have full editors; footprint/pathing/collision is not checked |
| Terrain | 25 | Height/noise/smoothing/textures/style/XML recipes/sampling/byte groups; water template rectangle cloning | No cliff/ramp/pathing editing; water payload/level opaque; native fixtures only four maps/known versions |

The Cutscene 646 in the old discovery documents is a historical counter. The current downloader combines additional properties and outputs 664. The general audit takes numbers from the code.

All eight sections are present, but **100% of the full semantics of SC2 are not established even before testing in the editor**.Global percentage is not calculated: the full denominator is unknown. Data 100% consistency with observed corpus stored and UI 100% generic coverage of known declarations are narrow verifiable statements, not full engine support.

## Release verification

Build/ESLint PASS; full Node suite: 198 PASS, 0 failures, 12 new tests. Text/binary concurrency, queue recovery, group save/discard, external edits, discard during async validation, second-rename failure with recovery of both files/save drafts, UTF8/symlink, binary existence pinning and shared Cutscene state.

Historically large corpus sweeps have not been re-executed. SC2Editor L5, gameplay L6, Windows launcher execution and visual browser QA - NOT_EXECUTED. Portable HTTP/MCP smoke is fixed separately in generated/project-portable-smoke.json.

## Next order.

1. Full dependency snapshot read sets and persistent recovery journal.
2. Native populated AI fixtures; additional Terrain versions and water/cliff/ramp/pathing discovery.
3. Positive/negative semantic cases in each section.
4. L5 save/reopen in SC2Editor 5.0.16.97563 and byte/semantic diffs for each case.
5. L6 runtime probes with the results of each case, not the adapter configured flag.

Remains: queue inside one Workspace, no interprocess lock; not all dependency reads pin; no crash-wide atomicity/permanent undo; symlink checks do not protect against a hostile race to change paths.
