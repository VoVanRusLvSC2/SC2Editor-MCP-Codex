# Text module coverage

Version: `1.1.0-alpha.5`.

| Area | Discovered | Editable | Preserve-only/unknown | Editor/runtime proof |
|---|---:|---:|---:|---|
| Core Font Styles | 2,839 | 2,839 through generic attributes | unknown attrs preserved | static/Core corpus |
| Style value attributes | 21 | 21 | future attrs preserved | EXE/Core evidence; L6 untested |
| Constants | 176 | generic add/set/remove | unknown nodes preserved | static/Core corpus |
| Font groups | 9 | generic ranges | unknown children preserved | static/Core corpus |
| Style flags | 15 | native/negated combinations | unknown tokens preserved | Core/EXE evidence |
| Font flags | 2 | native/negated combinations | unknown tokens preserved | observed Core |
| String-table files scanned | 319 | generic key/value patching | unknown lines preserved | static corpus |
| Rich-text tag candidates | 38 | 19 common tags parsed semantically | all 38+ raw-preserved | formatting classification incomplete |
| Native Cutscene Text | 55 nodes | `text.add`, generic property track | unknown attrs/children preserved | corpus; no runtime run |

## Validation status

- L1 XML/string/rich-text syntax: implemented.
- L2 style properties/types/enums: implemented for generated registry.
- L3 templates/constants/fonts/styles/text keys: implemented; dependency-only unresolved assets can be warnings.
- L4 inheritance cycles, duplicate styles and broken nesting: implemented.
- L5 SC2Editor load: `UNAVAILABLE` in this Linux environment.
- L6 game rendering: `UNTESTED`.

## Explicit unknowns

1. Localized FontStyles merge order was not tested because no localized `.SC2Style` was present locally.
2. Glyph coverage checking is not implemented; imported font files are existence/type checked only.
3. `shadowcolor` was not confirmed and is not emitted.
4. Several rare rich-text candidates are preserved but not yet classified as formatter versus validator/data expression.
5. Native `CCutsceneNodeText` has no corpus-observed Font Style/font property. The module does not invent one.
6. Editor/runtime visual equivalence, exact hinting behavior and exact upper height bound need Windows differential/runtime runs.

These are reported as unknown or untested, never silently dropped and never labelled runtime PASS.
