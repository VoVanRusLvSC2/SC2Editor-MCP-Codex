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
- Abilities, costs, cooldowns, command cards, effects and XP/veterancy belong in
  Data by default. Triggers coordinate match flow, objectives, UI and persistence,
  issue native orders and read/restore authoritative Data state.
- Player-facing effects normally include Actor/Model feedback and appropriate
  sound. Invisible helpers/passives are explicit exceptions. Check event phases,
  host/site operations, animation lifecycle and preloads. A Model ID is not proof
  of visible playback. Avoid duplicate primary unit actors.
- Plan biome, purpose, condition and circulation before decoration. Reserve paths,
  gates, resources and pads. Use `terrain.catalog`/`terrain.style`, measured palettes
  and named owned compositions. Actor, Model, TerrainObject and TerrainTex are
  separate namespaces. Observed densities and source groups are not quotas.
- Review overview and gameplay-scale previews, resnap after height edits, and
  report cliff/navigation/placement uncertainties. Keep ModKit as the fast preview;
  do not modify paused renderer/converter research without a relevant request.
- Record static validity, native compile, rendered appearance and gameplay as
  distinct evidence. Unknown/unreadable diagnostics remain unknown.
- For authorized native checks, use `editor.check`, `editor.job`, `editor.capture`
  and `editor.stop`. Toolkit owns a hidden Editor and private copies. Never attach
  to the user's visible Editor or force-kill active native handlers. Game tests
  require their own authorization. A region crop is not a controlled close-up.

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
