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

GUI plans and validation return a bounded `nativeProfile` review. Resolve known
original-generator risks before claiming full GUI readiness. `no_known_issues`
and XML `valid:true` do not establish native compilation. Named-library variable
types retain explicit TypeElement library bindings. Keep reusable library state
library-owned or pass arguments; a library's direct read of map globals can fail
because the original generator declares those globals later. A single literal
zero array bound collapsed to a scalar in the observed generator; an additional
Array tag did not repair it. New zero-bound declarations use a dedicated visible
global integer constant of zero for each dimension, in the same library. This
preserves the one-cell range for globals, fields and locals; it does not reuse or
change an existing user constant. Inspect `nativeProfile.loweredZeroBounds` and
verify the native result. Editing a generated helper produces a review finding,
not an automatic overwrite. Imported graphs are reviewed without this rewrite.
Do not silently relocate
existing variables/callbacks or replace their logic to obtain a passing test.
Expose hero abilities through native Data command cards. Do not duplicate them
with trigger Dialog buttons, automatic targeting or periodic cooldown displays
unless the user explicitly requests a separate ability interface.

Use explicit level indices when overriding inherited per-level ability arrays.
For example, the instant/target recipe's `castIntroTime`, `castOutroTime` and
`finishTime` write the corresponding native timing at index0; an unindexed child
timing may append a later level while the
current ability keeps its parent timing. Unindexed arrays used deliberately for
native append semantics are a separate case. Ability phase timings do not create
a channeled effect; keep native effect lifetime/cancellation separate from cast
and finish duration.

Player-facing abilities and effects include native visual Actor/Model feedback
by default: cast, travel/movement, hit or area cues as appropriate, and matching
sound when useful. Intentionally invisible helpers/passives are explicit
exceptions. Damage or teleport mechanics alone are incomplete presentation.
Reuse verified native bindings, including Start/Stop timing, source/target host,
site operations and animation lifecycle. Validate model links separately from
actual native playback; do not call an effect visually verified from XML alone.

Configure the unit's main `CActorUnit` as well: retain native movement, attack,
death and other required lifecycle animation handling. Bind custom ability
cast/channel/recovery animation where the model supports it, with appropriate
start, interruption and completion behavior. A separate impact or area Model is
not unit animation. Verify available model sequences and actual playback instead
of guessing animation names or creating a second primary unit actor for a spell.

Before adding an ability button, inspect the inherited card as well as local
entries with `data.card.check`. Instant/target recipes enforce known inherited
slot, cell and shared-face conflicts; use `card.conflictReason` only for an
intentional conditional binding and test the condition in the native UI. Unknown
merge semantics remain unverified. Two visible abilities must not accidentally reuse one hotkey-bearing
Button face. Use a distinct Button/hotkey and accurate tooltip when mechanics
differ. Native user hotkey profiles still require runtime review. Measure effect
scale against the unit and intended area; enlarging a model is not an art pass.
Compare native camera target readback with the requested target: map bounds can
clamp an apparently successful camera call. A visible conflict warning or clipped
effect remains an unresolved UI/presentation finding even when Data mechanics pass.

## Logic ownership

For missions, these five top-level systems are a recommended starting point:

```text
FUNCTIONS
MAIN
GAMEPLAY
OBJECTIVES
CINEMATICS
```

Five is a recommendation, not a required count or a maximum. Use fewer or more
folders and genre-appropriate names when the map needs them. Explicit folder
lists override the template; preserve established organization. Do not add empty
systems just to reach five. Use English UPPER_SNAKE_CASE subfolders only when needed. Shared helpers belong
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

Native GUI event declarations and runtime `TriggerAddEvent*` registration are
different operations. Runtime registration needs an explicit target `trigger`
expression and must preserve the original call, argument order and evaluation
timing; do not move it into initialization or force an event-only function into
an ordinary action. Preserve reference parameters, `structref`, nested arrays and
callback semantics without adding unsolicited checks. Unsupported representation
must remain an explicit limitation. See [GUI preservation requirements](TRIGGER_MCP.md#conversion-preservation-requirements).

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
8. After final landscape edits, use `map.minimap.rebuild`, save its staged
   transaction with `map.save`, then export. A foundation's neutral preview is
   not an updated landscape overview. Check the in-game minimap separately from
   fog, unit dots and the Editor overview; ordinary save/reopen need not rebuild it.

Distinguish full terrain dimensions, visible camera area and MapInfo playable
bounds before placing gameplay units or selecting spell test points. Supported
MapInfo bounds use left/bottom inclusive, right/top exclusive coordinates.
New Unit pivots and moves outside them reject by default. An explicit
`outsidePlayableReason` records intentional staging, but does not prevent the
engine from clamping a unit. Missing/unsupported MapInfo remains unverified.
Compare requested and observed positions before diagnosing effect radius/range.

For organic ground, use a related material base and regional
`materials.patches` where appropriate. Patches can retain an existing background,
blend coherent soil/litter/grass shapes and apply declared height/slope filters.
Keep functional roads and pads readable. Long solid strips and overlapping
canopy masks need a visual review even when their counts and spacing are valid.

Use `terrain.catalog` to inspect tileset sections and source location candidates.
Use `terrain.style` to retrieve one profile and a bounded Actor shortlist checked
against the target catalog. Actor, Model, TerrainObject and TerrainTex are separate
namespaces; a foliage Model cannot be placed as an Actor doodad.
Pass the location's `condition` when choosing its style shortlist. Automatic
composition excludes named wreckage for operational/abandoned defaults; explicit
asset choices remain reviewable. Use bounded target `browse.search` when the
observed tileset references omit an otherwise compatible prop, then measure it.

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

Owned woodland locations can use explicit `config.clusterCount` and
`config.clusterRadius` to reuse the scatter clustering already available in
`terrain.compose`. Reserve routes first, then give canopy and understory their
own spacing and grouping. Unspecified clustering retains the established uniform
layout; it is not automatically added to every biome or infrastructure zone.
Clustering controls object centers and does not establish engine collision or
art quality. Impossible density rejects instead of silently becoming uniform.

For incremental location terrain and decoration, use the named intent form of
`terrain.landscape.plan` or `terrain landscape file=...` in the compact interface.
Bind an existing relevant test suite with `intent.routeSource` and an explicit
`clearWidth` before adding decor around established gameplay routes. Test
tolerances are not design widths. This reserves positive route and formation
lanes without painting them; blocked crossings and native pathing stay separate.
Declare real overlay dependencies; repeated definitions are no-ops, and parent
changes rebuild their dependants. Preserve the ownership record with the complete
Terrain transaction. See [incremental locations](LANDSCAPE_OWNERSHIP.md) for the
supported channels and remaining native/art-review limits.

For intended building locations already declared by exact `game.pads` checks,
bind `intent.padSource` with the test file and explicit per-pad `clearWidth` and
`clearHeight`. This reserves decoration space through the same owned transaction.
Do not infer an engine footprint from a rendered Model or turn a diagnostic
nearby candidate into an exact authored pad. Resolve unselected owned conflicts
by reviewing the named zones, preserve unrelated/manual work, then export and
run the native placement suite. Reservation alone is not a predicate/build-order
or navigation verdict.

## Evidence and limits

Original Editor checks are available through the optional pinned
[SC2NativeToolkit integration](NATIVE_EDITOR.md): `editor.check` queues saved
archive load/Data diagnostics, native GUI compilation and save/reopen comparison;
poll `editor.job`. `editor.capture` is the separate original-render check.
`map.preview` remains the fast ModKit preview. These are explicit native jobs,
not automatic effects of offline validation or authoring plan mode. Unknown
diagnostics stay unknown; original Editor acceptance does not prove gameplay.

Before normal-order tests, compare the live player roster from `game.attach` or
`game.status` with every tested unit owner. A placed unit can exist for a player
whose live type is `None`; finding the unit does not establish a playing owner.
Configure intended participants through Settings and keep deliberate neutral or
inactive-owner cases explicit. Order submission alone does not prove execution.

Record pass, fail, not_checked or not_applicable with actual evidence. Static
checks do not prove visual cliff closure, unit navigation, buildability or runtime
performance. Use `project.check` and module validation, then actual preview images.
SC2 Editor/game validation is reported only when performed or confirmed by the user.

The catalog's 32x32 counts are broad source observations or authored suggestions,
not quotas. Catalog location fragments are reference candidates. The current
composition adapter does not reconstruct the native foliage distribution engine
or certify engine collision footprints. Geometry dimensions and visual
connection candidates are available through the measured decor tools.

Even native placement searches need explicit result review. The verified SC2
profile can snap an off-grid request to a different center with range0. Preserve
both requested and returned coordinates. Default placement tests enforce the
observed power/creep restrictions, while explicit tests=0 can bypass them; do not
make that override a silent default or call a nearby candidate exact placement.
Placement predicates do not by themselves check build orders, costs or tech.

For a ground-topology question, declare explicit `game.pathing` passable/connected
checks and `game.nativeProbe` timing. Keep point passability, point connectivity,
placement and unit arrival distinct. An occupied endpoint may remain connected
while not passable. A native false result is not a timeout, a diagnosis of its
cause or a unit-footprint test. The private query pass closes before ordinary
gameplay, so its state is not silently combined with later movement evidence.
