# `ui.apply` transaction API

## Purpose

Codex should not spend one MCP round trip per XML property. `ui.apply` sends one ordered semantic plan, executes it on a private `LayoutDocument`, validates the final candidate, and returns the minimal diff in the same response.

```text
ui.query_frames -> ui.describe_type / ui.describe_property -> ui.apply
```

With `validate:true`, separate `ui.validate` and `ui.diff` calls are unnecessary.

## Guarantees

Alpha.10: shared text/binary queue and automatically pinned staged bases. `ui.save(file)` saves the whole group containing that file and returns `savedFiles`; discard also affects the whole group. Multi-file commits use per-file atomic rename with compensation on handled failures, not crash-wide atomicity.

- 1–100 ordered operations per call.
- Operations see preceding changes.
- A failed operation changes neither draft nor disk.
- `dryRun:true` returns validation and diff without staging.
- `dryRun:false, stage:true` stages the accepted candidate once.
- `stage:false` uses backup, temporary file and atomic rename.
- Invalid candidates are rejected unless `allowInvalid:true` is explicit.
- Unknown XML outside targeted source spans remains byte-identical.
- `expectedSha256` rejects writes when the on-disk source changed since inspection.

## Aliases and runtime references

Creation and clone operations may define `as`. Later semantic targets use `@alias`:

```json
[
  {"op":"create_frame","as":"window","type":"Frame","name":"MyWindow"},
  {"op":"create_frame","as":"ok","parentPath":"@window","type":"Button","name":"Ok"},
  {"op":"set_property","framePath":"@ok","property":"Text","value":"OK"}
]
```

Aliases are limited to `parentPath`, `sourcePath` and `framePath`. SC2 runtime references inside anchors, StateGroups, animations and values remain native: `$this`, `$parent`, `$parent/Secondary`. Never put `@alias` or escaped MCP paths into runtime XML references.

## Operations

| `op` | Purpose |
|---|---|
| `create_frame` | Create any schema-known or explicitly allowed future frame |
| `clone_frame` | Clone an exact source subtree |
| `delete_frame` | Delete one addressed subtree |
| `set_property` | Set/remove scalar, table or compound property |
| `set_anchor` | Set one semantic anchor |
| `apply_template` | Patch a template and return runtime classification |
| `upsert_state_group` | Create/replace one named StateGroup |
| `upsert_animation` | Create/replace one named Animation |
| `add_include` / `remove_include` | Maintain DescIndex dependencies |
| `create_clipped_image` | Create viewport plus oversized clipped Image |

## Complete validated example

The canonical request is [`examples/TransactionRequest.json`](../examples/TransactionRequest.json), and its byte-for-byte tested result is [`examples/TransactionDemo.SC2Layout`](../examples/TransactionDemo.SC2Layout).

It creates all of the following in one call:

- a custom `CodexButtonTemplate` inheriting `StandardTemplates/StandardButtonTemplate`;
- `GameUI/UIContainer` with `file="GameUI"`;
- a visible, anchored window;
- two templated and anchored buttons;
- `Toggleable=true` on the first button;
- `OnShown -> Reset,Play -> Fade 0..255`;
- a property-driven StateGroup that disables/enables `$parent/Secondary`.

The same generic container operation can target another Blizzard layer:

```json
{
  "op":"create_frame",
  "as":"upper",
  "type":"Frame",
  "name":"GameUI/UIContainer/FullscreenUpperContainer",
  "frameFile":"GameUI"
}
```

It can also target a custom descriptor path from another layout by changing `name` and `frameFile`. The GUI exposes presets but does not restrict these values.

Important response fields:

```json
{
  "accepted": true,
  "aliases": {
    "buttonTemplate": "CodexButtonTemplate",
    "gameui": "GameUI~1UIContainer",
    "window": "GameUI~1UIContainer/CodexWindow",
    "primary": "GameUI~1UIContainer/CodexWindow/Primary",
    "secondary": "GameUI~1UIContainer/CodexWindow/Secondary"
  },
  "validation": {"valid": true, "errors": 0},
  "mutation": {"dryRun": false, "staged": true, "preview": "--- before ..."},
  "efficiency": {"toolCalls": 1, "includesValidation": true, "includesDiff": true}
}
```

## Compound properties

Call `ui.describe_property` before constructing an unfamiliar table/compound property. It returns scalar types/enums, table key, effective complex attributes, allowed child elements and `schemaDriven` coverage. Then use `set_property.attrs`, `selector` and `children`.

Known scalar attributes are validated by declared types. Unknown future XML remains preservable through explicit forward-compatible switches.

## Efficiency benchmark

```bash
npm run benchmark:codex
```

The bundled scenario reports 14 granular calls versus 3 calls (`query`, `describe`, `apply`): 78.6% fewer, with validation and diff included in `apply`.
