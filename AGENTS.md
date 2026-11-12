# SC2 MCP development and authoring

Read `docs/AUTHORING_PROTOCOL.md` first, then only the relevant subsystem guides.
Explicit user requirements override project defaults. Maintained documentation,
agent instructions and tool descriptions are English. Preserve requested map
localization, resource IDs and original catalog source annotations.

## Working defaults

- Visible-editor authoring defaults to the current open document.
  The target is complete current-document authoring across all map components;
  unsupported components are outstanding implementation work, not an accepted
  replacement workflow. Do not call the whole live mode complete while they remain.
  Never create or
  open a checkpoint/Save As copy unless the user explicitly chooses that workflow.
  Unsupported placement/terrain/trigger edits must be reported as missing; do not
  substitute another map. For requested saving use `live.document.status` then
  `live.document.save` with the returned archive hash. It calls native File > Save
  and verifies the same archive and clean document. Unknown saves never replay.
  Existing Doodads/Units use `live.placement.prepare`, `live.placement.inspect` and
  `live.placement.duplicate/move`, not checkpoint authoring. Snapshot row keys
  are not persistent instance IDs: the adapter compares complete native
  properties across row reordering and refuses ambiguous creation. Respect its
  group/scene bounds and retain unknown/partial outcomes. New types use the
  original filtered `live.placement.catalog` and `live.placement.create`; Units
  require an explicit owner. Native footprint/grid snapping can adjust positions:
  retain failed exact-coordinate verification and inspect the same instance;
  never repeat creation. Terrain and general trigger memory editing remain unfinished.
  Bounded removal uses `live.placement.delete` on one fresh snapshot key. Layers
  over 32 objects refuse. It compares visible native properties of remaining
  instances despite row reindexing; do not infer whole-document serialized-byte
  preservation from this in-memory check. Preserve native confirmation dialogs
  and unknown deletions. The retained deletion fixture found four other saved
  object nodes changed, so that broader preservation claim remains unaccepted.
  New self-contained GUI libraries prefer `live.trigger.create` with an inline
  typed plan; `live.trigger.income` handles periodic mineral income with a few
  scalar parameters. They accept the current AI/Terrain/Triggers window and resolve
  the same process and document automatically. No workspace change, plan file or
  advance Save is needed. The AI panel is not itself a blocking modal dialog.
  Separate `live.trigger.prepare/apply` accepts an inline plan or existing file.
  Game Links use original Data lists from this document, including committed
  unsaved objects; `live.trigger.catalog` verifies exact case-sensitive domain/ID
  and native source identity. Creation automatically rechecks before import.
  Preserve pending Data XML, manual filters and stale/unknown outcomes; never
  invent catalog entries or import last-saved Data as current memory evidence.
  It reuses the existing generator
  and original Import Library; no map copy, Custom Script substitute or graph
  replacement. `live.trigger.verify` re-exports the same library for recovery
  without replaying import. Native graph, compilation and gameplay are separate.
  Current map-local UI layouts use `live.ui.create/read/author` in the exact UI
  window. Existing compact `ui frame/property/anchor/remove/template` commands
  reuse the typed writer; omit file=. A pending current buffer is captured without
  reselecting its tree; source/layout changes preserve manual XML. `buffer_applied`
  is native XML readback, not rendering. Native same-file Save flushes the UI model;
  verify the saved layout and DescIndex registration. Additional Text/style/import
  components refuse. Deferred name dialogs and uncertain writes never replay.
  Current localized text uses `live.text.read/author` in the exact Text window.
  Compact `text set` defaults to the captured locale; `table=GameHotkeys` or
  `table=TriggerStrings` addresses those tables. Original locale exports remain
  cached until native Save. `import_submitted` returns a shared `pendingId`;
  preserve that guard across MCP sessions, save the same document when requested,
  then call `live.text.verify`. Do not re-import because an export still shows
  old values. Deletion, unexported strings and linked style/import batches remain
  unfinished. Never infer rendering or gameplay from localized text verification.
  New current-document resources use `live.import.prepare/apply` in the exact
  Import window, with workspace source paths, flat names and `Assets/<folder>/`.
  This add-only path supports 16 files, 1 MiB each/8 MiB total. Existing native
  paths and saved entries guard collisions; staged files stay pinned during the
  original Import Files handler. Keep its shared pendingId, request native
  same-file Save separately, then `live.import.verify` checks exact saved bytes.
  Unknown submissions never replay. This direct provider cannot replace/remove
  resources or handle larger/linked groups; the same-file refresh path below can
  prepare those resource operations, excluding reserved map components.
  The user also accepts a same-file external update followed by the original
  Editor's refresh/OK confirmation. This is an explicitly allowed application
  variant, not permission to discard unsaved buffers or open a different map.
  If the user requested saving, use `live.refresh.begin mode=same_file_refresh
  saveIfDirty=true`; it saves existing manual edits once when needed and prepares
  against the same confirmed document revision. Otherwise use `live.refresh.prepare`
  on a clean document. Then send compact `live.refresh.author` or detailed
  `live.refresh.call` operations and apply once. Preserve pending input, dialogs
  and uncertain Save outcomes; never repeat an unknown Save automatically.
  One `modkit.author` stage script can combine begin, a `live refresh.author`
  `<<TAG` block and apply: reference the preceding begin/prepare/resume result as
  `sessionId=@s1.sessionId` (using its actual step ID). This reuses the original
  batch dispatcher; a failed/unknown live step stops the remainder.
  The existing generators prepare all component edits before native Close,
  atomic same-path publication and original Open in the same Editor/frame.
  `live.refresh.resources` prepares additions, replacements and removals under
  `Assets/<folder>/` in a grouped transaction; source and target bytes are guarded.
  Native resource loading and linked-reference validity still need separate checks.
  Requires one clean current document and no pending buffers; native Undo resets.
  No new working map is created; an internal rollback archive is retained.
  Acceptance persists across batches. Never force-close archive handles or dismiss
  native dialogs. Resume preserved preparation with `live.refresh.resume` after
  reconnect; recover uncertain application by pendingId, never repeat mutations.
  Same-file loading, component readback, rendering and gameplay remain distinct.
  Component transport uses the Editor-reported per-user `.sc2mcp/transfer` store,
  outside MSIX AppData redirection. Do not override client TEMP/TMP to hide a path
  mismatch. `transferDirectory.ts` and native `transfer_paths.inc` own the
  shared UI/Data/library/locale/import path boundary. After native Save,
  `savedUiBuffer.ts` acknowledges an original UI control's savepoint only when
  its exact bytes match that layout in the stable saved archive. Different or
  concurrently edited buffers stay pending; never clear modified flags blindly.
  Live Data catalogs use `live.data.read/author`, reusing existing compact Data
  recipes through original Commit XML Changes. One XML dataspace only; pending
  typed changes are included and whole-buffer stale guards apply. No map copy or
  archive replacement. Other component changes refuse. Read native Messages and
  keep XML, saved-catalog, model and rendered evidence distinct. Numeric field
  reads/writes require the native value-panel header to match the selected Unit.
  Data XML initialization observes native selection completion before switching
  views. If original XML View clears selection, restore that same local anchor
  once only after confirming there is no pending manual XML; never replace this
  state check with a fixed delay or relax the native local-source requirement.

- For visible-editor connectivity tests, start with read-only `live.windows` and
  `live.capabilities`/`live.memory.capabilities`. These do not require a save or
  `live.connect`. An unsaved marker is context, not a connectivity failure. If
  long filenames shorten the caption to one directory plus basename, current-map
  providers additionally check exact archive ownership by the Editor process and
  a unique matching original Window-menu document. Do not replace this guard with
  basename-only/history matching or open a Save As dialog. Short Mod captions and
  duplicate names still refuse; original native document/revision IDs are not claimed.
  If `live.memory.*` is absent, report the connection/profile limitation and reload
  the MCP connection before claiming the current server lacks that implementation.
  For explicitly requested in-memory editing, use `live.memory.read/set` directly:
  this separate opt-in adapter edits existing map-local Unit scalar fields through
  the original visible Data controls. It does not reopen/save the map or inject
  the hidden test DLL. Preserve token-bound editors, manual input, snapshots and
  unknown outcomes. Do not describe this bounded backend as live Terrain/trigger
  authoring. Read `docs/LIVE_EDITOR.md#direct-in-memory-data-editing`.
  Only the separate saved-checkpoint workflow requires saving before
  `live.connect`, followed by `live.author`/`live.call`, publish and `live.pull`.
  Never replace an open archive using offline export or checkpoint writes. Explicit
  `live.document.save` uses the original native File > Save instead. Do not dismiss
  save dialogs, inject the test DLL or treat file-open as rendered proof. Preserve drafts.

- Author map content through MCP, preferably compact `modkit.author` commands in
  one persistent workflow session. Use detailed module tools when needed. Shell
  is appropriate for server development/tests/packaging, not a parallel map writer.
- Query bounded pages/fields, reuse caches, batch a logical change, and validate
  once. Keep complete transaction groups, stale guards, backups and manual edits.
- For derived units and common spells, prefer `modkit.author_help section=data`
  and compact `data unit` / `data spell` commands before writing raw Data JSON.
  Put adjacent same-catalog recipes in one author call to share validation/save.
  Inspect supported targeting, shared native mechanics and presentation limits;
  custom mechanics still use the detailed tools rather than forcing a preset.
  For balance edits, prefer `data unit.configure` / `data spell.configure` with
  only changed scalar parameters. They preserve existing graphs and manual fields.
  Adjacent compatible Text, Settings, Terrain and single-object placements also
  coalesce; inspect compilation receipts and keep reads/advanced guards as boundaries.
- Galaxy is the default. When GUI is requested, create native GUI elements and
  actual trigger folders; filesystem script folders and Custom Script wrappers do
  not satisfy full GUI authoring. Use genre-appropriate ownership and organization.
- Inspect `nativeProfile` from GUI plans/validation before original Editor checks.
  XML validity and no-known-risks are not native compilation. Keep reusable library
  state independent of map globals or pass explicit arguments. Do not widen zero
  array bounds or silently relocate existing state to avoid a native failure.
  New literal-zero array dimensions use dedicated visible zero constants;
  inspect `nativeProfile.loweredZeroBounds`. Preserve manual helper edits and
  imported graphs; neither is silently normalized.
- About five main trigger folders is a recommendation, not a fixed count or limit.
  Use fewer or more meaningful systems as needed; preserve coherent existing trees.
- Prefer complete recipes for common systems: `trigger.recipe_hero_select` creates
  real GUI selection/preview/confirmation and per-player state. `terrain.site.plan`
  composes measured asymmetric decor with materials and a reserved road. Inspect
  actual native output; recipes do not establish art or balance acceptance.
- For GUI conversion, read `docs/TRIGGER_MCP.md#conversion-preservation-requirements`.
  Keep runtime event registration's explicit target trigger and call timing, plus
  the matching localized TriggerStrings. Native compile and semantic equivalence
  require separate checks; an event-only GUI definition is not an ordinary action.
- Abilities, costs, cooldowns, command cards, effects and XP/veterancy belong in
  Data by default. Triggers coordinate match flow, objectives, UI and persistence,
  issue native orders and read/restore authoritative Data state.
- Player-facing effects normally include Actor/Model feedback and appropriate
  sound. Invisible helpers/passives are explicit exceptions. Check event phases,
  host/site operations, animation lifecycle and preloads. A Model ID is not proof
  of visible playback. Avoid duplicate primary unit actors.
  Preserve/configure the main CActorUnit's movement, attack, death and relevant
  ability cast/channel/recovery animations. Separate effect models do not replace
  unit animation. Verify supported model sequences and native event timing; do
  not invent animation names or add a second primary unit actor for a spell.
  Use `data.presentation.check` for a bounded declared-event/model review; retain
  inherited/asset/native-playback uncertainty and explicit invisible exceptions.
  Prefer atomic `data spell` cast/channel/finish options for supported recipes;
  use `data.unit.presentation` to find stale weapon animation selectors and
  unresolved presentation links before native tests. Review existing confirmed
  frames through `project.test.review` and save image-bound agent findings with
  `project.test.observe`; these notes never imply human art approval.
- For locked UI features, inherit an existing Core container through `type="Frame"`
  and override its existing named typed child through Frame. Generic Frame accepts
  any known template; specialized types retain their class checks. Root properties
  remain Frame properties, so movie/browser properties belong on inherited typed
  children. Read `docs/BLIZZARD_TEMPLATES_AND_CLIPPING.md`; verify actual playback.
- Plan biome, purpose, condition and circulation before decoration. Reserve paths,
  gates, resources and pads. Use `terrain.catalog`/`terrain.style`, measured palettes
  and named owned compositions. Actor, Model, TerrainObject and TerrainTex are
  separate namespaces. Observed densities and source groups are not quotas.
- Review overview and gameplay-scale previews, resnap after height edits, and
  report cliff/navigation/placement uncertainties. Keep ModKit as the fast preview;
  do not modify paused renderer/converter research without a relevant request.
- Authored saved map cameras need coherent Rotation/Yaw and explicit valid
  Near/Far Clip values. Readback and PNG delivery do not establish useful framing;
  inspect the image and retain sparse/flat `contentAssessment` review flags.
- Record static validity, native compile, rendered appearance and gameplay as
  distinct evidence. Unknown/unreadable diagnostics remain unknown.
- Read game diagnostics after every launch and after the tested ability/action,
  following returned continuations and retaining source coverage. Read the owned
  Editor Messages/Console after native checks. Inspect missing models even when
  no error was reported; an empty partial log is not an all-clear verdict.
- Final minimaps use the original Editor terrain render through the default
  `map.minimap.rebuild` backend. The explicit `overview` backend is a draft only.
  Preserve vision/fog and verify the minimap in game; gray/white placeholder
  overviews do not satisfy standard textured minimap acceptance.
- For generation defects, correct the reusable writer, recipe or authoring rule
  and add a focused regression where meaningful, then repair affected maps through
  MCP. Do not present a one-map patch as a generator fix. Before delivery follow
  `docs/AUTHORING_PROTOCOL.md#regression-review-before-delivery` for changed scope.
- Before another native run, identify the unverified behavior or changed code
  that justifies it. Reuse retained results within their recorded scope; do not
  replay passing fixtures solely to refresh a general readiness label. Follow
  `docs/FOCUSED_ACCEPTANCE.md` for the remaining bounded stress cases. A failed
  case gets a diagnosed fix and a targeted rerun, not an expanding renewal matrix.
- For authorized native checks, use `editor.check`, `editor.job`, `editor.capture`
  and `editor.stop`. Toolkit owns a hidden Editor and private copies. Never attach
  to the user's visible Editor or force-kill active native handlers. Game tests
  require their own authorization. A region crop is not a controlled close-up.
- Reuse one retained service Editor. Count existing Editor processes before a
  launch and keep at most two total, including the user's visible Editor. Close
  this task's idle workers through `editor.stop` after the checks; preserve
  unsaved user documents and active workers owned by other chats.
- For authorized local game checks use the optional external `game` module:
  `game.status`, `game.tools`, `game.attach`, `game.call`, `game.detach`. Consult
  `docs/NATIVE_GAME.md`. Keep private Toolkit sources and instrumented copies out
  of distribution. Ordinary delivered maps must not require test instrumentation.
- Prefer `project.test.plan/run/status/report` for reusable map checks; see
  `docs/PROJECT_TESTS.md`. Reuse existing retained bridges sequentially with their
  workflow lease. Private map copies remain enabled. User-confirmed movement on
  earlier maps is positive evidence, separate from exact-revision automated tests.

## Reusable workflows

Project skills live in `.agents/skills/`: `sc2-mission-authoring`,
`sc2-terrain-composition`, and `sc2-data-trigger-systems`. Read a skill only for
its task. They reference the common protocol instead of replacing it.
For server architecture and maintainability work use `sc2-mcp-refactoring`; preserve
public contracts, transaction groups and native ownership across extractions.

## Development and publication

Current-document editing belongs to `src/modules/editorLive`; `src/modules/live`
retains saved-checkpoint collaboration and compatibility exports. Prefer the
`editor-live` profile when only the open document is requested. Read
`docs/EDITOR_LIVE.md` before adding a native application provider. Preserve existing
generators and report per-component support; module extraction is not native
acceptance of unsupported Terrain, arbitrary object insertion, GUI or UI writes.

Run builds and relevant checks after code changes. Useful commands are
`npm run build`, `npm run build:release`, `npm run docs:check-language`,
`npm run catalog:verify`, and selected regression tests. Broaden testing for new
failures or unresolved risks. Preserve unrelated work and third-party notices.

When publishing requested changes, include runtime catalogs, English instructions
and skills that affect behavior, not only TypeScript files. Review the complete
candidate against the live source and the target branch. Keep maps, game assets,
native binaries, caches, tokens, logs, screenshots and local history out of source
commits. Map-specific history and evidence remain under `work/`. Commit/push only
when requested.
