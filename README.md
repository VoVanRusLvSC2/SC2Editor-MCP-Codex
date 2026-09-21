# SC2Editor MCP

Alpha.18: `map.blueprint.inspect/register/list` и `map.create` создают новую карту из native-заготовки с генерацией поверхности до публикации. `terrain.components.inspect` проверяет дополнительные native grids/entry boundaries. [Создание карт и ограничения](docs/MAP_CREATION_RU.md). Полная генерация cliffs/ramps/pathing и native карты с нуля ещё не реализована.

[Русский README: что уже есть, запуск, примеры и ограничения](README_RU.md).

Alpha.10 unifies project composition and text/binary/Cutscene commits, protects stale drafts and adds grouped saves plus 
`ui.project_status` and GUI Project coverage. See the [full architecture and coverage audit](docs/PROJECT_ARCHITECTURE_AUDIT_RU.md). Full engine coverage is not claimed.

One MCP server exposes nine top-level modules: UI, Cutscene, Text, Data, native AI, Browse, Placement, Terrain and **Map**. Version `1.1.0-alpha.19` adds focused module profiles, `modkit.capabilities`, lazy Data schema loading and an indexed `catalogsData.xsd` registry. Set `SC2_MCP_PROFILE=script`, `ui`, `cutscene`, `data`, `terrain`, or `authoring` to expose a smaller tool surface; the default remains `all`. Complex native body/wave sections stay read-only; Editor/game acceptance is unverified.

Workspace text/byte commits now persist prepared/committed recovery journals and serialize writers across processes. Interrupted groups are preflighted and restored on startup/next mutation; external unknown edits block recovery. Drafts and commit undo remain process-local.

A.I. Module: [tools](docs/AI_MCP.md), [Russian Codex guide](docs/AI_CODEX_GUIDE_RU.md), [migration/test report](docs/AI_MIGRATION_REPORT.md), [JSON input schemas](generated/ai-tools.json). The same GUI has an **A.I. Module** tab. Only CustomAI and its sibling ComponentList are writable: Trigger bindings are read-only, referenced rename/delete is blocked, and The Trigger top-level module is not included; AI does not edit terrain. Populated wave/composition serialization remains opt-in/unconfirmed.

Browse / Placement documentation:

- [Tools, architecture and examples](docs/BROWSE_PLACEMENT_MCP.md)
- [Russian Codex guide](docs/BROWSE_PLACEMENT_CODEX_RU.md)
- [Evidence and limitations](docs/BROWSE_PLACEMENT_EVIDENCE.md)
- [Implementation/test report](docs/BROWSE_PLACEMENT_REPORT.md)
- [Generated JSON input schemas](generated/browse-placement-tools.json)

Doodad improvements: [ground-aware scatter, existing-object snapping and measured optimizations](docs/TERRAIN_DOODADS.md). New commands: `placement.scatterDoodads`, `placement.snapToTerrain`, `terrain.recipe.plan`.

Terrain: [tools, XML recipes and safety limits](docs/TERRAIN_MCP.md), [Russian guide](docs/TERRAIN_CODEX_GUIDE_RU.md), [JSON input schemas](generated/terrain-tools.json). The existing GUI includes a **Terrain** tab for inspect, generation or brushes, PNG preview, grouped stage/save and rollback. Native structural cliffs/ramps and pathing writers are blocked; Editor/runtime validation has not run.

The existing GUI has a `Browse / Placement` tab. `placement.createLocation` creates one deterministic **object-based** forest, desert, city, base or custom location plan; without a `terrain` argument it leaves terrain untouched. With `terrain`, it returns one combined terrain/object plan, snaps new objects to planned ground, and uses `terrain.apply/save/rollback`. Pathing/collision validation remains unavailable. Placement supports unpacked `Objects` XML only. No editor-open/save or in-game compatibility is claimed for this release.

Data Editor documentation:

- `docs/DATA_FORMAT_REPORT.md`
- `docs/DATA_MCP.md`
- `docs/DATA_EDITOR_DISCOVERY.md`

Cutscene documentation:

- `docs/CUTSCENE_MCP.md`
- `docs/CUTSCENE_CODEX_GUIDE_RU.md`
- `docs/CUTSCENE_ARCHITECTURE.md`
- `docs/CUTSCENE_SCHEMA_DISCOVERY.md`
- `docs/CUTSCENE_EDITOR_EXE_DISCOVERY.md`
- `docs/CUTSCENE_CAMERA.md`
- `docs/CUTSCENE_CAMERA_DISCOVERY.md`
- `docs/CUTSCENE_TIMELINE.md`
- `docs/CUTSCENE_RUNTIME.md`
- `docs/CUTSCENE_COVERAGE.md`
- `docs/CUTSCENE_ASSETS_RU.md`

Text documentation:

- `docs/TEXT_MCP.md`
- `docs/TEXT_CODEX_GUIDE_RU.md`
- `docs/TEXT_ARCHITECTURE.md`
- `docs/TEXT_SCHEMA_DISCOVERY.md`
- `docs/TEXT_RICH_TEXT.md`
- `docs/TEXT_LOCALIZATION.md`
- `docs/TEXT_COVERAGE.md`

Schema-driven MCP bridge for semantic, minimal-diff editing of StarCraft II `SC2Layout`, `StormLayout`, and `SC2Style` files.

The UI subsystem remains at the proven `1.0.0-rc.2` capability level. In `1.1.0-alpha.5`, the supplied SC2Editor `5.0.16.97563` drives the reproducible Cutscene registry and a new Text registry built from the Editor plus the real Core `FontStyles.SC2Style`: 2,839 standard styles, 176 constants, 9 font groups, 21 native style value attributes and 38 corpus-observed rich-text tag candidates. L5/L6 execution remains outstanding. One `ui.apply`, `cutscene.apply`, or `text.apply` call can perform a complete validated atomic change.

## Run

### Focused MCP profiles

The default remains the backwards-compatible full tool surface. Set `SC2_MCP_PROFILE` to `ui`, `cutscene`, `data`, `terrain`, `script`, `authoring`, or `all` to expose only the relevant module schemas. For an exact surface, use a comma-separated `SC2_MCP_MODULES`; `ui` is always included. Call `modkit.capabilities` to inspect the active selection. The large Data evidence registry is parsed lazily on the first Data schema operation.

Compile a declared catalog XSD once instead of sending or parsing it on every request:

```powershell
npm run data:xsd:index -- "C:\path\to\catalogsData.xsd"
```

The generated manifest pins the source SHA-256 and routes each named type to a small shard. `data.describe_type` then combines declared XSD, observed XML, and Editor evidence.

```bash
npm install
npm run build
SC2_UI_ROOT=/absolute/path/to/your/map-or-mod node dist/index.js
```

For development:

```bash
npm run dev
npm test
npm run lint
npm run example:button
npm run cutscene:discover:editor -- /path/to/SC2Editor_x64.exe
npm run cutscene:example:editor
npm run text:discover
npm run data:discover -- /path/to/SC2Editor_x64.exe
npm run data:discover:corpus -- /path/to/sc2-data-corpus
npm run data:example
npm run browse:schemas
npm run browse:demo
npm run terrain:schemas
npm run terrain:demo
```

`npm run example:button` constructs a two-template button interaction exclusively through the semantic document API, validates it, and prints the resulting SC2Layout XML. It demonstrates `OnShown` fade, a toggle-state condition, and cross-template button disabling.

## Local GUI workbench

The first GUI is a local browser application backed by the same `Workspace`, `SchemaRegistry`, validator, staged drafts, minimal patches and atomic save implementation as MCP.

Linux/macOS:

```bash
SC2_UI_ROOT=/absolute/path/to/unpacked-map-or-mod npm run gui
```

PowerShell:

```powershell
$env:SC2_UI_ROOT = "E:\Maps\MyMap.SC2Map"
npm run gui
```

Open `http://127.0.0.1:4312`. The workbench supports file/frame browsing, XML source inspection, schema-aware scalar and compound/table properties, staged child creation, anchors, StateGroup construction, animation controller construction, validation, diff review, discard, and atomic save with backup. `Attach UI container` offers Core-derived GameUI layer presets but also accepts any custom descriptor path/`file`; it is not hard-coded to one container. It binds to localhost by default.

Detailed instructions: [Codex guide](docs/CODEX_GUIDE_RU.md) and [GUI workbench reference](docs/GUI_WORKBENCH.md).

## Windows EXE

Run `npm run windows:portable` to produce `release/SC2-UI-Workbench-Windows/SC2-UI-Workbench.exe` with the compiled app and runtime dependencies. A build executed on Windows also bundles the current `node.exe`, making the result self-contained; the cross-built package uses installed Node.js 20+. Double-click the EXE, select an unpacked/component map or mod directory, edit in the browser, then close the launcher message to stop the local server.

See [Windows EXE documentation](docs/WINDOWS_EXE.md).

## MCP API

Core discovery and editing:

- `ui.list_files`, `ui.read_layout`, `ui.query_frames`, `ui.get_frame`
- `ui.create_file`, `ui.add_include`, `ui.remove_include`
- `ui.describe_type`, `ui.get_schema`
- `ui.describe_property`, `ui.capabilities`
- `ui.audit_schema_coverage`
- `ui.apply` — the preferred atomic batch API; validation and diff are included
- `ui.create_frame`, `ui.clone_frame`, `ui.delete_frame`
- `ui.get_property`, `ui.set_property`
- `ui.get_anchor`, `ui.set_anchor`
- `ui.apply_template`
- `ui.get_state_group`, `ui.upsert_state_group`
- `ui.get_animation`, `ui.upsert_animation`
- `ui.list_styles`, `ui.get_style`, `ui.upsert_style`
- `ui.validate`, `ui.diff`, `ui.save`, `ui.discard`

Cutscene creation and editing:

- `cutscene.context` — preferred compact context call for Codex
- `cutscene.create`, `cutscene.open`, `cutscene.inspect`
- `cutscene.compose` — preferred one-call creation API
- `cutscene.apply` — preferred one-call atomic editing API
- `cutscene.validate`, `cutscene.diff`, `cutscene.save`, `cutscene.export`
- `cutscene.schema.inspect`, `cutscene.schema.coverage`
- `cutscene.assets.search`, `cutscene.assets.inspect`, `cutscene.assets.status`, `cutscene.assets.refresh`, `cutscene.animations.list`
- optional `cutscene.runtime.validate`, `cutscene.runtime.generate_trigger`

Shared text and Font Styles:

- `text.context` — preferred one-call batch lookup
- `text.inspect`, `text.schema.inspect`
- `text.apply` — preferred atomic style/localization/rich-text transaction
- `text.validate`, `text.diff`
- `ui.apply` operation `text.bindStyle`
- `cutscene.apply` operations `text.add`, `text.animate`

Native Data Editor catalogs:

- `data.context` — preferred selective context with inheritance and dependency provenance
- `data.query`, `data.describe_type`
- `data.apply` — preferred atomic batch create/clone/rename/delete/field-patch API; includes linked `recipe.weaponBurn` and `recipe.unitTextureByVital` operations
- `data.validate`

The Data benchmark covers both a generic object edit (18 calls to 2, 88.9% fewer) and the Reaper burn + reversible 40%-Life texture workflow (24 calls to 2, 91.7% fewer). The latter expands two semantic operations to 10 native mutations in one transaction; its checked-in apply body is 1,065 bytes (about 267 tokens by the benchmark's explicit bytes/4 estimate). Reproduce it with `npm run benchmark:data`.

The bundled Data registry now covers all 529 C-types and all 10,509 exact field paths observed in 1,732 real Catalog files (165,161 objects; 1,277,381 field instances), with zero parse or byte-round-trip failures. It includes observed scalar classes, enum/default candidates, ranges and catalog-reference candidates, so `data.describe_type` does not require loading the entire dependency corpus. `npm run schema:audit:data` is the strict pre-L5 gate; SC2Editor acceptance and game runtime remain explicitly L5/L6 rather than being mislabeled as static PASS.

`cutscene.compose` accepts arbitrary recursive native nodes, alias-bearing entries and a full operation batch. `dryRun:false, stage:false` validates and writes atomically in that same call. The reproducible benchmark for 20 scene operations is 2 MCP calls instead of 24 (91.7% fewer): `npm run benchmark:cutscene -- 20`.

Convenience/policy tools remain thin wrappers over the generic model:

- `ui.create_button`
- `ui.create_clipped_image`
- `ui.list_blizzard_templates`
- `ui.describe_blizzard_template`
- `ui.create_from_blizzard_template`
- `ui.create_restricted_frame`

Mutations default to `dryRun: true`. With `dryRun: false` and `stage: true`, changes stay in memory until `ui.save`; saving uses an optimistic hash guard, a `.sc2uimcp.bak` backup, and atomic rename.

For Codex, the preferred workflow is now `ui.query_frames -> ui.describe_type/ui.describe_property -> ui.apply`. A benchmark scenario containing `GameUI/UIContainer`, a window, two templated buttons, properties, StateGroup and Fade animation requires 3 calls instead of 14 (78.6% fewer); `npm run benchmark:codex` reproduces the measurement.

`ui.apply` supports up to 100 ordered operations and `@aliases` for frames created earlier in the same transaction. If any operation fails, neither the draft nor disk changes. See [transaction API](docs/UI_APPLY_TRANSACTION.md).

Copyable artifacts: [transaction request](examples/TransactionRequest.json), its [generated SC2Layout](examples/TransactionDemo.SC2Layout), the matching [DescIndex](examples/UI/Layout/DescIndex.SC2Layout), and the [full Russian walkthrough](docs/REAL_EXAMPLE_RU.md).

Text artifacts: [atomic request](examples/text/KaldirTextApply.json), [generated Font Style](examples/text/Base.SC2Data/UI/FontStyles.SC2Style), [UI consumer](examples/text/KaldirSubtitle.SC2Layout), [native Cutscene Text](examples/text/KaldirText.SC2Cutscene), and the [Russian Codex guide](docs/TEXT_CODEX_GUIDE_RU.md).

Data artifacts: [compact Reaper request](examples/data/ReaperBurnAndDamageTextureApply.json), [generated native Catalog](examples/data/ReaperBurnAndDamageTextureData.xml), and [static validation report](examples/data/ReaperBurnAndDamageTextureValidation.json). The texture filenames are explicit custom asset contracts; model-slot compatibility still requires L5/L6 verification with the DDS files present.

Visible controls should use an actual template. `ui.describe_type` now returns ranked `recommendedTemplates`; the GUI lists compatible real Core templates and recommends `StandardTemplates/StandardButtonTemplate` for `Button`. Locked targets keep the `may-not-work` classification and are never presented as a guaranteed bypass.

## Image clipping/cropping

SC2 normally clips a child frame to its ancestors. `ui.create_clipped_image` creates a fixed-size viewport and a larger child `Image`, explicitly leaving `<Unclipped val="false"/>`. It accepts normalized `TextureCoords`, a texture `layer`, and the complete observed `TextureType` enum: `None`, `Normal`, `Border`, `HorizontalBorder`, `EndCap`, `NineSlice`, and `Circular`. This API is suitable for the future GUI: viewport size, image size, X/Y pan, texture rectangle, layer, and rendering mode map directly to form controls.

## Creating files and Includes

`ui.create_file` creates a staged `.SC2Layout`, `.StormLayout`, or `.SC2Style` with the correct root. For a layout, `includeIn` can point to the current map/mod `UI/Layout/DescIndex.SC2Layout`; the new file and one minimal `<Include path="..."/>` insertion are previewed together. Duplicate Includes are ignored case-insensitively and Windows separators are normalized. Save the returned `saveFiles` in order after reviewing `ui.diff`.

This works directly for unpacked/component map and mod directories selected by `SC2_UI_ROOT`. Packed binary MPQ `.SC2Map`/`.SC2Mod` files use the explicit `sc2-ui-archive-adapter-v1` boundary. Configure `SC2_UI_ARCHIVE_ADAPTER`, then use `npm run gui:archive -- MyMap.SC2Map` for the complete extract -> GUI edit -> Ctrl+C -> safe repack workflow, or `npm run archive -- extract ...` / `pack ...` manually. Packing writes a temporary archive, checks it is non-empty, preserves `.sc2uimcp.bak`, then atomically replaces the target. On failure, the edited component directory is retained. No built-in proprietary MPQ implementation is claimed.

## Blizzard-only frames and templates

`LaunchURLButton` is marked `blizzOnly="true"` by the schema, so ordinary `ui.create_frame` requires an explicit `allowBlizzardOnly`. The guarded `ui.create_from_blizzard_template` path instead requires a template that was actually observed in the bundled Core.SC2Mod corpus and checks class compatibility. For example, a `LaunchURLButton` is class-compatible with `StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate` because its `CLaunchURLButton` class derives from `CButton`.

Every template inspection/application result now carries one of three explicit runtime expectations:

- `ordinary-template` / `expected-to-work`: normal SC2 inheritance, provided the template reference resolves and exists in the target game version;
- `locked-frame-template` / `may-not-work`: the target is Blizzard-only/locked; even a Core-observed, class-compatible template may fail at runtime;
- `incompatible-template` / `unsupported`: the known Core template has an incompatible base class.

The bundled catalog contains more than 2,300 real top-level Blizzard templates, including `ScreenCustomFeatured/CTABannerTemplate` and `StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate`. “Blizzard-only” is treated as an explicit compatibility/risk marker, not as proof that a layout can never reference the type.

`ui.create_restricted_frame` applies the same policy to every restricted type. For simple types it chooses a verified compatible template. For complex types such as `SceneBrowser`, it chooses a Core container template that supplies all required hookups and emits only a nested semantic override for the target frame.

## Frame and property coverage

`ui.audit_schema_coverage` checks the complete loaded registry instead of relying on a fixed list. In the bundled snapshot all 892 known frame types are describable and structurally editable, including 18 Core-observed types missing from the community schema; those receive explicit observed-only class records. All 1,918 schema-declared properties are typed and handled by the universal property API, while 58 additional Core-observed properties remain structurally editable.

This is not presented as timeless engine knowledge: it is the union of the bundled community schema and the verified Core snapshot. The dedicated `ehotkey.xml` enum is loaded as part of the registry, so all currently declared property type references resolve. Unknown future types/properties are preserved losslessly and can be edited only through explicit `allowUnknownType`/`allowUnknown` switches. Run `npm run schema:audit` for the machine-readable report.

See [docs/BLIZZARD_TEMPLATES_AND_CLIPPING.md](docs/BLIZZARD_TEMPLATES_AND_CLIPPING.md) and the tested fixture [src/tests/fixtures/URLButton.SC2Layout](src/tests/fixtures/URLButton.SC2Layout).

## Source model guarantees

- No mutation means byte-identical output.
- Existing scalar attribute edits patch only that attribute value.
- Unrelated comments, whitespace, quote style, unknown attributes, and unknown elements are retained.
- Subtree operations replace only the explicitly targeted named subtree.
- Cross-file descriptor names containing `/` use JSON-Pointer-style escaping in semantic paths: `GameUI/UIContainer` becomes `GameUI~1UIContainer`.

## Runtime verification and remaining boundaries

`npm run runtime:corpus -- ./runtime-corpus` generates 892 isolated layouts plus a manifest—one probe per known frame type. With `SC2_UI_RUNTIME_ADAPTER` configured, add `--run` to launch the external `sc2-ui-runtime-adapter-v1` and collect its exit status/stdout/stderr. This environment does not contain the Windows SC2 runtime, so the bundled structural/corpus checks are not misrepresented as an in-game pass.

Blizzard/internal restrictions remain runtime-dependent. `ui.capabilities` distinguishes semantic support, configured archive support and actual runtime validation. The remaining release gate for final `1.0.0` is a recorded real-SC2 corpus run plus a production archive adapter round trip. See [v1 readiness](docs/V1_READINESS.md) and [runtime/archive protocols](docs/RUNTIME_AND_ARCHIVES.md).

Terrain alpha.14: lighting preset assignment, ambient/HDR and Key/Fill/Back directional settings, combined landscape + lighting plans. [Освещение и границы Terrain](docs/TERRAIN_LIGHTING_RU.md). Editor/game acceptance remains unverified.

## Galaxy scripts — alpha.16

`script.*` is a separate top-level module in the existing composition root. It never edits GUI Triggers. Commands: inspect, symbols, references, context, validate, plan, apply, connect, recipe, save, discard.

Use `script.context` to request one function plus dependency signatures with a strict serialized character budget. Symbol queries paginate. Parsing caches unchanged files (128 entries/32 MiB source text); plans are limited to 8 and 128 MiB of accounted source text.

Workflow: inspect/symbols → context → plan → apply (dryRun=true for diff) → apply (dryRun=false to stage) → save. `connect` plans an Include plus zero-argument void init call in an existing InitMap; it does not create a native map foundation. `recipe` creates an init scaffold or a periodic callback around an existing void action. Periodic scripts use Galaxy event APIs, without GUI trigger serialization.

Validation covers lexical/structural declarations, delimiter/string/comment errors, unsafe Includes, local Include cycles and arity for 2200 pinned Core natives. This is not a complete AST/type checker or a target compiler. Native GameData libraries, local scope binding, dynamic string references and map-resource validation remain partial. Editing generated MapScript may be overwritten by Editor regeneration; Windows Editor/runtime persistence has not been verified.

Native provenance is bundled in generated/galaxy-native-api.json. The source commit is pinned, not assumed to be the latest target build.

## Target test preparation — alpha.17

`ui.test_readiness` gathers known offline map/terrain, UI, cutscene, text, data, browse, placement, AI and script checks in one call. `/api/project/preflight` provides the same report over the local HTTP API. Pending text/binary drafts block readiness. `readyForEditorTest=true` means the known offline prerequisites passed; it is not full standard-function support or Editor/compiler/runtime acceptance. Warnings and unresolved dependencies still need review.

Data indexes text/binary drafts and overrides before save; active-parent resolution excludes inactive catalogs and exposes unresolved parents. Native defaults and full layer/indexed/removal merging remain partial. Galaxy connection blocks unverified existing conditional/expression init calls. Empty file creation now preserves existence intent through shared staged save.
