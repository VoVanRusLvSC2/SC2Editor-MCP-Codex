# Efficient map authoring through MCP

`map.export` automatically merges direct placed Unit/Doodad/Terrain dependencies
into native `Preload.xml` and creates a missing `Objects.version` in its private
snapshot. Source components remain unchanged. Use `map.prepare_editor` with
`dryRun:false` to save the same preparation to components atomically, with backup.
Existing preload entries and placement bytes are preserved. This closes a native
save-contract gap observed on the arena; it does not certify cold Editor rendering.

When placed objects are listed but absent from the Editor viewport, distinguish
generated content from live viewport state. `placement.editor_visibility` reads
the saved Windows preference only. Bit-to-layer meanings are not established by
this tool; disabled bits alone do not prove Units or Doodads are hidden. Both
layers were checked in the live arena Editor while models remained absent.
`enableAll:true,dryRun:false` backs up and writes all bits, but is not a proven
rendering repair. Running instances may cache and overwrite the preference.
If the live layers are enabled, investigate generated placement, terrain heights,
catalog/actor initialization and native diagnostics. Never equate placement XML
validation, object counts or a successful registry write with visible models.

Use the `workflow` profile and keep one MCP session alive for related work.
Author map content through MCP tools. The thin client below holds the stdio
connection and prints compact receipts:

```powershell
node scripts/mcp-session.mjs --root K:\path\to\Map.SC2Map.components
```

For common work, send compact line commands through `modkit.author`; Galaxy is
the default for logic. See [MCP_AUTHORING_SCRIPT.md](MCP_AUTHORING_SCRIPT.md) and
the current [AUTHORING_PROTOCOL.md](AUTHORING_PROTOCOL.md). Use original module
tools for detailed operations that do not have a compact alias.

The session client accepts one JSON request per line. `steps` are passed to
`modkit.batch`; static schemas are checked before invocation, and result
references connect plan IDs to apply/save calls. Operations remain sequential.
An earlier committed save survives a later failure. Individual module transaction
groups preserve their existing atomicity and stale/dependency checks.

```json
{"id":"author","tool":"modkit.author","args":{"script":"project organize genre=mission","mode":"plan"}}
{"id":"check","steps":[{"id":"terrain","tool":"terrain.validate","args":{}},{"id":"objects","tool":"placement.validate","args":{}}]}
{"command":"close"}
```

Single-tool requests are routed through the same batch registry, including tools
hidden from the workflow profile's public list. Use `modkit.tools` to find a
capability, then `modkit.enable_tools` when its full schema is needed. Request
specific receipt fields with `select` rather than fetching entire XML documents.
Catalog queries use bounded pages; respect the returned offset when requesting
more candidates. A compact response may trim a page and adjusts nextOffset so
that rows are not skipped.

Data validation stores a report under `.sc2mcp-output/data-reports`; request
`data.report.page` for selected diagnostics instead of validating again. Full
responses cost more transfer, processing and context. The exact tool schema
explains whether `response=full` is available in the selected profile.

Prepare placements in batches. Reserve paths before decoration; query exact IDs
and dependencies once, then reuse the warm catalog index. Validate and render a
preview after each meaningful change, rather than after every object. Named
`terrain.compose` groups preserve seeds and object ownership for repeatable edits.

`modkit.usage` measures MCP request/response text and durations. It does not report
actual model billing, reasoning tokens, conversation history or image processing.
Large responses above its token-count budget retain byte and duration metrics.
Set `SC2_MCP_SESSION_METRICS` to a JSONL path before starting the session to record
the compact client request/response text counts using o200k_base. Without that
variable, the extra client token counter stays disabled.

A valid terrain structure does not prove visually closed cliffs. Use actual
preview images and report Editor/game checks only when performed or confirmed.
