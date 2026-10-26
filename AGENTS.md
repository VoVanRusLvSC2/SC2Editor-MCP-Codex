# SC2 MCP development and authoring

Read `docs/AUTHORING_PROTOCOL.md` first, then only the relevant subsystem guides.
Explicit user requirements override project defaults. Maintained documentation,
agent instructions and tool descriptions are English. Preserve requested map
localization, resource IDs and original catalog source annotations.

## Working defaults

- Author map content through MCP, preferably compact `modkit.author` commands in
  one persistent workflow session. Use detailed module tools when needed. Shell
  is appropriate for server development/tests/packaging, not a parallel map writer.
- Query bounded pages/fields, reuse caches, batch a logical change, and validate
  once. Keep complete transaction groups, stale guards, backups and manual edits.
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
- Before another native run, identify the unverified behavior or changed code
  that justifies it. Reuse retained results within their recorded scope; do not
  replay passing fixtures solely to refresh a general readiness label. Follow
  `docs/FOCUSED_ACCEPTANCE.md` for the remaining bounded stress cases. A failed
  case gets a diagnosed fix and a targeted rerun, not an expanding renewal matrix.
- For authorized native checks, use `editor.check`, `editor.job`, `editor.capture`
  and `editor.stop`. Toolkit owns a hidden Editor and private copies. Never attach
  to the user's visible Editor or force-kill active native handlers. Game tests
  require their own authorization. A region crop is not a controlled close-up.
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

## Development and publication

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
