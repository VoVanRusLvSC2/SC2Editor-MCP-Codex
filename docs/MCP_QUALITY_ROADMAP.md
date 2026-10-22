# MCP quality roadmap

Status: implementation plan based on the local source audit of 2026-10-21.
The folder-policy correction and the initial `project.test.*` workflow are
implemented. Marine/Marauder route observations have new live evidence; the full
acceptance corpus and remaining phases below are still open. See
[current test contract and evidence](PROJECT_TESTS.md).

Execution ledger:

- Explicit-target runtime GUI registration now uses a separate `Registration`
  call and typed trigger-element/variable/parameter expressions. The native
  Action signature keeps original argument binding and Action/body position;
  it does not add ScriptCode or treat an ordinary Event as an Action. Static
  API-to-GUI identity checks accept108 native signatures and explicitly reject
  four unverified bindings. Original Editor generation/compile preserved the
  destination/timer/local/array call. Two ordinary-map game launches passed the
  selected-receiver, wrong-receiver, phase7, exactly-one callback, wrong-timer and
  library controls. Full regression:1426pass/1skip; focused:36pass; build/release,
  lint and English checks passed. The356-file local candidate passed9970-entry
  privacy comparison against1113 private sources. The save/reopen handler remains
  live beyond its observation deadline; exact saved-artifact parity/execution
  is not accepted. Do not restart that worker on a timeout. See
  [registration evidence](verification/native-runtime-registration-2026-10-23.json).

- Native Learn progression now passes two frozen-runtime launches: three point
  profiles,30 Learn orders,14 causal damage/energy/completion casts and14 XP kills.
  Rank effects10/20/35 and energy1/2/3, level gates, exhausted points, per-level
  points and maximum rank were checked through native state and real execution.
  The original hidden Editor loaded the Data and generated/compiled Galaxy.
  A separate read-only named-XP observer exposed Core's map-wide recipient search:
  radius10 divided50 XP between three nearby heroes; behavior ShareFilters alone
  did not fix it. Radius0 gave the killer50 and both controls0. New explicit
  `data.xp.search` configures this map-wide policy, preserves unrelated fields and
  rejects a conflicting second catalog owner. Hero recipes no longer promise
  solo rewards from behavior fields alone. Full regression:1422pass/1skip;
  focused:30pass; build/release/lint/English checks passed. The355-file candidate
  passed9968-entry privacy review against1113 private sources and remains local.
  Command-card frames were reviewed; real UI activation, larger talent systems,
  isolated sound, finished art, GUI runtime registration and native navigation
  remain open. See [Learn/XP evidence](verification/native-learn-xp-2026-10-23.json).

- Added `game.action`: one bridge-serialized workflow drains returned history
  cursors, submits one normal order/UI activation and observes exact event fields
  at or after the action time on the same stream. Ability damage binds the
  ordered caster, and native completion is awaited by default. Ambiguous action
  responses are never retried; private page/response receipts are retained.
  Two frozen-runtime launches of the unchanged charge fixture passed six casts,
  life500→380 and energy100→97 per launch. Full regression:1410pass/1skip;
  focused:71pass. Native multi-page histories and real UI activation through the
  new wrapper remain unverified; synthetic pagination/identity/transport tests
  pass. It is separate from the upstream `game.test.run` scenario vocabulary.
  Exact cast-instance attribution, broad Data/GUI/navigation and final art remain
  open. See [action-event evidence](verification/action-events-2026-10-22.json).

- Added `data.ability.charges` / `recipe.abilityCharges` and compact commands,
  owning only the direct native Charge subtree. Initial recovery now retains a
  partial stock; finite partial/empty starts use the native initial-timer sentinel.
  Execution recipes own AbilSetId and target ranges explicitly override level0.
  Two frozen-runtime launches of the exact ordinary archive passed nine target
  profiles:38 causal40-damage casts with native completion and24 blocked orders.
  Four pool scopes, timed recovery, disabled charge gating, spend-two and finite
  stock controls passed. Fixture prerequisites are explicit: active player2 and
  sight32. Test observations now drain paged history before each action, check
  caster/time and await native finish rather than equating damage with readiness.
  Earlier failures and confounded probes remain retained. Full regression:
  1399pass/1 skipped shell fixture; no failures/cancellations. The unchanged local
  runner passed9963-entry privacy comparison against1113 private sources. It is
  unpublished; diagnostics remain partial. Instant/cross-ability/nonqueued/cooldown
  variants, learn/talent, authoritative navigation, finished art/UI/balance and
  explicit-target GUI registration remain open. See
  [charge/range evidence](verification/native-charges-range-2026-10-22.json).

- Added `data.effect.projectile` / `recipe.projectileEffect` and the compact
  command for the observed GenericAttack/GenericAttackMissile profile. It keeps
  native ammo/mover behavior, rebinds launch/impact/damage, pins missile/impact
  Model/sound links and couples preloads. Two frozen-candidate launches passed
  point casts,40 damage to both affected targets, an untouched outside control,
  energy100/75/50, early-reuse blocking and natural cooldown recovery. Both flight
  and impact frames were reviewed; matching Action/Missile/impact Actor instances
  were destroyed after both casts. Mixed audio is nonzero; isolated sound and
  exact main-unit animation-name playback remain separate. The unchanged Ghost
  Unit/Model/main Actor profile retains native attack handling.
- That fixture exposed a placement prerequisite: Y50 exceeded its64x48 terrain
  and the engine placed units at47.9998. MapInfo playable top40 is a different
  boundary. New Unit add/batch/move plans now check supported MapInfo pivots,
  expose an intentional outsidePlayableReason exception, and pin binary MapInfo
  through staged save. A real MCP request rejected the old coordinate; five
  MCP moves to central Y26 corrected only Objects. Data/GUI/script/terrain bytes
  stayed unchanged. The first attempted repair at exclusive top40 also rejected.
  Full regression at concurrency4:1392pass/1skip, zero failures/cancellations.
  The earlier unbounded run's15-second stdio timeout remains retained. The
  current local candidate passed9961-entry privacy comparison against1113 private
  source files, zero violations, with no publication or SDK modification. See
  [point/projectile and boundary evidence](verification/point-projectile-bounds-2026-10-22.json).

- Added public `game.startupEvents` manifest observations: read retained event
  pages, follow only returned cursors and then poll for future events. Session,
  epoch and map-load changes invalidate observation; missing events remain
  inconclusive. Optional native vital/area readiness avoids a fixed delay. Two
  clean launches of the unchanged306-element GUI fixture passed save/reopen,
  exact-artifact recompile, a death event already present in the first history
  page, real Dialog clicks and independent44/23 callback markers. The general
  runner changed; the map and private SDK did not. Full regression:1382pass/1skip;
  focused checks:48pass. A frozen local candidate passed a9959-entry privacy
  audit against1113 external source files with zero violations. It remains
  unpublished. Earlier event timeouts are retained; broader imported semantics,
  launch coverage, Data profiles, native navigation and finished art remain open.
  See [startup-history evidence](verification/startup-history-2026-10-22.json).

- A fresh twelve-orientation Agria junction matrix passed56 Marine/Marauder
  traversals on two launches, including concave bays, a narrow high neck, the
  supported two-cell edge margin, a deliberate courtyard/island and level2/3
  ramps. Native detail and opposite-face images were reviewed; an oriented
  overview shows every map edge. Earlier clipped frames and distance260-to4
  readback remain retained. No new geometry algorithm was needed for these
  supported cases. See [junction evidence](verification/native-junction-matrix-2026-10-22.json).
- Reusable tests now forward native scope/context/locale and expose bounded
  phase errors. Saved-artifact validation follows the exact retained worker
  identity, preserving the concurrent compact-path change and rejecting sibling
  worker output. Build, lint and85 focused tests passed. A frozen local package
  passed native GUI save/reopen, exact payload preservation, recompile and typed
  gameplay; real UI clicks passed on both events runs, but startup-death waits
  stayed inconclusive. Omitting a wait cursor creates a fresh baseline; generic
  retained-startup observation remains open. The package's initial private-source
  audit found zero violations against60 installed external source files; this is
  not the earlier broader private corpus or final publication acceptance. See
  [current context evidence](verification/gui-context-roundtrip-2026-10-22.json).

- Completed the declared representative GUI native roundtrip profile on two
  fixtures and three fresh game launches. Original Editor save/close/disk reopen
  preserved all174/306 GUI Elements and byte-identical Triggers/MapScript payloads;
  exact native-saved archives were recompiled and executed. Library/type/array
  cases and real Dialog/event callbacks passed. An earlier stalled save handler
  remains an unexplained retained failure; this is scoped acceptance, not a claim
  of universal imported-library compatibility or general launch stability. See
  [native roundtrip evidence](verification/gui-native-roundtrip-2026-10-22.json).

- Added scoped ordinary-weapon combat acceptance for matched native Ghost and
  Marauder Unit/Weapon/main Actor profiles: two clean launches,61 cases, movement,
  weapon damage before/after a finite channel, six50-damage pulses and confirmed
  main Actor destruction. Body recoil/movement/death frames were reviewed and the
  exact archive passed original Editor load/compile. The verifier now journals
  returned MCP replies and case transitions before final shutdown; interruption
  retains observations without claiming acceptance. Earlier camera/capture-count
  failures and an unexplained frontend exit remain retained. See
  [combat lifecycle evidence](verification/native-combat-main-actor-2026-10-22.json).
  This does not certify arbitrary mismatched Unit/Weapon/Model combinations,
  exact native animation-name queries, isolated sounds or general launch stability.

- Main Ghost Actor death during channel passed two clean launches and all41 suite
  cases. The native destructor observation matched the created Actor instance;
  damage stopped at100, then a replacement completed300 more. Added guarded
  optional external game evidence storage. Compatible adjacent same-catalog Data
  commands now share atomic validation/apply/save: a real warm no-op comparison
  reduced three commands from82.3s/6 internal calls to37.5s/2, with source bytes
  unchanged. Byte/call metrics are not billed-token savings. Full regression:
  1359pass/1skip, followed by7 focused lifecycle checks. See
  [death and grouping evidence](verification/main-actor-death-data-groups-2026-10-22.json).
  Broader Models, combat transitions, startup and final portable acceptance remain
  separate; older source fingerprints are preserved.

- Verified a finite native channel on the main Ghost Actor with installed
  `Spell A/B/C` and the declared Ghost M3A supplement. Three clean launches cover
  six pulses totaling300 damage, cancellation after100 damage with no later
  ticks, full recast for300 more, and normal movement during finish. The exact
  archive passed original Editor load/compile. Added high-level indexed
  `castOutroTime`/`finishTime` alongside `castIntroTime` and bounded asset-resource
  hashes in animation receipts. Full regression:1350 pass/1 skip. Native pixels
  were reviewed; exact current-animation-name readback, death interruption,
  other Models, isolated ability sound and final art remain open. SoundDecoder
  observation is unavailable with MH_ERROR_MEMORY_PROTECT; mixed audio capture
  still works. No private SDK/source publication or SDK edits occurred. See
  [native phase evidence](verification/native-unit-animation-phases-2026-10-22.json).

- Added `data.actor.ability_animation`, the Data operation and compact command.
  The main Actor's effective Model resolves to actual imported/installed M3 and
  declared supplemental assets; saved plans pin that asset revision. Unknown
  sequences/parents/ownership reject, local asset changes block staged save, and
  a native-model MCP repeat is byte-identical. Native movement/progression passed
  twice, original Editor load/compile passed, and scoped cancellation/completion
  recordings are retained. Pixels show a pose/orientation change and recovery;
  exact channel/finish playback and artistic suitability are still unverified.
  Full regression:1349 pass/1 skip. A separate unpublished portable has28 checked
  compiled files and zero private-source audit violations. One recording request
  used an unsupported argument; its failed suite and corrected completion retry
  remain explicit. See [main Actor evidence](verification/main-actor-animation-2026-10-22.json).

- Added read-only `data.card.check` and inherited-card guards for instant/target
  recipes. Known slot/cell/shared-face conflicts reject before staging; explicit
  conditional reasons cannot waive an occupied slot or unknown inheritance.
  Literal zero speed with movement commands produces an availability warning.
  A distinct localized button, corrected tooltip and proportional feedback were
  authored through MCP. Two new launches verified movement out/back and the
  full native XP/stat sequence; original Editor load/compile passed. Reviewed
  recording shows nine command icons, no hotkey modal, useful camera framing
  and a small level burst. Full tests:1328 pass/1 skip. Main-unit ability animation,
  other ability profiles and finished art remain open. See
  [card/availability evidence](verification/data-card-quality-2026-10-22.json).

- Added native `data.hero.veterancy` / `recipe.veterancy` and compact CSV thresholds.
  Native Data owns kill XP, levels and cumulative life/damage deltas. The generator
  now converts cumulative thresholds to transition costs and avoids a duplicate
  zero row that would start at level2. Two clean launches verified levels1/2/2/3
  at cumulative XP0/50/100/150, life1000/1100/1100/1200 and damage500/505/510.
  Original Editor load/compile, guarded compact no-op and 1318 regression passes
  with one skip passed. Level feedback and native HUD are visible in an extra
  recording; that technical UI has a reused-button hotkey conflict and a partly
  clipped large effect, so finished presentation is explicitly not accepted.
  See [native veterancy evidence](verification/native-veterancy-2026-10-22.json).

- Added `data.ability.target` / `recipe.targetAbility` / compact target command.
  An explicit same-class native template retains filters, cursor and cast timing;
  the recipe sets effect/button, Data costs/cooldown, optional range and indexed
  local command-card binding. Local templates are no longer counted twice.
  An exact Snipe-based archive passed original Editor load/compile and two clean
  game launches, including bounded mechanical/range/energy controls, damage,
  energy cost, early reuse and cooldown recovery. Waits observe actual damage
  after the order cursor. The old instant archive also passed two new launches;
  current-writer no-op preserved its declaration in the new map. One additional
  presentation launch has reviewed target-impact pixels and nonzero owned audio.
  Native order acceptance is only submission, including for the negative controls.
  Full tests:1316 pass/1 skip. Point-target, charges, progression and full ability
  presentation design remain open. See
  [scoped Data evidence](verification/targeted-data-quality-2026-10-22.json).
- Added a digest-bound record inventory through `npm run evidence:status`.
  Historical source drift remains visible; source matches never upgrade partial
  roadmap coverage. Invalid record digests/paths/empty coverage reject, and
  `--require-ready` exits 2 while required work remains. The old broad
  `evidence:check` gate still fails its historical drift; it was not waived.

- Added regional native topology to the existing owned landscape intent: bounded
  cliff strokes and cardinal width-four ramps, semantic XML row ownership,
  masked CLIF/LFCT preimages, one-time foundation preparation and guarded ancestor
  object resnap. Removing/rebuilding one plateau preserves the independent region.
  Three exact MCP exports passed six clean launches and 48 Marine/Marauder route
  traversals; inspected detail frames show filled ramps and closed wall caps.
  A separate rotated overview improves framing; the original clipped overview is
  retained as unsuitable. This is technical topology evidence, not final art.
  A catalog cache fix avoids reindexing GameData after native terrain XML edits:
  observed warm plans take about 1–2 seconds on this fixture. Cold catalog parsing
  and general navigation/buildability certification remain separate. See
  [scoped ownership evidence](verification/landscape-native-ownership-2026-10-22.json).

- Fixed a prerequisite for owned native topology: ordinary height operations no
  longer add native cliff/ramp displacement to SMAP a second time in mixed plans.
  Native-only plans also report actual changed vertices. A reproduced old batch
  differed from sequential execution at 186 sync vertices; the corrected fixture
  differs at zero. Two fresh MCP-generated component sets match, with two clean
  launches, eight corridor-bound Marine/Marauder traversals and reviewed views.
  Native list/cell metadata is retained; unhandled nested payload rejects instead
  of being discarded. Regional ownership was added in the later checkpoint above.
  See [operation-order evidence](verification/terrain-operation-order-2026-10-22.json).

- Extended original-GUI evidence: two exact archives, four clean game launches,
  native library coexistence, loops/branches, structures, local/global arrays,
  presets, function parameters/defaults/returns, real Dialog button callbacks,
  EventPlayer/EventDialogControl, a per-player array and an EventUnit death handler.
  Original generation and final-archive load/compile passed. The separate complex
  typed-core save/reopen handler remains pending; it is not covered by these
  gameplay passes. A later representative roundtrip checkpoint above now covers
  that same typed-core source and the events fixture. Missing-dependency preflight and a real readiness timeout also
  behaved as expected, including cleanup. See
  [scoped GUI and negative-startup evidence](verification/gui-core-events-2026-10-22.json).

- Added and engine-tested: reusable `data.ability.instant` / compact authoring
  recipe from a verified native execution template, explicit command-card indices,
  Data costs and unit cooldown. Two launches verified damage, energy expenditure,
  early-reuse protection, cooldown recovery and a second cast. Native model/sound
  actors were observed; a recorded frame review showed the effect and the owned
  process audio capture contained nonzero PCM. This is one scoped ability fixture,
  not universal ability/presentation coverage. Strict Data rejections now carry
  MCP error flags, inherited typed token attributes validate, compact placement
  uses the actual plan identifier, and suite assertions no longer ignore `equals`.

- Diagnosed and fixed the old foundation load failure: a restricted MCP repair
  restores singular SMAP Q12 scales and a missing empty cliff allocation while
  preserving all surface/gameplay payloads. The original library-qualified GUI
  startup ran twice after this minimal repair and produced the expected 42 HP.
  Exact-archive load preflight now rejects known invalid structures before
  starting native workers and rechecks native-saved artifacts by digest. Unknown
  transformed profiles remain unverified. This closes this specific startup
  defect, not the full GUI/type/topology corpus. See
  [digest-bound evidence](verification/terrain-load-startup-2026-10-22.json).

- Implemented: manifest/file planning, five job/report/cancel tools, digest guards,
  reuse of existing native bridges with a workflow lease, named bidirectional
  routes, bounded scenarios, cleanup, compact CLI and MCP image delivery.
- Implemented and live-tested on a GUI/Data fixture: native-saved artifact selection,
  owned-path/hash checks and load/compile revalidation before game launch. The
  full startup/dependency/GUI corpus, authoritative
  navigation/buildability queries and topology matrix remain open.
- Updated: Editor pin 0.10.0-rc.1 and generic access to all 18 native methods;
  discovery and scoped Vulkan core/image/game-artifact checks passed. The initial
  unconfirmed startup failure and a poor camera fixture are retained. Updated ModKit
  image/model extension sources and tested Data/navigation/preview through MCP.
- All 18 Editor methods have actual fixture calls, including GUI XML conversion,
  cutscene timing/frame and silent video. Deep report fields are paged through
  `editor.job(details)`. Audio/FaceFX/link variants remain open.
- Updated: private GameToolkit pin v0.1.0-dev.11, complete manifest verification,
  native UI discovery/filtering/handler activation and render-backend forwarding.
  All 18 game operations passed an extended known-foundation MCP check, including
  a silent recording. Public distribution excludes the private runtime and test
  libraries. This does not close the general startup/topology/ability corpus.
- Existing landscape functionality is retained: zones, roads, textures, measured
  decor, location creation and combined terrain/object transactions. Further work
  connects and reviews these tools; do not replace them with a second generator.
- Added: exact-archive playable-bound preflight with bounded neutral component
  reads and per-digest caching. First cliff sync correction matches 396 native
  reference cells across 12 orientations; reviewed convex/small-plateau game
  frames and high-pad placement/movement passed. Canonical fine-vertex/SMAP
  normalization preserves coarse corners and base heights; a subsequent concave
  placement/render check passed. Arbitrary junction repair and generated
  ramp/collision acceptance remain open beyond the restricted fixture below.
- Implemented and live-tested: cardinal ramp direction enum corrected against
  original native frames; four reviewed closed ramp views and 32 corridor-bound
  Marine/Marauder ascent/descent checks over two clean launches on one exact
  Agria archive. Bounded cliff normalization and diagnosed legacy ramp-direction
  repairs use ordinary guarded MCP transactions; repeat commands preserve bytes.
  Native navigation rebuilding and arbitrary profiles remain unconfirmed.
- Connected: polygon location areas, explicit road reservations and a whole-stroke
  containment guard. Decoration clearance here covers pivots only. Whole-location
  height/texture/object ownership and explicit overlay dependencies are now
  implemented through the existing location generator. Equal requests are no-ops;
  parent changes rebuild their dependants in one guarded transaction. Incremental
  native cliff/ramp ownership is covered by the later restricted checkpoint above;
  broad topology profiles and final aesthetic approval remain open.
- Added: ordinary fine-height editing bounds in foundation planning and terrain
  analysis. Decoration-only passes can preserve both height and texture channels,
  including guarded empty terrain plans, so adding trees does not erase authored
  soil/clearings. Explicit read-only Actor measurement also supports Unit/effect
  geometry without weakening Doodad placement eligibility. Engine animation,
  footprint and presentation acceptance remain separate.
- Connected measured infrastructure/groups to that same owned location intent.
  Existing prefab members can flow through internal MCP batch references. All
  terrain overlays finish before placement; affected ancestor height resnaps are
  guarded. Slots retain group IDs when scatter counts change, unrelated older
  records survive partial migration, and member rectangles cannot bridge across
  roads/concave boundaries. Native traversal and reviewed views passed on the
  regional forest fixture. Three fresh style fixtures now also passed six clean
  launches, 48 corridor-bound traversals and 18 native view captures in one
  retained game bridge. All first-run views were reviewed. They are technical
  composition examples; final aesthetic approval and finished mission quality
  are not claimed. See [recorded checkpoint](verification/landscape-groups-2026-10-22.json).
- Added: named `game.views` in the reusable test manifest, with camera readback,
  bounded UI-free PNGs and digest-checked image selection through MCP. The first
  forest fixture passed native overview/detail capture and bidirectional movement;
  its sparse transplanted composition is not aesthetic acceptance. Landscape
  texture/decor passes can explicitly preserve existing height channels.
- Corrected measured-member support sampling: new prefab bounds declare their
  member frame and apply placement scale/member rotation before the group
  transform. Legacy pre-oriented group bounds retain their prior semantics.
  Geometry regressions and a real CASC prefab MCP request passed; native whole-
  group footprint/render acceptance remains separate.
- Improved: tracked Browse cache replays verified content/draft/directory reads
  into transaction guards instead of recomputing every effective catalog object.
  Objects/Triggers consumer references remain in the separate Data tools. A real
  warm three-zone MCP fixture improved its no-op request from 51.87 s to 2.46 s,
  and a parent/overlay update from 55.28 s to 4.94 s. These are scoped timings,
  not model token/billing measurements or cold-start guarantees.
- Added: bounded `data.presentation.check` declared-event/model review with
  explicit invisible exceptions. Actual ability presentation still needs the engine.
- Implemented: reviewed GUI imports can use a successful original map-root
  conversion from the same session, with XML/runtime/template context guards and
  library-qualified references. Broader library/type acceptance and the complete
  quality/performance corpus remain open. Five folders remain a recommendation.

## Outcome

Let an author describe locations, circulation and visual intent, then generate
and verify a playable map through MCP without writing one-off server scripts.
Reuse the current ModKit preview, terrain transactions, measured compositions,
GUI authoring and optional native Editor/Game bridges. Better results require
both reusable design recipes and a feedback loop; more random objects or a new
renderer alone will not deliver the desired quality.

## Current implementation and specific gaps

| Area | Existing implementation | Gap to close |
| --- | --- | --- |
| Landscape | Zone/road/texture tools, `terrain.generate`, `terrain.landscape.plan`, measured groups and `placement.createLocation`; named location ownership and atomic terrain/Objects/ledger updates; three fresh native-reviewed style fixtures | Native cliff/ramp ownership and final art refinement remain separate. Preserve height/texture channels explicitly for decoration-only passes. |
| Composition | `terrain.style`, measured palettes, `terrain.prefab`, `terrain.assemble`, `terrain.compose`; owned objects, exclusions and stale guards | Whole-location hierarchy, texture transitions, protected circulation and consistent visual review still need orchestration. |
| Native geometry | `nativeGeometry.ts` implements a measured cardinal width-four ramp profile and restricted cliff edits | Unsupported topology must remain explicit. Organic joins, narrow holes, other ramp profiles and engine navigation are not universally verified. |
| Navigation | `terrain.navigation.preview` estimates routes with terrain/catalog footprints; pathing paint and native component access exist | Static reachability is not the game's pathfinder, collision or buildability result. No explicit general native navigation rebuild operation is exposed by our bridge. |
| Editor checks | Native loading, compilation, save/reopen, diagnostics and images on private snapshots | A checked snapshot is not automatically the delivered archive. Saving/reopening is not proof of navigation rebuilding. |
| Game integration | Direct bridge plus `project.test.*` manifests, named routes, retained sessions and digest-bound reports; Marine/Marauder arrival observed | The old Phoenix verifier remains an adapter smoke test. Full startup/topology coverage, authoritative movement-plane/path queries and final native artifact adoption are open. |
| GUI | Typed calls, declarations, folders and original map-root compilation/adoption with library-qualified IDs; native save/reopen preserves exact GUI/script payloads; typed runtime and real Dialog clicks passed; retained startup death and final callback markers now pass twice on the unchanged events fixture; folder count is flexible | Other library/type/control variants, runtime registration/reference semantics and imported third-party semantics remain outside this corpus. An earlier save-handler stall remains unexplained. |

Source locations: `src/modules/terrain/{recipes,workspace,nativeGeometry,
modkitWorkspace,schemas,tools}.ts`, `src/modules/placement/compositions.ts`,
`src/app/{authoringTools,authoringScript}.ts`, `src/modules/trigger/revisedImport.ts`,
`src/integrations/{game,native}/`, and `scripts/verify-native-game.mjs`.
See [verification scope](VERIFICATION.md) and [game evidence](NATIVE_GAME.md).

## Delivery order and acceptance gates

### 1. General test manifest and reliable launch orchestration

Keep the current verifier as a named adapter smoke test. Add a typed map-test
manifest, a planner and a bounded job runner using the existing bridges.

Implemented entry points (initial supported scope is in PROJECT_TESTS.md):

- `project.test.plan`: resolve map, dependencies, build, capabilities, named
  points/regions/placed-unit selectors, suites and expected diagnostics. Return
  required inputs and unsupported checks before starting a worker.
- `project.test.run`: execute the resolved plan against an identified archive.
- `project.test.status` / `project.test.report`: compact progress and bounded
  evidence retrieval. A run returns promptly with a job ID.
- `project.test.cancel`: request orderly cleanup at a supported boundary; never
  force-kill an active native handler.

Implement shared test records under `src/modules/testing/` and compose existing
`editor.*` / `game.*` methods. A saved final archive, dependency identities, test
manifest, instrumentation version, runtime build and relevant settings identify
a result. Any content change invalidates claims about that exact map revision.
Use explicit states: passed, failed, unsupported, inconclusive and not_checked.
A required unsupported check prevents acceptance; an optional one remains visible.

Execution stages: static preflight, native load/compile, optional native saved
artifact adoption, exact archive hash, private game launch, identity handshake,
map-defined startup readiness, assertions, capture and owned-session cleanup.
If native serialization/export changes the archive, hash and test that artifact;
do not transfer a pass from the previous snapshot. Preserve the authoring source.

Classify missing dependency, compilation, launch, handshake, readiness timeout,
runtime failure and cleanup failure separately. Report new errors since a cursor;
expected warnings use exact, versioned rules rather than hiding all Actor messages.
Do not retry gameplay mutations after an ambiguous response.

Acceptance: repeat two clean launches per supported fixture; include Galaxy and
GUI startup, custom Data and a dependency-backed map. Negative fixtures must
exercise compile failure, missing dependency and readiness timeout. Verify source
hashes, fresh evidence, cleanup and absence of unrelated-process interference.
These fixture classes define supported scope, not universal map compatibility.

### 2. Ground movement and topology regression fixtures

Introduce named positive routes, expected blocked crossings and reserved building
pads in the test manifest. Select actual available unit types and valid endpoints
from the target catalog/map. Never silently substitute a flying unit.

For positive routes, sample movement until arrival or a bounded failure and retain
the trajectory, duration and a relevant frame. Test both directions, narrow gates
and at least two ground footprints where supported. Check formations separately
from single-unit movement. Disable or account for combat/control interference in
isolated fixtures; otherwise report an inconclusive path test.

For blocked crossings, distinguish an explicit engine path result from a timeout.
A timeout alone cannot prove a valid obstruction. Placement/buildability and
collision checks require authoritative query support; unavailable queries remain
unsupported. Painted pathing, static search and game movement are separate fields.

Build a differential corpus of native Editor-authored components: inner/outer
cliff corners, one-cell pockets, short islands, map edges, multiple cliff sets,
supported cardinal and donor-based diagonal ramps, width variants and joins.
Compare coherent height/cliff/holes/sync components, then native images and live
ground traversal. Do not compare unrelated serialization bytes as geometry proof.

Repair only diagnosed generated topology with ownership and a preview. A deliberate
hole, playable depression or manually edited ledge must not be filled merely
because it resembles an earlier broken cell. Reject an unverified geometry profile
or propose an explicit supported alternative; never claim an approximate ramp is
native-equivalent.

Acceptance: supported cases pass structural, native visual and traversal checks;
unsupported cases fail before mutation. Include regressions for the observed
cliff caps/holes and editor-visible placed objects. Run the same checks on a newly
generated map, not only a repaired historical map.

### 3. Connect and improve the existing location workflow

Reuse existing zones, roads, textures, composition tools and the atomic
`placement.createLocation` terrain/object path. First identify missing connections;
do not rewrite those systems. Where the current entry points need shared intent,
extend `terrain.landscape.plan` without replacing its legacy recipe or codecs.
The shared intent should connect:

- Biome, tileset, seed, visual theme and explicit preservation policy.
- Named zones with purpose, outline, elevation tier, construction condition,
  gameplay density and focal anchors.
- Connections with endpoints, minimum clear width, traffic role and allowed
  elevation transition. Reserve routes before placing decoration.
- Supported native cliff/ramp profiles, protected water and manual edits.
- Texture roles and transitions, palette references and measured composition
  recipes. Resolve every ID against the target dependencies.
- Acceptance requirements: route pairs, building pads, visibility/readability
  viewpoints and maximum permitted unresolved issues.

Generate in dependency order: circulation/reservations; macro heights; native
cliff levels and transitions; textures; infrastructure anchors; clustered large
and medium decor; small accents/foliage; object resnap; validation and preview.
Smooth hills and discrete cliff levels remain separate concepts.

Use regional texture masks based on function, slope, moisture and wear, not one
base texture plus noise everywhere. Compose a few strong landmarks, coherent
infrastructure and uneven clusters with quiet spaces. Avoid both a uniform green
carpet and arbitrary use of every available texture. Style profiles should set
defaults, not mandatory decor counts or damage/fire everywhere.

The plan owns a dependency graph and generated IDs/masks. Regenerate changed zones
and their dependants only; seed equality is deterministic. Preserve manual edits,
detect stale inputs and show affected files/objects before apply. Commit a coherent
terrain/placement/pathing group atomically with existing transaction mechanisms.
If that combined transaction cannot yet be guaranteed, implement it before exposing
one-click landscape application.

Acceptance: three deliberately different fixtures (forest outpost, industrial
arena, settlement with connected plateaus) meet route/placement checks and undergo
overview plus gameplay-scale native review. Reapplying does not duplicate objects;
changing one zone preserves unrelated manual work. A visual review rubric covers
hierarchy, material transitions, silhouette, density variation and playable
clearance. Human review is needed for aesthetic approval; checks alone do not
establish a numeric art-quality score.

### 4. GUI compatibility and reusable gameplay systems

Confirmed authoring gap: `TriggerAddEventTimer` is indexed as `FlagEvent` /
`FlagNative`; resolving it as an Action currently rejects with
`GUI_FUNCTION_ROLE_OR_TYPE`. Its GUI parameter `t` is the timer, not the
compiler-supplied target trigger. The new `Registration` call now carries the
explicit target expression and preserves argument evaluation/execution position
for matched native definitions. A two-launch timer fixture passes, but its
save/reopen handler and exact saved-artifact execution remain unaccepted.
Do not fix this by accepting an event as an Action, substituting the current
trigger or moving the call into startup. Test registration after initialization,
different target triggers and reference/callback arguments; compare native
exported Galaxy and actual event delivery. Ordinary declarative Events and
custom Event helpers with an implicit target are separate supported cases.

Folder-count policy was separated from import validity during this review.
Five main folders are a recommendation, not a required count or a maximum;
explicit organization and existing trees take precedence. Continue by resolving
library-qualified references explicitly.
Do not accept arbitrary libraries without dependency/type checks. Do not silently
fall back to Custom Script when full GUI is requested.

Build native GUI fixtures for event parameters, nested loops/conditions, local
and global arrays, presets, function arguments/returns, supported structures,
library references and dialog callbacks. Validate schema, native compilation,
save/reopen and expected runtime behavior. Publish coverage by feature and build,
including rejected cases. Imported logic must retain its behavior and element IDs.

Keep abilities, damage, cooldowns and veterancy in Data. Reusable wave/selection/
objective/UI systems coordinate those records. Ability acceptance checks costs,
targeting, execution, cooldown and Actor/Model presentation separately. Damage
alone is not evidence of a visible shockwave, dash or drop pod.

### 5. Compact authoring and continuous quality review

Expose landscape intents and test suites through the existing `modkit.author`
entry point after their contracts stabilize. Return a plan/job ID, changed counts,
blocking issues and a small evidence summary. Load full schemas, catalog pages,
trajectories or logs only on demand.

Cache catalog resolution and measurements by dependency/content digest. Reuse
owned native workers where their lifecycle permits; batch logically related work.
Use ModKit for fast iterations and original Editor/Game frames at acceptance
milestones. Preserve the custom renderer for its useful preview functions without
making renderer parity a dependency of this roadmap.

Measure before/after on the same fixtures and warm/cold conditions: MCP call count,
response bytes, plan/apply/compile/startup durations, changed-zone rebuild cost and
failure diagnosis steps. Token figures require actual client usage data; bytes
and call counts are proxies, not claimed token savings.

## Native Toolkit work versus our MCP work

| Owner | Required work |
| --- | --- |
| Our MCP | Semantic intent, transactions/ownership, target resolution, suite orchestration, evidence invalidation, efficient summaries and reusable styles/systems |
| ModKit adapter | Fast component/footprint previews and static route estimates; correct format support and provenance |
| Editor Toolkit | Explicit capability discovery for native terrain rebuild/navigation/collision operations, operation completion and affected artifact identity; never infer this solely from Save As |
| Game Toolkit | Capability-backed path/buildability queries where available, ground movement/state observations, map startup readiness and structured failure reporting; existing orders/wait/capture remain useful |
| Author review | Art direction, composition/readability acceptance, balance and whether the mission is enjoyable |

Do not block all progress on unavailable native calls: ship a restricted, honestly
tested matrix using current operations, and report unsupported checks. Native
capability additions should be versioned and tested before the MCP advertises them.

## First implementation slice

Implement phases 1 and 2 initially for saved maps with explicit named test points,
one supported ground-unit profile and a bounded Editor/Game lifecycle. Keep the
Phoenix adapter test separate. Deliver one passing flat route, one passing native
ramp route, one diagnosed broken route and launch-error fixtures, with reviewed
evidence tied to exact archives. Then extend the landscape planner against those
checks. This makes further terrain generation measurable instead of repeatedly
patching the demonstration map.
