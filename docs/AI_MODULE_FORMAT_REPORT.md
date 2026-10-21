# StarCraft II A.I. Module / `CustomAI` format report

Status: discovery implementation for SC2Editor 5.0.16.97563. This report deliberately separates exact evidence from structural inference.

Current alpha.7 migration: original research is retained, but Trigger writes are excluded. Only CustomAI and sibling ComponentList are writable. Current checks/source paths: [AI migration report](AI_MIGRATION_REPORT.md). Extracted empty/Definition CustomAI samples were byte-exact checked; populated waves remain unconfirmed. The earlier ComponentList source claim is inherited from the original audit, not a new Editor-output test.

## Sources and confidence

1. `SC2Editor_x64.exe`, SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`, inspected read-only.
2. A real Editor-produced `ComponentList.SC2Components` fixture records `<DataComponent Type="aiai">CustomAI</DataComponent>`.
3. Observed Editor/custom map files confirm the `AIData` root and direct `<Definition Id="…">` children, including empty definitions.
4. The earlier Trigger subsystem reverse report confirms the native types `aidef`, `aidefwave` and `FlagCustomAI`.

The attached Linux environment cannot run the Windows Editor. L5 Editor and L6 game runtime are therefore not reported as PASS.

## Exact EXE vocabulary

At file offsets `0x35ac4b8..0x35ac674`, the EXE contains a contiguous CustomAI serialization vocabulary:

| Native token | Editor meaning recovered from neighboring UI/generator strings | Typed handling | Evidence |
|---|---|---|---|
| `Active` | personality active state | boolean candidate | EXE exact, scalar carrier inferred |
| `ConfigData` | configuration/custom data | opaque/preserve | EXE exact |
| `ConfigTrigger` | configuration Trigger link | Trigger candidate/preserve | EXE exact |
| `CustomScript`, `CustomInit` | custom AI Galaxy hooks | opaque/preserve | EXE exact |
| `Definition` | AI definition/personality | identity by `Id` | XML observed |
| `DiffLevel` | difficulty selector | integer candidate | EXE exact |
| `Duration` | wave/step duration | non-negative time candidate | EXE exact |
| `GatherDefault` | default gather configuration | point reference candidate | EXE exact |
| `CreateUnits` | “Create Units Instantly” option and/or creation block | gated | EXE exact; role is ambiguous |
| `NoWait`, `OnceOnly` | attack-wave options | boolean candidates | EXE exact |
| `Create`, `Gather`, `TargetPoint`, `Transport`, `Waypoint` | attack-wave point configuration | point-reference candidates | EXE exact |
| `RepeatShow`, `RepeatWaves`, `SkipInEditor` | repeat/editor visibility settings | boolean candidates | EXE exact |
| `SourcePlayer`, `TargetPlayer` | source/target player | player references | EXE exact |
| `Step`, `Wave` | timeline/wave entities | semantic nodes | EXE exact; nesting inferred |
| `Time`, `Arrival`, `EditorDelay`, `FinalWait`, `GatherTime`, `TurnedOff` | attack-wave timing phases | time/boolean candidates | EXE exact |
| `Trigger`, `TriggerRunAtEnd`, `TriggerWait` | Trigger attachment behavior | typed Trigger candidate | EXE exact |

The same binary also exposes AI panels/dialogs for General, Waves, Units, Timing and Points; graphs for total/mineral/gas/supply; generated helpers `cai_`, `startall`, `runall`, `playerAI`; and Galaxy functions such as `AIAttackWaveUseGroup`, `AIAttackWaveAddUnits`, `AIAttackWaveSend`, target/gather/waypoint setters and `AIAttackWaveCancel`.

## Confirmed XML envelope

```xml
<?xml version="1.0" encoding="utf-8"?>
<AIData>
    <Definition Id="71EEC1FA">
    </Definition>
</AIData>
```

An empty root is also valid in observed files. Whitespace, line endings, comments, attribute quote style, unknown nodes and unknown attributes are all retained by the span-based document layer.

## Implemented model

- `AiDocument`: lossless source plus exact XML spans. A no-op performs no serialization.
- Typed projections for definitions, waves, scalar native fields, unit-like composition carriers and unknown children.
- Generic native nodes provide a preserve-first escape hatch for real structures not yet registered.
- `AiReferenceResolver`: workspace and `SC2_ASSET_ROOTS` catalog indexing without a Blizzard unit whitelist; player/point/region/Trigger references; dependency provenance; native `aidef`/`aidefwave` Trigger bindings.
- Cost/supply graph values use Data inheritance when available; missing mineral/gas/supply values produce `complete: false`. Unit availability uses Browse declared dependency policy in the integrated server; the legacy standalone resolver only verifies catalog presence.
- Atomic CustomAI + sibling ComponentList transactions reuse Workspace.applyRawTransaction. Trigger references are read-only and block referenced rename/delete; no Trigger patching code is included.

## Validation levels

| Level | Status in this environment | Coverage |
|---|---|---|
| L1 | implemented | XML diagnostics and `AIData` root |
| L2 | implemented | IDs, duplicates, typed booleans/numbers, unknown preservation |
| L3 | implemented | units, players, points, triggers, `aidef`/`aidefwave` dangling links |
| L4 | implemented | composition quantity and non-negative timing checks |
| L5 | `UNAVAILABLE` | Windows Editor was not executable here |
| L6 | `UNTESTED` | no game runtime harness execution |

## `UNKNOWN_NEEDS_RESEARCH`, `UNTESTED`, preserve-only

- Exact parent/child nesting below populated `Definition`, especially `Wave`, `Step`, `ConfigData` and `ConfigTrigger`.
- Exact unit composition tag and attribute spelling. The high-level theoretical writer uses `CreateUnits/Unit Type/Count` only when `allowUnconfirmedStructure=true`.
- Whether `CreateUnits` is exclusively a boolean option, a container, or context-dependent.
- Native ID format/generation rules for waves and relationships between `Definition Id`, `aidef` and `aidefwave`.
- Defaults, legal combinations, difficulty enum values, timing phase enable flags and randomization/repetition encodings.
- Custom-data payload shape and Trigger attachment ownership.
- Point vs region vs unit target variants stored in `CustomAI` versus runtime Trigger overrides.
- Inherited Unit catalog cost/supply calculation parity with the Editor graph.
- L5/L6 behavior and package/archive round-trip.

Until populated differential fixtures are captured, these fields remain readable and losslessly preserved. The public writer refuses unconfirmed high-level serialization unless the caller explicitly opts in.
