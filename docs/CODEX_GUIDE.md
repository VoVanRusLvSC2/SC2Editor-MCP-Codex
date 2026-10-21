# SC2 UI MCP: A Complete Guide to Codex

For current cross-module rules, start with [AUTHORING_PROTOCOL.md](AUTHORING_PROTOCOL.md). Version-specific statements below describe the historical UI workflow; current Trigger/Terrain capabilities are documented in their module guides.

The alpha.7 server also contains Data/Text/Cutscene/Browse/Placement and native A.I. Module. [AI instruction manual](AI_CODEX_GUIDE.md): CustomAI + ComponentList only, read-only Trigger bindings; Trigger Editor and surface not yet enabled. XML editing does not replace Editor/runtime tests.

In alpha.6, separate `browse.*` and `placement.*` are added, including the universal `placement.createLocation`. For assets, dependencies and secure placement, see [Instructions Browse/Placement](BROWSE_PLACEMENT_CODEX.md). This does not replace UI APIs and does not confirm editor/runtime compatibility.

This guide describes the recommended way Codex and GUI client work with StarCraft II UI files. The main principle of the project is that the model does not edit XML strings, but semantic entities - files, frames, properties, anchors, templates, StateGroups, animations and styles. XML remains the final format, but its unknown elements, comments and formatting should not disappear.

> Starting with `1.0.0-rc.2`, the main change path is `ui.apply`. Individual `ui.create_frame`, `ui.set_property`, `ui.upsert_state_group` and other mutation tools remain for single actions and compatibility, but a complex user request should be collected into one atomic transaction. `ui.apply` already returns validation and minimal diff, so individual calls after it are usually not necessary.

Short effective workflow:

```text
ui.query_frames -> ui.describe_type / ui.describe_property -> ui.apply
```

Inside `ui.apply`, use `as` and `@alias` to access the frames created in the same transaction. A detailed diagram, all operation types and the full example are in [UI_APPLY_TRANSACTION.md](UI_APPLY_TRANSACTION.md).

## 1 What MCP gives Codex

Without MCP, a model must remember thousands of SC2Layout details:

- the exact name of frame type;
- Available properties and their types;
- inheritance of classes;
- enum values;
- mandatory hookups;
- Syntax `$this`, `$parent` and handles
- Table/index/layer properties format
- StateGroup and Animation format;
- Includes and cross-file templates;
- Blizzard-only/locked type features
- A safe way to change one attribute without rewriting the entire XML.

With MCP, Codex first requests Registry, then performs a generic operation, runs validation, watches diff, and then saves, which reduces the hallucinations of names and eliminates the destructive XML rewrite.

## Mandatory work cycle

For any task, Codex must follow the following order:

1. Call `ui.list_files` and determine the actual layout/style files.
2. Read the file via `ui.read_layout`.
3. Find target frames via `ui.query_frames` or `ui.get_frame`.
4. Before creating a new type, call `ui.describe_type`.
5. Before an unknown property, call `ui.get_schema` or test it as a result of `ui.describe_type`.
6. All changes must be done either in `dryRun: true` or staged mode.
7. After a group of changes, call `ui.validate`.
8. Call `ui.diff` and check only for expected changes.
9. Save via `ui.save` with backup.
10. In case of doubt, call `ui.discard`; do not attempt to manually restore the original XML.

Recommended mutation mode:

```json
{
  "dryRun": false,
  "stage": true
}
```

It only changes the in-memory draft. The disk changes only after `ui.save`.

## 3. Sources of Truth and Level of Trust

Registry combines several levels of data:

1. Community schema — frame classes, inheritance, properties, scalar/complex types, enums and hookups.
2. Blizzard Core corpus are real-world frame types, properties, templates, states, animation controllers, and restricted-frame routes.
3. Workspace corpus: Unknown elements found in the current map/mode.

Community schema and historical Core snapshot are not considered to be the eternal truth of the engine, so Registry reports provenance and does not remove the unknown XML.

The current coating is not checked manually, but through:

```text
ui.audit_schema_coverage
```

or:

```bash
npm run schema:audit
```

In bundled snapshot:

- 892 known frame types;
- 892/892 have a semantic description;
- 1 918 schema-declared properties;
- 1 918/1 918 have a type and generic edit path;
- 58 additional Core-observed properties are structurally supported.
- The unknown future XML is lostlessly.

## 4.Semantic paths of frames

Normal nested path:

```text
Window/Footer/AcceptButton
```

SC2 allows descriptor names with `/`, for example:

```xml
<Frame type="Frame" name="GameUI/UIContainer" file="GameUI">
```

In the semantic path, the `/` symbol inside the name is shielded by JSON Pointer:

```text
GameUI~1UIContainer
```

Rules:

- `~` is converted into `~0`.
- `/` is converted into `~1`.
- `$this` means the current runtime frame.
- `$parent` means the parent runtime frame.
- `$this/Child` and `$parent/Sibling` are used in SC2 references rather than in MCP framePath.
- The handle can be used for SC2 binding/reference, but the MCP path is always built with the descriptor names.

### GameUI Container Layers

The `GameUI/UIContainer` is not the only acceptable container, and Blizzard Core `GameUI.SC2Layout` also confirms:

| Descriptor override | Appointment |
|---|---|
| `GameUI/UIContainer` | world-over |
| `GameUI/UIContainer/FullscreenLowerContainer` | fullscreen layer below console |
| `GameUI/UIContainer/ConsoleUIContainer` | UI tied to console |
| `GameUI/UIContainer/FullscreenUpperContainer` | fullscreen layer above console |

They are created the same way: top-level `Frame`, full descriptor path in `name`, `frameFile:"GameUI"`. Any other real descriptor path is allowed through the generic API; the GUI list is presets, not whitelist.

```json
{"op":"create_frame","as":"upper","type":"Frame","name":"GameUI/UIContainer/FullscreenUpperContainer","frameFile":"GameUI"}
```

## 5. Discovery API

### `ui.list_files`

Returns all `.SC2Layout`, `.StormLayout` and `.SC2Style` inside `SC2_UI_ROOT`, including staged new files.

### `ui.read_layout`

Entrance:

```json
{
  "file": "UI/Layout/GameUI.SC2Layout",
  "includeSource": false
}
```

Returns SHA-256, XML diagnostics, and frames list. `includeSource: true` should only be used when an accurate source XML is needed.

### `ui.query_frames`

Supported filters:

- `name`;
- `type`;
- `template`;
- `property`;
- `handle`;
- `under` is a parental semantic path restriction.
- `limit`.

It’s best to use query first, rather than uploading all XML into the context of the model.

### `ui.get_frame`

Returns:

- type/name/path;
- template/file/handle;
- normalized representation of properties;
- generic element tree;
- anchors;
- direct child paths;
- It's an exact XML fragment.

## 6. Schema Registry

### `ui.describe_type`

Codex must call it before using an unfamiliar frame type.

The answer is:

- underlying `classType`;
- inheritance chain;
- effective inherited properties;
- property value/element types;
- readonly metadata;
- enum/value information through simple types;
- hookups;
- `blizzardOnly`;
- Core observation count;
- restriction plan and runtime notice.

### `ui.get_schema`

Generic search by category:

```text
frameType | frameClass | simpleType | complexType | animation | state | style
```

Examples:

```json
{"kind":"frameType","search":"Button","limit":100}
```

```json
{"kind":"animation"}
```

```json
{"kind":"state"}
```

### `ui.audit_schema_coverage`

Checking:

- a description for each frame type;
- presence of an underlying class;
- inheritance cycles;
- typing declared properties;
- unresolved type references;
- opaque types;
- Typed and observed-only coverage.

Codex should not say “engine is 100% supported” if the audit shows observed-only or runtime-only limitations. Correctly, “all known bundled types are structurally supported and declared properties are typed.”

## 7 File Creation and Includes

### `ui.create_file`

Create the correct minimum root:

```xml
<Desc>
</Desc>
```

or:

```xml
<StyleFile>
</StyleFile>
```

Example:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "kind": "layout",
  "includeIn": "UI/Layout/DescIndex.SC2Layout",
  "dryRun": false,
  "stage": true
}
```

`includeIn` Adds one duplicate-safe `<Include path="..."/>` the minimum patch. `.SC2Style` Include does not apply.

Individual operations:

- `ui.add_include`;
- `ui.remove_include`.

## 8 Creation, cloning and removal of frames

### `ui.create_frame`

It's a basic universal constructor. It's not limited to a list of convenience features.

Main fields:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "parentPath": "GameUI~1UIContainer/MyWindow",
  "type": "Button",
  "name": "AcceptButton",
  "template": "StandardTemplates/StandardButtonTemplate",
  "frameFile": "GameUI",
  "properties": [],
  "anchors": [],
  "allowUnknownType": false,
  "allowUnknownProperties": false,
  "allowReadonlyProperties": true,
  "allowBlizzardOnly": false,
  "dryRun": false,
  "stage": true
}
```

`frameFile` is an XML attribute `file=`, not a layout file path.

`allowReadonlyProperties` is allowed by default because readonly metadata community schema often contradicts real Core layouts.

### `ui.clone_frame`

Copies the exact source subtree, changing the name and indentation, preferably reconstructing a complex known pattern by hand.

### `ui.delete_frame`

Removes only the selected subtree. Be sure to check diff before saving.

### Convenience API

- `ui.create_button` is a thin shell over `ui.create_frame`.
- `ui.create_clipped_image` — viewport Frame + oversized child Image;
- `ui.create_from_blizzard_template` - Proven Core template
- `ui.create_restricted_frame` — restricted policy route.

## 9. Universal properties

### Reading

```text
ui.get_property
```

Supports selector:

```json
{
  "index": 0,
  "layer": 1,
  "attrs": {"state":"Hover"},
  "occurrence": 0
}
```

### Recording.

```text
ui.set_property
```

Scalar property:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Button",
  "property": "Enabled",
  "value": false,
  "dryRun": false,
  "stage": true
}
```

Indexed/layer property:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Image",
  "property": "Texture",
  "value": "Assets/Textures/MyImage.dds",
  "selector": {"layer": 0},
  "dryRun": false,
  "stage": true
}
```

Complex property:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Image",
  "property": "TextureCoords",
  "attrs": {
    "top": 0.1,
    "left": 0.2,
    "bottom": 0.9,
    "right": 0.8,
    "layer": 0
  },
  "replace": true,
  "dryRun": false,
  "stage": true
}
```

Removal is performed by the same operation with `remove: true` and the exact selector.

If several identical table properties are found, the operation without selector should reject the ambiguous change.

## 10. Anchors

Reading: `ui.get_anchor`.

Recording: `ui.set_anchor`.

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Button",
  "anchor": {
    "side": "Left",
    "relative": "$parent",
    "pos": "Min",
    "offset": 24
  },
  "dryRun": false,
  "stage": true
}
```

Sides:

```text
Top | Left | Right | Bottom | All
```

Positions:

```text
Min | Mid | Max
```

`All` is a side-less anchor. Codex does not have to generate four anchors on its own if layout uses one all-edge anchor.

## 11. Templates

### Own templates

Top-level named Frame can serve as template:

```xml
<Frame type="Button" name="MyButtonTemplate">
```

If the file is called `MyButtons.SC2Layout`, the reference usually looks like this:

```text
MyButtons/MyButtonTemplate
```

### Blizzard templates

- `ui.list_blizzard_templates` - search by Core directory;
- `ui.describe_blizzard_template` - Accurate information and class compatibility
- `ui.apply_template` - Minimum patch opening tag
- `ui.create_from_blizzard_template` is created with catalog-verified template only.

Each template usage receives one status:

| kind | runtimeExpectation | Meaning. |
|---|---|---|
| `ordinary-template` | `expected-to-work` | Ordinary inheritance if reference is allowed and template is in the game version |
| `locked-frame-template` | `may-not-work` | Target frame Blizzard-only/locked; Core evidence does not guarantee runtime |
| `incompatible-template` | `unsupported` | Template class is incompatible with target type |

Codex should not call a restricted route a "hack." XML may be syntactically correct, but SC2 runtime may not create or allow a locked frame.

## Hookups and restricted frames

Hookup is an expected child runtime frame, such as `Label`, `NormalImage`, or controls SceneBrowser.

Validator checks the required hookups.

- explicitly described by the Frame subsidiaries;
- Inherited from an accurate verified template;
- The complete container-template route is available.

`ui.create_restricted_frame`:

1. check the `blizzardOnly`;
2. builds a restriction plan;
3. Prefers the exact template;
4. It uses a compatible base template.
5. For complex types, look for a container route that covers hookups.
6. returns `may-not-work` runtime notice;
7. Refuse if there is no safe automatic route.

Low-level circumvention is possible only through:

```json
{"allowBlizzardOnly":true}
```

and should only be used after manual checks of hookups and runtime risk.

## 13. StateGroup

Operations:

- `ui.get_state_group`;
- `ui.upsert_state_group`.

Composition:

- `name`;
- optional `template`, `file`, `log`;
- `defaultState`;
- `states` array;
- `when` and `actions`.

Known conditions include:

- `Property`;
- `AnimationState`;
- `StateGroup`;
- `Option`;
- Additional Core-observed variants.

Notable actions include:

- `SetState`;
- `SetProperty`;
- `SetAnimationProperty`;
- `SetAnchor`;
- `SendEvent`;
- `PlaySound`;
- `ApplyTemplate`;
- `CreateFromTemplate`.

An example of the reaction toggle:

```json
{
  "name": "ButtonLinkState",
  "defaultState": "Enabled",
  "states": [
    {
      "name": "Disabled",
      "when": [
        {"type":"Property","frame":"$this/Button1","attrs":{"Toggled":true}}
      ],
      "actions": [
        {"type":"SetProperty","frame":"$this/Button2","attrs":{"Enabled":false}}
      ]
    },
    {
      "name": "Enabled",
      "when": [
        {"type":"Property","frame":"$this/Button1","attrs":{"Toggled":false}}
      ],
      "actions": [
        {"type":"SetProperty","frame":"$this/Button2","attrs":{"Enabled":true}}
      ]
    }
  ]
}
```

For a regular click to change `Toggled`, Button must have:

```xml
<Toggleable val="true"/>
```

## 14. Animations

Operations:

- `ui.get_animation`;
- `ui.upsert_animation`.

Animation contains:

- events;
- drivers;
- controllers;
- controller keys.

Registry knows schema-declared and Core-observed controller types. In front of an unfamiliar controller, Codex must call:

```json
{"kind":"animation"}
```

Fade by `OnShown`:

```json
{
  "name": "ShowFade",
  "events": [
    {"event":"OnShown","action":"Reset,Play","frame":"$this"}
  ],
  "controllers": [
    {
      "type": "Fade",
      "frame": "$this",
      "end": "Pause",
      "keys": [
        {"type":"Curve","time":0,"attrs":{"value":0,"out":"Fast"}},
        {"type":"Curve","time":0.3,"attrs":{"value":255,"in":"Slow"}}
      ]
    }
  ]
}
```

For SC2 Fade, the alpha `0..255` range is usually used, rather than the CSS-like `0..1`.

Real controller families encountered include Fade, Visibility, Anchor, Dimension, Texture and other variants from Registry. Codex should not be limited to these examples - the list is taken dynamically.

## 15. Images and clipping

`ui.create_clipped_image` creates:

- viewport Frame of a given size;
- oversized child Image;
- `<Unclipped val="false"/>`;
- optional `TextureCoords`;
- layer;
- TextureType.

Texture types:

```text
None | Normal | Border | HorizontalBorder | EndCap | NineSlice | Circular
```

Two ways of crop:

1. The size of the child image is larger than the viewport, the position of the child determines the visible part.
2. `TextureCoords` selects the normalized rectangle of the original texture.

## 16. SC2Style

Operations:

- `ui.list_styles`;
- `ui.get_style`;
- `ui.upsert_style`.

Style mutation changes only the desired attributes. Unknown style attributes are saved.

Before installing the `<Style val="..."/>` validator, the cross-file resolver checks if the style name is found.

## References and bindings

Resolver checks:

- Includes;
- template references;
- `$this`/`$parent` frame references;
- handles;
- style names;
- property bindings of the `{$TextSource/@Text}` type;
- staged new files.

Binding example:

```xml
<URL val="{$TextSource/@Text}"/>
```

Target can be found through:

```xml
<Handle val="TextSource"/>
```

## 18. Validation

`ui.validate` returns:

- `valid`;
- number of errors;
- number of warnings;
- Diagnostics with code, message, file and framePath.

The main classes of diagnostics:

- `xml.syntax`;
- `layout.structure`;
- `schema.unknown_frame_type`;
- `schema.unknown_property`;
- `schema.blizzard_only_runtime_uncertain`;
- `property.invalid_value`;
- `property.readonly`;
- `hookup.required_missing`;
- `anchor.invalid_offset`;
- `anchor.unknown_position`;
- `reference.include_missing`;
- `reference.template_missing`;
- `reference.frame_missing`;
- `reference.binding_missing`;
- `reference.style_missing`;
- `state.unknown_condition`;
- `state.unknown_action`;
- `animation.unknown_controller`.

Policy:

- Errors block the correct result.
- Warnings require review;
- Locked runtime warning cannot be concealed by class compatibility claims.
- Unknown/forward XML is saved even if Registry doesn’t know it yet.

## 19. Diff, backup and save

### `ui.diff`

Shows staged change and before/after hashes.

Codex should check:

- the correct file has been changed;
- no full rewrite;
- Comments and unknown elements remain;
- Only the expected opening tag/property/subtree has been changed.
- Include is not duplicated.

### `ui.save`

Performs:

- optimistic SHA-256 guard;
- optional `.sc2uimcp.bak`;
- recording into a temporary file;
- atomic rename;
- Clearing staged draft.

Example:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "expectedSha256": "hash-from-read-or-diff",
  "backup": true
}
```

### `ui.discard`

It only removes the draft in memory. The disk and the backup don't change.

## 20.The Codex algorithm for the new window

Create a window, header, two buttons, hover, fade, state and template:

1. Find DescIndex.
2. Create a separate layout and include.
3. Describe the types `Frame`, `Label`, `Button`, `Image`.
4. Find ordinary base templates.
5. Create top-level templates.
6. Select the appropriate GameUI/custom container layer and create a descriptor override with the correct `file`.
7. Create Window and kids.
8. Set up typed properties.
9. Install anchors.
10. Add hover State Group or inherited hover behavior.
11. Add opening Fade Animation.
12. Add the enabled/disabled State Group.
13. Check every frame reference/template/style.
14. Launch validation.
15. Check the diff.
16. Save the new file, then DescIndex.

Full verifiable request generated by XML and GUI/EXE workflow: [REAL_EXAMPLE.md](REAL_EXAMPLE.md).

## 21 When to use low-level escape hatches

`allowUnknownType`, `allowUnknown`, `allowBlizzardOnly` are permissible if:

- The item is actually found in the current layout/core version.
- Registry snapshot doesn't know him.
- It requires forward-compatible preservation/edit.
- Codex explicitly tells the user which check is missed.

They should not be used only to suppress the usual mistake in the name.

## 22 The boundaries of the current version

Supported by:

- unpacked/component map/mod directory;
- SC2Layout, StormLayout, SC2Style;
- staged multi-file workflow;
- generic frames/properties;
- schema, inheritance, hookups, templates;
- State Group and animations;
- cross-file resolver;
- minimal XML patches;
- GUI/API on top of the same Workspace.

Until guaranteed:

- Direct mounting of a binary MPQ/CASC archive;
- Live rendering inside the SC2 Editor
- runtime resolution of locked frames;
- a full transaction journal for multiple files at once;
- Visual pixel-perfect preview engine SC2.

The GUI should not portray its own HTML preview as an accurate SC2 renderer; its task is semantic editing, schema inspection, validation, and diff review.

## 23.Short checklist for system prompt Codex

```text
1. Не редактируй SC2Layout строками, если существует ui.* операция.
2. Сначала discover files/frames/schema.
3. Используй generic API; не требуй отдельный tool для каждого property.
4. Все mutations сначала dry-run или stage.
5. Не создавай locked frame без runtime warning и hookup review.
6. Не считай community schema вечной истиной.
7. Сохраняй unknown XML и существующее форматирование.
8. После изменений обязательны validate и diff.
9. Сохраняй только atomic save с backup.
10. При ambiguity остановись, запроси selector или точный framePath.
```
