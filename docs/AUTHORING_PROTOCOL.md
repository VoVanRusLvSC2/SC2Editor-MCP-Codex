# SC2 authoring protocol

All maintained project documentation, agent instructions and tool descriptions
use English. Preserve resource IDs, source observations and user-requested map
localization. Historical evidence is retained under `work/`; it is not agent policy.

## Entry points and cost

Use a persistent MCP session. Start with `modkit.author_help`, then send compact
commands through `modkit.author`. Query only the needed catalog page or function
signature. Batch related work, validate once per logical change, and request full
evidence only when investigating a failure. Full catalog dumps are unnecessary.

Galaxy is the default logic language. `logic file/function/body` use guarded
`script.plan` workflows. GUI authoring requires an explicit `gui plan` or
`trigger.plan` request; Galaxy is not automatically converted into GUI elements.

When the user requests a graphical organization, create real `Triggers`
categories and place executable elements there with `trigger.organize` or
`trigger.plan.create.folder`. Filesystem Galaxy folders are not a substitute.
Choose the actual map genre. Abilities, effect graphs, energy costs, cooldowns,
command-card buttons and XP/level progression belong in native Data by default.
Triggers coordinate the match, objectives, UI and persistence, issue native
ability orders and read/restore native veterancy. Do not implement a second
ability cooldown, damage or level system in periodic trigger code.
Expose hero abilities through native Data command cards. Do not duplicate them
with trigger Dialog buttons, automatic targeting or periodic cooldown displays
unless the user explicitly requests a separate ability interface.

Player-facing abilities and effects include native visual Actor/Model feedback
by default: cast, travel/movement, hit or area cues as appropriate, and matching
sound when useful. Intentionally invisible helpers/passives are explicit
exceptions. Damage or teleport mechanics alone are incomplete presentation.
Reuse verified native bindings, including Start/Stop timing, source/target host,
site operations and animation lifecycle. Validate model links separately from
actual native playback; do not call an effect visually verified from XML alone.

## Logic ownership

For missions, use exactly these top-level systems, in this order:

```text
FUNCTIONS
MAIN
GAMEPLAY
OBJECTIVES
CINEMATICS
```

Use English UPPER_SNAKE_CASE subfolders only when needed. Shared helpers belong
in FUNCTIONS; startup and coordination in MAIN; mechanics, waves and gameplay UI
in their owning GAMEPLAY system; native tasks in OBJECTIVES; scenes and their
dialogue in CINEMATICS. Dedicated helpers and state stay with their system. Local
variables stay inside their trigger/function. No MISC/OTHER catch-all folders.

`project.organize genre=mission` defaults to Galaxy scaffolding and a versioned
ownership manifest. It preserves existing source. The scaffold entry is not
connected to InitMap until initialization is implemented and explicitly connected.
Other genres start with FUNCTIONS, MAIN and GAMEPLAY, adding necessary systems.

For GUI, `trigger.organize` accepts nested folder paths and exact element IDs.
Its order requests reorder exact folder members. It preserves executable XML and external libraries, reuses categories and
localizes new category names. Existing unrelated folders are reported rather
than silently reassigned. `trigger.plan.create.folder` assigns the new trigger
and newly created global declarations/helpers to the same system. Set create.genre for a non-mission map. Legacy
`create.category` remains compatible and reuses existing folders.

The complete supplied convention is in [TRIGGER_ORGANIZATION_PROTOCOL.md](TRIGGER_ORGANIZATION_PROTOCOL.md).

## Terrain composition

Describe tileset/biome, zone function, architecture, condition and gameplay
constraints separately. Operational, abandoned, damaged, destroyed and absent
are different states. Variety alone does not justify wreckage or fire.

1. Reserve routes, gates, resources, building pads and exclusion masks.
2. Build major heights, native cliffs and ramps, then inspect connectivity.
3. Paint functional texture regions, local transitions and accents.
4. Place anchored structures and measured infrastructure groups.
5. Add irregular vegetation clusters and quieter clearings.
6. Add supported foliage and surface markings separately.
7. Resnap after height edits and inspect overview/gameplay-camera previews.

Use `terrain.catalog` to inspect tileset sections and source location candidates.
Use `terrain.style` to retrieve one profile and a bounded Actor shortlist checked
against the target catalog. Actor, Model, TerrainObject and TerrainTex are separate
namespaces; a foliage Model cannot be placed as an Actor doodad.

`terrain.compose` supports named forest/natural clusters and explicit measured
anchor-relative groups for base entrances, service yards and ruins. Polygon
decoration areas can follow irregular terrain; rectangular/circular exclusions
reserve routes and work areas. Forest density uses seeded clusters, spacing,
water, hole, slope and protection checks. Constructed recipes accept explicit measured members. For ready groups, use
`terrain.prefab` / `terrain.assemble`: geometry measurements generate those
members with reserved routes. Inspect `terrain.measure` and
`terrain.palette_preview` before choosing objects. See
[Measured decor and visual palettes](DECOR_VISUAL_WORKFLOW.md).

Composition state stores seed, parameters and owned object fingerprints. Repeating
a composition replaces its owned objects without duplicating them. Manual edits
to an owned object stop replacement. Unrelated objects remain independent.
Objects, component registration and ownership state are saved as one transaction;
terrain/dependency changes invalidate a staged save.

## Evidence and limits

Original Editor checks are available through the optional pinned
[SC2NativeToolkit integration](NATIVE_EDITOR.md): `editor.check` queues saved
archive load/Data diagnostics, native GUI compilation and save/reopen comparison;
poll `editor.job`. `editor.capture` is the separate original-render check.
`map.preview` remains the fast ModKit preview. These are explicit native jobs,
not automatic effects of offline validation or authoring plan mode. Unknown
diagnostics stay unknown; original Editor acceptance does not prove gameplay.

Record pass, fail, not_checked or not_applicable with actual evidence. Static
checks do not prove visual cliff closure, unit navigation, buildability or runtime
performance. Use `project.check` and module validation, then actual preview images.
SC2 Editor/game validation is reported only when performed or confirmed by the user.

The catalog's 32x32 counts are broad source observations or authored suggestions,
not quotas. Catalog location fragments are reference candidates. The current
composition adapter does not reconstruct the native foliage distribution engine
or certify engine collision footprints. Geometry dimensions and visual
connection candidates are available through the measured decor tools.
