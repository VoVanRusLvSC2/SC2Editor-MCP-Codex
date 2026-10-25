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

Asset provenance is accumulated once per reference instead of repeatedly
serializing an asset's growing consumer list. In a sequential local MCP
comparison, the first catalog query fell from 43.4 to 17.1 seconds and a cold
unchanged landscape plan from 52.0 to 21.9 seconds. Four explicitly selected
asset pages retained identical JSON, including 5804 consumer references.
These are scoped observations under ordinary cache/load conditions, not a
universal timing guarantee or a billed-token measurement. Warm plans still
benefit from retaining one session. See the
[asset-index checkpoint](verification/asset-index-2026-10-23.json).

Configure the same external runtime when comparing a checkout and an installed
package. `modkit.runtime` reports its availability, receipt digest and restart
requirement. An installation without ModKit must not inherit a checkout's
implicit runtime path. Set `SC2_MODKIT_HOME` or run the documented setup; retain
dependency/engine-activation refusals rather than bypassing placement checks.

CASC mount manifests persist `registrationOrder`. Reconnecting immediately after
the first mount must not reorder the same catalog roots or rebuild unchanged
locations. Old manifests acquire their existing filename order once; fresh mounts
retain first registration order even when later calls remount in another order.
The native DocumentInfo resolver still controls Data dependency precedence.
The installed-package check retains all 36 native payload files and gives zero
changed bytes/rebuilt zones on warm and fresh repeats. See
[CASC order evidence](verification/casc-order-2026-10-23.json).

Data validation stores a report under `.sc2mcp-output/data-reports`; request
`data.report.page` for selected diagnostics instead of validating again. Full
responses cost more transfer, processing and context. The exact tool schema
explains whether `response=full` is available in the selected profile.

For GUI, inspect `nativeProfile` from the initial plan before launching the
original Editor. The review exposes retained generator risks without changing
the graph, catches known qualifier/array/declaration-order issues and limits
samples while retaining the total count. Static validity remains separate from
compilation. Preserve an imported graph and its failure rather than silently
reorganizing it to make a different fixture pass.
New literal-zero array declarations use dedicated visible zero constants;
`nativeProfile.loweredZeroBounds` reports them without expanding every GUI node.
This keeps the one-cell range. Existing imports and manual helper edits remain
intact; native compilation and execution still need independent evidence.

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
