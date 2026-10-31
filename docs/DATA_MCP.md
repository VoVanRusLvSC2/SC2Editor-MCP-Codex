# Data Editor MCP

`data.*` edits the native StarCraft II Data Editor catalogs: unit, actor, ability, effect, weapon, and other catalog definitions stored in `<Catalog>` files below `GameData`.

Presentation includes the unit's main `CActorUnit` animation handling, in addition
to effect Models and sound Actors. Preserve native movement/attack/death behavior
and configure supported cast/channel/interruption/completion animation for custom
abilities. Existing parent events and an impact model alone do not prove those
animations work; model-sequence and native playback review remain separate.

For a custom ranged weapon, an impact Actor alone is incomplete presentation.
Bind a visible native projectile or an Action Actor with a beam between the
caster's supported launch attachment and the target, as well as the main unit's
supported firing animation. A model with no Attack sequence needs an explicitly
verified model-appropriate alternative such as Spell or a channel sequence. Check
the rendered form as well: a valid Spell sequence can temporarily shrink or morph
the model instead of showing the intended attack gesture. A protective behavior should have a visible
state cue tied to its actual On/Off lifecycle, with death/orphan cleanup; do not
describe damage reduction as invulnerability. Verify these cues in normal gameplay
framing, including their disappearance, instead of inferring them from Actor counts.
An inherited attack Action can require target attachment volumes. A target's
Ref_Center attachment does not prove it has a matching volume; for a simple beam
that does not need volume placement, explicitly use a volume-free impact site
operation and check the console on actual target models.
For that volume-free profile, set the Action's ShieldFlashType explicitly to
Full or None; the inherited Header mode requires a compatible attach volume.

## Public tools

### Discovery and performance

`data.query` and `data.context` reject unknown parameters before catalog access.
Use `text` and `domains` (an array), not `query` and `domain`. A typo must not
silently become an unfiltered catalog search. Existing defaults and explicit
unfiltered queries remain supported.

`data.batch` and `data.apply` return `timing.elapsedMs` and named `stagesMs` for
catalog discovery, indexing, references and validation. Batch summaries retain
these measurements. Stage times are nested within the tool duration; do not add
them to parent spans or interpret them as token billing.

Validation shares one operation-local object index and a synchronous pinned XSD
read window. The index refuses changed source, record order, layer or activation.
Consumed schema hashes still join the transaction read guards before publication;
full static validation, dependency coverage and native uncertainty remain intact.
The index is not a persistent cache that can certify an edited catalog.
Within one apply, the final index can reuse objects from the initial index only
when both the full source and source filename match. Record order, file bindings,
layer and activation are rebuilt. Public document object reads remain independent
mutable snapshots. Replacing document source invalidates parsed field ordinals.
Discovery and object reads share the document's parsed XML instead of parsing each
catalog twice. Repeated unindexed fields retain their source-order ordinals.

Incoming-reference preflight runs for object rename/delete operations, where its
result is consumed. Scalar edits and creation recipes retain consumer read guards
and full final reference/authoring validation without constructing an unused
pre-edit incoming-reference graph. Rename/delete still check dynamic consumers,
incoming links, inherited tokens and manual changes before publication.

GUI/Galaxy/Object consumer parsing is retained within the MCP workspace using
tracked read memos. Reuse rechecks actual file contents, directory membership and
effective drafts, and replays dependencies into the next transaction. A new draft
consumer invalidates the memo. Returned results are isolated from callers that
append coverage findings. Keep one MCP process alive to benefit from this cache.
The first Galaxy parse also uses ordered token/function cursors rather than
searching every token for every call. Constants, lexical shadows, dynamic-reference
findings and exact rewrite spans retain the same representation. On the same map,
a local cold consumer-only comparison changed from 49.7s to 2.2s, with identical
serialized output (2895 references and110 findings). This narrower measurement
does not establish the latency of a complete apply or an Editor/game operation.

Dependency preparation is scoped to a logical read operation. Data's initial and
final catalog passes share verified CASC preparation and prepared dependency
documents; workspace candidates and activation/order metadata remain separate.
Reusing a dependency document checks actual file bytes and directory membership,
including optional activation inputs. Source or native activation changes cannot
silently reuse a previous interpretation. Preparation is released when the read
scope ends and is not shared across independent requests or isolated read memos.

CASC build identity, mount manifests and verified view bytes join the existing
transaction read guards when preparation runs in a tracked operation. Legacy mount
order migration records the final manifest. Final disk/draft checks and grouped
publication remain enabled. Independent snapshot comparisons read at most four
files concurrently, drain all started reads and retain the first mismatch/error
in input order; writes remain serialized.

A local 2026-10-30 comparison on the Narud map used the same single-field dry-run
through public MCP: the first call changed from 131.6s to 20.7s and a repeated call
from 104.7s to 15.7s. Complete validation and authoring reports, including 6555
diagnostics, matched exactly. These are two observations on one map, not a general
latency guarantee or a measurement of the complete visual-authoring workflow.

### Catalog class changes

`object.setType` works in single-file Data operations and `data.batch`. It changes
only the outer class tags within the same catalog domain, preserving the ID,
fields, comments and incoming catalog links. Batch aliases follow the new typed
key, so later operations can keep using the same alias. Cross-domain changes reject
the complete transaction before files or drafts are published. The operation is
listed by `data.context` as well as the tool schema. Static class/field validity
does not prove that the original engine can instantiate a class.

One native-observed class rule rejects ordinary named `CWeapon` entries before
staging. Original Editor5.0.17.98310 rejected that form, while an explicit named
`default="1"` template and a concrete `CWeaponLegacy` entry passed load/Data
diagnostics. Validation reports `DATA_NATIVE_CLASS_INSTANCE_REFUSED`; `data.describe_type`
exposes the dated build and report hashes in `nativeClassObservations`. Templates
and imported bytes are preserved. Removing a default flag, cloning an ordinary
entry, or changing a concrete entry to the refused form is checked against the
final transaction graph. Explicit or dynamic template markers retain their
separate schema/native uncertainty. This is not a general ban on XSD `abstract`
types: a named `CEffect` passed the same native load controls. Load acceptance
does not establish effect execution, models or gameplay.

### Native ability learning

`data.hero.learn` / `recipe.learn` creates one `CAbilLearn` point pool on a local
hero and binds real `Learn1`..`Learn20` native command-card entries. Parameters
are `id`, `unit`, `veterancy`, `points` (default0), `pointsPerLevel` (default1),
`entries` and explicit `replace`. Each entry declares `command`1..20, `ability`,
`button`, `minLevel` (default1), `levelSkip` (default1), and an explicit `card`
page/slot/row/column. These are native Data fields, not trigger counters.

Execution abilities remain separately authored local `CAbilEffectInstant` or
`CAbilEffectTarget` records with an explicit positive `Levels` value. Configure
their actual per-rank Effect/Cost/timing fields with explicit native indices;
this recipe does not invent higher-rank mechanics or presentation. The bound
unparented `CBehaviorVeterancy` must expose an explicit contiguous level table.
Unknown/layered references, unreachable ranks, competing Learn/veterancy pools
and card conflicts reject before staging. About five trigger folders has no
relationship to the native20-command Learn capacity.

Explicit replacement owns the Learn record and its same-unit Learn command
bindings, releasing obsolete owned slots while preserving unrelated cards.
Use distinct localized learn and execute Button faces/hotkeys. The compact
single-entry form is:

```text
data hero.learn id=HeroLearn unit=Hero veterancy=HeroXP ability=Pulse button=LearnPulse command=1 card.page=0 card.slot=14 card.row=1 card.column=3
```

Use the structured tool's `entries` array for multiple commands in one pool.
Native starting-point accounting, level gates, rank execution and visible button
states require original-game checks. Successful generation and XML validation
alone do not establish those behaviors or a finished talent-selection interface.
The [native Learn/XP fixture](verification/native-learn-xp-2026-10-23.json) now
records two launches with three point profiles, native level/max-rank gates and
actual per-rank damage/energy results. Direct numeric point-pool introspection,
real command-card activation and larger talent/UI variants remain separate.

Instant/target ability recipes accept `castIntroTime`, `castOutroTime` and
`finishTime` as explicit overrides of native `CastIntroTime[0]`,
`CastOutroTime[0]` and `FinishTime[0]`. Zero is an explicit override. Native timing
fields are per-level arrays: adding an
unindexed value to a child can append a later level and leave the first-level
parent timing active. Use explicit indices when overriding inherited timing;
omitting the recipe option preserves the native template. This parameter is not
a generic label for every preparation/channel/recovery stage. In particular,
waiting in a cast timing does not construct a channeled effect. The native
finite-channel profile uses a `CEffectCreatePersistent` with `Flags[Channeled]`,
period count/effect/period and appropriate targeting/lifecycle. Check cancellation
and actual effect ticks separately from these ability timings and main Actor
animation events. Timing options preserve the selected source's other semantics.

`data.card.check unit=Hero` (or `data card.check unit=Hero` in compact authoring)
reviews the known effective command card through a unique active Unit-parent
chain. Fresh implicit root entries and numeric indexed overlays are supported;
layered declarations, derived implicit arrays and tokenized array indexes remain
unverified. Results are paged and distinguish static findings from native UI
acceptance. This lookup does not stage files.
Mount the target's declared dependency catalogs. Built-in native catalog
activation uses the installed ModKit runtime's catalog profile; configure
`SC2_MODKIT_HOME` or run the normal ModKit setup in a standalone portable install.
An unavailable parent remains unverified rather than an empty inherited card.
When the unique parent chain declares a literal `Speed=0` and exposes move
commands, it also reports `CARD_MOVE_AT_ZERO_SPEED`. This is an availability
warning, not a rejection of intentionally stationary units or a full simulation
of movers, validators, requirements, buffs or native command visibility.

Instant/target ability recipes run the same inherited-card guard before writes.
They reject another command's slot, a shared visible cell or a reused Button face
on the same page. Existing unrelated conditional overlaps are reported by the
lookup but do not block a separate new binding. `card.conflictReason` allows an
explicit intentional conditional/shared-face exception; it cannot override an
occupied slot or unresolved inheritance. The reason records intent, not proof of
native exclusivity. Different Button faces can still use conflicting hotkeys;
localized/default keys and user profiles require actual runtime review. Low-level
Data operations remain available for layouts outside this supported recipe scope.

`data.hero.veterancy` / `recipe.veterancy` creates one native kill-XP
`CBehaviorVeterancy` and binds it to a local Unit with its Hero flag. Supply
`levels:[{xp:0},{xp:50,lifeDelta:100,damageDelta:5},{xp:150,...}]` using cumulative
XP thresholds. The first threshold is zero; later thresholds strictly increase.
The native level table begins at index0 for displayed level1 and stores transition
costs, so these thresholds serialize as 0,50,100. An extra zero row would start
the hero at level2. Deltas accumulate across levels; damage affects Melee, Ranged,
Splash and Spell. Per-behavior sharing is disabled, friendly/neutral/hallucination
targets are excluded, and `xpFraction` defaults to1. The map-wide native recipient
search remains inherited. No trigger counter is introduced.

`data.xp.search` / `recipe.xpSearch` explicitly configures **map-wide**
`CGame:Dflt.VeterancySearchRadius`. Core defaults to10: nearby heroes may split
kill XP even when the behavior has zero SharedXPFraction/SharedXPRadius. Use
`data xp.search radius=0` for a killer-only recipient search; this preserves
behavior-level sharing settings and unrelated gameplay fields. The radius is
required and nonnegative; changing an existing local value requires `replace=true`.
A hero recipe never silently changes this setting for every unit on the map.
Native XP eligibility/filters, learning points and the final UI remain separate
checks. In the three-hero diagnostic fixture, radius10 gave each hero16.6665 of
a50-XP kill; radius0 gave the killer50 and the two controls0.

An existing `levelEffect` is required for feedback. Its Model/sound binding needs
separate presentation checks. The Unit's parents must resolve unambiguously;
another known veterancy behavior rejects. Replacement explicitly owns the behavior
fields and retains independent Unit fields. Native level/stat behavior has one
recorded three-level fixture; this is not a general talent/learn/charge system.
For compact commands, CSV thresholds and constant later-level deltas replace a
long level array:

```text
data hero.veterancy id=HeroXP unit=Hero levelEffect=LevelUp xp=0,50,150 lifeDelta=100 damageDelta=5
```

The first level receives zero deltas in this shorthand. Use explicit `levels` for
varying increments or base bonuses; `xp` and `levels` cannot be mixed. Native
levels1→2→2→3 at total kill XP0→50→100→150, life1000→1100→1200 and damage500→505→510
passed two launches on the recorded fixture. Its reused ability button produced
a hotkey-conflict warning, and a large level effect was partly clipped by camera
bounds. Those are remaining UI/presentation work, not an accepted finished HUD.

`data.ability.instant` is a scalar wrapper around `recipe.instantAbility` in the
existing guarded `data.apply` transaction. It inherits an active same-class
native execution template (default `Stimpack`), sets an existing effect/button,
energy cost and unit-scoped cooldown, and clears inherited life/fraction/resource
costs. Research requirements are cleared by default; set
`clearRequirements:false` to retain them. Other native template behavior remains
inherited and needs a target-engine test. Mount the map's declared native catalogs
first; ambiguous or unavailable sources reject.

Optional `unit` + `card:{page,slot,row,column}` binds a local Unit through explicit
native page/slot indices. Unindexed local cards and slots owned by another ability
reject. Choose a free visible coordinate; an index alone does not prove the native
parent has no coordinate conflict. `replace:true` explicitly owns and rebuilds an
existing ability's fields. Model/sound presentation is authored separately with
the recipes below. The recipe is single-catalog only, not a multi-file batch
expander. Compact save mode accepts:

```text
data ability.instant id=Pulse effect=PulseSearch button=Pulse energy=25 cooldown=5
```

Use the returned strict verdict, then save the complete Data group. Mechanics,
cooldown rejection/reuse and visible/audible playback are separate engine checks.

`data.ability.target` / `recipe.targetAbility` uses the same guarded cost/card
workflow for `CAbilEffectTarget`. `sourceAbility` is required; there is no guessed
universal target template. It retains that source's unit/point targeting, filters,
validators, cursor effects, cast timing and other native behavior. Optional
`range` overrides the inherited range. It does not derive those semantics from
the supplied damage/search effect. Inspect the actual native template first and
test both legal and illegal targets in the target build. Changing an effect does
not automatically rebind the inherited cursor, sound or visuals.

Both execution recipes assign the new ability's own native `AbilSetId`. An
explicitly inherited shared identity can otherwise route a normal order back to
the original template. Shared order identities require deliberate low-level
authoring and native verification; distinct names alone are not independent IDs.

The target recipe writes `Range` at native level0 explicitly, just like indexed
phase timings. An unindexed override can append a later level while the current
ability retains its parent's range. Test normal orders inside and outside the
intended range; a correct catalog value alone does not establish engine behavior.

`data.ability.charges` / `recipe.abilityCharges` configures only the direct
`Cost[0].Charge` on one unambiguous local `CAbilEffectInstant` or
`CAbilEffectTarget`. Effects, energy, cooldowns, command cards and presentation
remain independent. It writes an explicit link and `Abil`, `Unit`, `Player` or
`Global` scope (default `Unit` and the ability ID), counts, recovery time and
queuing flags. `max=0` explicitly disables the charge gate; positive maxima use
integer `start` (default max), `use` (default1) and `regen` seconds (default0).
The writer owns Charge, applies the recovery duration to the initial timer as
well as the use timer, clears the delay and native RestoreAllChargesOnCooldown
flag, and defaults to queued recovery. A zero initial timer can immediately fill
a partial starting stock; `CountStart` alone does not preserve that stock.
With `regen=0`, the stock is finite. A partial or empty stock uses native
`TimeStart=-1` to suppress the initial refill while retaining `TimeUse=0`.
Negative use/recovery durations are not public recipe inputs. Initial far-target
probes were confounded by an unindexed range override; the later close-target
probe isolated the initial-timer sentinel and confirmed a legal cast followed by
depletion without trigger-side counter changes.
Unindexed
local costs, other ability classes and ambiguous identities reject. Other
per-command, Behavior/OffCost and per-level cost layouts remain outside this
recipe. Native depletion/sharing/recovery and UI need engine checks; source
validity is not runtime acceptance.

```text
data ability.charges id=PointAbility max=2 start=2 use=1 regen=8 location=Unit
```

Use the existing guarded Data group and save, rather than a trigger counter or
forced charge reset. This setter can join adjacent same-catalog compact commands.

The [native charge/range checkpoint](verification/native-charges-range-2026-10-22.json)
uses nine EMP-derived target profiles on two fresh launches. Four pool scopes,
natural recovery, disabled charge gating, spend-two affordability and finite
partial/empty starts passed. Each launch confirmed19 casts by their caster/time,
40 damage and native completion, plus12 blocked orders. Declared range32 casts
at30 units and an outside-range control passed with explicit sight and active
owners. Native Editor load/compile passed for the exact archive. Instant charges,
cross-ability shared links, nonqueued recovery and nonzero-cooldown combinations
remain outside this native corpus. No new art, animation-name or isolated-audio
acceptance is implied; runtime diagnostics retain partial coverage.

```text
data ability.target id=TargetPulse sourceAbility=Snipe effect=TargetDamage button=TargetPulse range=6 energy=25 cooldown=5
```

Local same-file execution templates are read from the evolving transaction once;
the old parse is not counted as another declaration. Real competing active
declarations remain ambiguous and reject. Replacement owns the ability fields;
existing independent unit fields are retained. These recipes do not currently
expand through `data.batch`; use their single-catalog guarded transactions.

`data.effect.projectile` / `recipe.projectileEffect` creates a launch-missile Effect
and matching Action Actor in one guarded catalog transaction. Supply explicit
`sourceEffect` and `sourceActor`, an existing `impactEffect`, `damageEffect` and
`impactModel`. Optional `actor` selects the generated Action ID (default: the
Effect ID plus `Action`); `replace:true` explicitly owns both generated objects.

The currently supported source profile is `CEffectLaunchMissile` with declared
AmmoUnit/ImpactEffect, `CActorAction parent="GenericAttack"` with matching
effectLaunch/effectImpact tokens and one simple ActionDamage event, and a unique
`GenericAttackMissile` Actor for that ammo. The recipe resolves its actual Model,
retains the native ammo/mover, rebinds the effect tree and pins Missile/impact
Model/sound links. It neutralizes unsupported implicit new-ID art lookups and
preloads Actor, Unit, Effect, Model and Sound references as one coupled group.
Ambiguous or unsupported source profiles reject. It does not add another primary
unit Actor or infer a projectile visual from a damage effect alone.

```text
data effect.projectile id=PointLaunch sourceEffect=EMPLaunchMissile sourceActor=GhostEMPAttack impactEffect=PointSearch damageEffect=PointDamage impactModel=GhostEMPAttackImpactEffect
data ability.target id=PointAbility sourceAbility=EMP effect=PointLaunch button=PointButton range=8 energy=25 cooldown=5
```

Point/unit targeting remains owned by the selected ability template. Body
animation, flight, impact, sound, area filters and gameplay still require native
checks. These single-catalog recipes can share an adjacent compact authoring
group; the separate multi-file `data.batch` expander does not support them.

`data.actor.ability_animation` / `recipe.unitAbilityAnimation` binds ability phases
on one existing local main `CActorUnit`. It resolves the effective Actor Model,
reads actual M3 and declared supplemental animation assets in declared dependency
order, and rejects sequence names absent from those bytes. Imported map assets
take priority. Ambiguous overrides, unresolved parents, pending model drafts and
unverified ownership of existing ability-animation handlers reject before writes.
It preserves unrelated movement, weapon, death, portrait and other Actor fields.

```text
data actor.ability_animation id=PulseMotion actor=HeroActor unit=Hero ability=Pulse cast=Attack loopCast=true
```

Use a stable binding `id` independent of ability renames. `cast`, `channel` and
`finish` take actual space-separated model sequence names. Channel loops; cast
looping is explicit. Cast/channel stop and unit death clear owned labels. Finish
normally completes naturally and clears on walking; `clearFinishOnStop=true` is
an explicit alternative for phase-bounded playback. `replace=true` updates only
that binding's owned events. Default file is `ActorData.xml`; supply `file` when
the main Actor lives in another catalog. Save the complete Data transaction.

When retaining a native weapon, match the Unit, weapon and source Actor
presentation or explicitly adapt and verify their event/attachment bindings.
Having an `Attack` sequence alone does not establish compatibility. Test ordinary
attacks before and after the ability as well as movement and death. Native combat
or a new order can interrupt recovery; a declared finish duration does not prove
that its pose remains active for that entire duration. Scoped Ghost/Marauder
checks are retained in [the combat record](verification/native-combat-main-actor-2026-10-22.json).

`data.plan` pins the observed asset revision for apply. Local asset reads also
participate in staged-save stale guards. Missing/unresolved supplemental assets
retain partial coverage. The receipt deliberately says `nativePlayback=not_checked`:
available names and valid event bindings do not establish cast/channel/finish
playback, interrupted-cast cleanup or artistic suitability. Review those states
in the target engine/model. This recipe is single-catalog, not a `data.batch`
expander, and does not create a second primary Actor or infer suitable motions.

The animation receipt includes bounded logical asset resources, SHA-256 values
and installed build keys, including declared M3A supplements. A model's main M3
sequence list alone can omit movement supplied by such supplements.

The [native Ghost phase fixture](verification/native-unit-animation-phases-2026-10-22.json)
uses a finite channeled persistent effect, six50-damage pulses at0.5-second
intervals, one-second preparation and two-second finish. The main Actor binds
the installed Ghost `Spell A/B/C` sequences. Three fresh launches cover natural
completion, interruption after two pulses followed by a complete recast, and
movement during finish. The exact ordinary archive also passed original Editor
load/compile. Frames/video have scoped visual review; there is no native current
animation-name query or universal animation/art verdict. Death during channel,
other Models and isolated ability sound remain separate checks. Static recipe
receipts therefore remain `not_checked` for native playback.

The [recorded Snipe fixture](verification/targeted-data-quality-2026-10-22.json)
passed original Editor load/compile and two game launches on 5.0.17.98310, with
energy/damage/cooldown observations and separately reviewed target-impact pixels.
Its inherited cast delay is retained. Wait for actual damage before checking the
result; accepted order submission can precede execution. Mechanical/out-of-range/
insufficient-energy controls record bounded non-execution, not an explicit
engine refusal reason. Point targeting and other templates remain unverified.

`data.presentation.check({effects:["WaveDamage","DashEnd"]})` returns one bounded
review of declared Actor events, model links, host/site operations and sound-only
gaps. It is also available through `modkit.author`. Invisible helpers can be listed
as `invisible:[{effect:"Helper",reason:"Internal targeting helper"}]`. An exception
remains visible in the report. `declared_links_found` is not native playback:
inherited/tokenized events, macros, overlays and assets require further resolution.
Use this review after writing effect presentation; a sound Actor alone is not a
visual. Missing declared bindings are review findings, not universal proof of absence.
Bindings with an explicit TargetPoint location and `At Target` also return an
`eventScopeReview`: that unit-actor scope can suppress point-only visuals. This
is a review finding, not an error or a ban on unit-target bindings. The retained
triangle case uses a location-bearing effect Start and `SOpShadow`;28 actual
actors and rendered triangles were observed separately from this static audit.

`data.apply` also supports `recipe.unitActor` and `recipe.effectModel` (single
catalog transactions; the multi-catalog `data.batch` expander does not support
these recipes yet). The first copies a native actor's authored presentation and
GenericUnit template, retains its native class, rebinds unit selectors and pins
display/build/placement models. It avoids deriving a primary actor from another
concrete unit actor and adding a second UnitBirth Create. The known conflicting
pattern is rejected by `DATA_ACTOR_CONCRETE_PARENT_CREATE`. The second binds an
effect Start/Stop event to a native one-shot model bracket. It supports Source,
Caster, Target and Effect contexts, a selectable host, scale inheritance, site
operations, explicit orphan policy and a separate stopEffect/stopEvent. It merges
Actor, Model, Effect and related sound preloads into Preload.xml in the same
transaction, preserving existing entries. Both require `replace:true` to rebuild an existing
actor; replacement owns its authored fields. Source layer overlays, native event
execution and complete rendering equivalence are not simulated. Validate visual
behavior in the target engine; model/catalog existence is a static prerequisite.

- `data.context` — selective objects, declared/effective fields, parent chain, references, dependency provenance and diagnostics. With `ids`, `ctypes`, `domains` or `fields`, it returns only matching objects/files; `fields` also projects the returned field trees to keep token use small.
- `data.query` — batch search by id, C-type, domain, field, parent, native `Link` or invalid reference.
- `data.describe_type` — bundled plus active observed schema for a C-type. It works even before a map/dependency is mounted: the generated registry contains every C-type, object attribute and field path seen in the audited corpus.
- `data.apply` — up to 500 ordered operations in one atomic transaction, with aliases, validation, minimal diff, backup and dry-run.
- `data.validate` — L1 XML, L2 identities, L3 references and L4 inheritance/field checks. L5 Editor and L6 runtime are reported separately.

Normal Codex workflow: one `data.context`, then one `data.apply`. `data.apply` defaults to `dryRun: true`.

Strict authoring rejections return `isError:true` with `accepted:false` and the
bounded authoring diagnostics. No file is staged by a rejected transaction;
clients must not treat a returned JSON body or a later no-op save as success.

Native root token overrides are checked against declarations in the active entry
and its parent chain. For example, a GenericUnit template may declare `unitName`
as `CUnitLink`: a derived Actor can bind it to an existing Unit. The declaration's
type is retained in `tokenTypes`, including declarations without default values.
Unknown attributes, misspelled tokens and unresolved typed token links still fail
strict validation. Comments/CDATA do not authorize token attributes. This supports
native Actor recipes without globally allowing arbitrary XSD extensions.

## Operations

- `object.create`, `object.clone`, `object.rename`, `object.delete`, `object.setParent`, `object.setType`, `object.setAttribute`, `object.removeAttribute`
- `field.set`, `field.setLink`, `field.setAttribute`, `field.removeAttribute`, `field.remove`
- `array.append`
- `native.add` for exact native structures discovered in a real map or dependency
- `recipe.weaponBurn` — one compact operation expands to the native Damage → Buff → ApplyBehavior → Set → weapon carrier → Actor graph
- `recipe.unitTextureByVital` — one compact operation creates reversible health-threshold texture states for one or more model material slots

Fields use SC2-shaped paths such as `LifeMax`, `FlagArray[ArmySelect]`, `WeaponArray[0]`, or `CardLayouts[0].LayoutButtons[3]`. Unknown elements, attributes, comments, formatting and extension trees are retained. A clone is a byte copy with only the requested identity/parent change.

Rejected multi-catalog batches retain authoring diagnostics from every checked
catalog in the returned verdict. The brief error message is only a sample; review
the complete diagnostics before retrying a connected graph. Rejection still
writes no part of the batch and does not establish Editor/runtime acceptance.

The original Editor on build98310 exposes stock `GravitonBeamHeight` with
`Modification.PlaneDelta` values `Ground=-1`, `Air=1`. Authoring accepts signed
int8 deltas only on those two Buff modification fields; the bundled generic int8
facet is nonnegative. Other numeric fields retain their declared restrictions.

### Native Actor class and parent checks

Read the native Actor's `ctype` using `data.peek` or bounded `data.context`
before deriving it. A unit Actor is not necessarily `CActorUnit`: Liberty Reaper
is `CActorMissile`. Editor 5.0.17.98310 rejected the arena's former
`CActorUnit ArenaHero04Actor parent="Reaper"` as an incompatible parent.
`DATA_PARENT_CLASS_INCOMPATIBLE` now blocks this known invalid direction in
ordinary strict and compatibility writes and is an error in `data.validate`.
The effective-field view stops at that incompatible parent. The valid native
direction, `CActorMissile` inheriting the `CActorUnit GenericUnitBase` template,
is retained. The flattened Data XSD does not encode the full engine class tree;
other unknown class relationships are not certified or rejected by guesswork.

Repair an existing Actor with one guarded operation rather than deleting it:

```json
{"op":"object.setType","object":{"domain":"Actor","id":"ArenaHero04Actor"},"ctype":"CActorMissile"}
```

This preserves the catalog domain, ID, attributes, fields, comments and references;
only the enclosing XML tag changes. Cross-domain changes are refused. The final
catalog still goes through normal transaction validation. Editor/game acceptance
and object visibility require a new target check; a list of placed objects or an
offline terrain PNG is not that check.

## Atomic example

```json
{
  "file": "Base.SC2Data/GameData/UnitData.xml",
  "operations": [
    { "op": "object.create", "as": "hero", "ctype": "CUnit", "id": "CodexMarine", "parent": "Marine" },
    { "op": "field.set", "object": "@hero", "path": "LifeMax", "value": 250 },
    { "op": "field.set", "object": "@hero", "path": "FlagArray[ArmySelect]", "value": true },
    { "op": "field.setLink", "object": "@hero", "path": "WeaponArray[0]", "link": "GaussRifle" }
  ],
  "dryRun": true
}
```

If no Data component exists, the same transaction creates the catalog, registers `GameData/UnitData.xml` in `Base.SC2Data/GameData.xml`, and adds `<DataComponent Type="gada">GameData</DataComponent>` to `ComponentList.SC2Components`.

## Safety boundary

`parent`, `value`, `Link`, `index` and nested child elements are typed at the serialization level. The bundled registry classifies corpus-observed booleans, integers, numbers, enum candidates, token/expression values and catalog-reference candidates; it reports observed ranges, defaults, reference domains and confidence. `data.validate` checks those constraints and resolves both native `Link` plus high-confidence value-carried catalog references against the loaded dependency chain. Unknown semantics remain `UNKNOWN_NEEDS_RESEARCH`/preserve-only; the API never converts them to guessed fields.

Rename patches exact native `parent`/`Link` attribute values only. It never performs global string replacement. Delete is blocked by live native references unless `force=true`.

## Linked recipe example

The checked-in `examples/data/ReaperBurnAndDamageTextureApply.json` uses two semantic operations in one atomic `data.apply`: the Reaper impact applies a refreshing burn and the Reaper unit actor switches its `main.diffuse` texture below 40% Life, restoring the healthy texture after healing. The texture recipe requires explicit healthy/damaged DDS files because the exact innate material filename is model-specific and must not be guessed.

The health path is based on native corpus evidence: `CValidatorUnitCompareVital` inheriting `CasterLifePercent`, `Compare=LT`, fractional `Value=0.4`; a `CActorStateMonitor` evaluates the state at `StateThinkInterval`; state transitions send `TextureSelectById` to `_Unit`. Use generic operations after the recipe alias if additional native fields are needed in the same batch.

## Pre-Editor coverage gate

Run `npm run schema:audit:data`. The gate requires zero parse/round-trip failures, exact registry accounting for all observed types/fields, at least 1,000 Editor class candidates and at least 600 exact Editor field descriptors. The current snapshot is 529 XML C-types, 10,509 exact typed field paths and 1,277,381 field instances across 165,161 objects. This is 100% coverage of the audited structural corpus; L5 Editor acceptance and L6 runtime behavior are deliberately separate claims.

Atomic `data.batch` requests allow up to 1,000 operations across at most 48
catalogs. `preserveExistingErrors: {reason: "..."}` is an explicit exception for
unfinished imported maps: only identical baseline errors on untouched catalog
files may be retained. Errors on edited catalogs and newly introduced errors
still reject the complete transaction. The response keeps `validation.valid`
false and reports `validationDelta.retainedErrors` separately from blocking
errors. Acceptance does not claim a clean map, native compilation or gameplay.

Atomic batches retain the 500-operation per-catalog input limit. This accommodates
a connected private hero/technology graph without publishing half its links.
Dry runs, whole-group stale guards and compact report paging remain unchanged.
Native requirement subclasses such as `CRequirementCountUnit`, `CRequirementLT`
and `CRequirementAnd` belong to `RequirementNode`, separately from `CRequirement`.
Use that catalog when selecting/remapping their typed links.

## Compact compound recipes

Existing local graphs can be tuned without reconstructing them:

```text
data unit.configure id=Hero life=800 shields=100 speed=3 scale=1.4
data spell.configure id=Pulse damage=50 energy=20 cooldown=8
data spell.configure id=Burn damage=3 duration=240 period=2
```

These explicit updates share the normal guarded transaction and compatible
same-catalog grouping. Unit changes support life/shields/energy maximum and start,
speed, heroic and optional unique local main Actor scale. Spell changes support
damage, energy, private cooldown, target range and burn timing on an explicit
local compact-recipe graph. Omitted values, graph shape, targeting, command cards,
Actor animations, unknown XML and manual fields remain unchanged. Ambiguous,
inherited-only or unsupported graphs reject. Creation tools remain creation-only;
configure tools neither create missing objects nor silently replace a graph.

Use `modkit.author_help` with `section=data` for the short guide. The MCP envelope
remains structured JSON, but the author writes a command string rather than
nested XML/operation JSON. Existing detailed tools remain available.

For example, send these lines in one `modkit.author` call with `mode=plan`,
`stage` or `save`:

```text
data unit id=Hero from=Marine life=600 scale=1.2 heroic=true
data spell id=Pulse kind=pulse unit=Hero slot=11 damage=40 radius=4 model=ImpactModel face=EMP energy=25 cooldown=5
data spell id=Rift kind=line unit=Hero slot=11 damage=48 count=9 model=ImpactModel face=EMP delay=1.4 warningModel=WarningModel
```

`ImpactModel` and `WarningModel` are placeholders for exact existing Model IDs;
`face` is an existing Button ID. Mount the map's declared native dependencies
first. Optional `file` selects a common local catalog; recipes bind the local Unit
in that same catalog. Compatible adjacent commands share one strict `data.apply`
and one save of the entire catalog/registration/preload transaction. A later
collision or unresolved reference rejects the whole group before staging. Distinct
groups in one author script remain sequential rather than globally rolled back.

`data.unit.copy` is also available as a typed tool and `recipe.unitCopy` as a
`data.apply` operation. It derives a Unit from `from`, detects a unique native
main Actor on a GenericUnit parent, pins source asset identities, and retains
movement/attack/death presentation fields. Optional life, shields, energy, speed,
scale and heroic are scalar overrides. Existing weapons, abilities, upgrades and
morph forms are **shared**, not recursively duplicated. Ambiguous declarations,
unsupported concrete Actor layers and existing target identities reject.

`data.spell` / `recipe.spell` supports:

| Kind | Native mechanics | Additional scalar parameters |
| --- | --- | --- |
| `damage` | One targeted spell hit and attached impact Model | `range` |
| `pulse` | Caster-centered enemy-ground search | `radius` |
| `line` | Aimed cells with one delayed search per cell | `count`, `spacing`, cell `radius` |
| `ring` | Aimed ring with an open sector | `count`, ring `radius`, `gap` in degrees |
| `burn` | Single refreshable native buff with periodic damage | `duration`, `period`; `damage` is per tick |
| `projectile` | Native missile travel, impact damage and presentation | Required exact `sourceEffect`, `sourceActor` templates |

Area cells use a short spell-owned overlap lock. A positive `delay` requires
`warningModel`; warnings end with a native Actor timer. Impact actors use the
existing effect-model lifecycle and preload writer. Optional `sound` is an exact
Sound ID with a native cast Actor and preload entries. No new main unit Actor is
created by spells. Optional `unit` plus `slot=0..14` binds a 3x5 command card;
`page` defaults to0. Known inherited cell/face conflicts still reject.

Execution templates default to `Stimpack` for pulse, `EMP` for line/ring and
`Snipe` for damage/burn/projectile. `sourceAbility` explicitly changes the native
template; its target filters, validators and cursor behavior remain inherited. Changing a
template is a gameplay decision, not a generic unit/point coercion. Labels, icon
and hotkey inherit `face`; use the text/Data tools for distinct localized UI when
mechanics differ. Optional `cast`, `channel` and `finish` use inspected real
sequence strings on the bound unit's existing main Actor, in the same atomic
spell transaction. `actor` explicitly selects it when needed; `loopCast` defaults
to false. These options require `unit`; a missing sequence rejects the complete
group, including the spell, card and preloads. The separate
`data actor.ability_animation` tool remains available for existing abilities.

For projectile spells, inspect an exact `CEffectLaunchMissile` and its matching
`GenericAttack` Action Actor first. The supported profile keeps native ammo,
mover, missile Actor/Model and inherited sounds, and rebinds launch, impact and
damage events to the new IDs. Unsupported/ambiguous profiles reject; the command
does not guess a projectile from a Model filename. The compact projectile is
unit-targeted and explicitly sets launch `ImpactLocation=TargetUnit` for its
direct damage. Source validators remain inherited and may restrict valid targets.
Use the detailed projectile/area recipes for point-impact searches. For example,
with inspected catalog and M3 identities:

```text
data spell id=Bolt kind=projectile unit=Hero slot=12 damage=40 model=ImpactModel face=Snipe sourceEffect=NativeLaunch sourceActor=NativeAction cast=Attack
data.unit.presentation unit=Hero
```

The identifiers above are placeholders. `data.unit.presentation` returns a
bounded repair shortlist for explicit primary Actor/Model, inherited weapons,
stale `WeaponStart` animation selectors and common effect execution links.
`data.presentation.check` inspects selected effects, including explicit
GenericAttack selectors and named missile/beam Model links. Both are declared
profile audits: a resolved link does not prove model loading, animation, sound
or visible impact. Native frames and timed gameplay observations remain required.

These are creation-only presets. Detailed tools author nonstandard graphs or
modify existing entries. Up to500 **expanded** native operations may share a
Data apply. Missing dependencies and unsupported profiles remain errors. Static
checks do not certify native playback, targeting, art quality or balance.

The [2026-10-30 scoped presentation workflow record](verification/presentation-workflow-2026-10-30.json)
contains public-MCP authoring, native Editor load/compile, one observed projectile
hit and separate frame-review evidence. Timed animation/VFX and audible sound
remain unverified by its camera-only still.
