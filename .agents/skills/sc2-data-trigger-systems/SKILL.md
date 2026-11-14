---
name: sc2-data-trigger-systems
description: Implement or review SC2 abilities, progression, gameplay coordination and native GUI organization through MCP. Use for Data versus trigger ownership and connected effects/UI/logic. Do not activate for terrain-only decoration.
---

# Native Data and coordinating logic

Read `docs/AUTHORING_PROTOCOL.md`, then only the guide for the requested operation.
Data work uses `docs/DATA_MCP.md`; GUI organization uses
`docs/TRIGGER_ORGANIZATION_PROTOCOL.md`. Read `docs/NATIVE_EDITOR.md` when doing
original Editor checks. Inspect actual tool schemas before using recipes.

For a new self-contained GUI system in an open Editor, prefer `live.trigger.create`
with an inline typed plan, or `live.trigger.income` for periodic mineral income.
Use the supplied AI/Terrain/Triggers window identity; the adapter resolves the
native Trigger Editor. Existing unsaved changes and the AI panel are allowed.
No external plan file, workspace reconfiguration or advance Save is required.
For edits inside existing GUI systems, inspect `live.trigger.details` and use
its fresh detail fingerprint. `groupPath=3/1/1/2` selects a nested action/body;
`parameterPath=2/3` selects an existing expression's parameter container.
Preserve both selectors through parameter discovery, configure and literal
setters. Compound action insertion creates a subtree, not necessarily one row.
`append_condition` currently creates only the native default Comparison and
returns `needs_parameters`; do not claim arbitrary variable/function/type
binding. See `docs/EDITOR_LIVE.md` for the bounded current scope.
For a requested Save, use `live.document.status/save` after successful application.
Inspect the returned native graph verification and preserve uncertain results
without repeating import. Unit/Actor inspection and conversion guides below are
only relevant when the request actually involves those systems or conversion.

1. Inspect the unit, ability/effect graph, actors, strings, dependencies and logic
   source. Reuse verified native presentations where possible.
2. Keep ability mechanics, costs, cooldowns, command cards and XP/veterancy in Data.
   Triggers coordinate flow, selection, objectives, UI and persistence and issue
   native orders. Do not add competing cooldown or progression loops.
   Native kill XP also uses the map-wide gameplay recipient search. Inspect it
   when multiple heroes split rewards; `data.xp.search radius=0` explicitly
   disables nearby search for the whole map. A hero recipe must not silently
   override that policy. Verify the killer and nearby control heroes separately.
3. Include cast/travel/hit or area presentation and sound. Check Start/Stop events,
   source/target hosts, site operations, animation lifecycle and preloads. Use the
   documented `recipe.unitActor`/`recipe.effectModel` scope where suitable; avoid
   duplicate primary unit actors.
   Use `data.presentation.check` to review declared effect events and model links
   together. It does not replace asset resolution or native playback evidence.
   Inspect `eventScopeReview` for point effects; do not automatically add
   `At Target`. Read launch/action diagnostics and review actual rendered frames:
   working damage or an actor count alone does not prove a visible model.
4. Use Galaxy by default. For requested GUI, create native elements and real
   folders without an undisclosed parallel script. Keep locals and state with
   their owning system and shared helpers with shared functions.
   Read `docs/TRIGGER_MCP.md` conversion preservation requirements for runtime
   event registration, explicit trigger targets, reference/callback semantics and
   localized `TriggerStrings`. Native compilation alone is not equivalence proof.
5. Handle initialization, transitions, duplicate input, death, cleanup and restart.
   For common hero selection, prefer `trigger.recipe_hero_select` with existing
   Data Unit IDs; inspect its native UnitModel preview and confirm callback.
   Use `project.test.combat.plan` for declared matchups and `game.presentations`
   for timed native observation. Review and compare actual frames after repairs;
   generated graphs, recorded bytes and event matches do not judge art quality.
   Keep UI state per player where needed. Use native command cards unless a
   separate ability interface is explicitly requested.
   For locked UI features, read `docs/BLIZZARD_TEMPLATES_AND_CLIPPING.md`. Prefer
   a verified Core container inherited through generic `type="Frame"`, then an
   exact named Frame override of its existing typed child. Generic Frame accepts
   known templates; specialized properties belong on the typed child, not the
   base root. Native instantiation and video/web playback require separate proof.
6. Apply guarded transactions, validate references/generated source, and use native
   compilation when available and authorized. Separate compiler, load, image and
   gameplay evidence.

Completion includes editable source, linked Data, user-facing feedback and bounded
evidence. Valid XML and successful compilation do not prove visible effects or
correct gameplay; identify the exact remaining test when it cannot be performed.
Use the [shared regression review](../../../docs/AUTHORING_PROTOCOL.md#regression-review-before-delivery)
for changed scope before delivery; reuse accepted evidence instead of repeating it.

## Complete presentation before acceptance

For supported new spells, prefer `data.spell` with inspected `cast`, `channel`
and `finish` sequences so mechanics, command card, effect Actors, preloads and
main-unit animation commit together. Use `kind=projectile` only with an inspected
supported native launch/Action template; retain its missile/mover presentation.
Never invent an animation inventory or replace the main Actor with a second one.
Use `data.unit.presentation` for a bounded repair shortlist, then inspect exact
Actor events/effect links. A declared Model is not evidence of visible playback.
Review actual native frames with `project.test.review`; record concrete,
image-bound agent observations through `project.test.observe` without treating
them as human approval. Reuse unchanged passing evidence; rerun the affected
cast/travel/impact/cleanup phases when presentation changes.

## Standard unit presentation

A model assignment alone does not copy the native unit panel or attack events.
For derived player-facing units, use `data unit` with its native source Actor;
retain UnitIcon, HeroIcon, GroupIcon, Wireframe, LifeArmorIcon and applicable shield
icons along with the main Actor's attack, movement and death presentation. Keep
source asset identity tokens bound to the source; remap only the actual duplicated
catalog identities. A custom unit must not acquire an invented texture path.

Inspect `data unit.presentation unit=Hero` and resolve selection/armor/attack
review findings before delivery. Ordinary Data validation also warns about a
narrow generic-parent clone missing presentation declared by its native source.
Existing stripped Actors can be repaired explicitly with
`data unit.presentation.repair unit=Hero actor=HeroActor sourceActor=Marine`.
The selected native UI groups are replaced; missing native attack handlers are
added while custom spell events, models, scales and attached modules remain.
Intentional custom icons or invisible helpers are explicit exceptions. Existing
conflicting manual attack handlers and unsupported source layers require review;
static Data restoration does not prove native animation playback.
