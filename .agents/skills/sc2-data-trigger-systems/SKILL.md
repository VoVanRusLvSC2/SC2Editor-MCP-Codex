---
name: sc2-data-trigger-systems
description: Implement or review SC2 abilities, progression, gameplay coordination and native GUI organization through MCP. Use for Data versus trigger ownership and connected effects/UI/logic. Do not activate for terrain-only decoration.
---

# Native Data and coordinating logic

Read `docs/AUTHORING_PROTOCOL.md`, then relevant parts of `docs/DATA_MCP.md` and
`docs/TRIGGER_ORGANIZATION_PROTOCOL.md`. Read `docs/NATIVE_EDITOR.md` for authorized
original Editor checks. Inspect actual tool schemas before using recipes.

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
4. Use Galaxy by default. For requested GUI, create native elements and real
   folders without an undisclosed parallel script. Keep locals and state with
   their owning system and shared helpers with shared functions.
   Read `docs/TRIGGER_MCP.md` conversion preservation requirements for runtime
   event registration, explicit trigger targets, reference/callback semantics and
   localized `TriggerStrings`. Native compilation alone is not equivalence proof.
5. Handle initialization, transitions, duplicate input, death, cleanup and restart.
   Keep UI state per player where needed. Use native command cards unless a
   separate ability interface is explicitly requested.
6. Apply guarded transactions, validate references/generated source, and use native
   compilation when available and authorized. Separate compiler, load, image and
   gameplay evidence.

Completion includes editable source, linked Data, user-facing feedback and bounded
evidence. Valid XML and successful compilation do not prove visible effects or
correct gameplay; identify the exact remaining test when it cannot be performed.
