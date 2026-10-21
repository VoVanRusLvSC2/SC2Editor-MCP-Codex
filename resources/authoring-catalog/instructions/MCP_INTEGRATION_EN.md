# MCP integration and lookup

This archive does not modify SC2Editor-MCP-Codex, register server tools, implement a map generator or add an editor button. Its Python 3 standard-library scripts are read-only reference lookups.

Start with AGENT_INSTRUCTIONS_EN.md and one style profile. Read only relevant catalog pages. Inspect actual editor tool schemas and dependencies before planning mutations. If a capability is absent, report a blocked operation or an explicit manual editor step; never invent a command.

## Commands from the extracted root

```sh
python scripts/style_lookup.py
python scripts/style_lookup.py --id terran_fortified
python scripts/style_lookup.py --id forest
python scripts/mcp_lookup.py list --query Agria
python scripts/mcp_lookup.py get --id Agria --section vegetation --limit 8
python scripts/mcp_lookup.py get --id Agria --section auto_vegetation --limit 8
python scripts/mcp_lookup.py model --id PlantMixAgria
```

Both scripts accept one JSON object on stdin with --json and return JSON. style_lookup supports list/get; get requires an exact profile id. Its result includes common rules, profile, relevant transitions, states, curated asset overrides and quality criteria. mcp_lookup supports list/get/model; get supports section, width, height, limit and offset. Follow next_offset until null when a complete list is needed.

Suggested adapter names catalog_lookup and style_lookup are design labels, not registered tools. A server adapter should use its actual SDK, pass requests through process stdin rather than shell interpolation, enforce the documented inputs, and check exit codes, timeouts and JSON errors. These lookups must not perform object placement.

Required editing capabilities to assess: map/dependency/palette inspection; height/cliffs/ramps; surface masks; Actor placement; separate TerrainObject support; supported ground markings; native foliage masks/generation; snapshots/undo; screenshots; actual pathing/buildability tests. Record each as available, unavailable or unverified after inspection.

Retain the plan, edit region and seed when supported. Protect existing manual edits. Implement profile lookup and planning before binding mutation operations. This archive has not been tested against the current target MCP API or in the SC2 engine.

Original catalog IDs, names and evidence fields are preserved. Some legacy source-derived annotations remain Russian. The canonical English agent policy and style data supersede old language-specific authoring guidance; do not translate resource identifiers.
