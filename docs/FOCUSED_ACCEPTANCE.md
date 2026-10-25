# Focused functional acceptance

The requested remaining scope is terrain/decor, Data/main actors, GUI/Galaxy,
and text/UI. Cutscene acceptance is outside this pass. This is a finite exit
contract, not a declaration that the four new combined cases have passed.

Do not replace a missing assertion with another successful launch, a larger
test count or a screenshot of unrelated behavior. Preserve historical evidence
and its original runtime identity. A newer package does not invalidate a recorded
observation, and that observation does not automatically certify the newer code.

## Existing controls to reuse

- Terrain: [joined ramps](verification/native-ramp-join-2026-10-25.json),
  [point pathing](verification/native-point-pathing-queries-2026-10-24.json)
  and [concurrent groups](verification/concurrent-ground-groups-2026-10-24.json).
  These already cover substantially more than a single unit crossing flat ground.
- Data: [main actor lifecycle](verification/native-combat-main-actor-2026-10-22.json)
  and [cast/cancel observations](verification/main-actor-animation-2026-10-22.json).
  Do not repeat isolated movement, cast or cancellation as a new stress result.
- GUI: [typed references, arrays, callbacks and registration](verification/native-gui-matrix-current-2026-10-25.json).
  Six suites cover 52 scenarios and 122 steps, with actual saved-artifact execution.
- UI: [native Learn activation](verification/native-learn-ui-2026-10-25.json)
  and [normal handler action checks](verification/reusable-action-checks-2026-10-23.json).
  A new run needs an additional lifecycle or routing assertion.

## Four remaining combined cases

| ID | Hard case | Required observations | Exit boundary |
| --- | --- | --- | --- |
| F1 | Refine an owned area adjoining a measured cliff/ramp after a manual object or terrain edit. | A conflicting stale request refuses atomically. An allowed disjoint change preserves the manual bytes/IDs, intended depressions and unrelated objects. Reapplication is a no-op. Observe the changed junction, declared group passage and explicit building-placement predicate separately. | Accept only the measured geometry and declared unit/building footprints. Unregistered holes or unsupported ramps must refuse with a useful reason; do not invent geometry or certify every cliff mask. |
| F2 | Two casters act concurrently; cancel one, lose a target during the other channel, then cast at a new target and resume ordinary attacks. | Attribute orders, phase events and actual vitals to the correct unit/session. Cancellation must not apply the completed damage; the survivor must recover without a stuck order. Review main-unit/effect actor lifetime and relevant frames through cleanup/death. | Accept only the declared abilities/models. Missing sequence or isolated sound observation remains an explicit instrumentation limit. Order submission or nonzero mixed audio is insufficient proof. |
| F3 | Convert/import a complex editable GUI graph with a named library, nested records/arrays, reference parameters, callbacks and runtime registration. | Preserve the GUI graph and localized TriggerStrings; compare original expected behavior with the original Editor's regenerated, saved and recompiled artifact. Verify the receiver, call timing and exactly one callback. Exercise a known invalid cross-scope graph as a separate expected refusal/finding. | No silent variable relocation, widened bounds, substitute script emitter or Custom Script wrapper. Keep unsupported library-to-map-global initialization/order visible; do not claim arbitrary library equivalence. |
| F4 | Rebuild a hero-selection/ability dialog after closing it, with changing pages, long localized labels and an overlapping child control. | Use the actual returned native root and normal handler. The chosen hero/state must match the selected entry; one activation fires one callback. Closed/stale handles cannot activate the new dialog. Inspect text clipping, disabled requirements and page changes at the observed viewport. | Accept the tested locale/viewport/control profile. Other resolutions, keyboard routes or direct numeric counters need their own observation; unsupported access is a bounded limitation, not a reason for endless retries. |

Initial state: all four rows were **pending**. Existing controls above are retained
evidence, not executions of these additional combined cases. Record a row as passed,
failed with a reproducible defect, or limited by a specifically named unsupported
operation. A diagnosed limitation closes investigation of that operation without
reclassifying it as a pass or blocking every supported map workflow.

## Recorded outcomes

- **F2: mechanics passed; presentation scope limited.** The
  [new compound native observation](verification/focused-data-lifecycle-2026-10-26.json)
  verifies concurrent caster identities, early cancellation with zero pulse damage,
  target loss between the second ability's body and finish, six pulses/300 damage
  on a same-unit recast, ordinary attack/movement recovery and matching observed
  main Actor create/destroy instances. One unsuccessful harness attempt is retained.
  Exact animation-sequence identity and isolated sound remain unverified; three
  selected frames were inspected. Do not repeat this mechanical case without a
  diagnosed relevant change. Global absence of every possible orphan/duplicate
  actor is not inferred from paginated snapshots.
- **F1, F3 and F4: pending.** No result for these combined cases is inferred from F2.

## Execution and stopping rules

1. Inspect the existing evidence and exact public API before preparing a fixture.
   State which observation is new. Use one concrete fixture per row and existing
   retained bridges sequentially; keep ordinary maps free of private Toolkit code.
2. Run each new combined case once. Repeat only the failing portion after a
   diagnosed change, or when a specific intermittent defect requires reproduction.
   Do not automatically repeat the entire suite or already accepted controls.
3. Retain original failures, source/artifact digests, native observations and owned
   cleanup. Do not extend timeouts or weaken expectations to manufacture a pass.
4. When the four outcomes are recorded, publish the defect/limitation summary and
   stop this pass. Further coverage is a separately scoped task. Finished artwork,
   balance and human aesthetic approval remain separate from functional acceptance.
