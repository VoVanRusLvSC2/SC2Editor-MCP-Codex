# Five-point map quality workflow

Use the existing authoring modules and retained native bridges to complete a map
feature, inspect its actual result and correct reusable generation defects.
This workflow does not assign automatic beauty scores.

## 1. Unit and ability presentation

Compact `data unit` and `data spell` commands share guarded transactions. Optional
`cast`, `channel` and `finish` bind inspected real sequences to the existing main
Actor. `kind=projectile` uses explicit supported native launch/Action templates,
retains missile/mover/sound links and binds unit-targeted impact damage.

Inspect `data.unit.presentation` and `data.presentation.check` for stale weapon
selectors, unresolved Models and ambiguous primary Actors. Unsupported macros,
default layers and native playback remain explicit. Review movement, attack,
cast/travel/impact, death and cleanup in real timed frames. Costs, damage,
cooldowns and progression remain native Data. See [Data MCP](DATA_MCP.md).

## 2. Designed locations

The measured `checkpoint` and `forest_clearing` prefabs use unequal groups, an
open corridor and grounded anchor/secondary props. `terrain.site.plan` combines
the layout, floor, road and coherent accent material in the existing owned
landscape transaction. Height is preserved; nothing is silently flattened.

```text
terrain site.plan zone=gate tileset=Agria recipe=checkpoint at=32,22 clearance=6 baseTexture=AgriaGrassYellow pathTexture=AgriaConcrete accentTexture=AgriaDirtRough
```

Use `modkit.author` with `mode=plan`, `stage` or `save`. Override slots with exact
available `fence`, `light`, `prop`, `secondaryProp` or `tree` Actor IDs. Regeneration
reconciles the owned zone, preserves unrelated objects and refuses manual/stale
edits. Roads reserve measured bounds with positive clearance. Native navigation,
collision and visual approval remain separate checks. Inspect overview and
gameplay-scale views. See [decor workflow](DECOR_VISUAL_WORKFLOW.md).

## 3. Observe, correct and compare

`game.presentations` in a test manifest reuses `game.record` once. Setup/readback
queries use local `$from` references. A named view, before/after timing, fps and
optional audio audit define observation. Expected events require the unchanged
session and post-order game time; incomplete evidence stays inconclusive.

Selected PNGs and MP4 are copied only from the bridge's owned directory, with
exact hashes, bounded sizes and type checks. `project.test.review` includes real
frames and timestamps. Inspect them before `project.test.observe` records concrete
findings. After normal MCP repairs and a targeted retest, `project.test.compare`
accepts `baselineJobId` and `candidateJobId`: the baseline remains historical and
its tested archive/PNGs must be unchanged; the candidate must match current inputs.
Side-by-side images and changed bytes do not judge improvement. Agent notes never
imply human approval. See [map tests](PROJECT_TESTS.md).

## 4. Combat and balance evidence

`game.combats` adds controlled fixture pairs to the retained runner. Ordinary
attack orders and native response timestamps produce sampled survival, net
life/shield loss and last-alive/first-dead brackets. These are not exact kill
timestamps or isolated gross damage; healing, auto-acquisition and map mechanics
may affect observations.
When the engine invalidates a corpse before inspection, death requires a
same-stream post-order `unit_died` event. Terminal vitals stay unavailable and
loss-range acceptance remains inconclusive; last-known vitals are never presented
as the final values.

`project.test.combat.plan` accepts `map`, `attacker`, `defender`, center `x`/`y`,
and optional `separation`, `repeats`, `expected`, `deathMin`/`deathMax`, `duration`,
`timeout` and `counterattack`. Planning does not launch. Use `project.test.run`
and `project.test.report`. Detailed manifests add loss ranges and views. Compare
intended hero/tier matchups, alongside existing ability/cost/cooldown checks.
One duel does not certify universal balance. Unknown mutations never retry; cleanup
must invalidate known fixtures before another case. Real output-volume budgets
remain planning and execution gates.

## 5. Complete GUI hero selection

```text
trigger recipe_hero_select prefix=Roster heroes=Vanguard,Bulwark players=1,2 at=32,34
```

The native editable GUI plan supports 2–20 existing Data Unit IDs, a UnitModel
preview, Data-localized names, confirmation, per-player state, duplicate-input
guards, selection/camera handoff and final Dialog cleanup. Actual elements live
in `GAMEPLAY/HERO_SELECTION`; there are no Custom Script wrappers or parallel
handwritten gameplay implementation. Apply/save the whole GUI group and generate
runtime from that same graph before native acceptance.

`<prefix>Hero[player]` is the created unit and `<prefix>Locked[player]` the confirmed
state. Failed normal Unit creation releases the player's lock. Abilities, levels,
command cards and progression remain on the Data Unit. Provide localized names
for custom units. Existing identities reject rather than being overwritten.
Verify native controls and the resulting unit; static GUI generation alone does
not prove model visibility or callbacks.
`previewCamera` defaults to the inspected Core Marine `Star2CameraMid03`; choose a
different real model camera for the roster's scale and inspect native framing.
