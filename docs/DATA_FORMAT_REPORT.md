# StarCraft II Data Module format report

## Evidence and scope

The implemented format is based on existing project abstractions, locally available Editor-produced catalog fixtures, the neighboring TriggerRizer/Data implementation, and public SC2GameData XML corpora. The representation observed across those sources is:

```xml
<Catalog>
    <CUnit id="CodexMarine" parent="Marine">
        <LifeMax value="250"/>
        <FlagArray index="ArmySelect" value="1"/>
        <WeaponArray index="0" Link="GaussRifle"/>
    </CUnit>
</Catalog>
```

| Concept | Native representation | Typed behavior |
| --- | --- | --- |
| Catalog object | direct `<Catalog>` child whose tag is `C*` | C-type and inferred catalog domain |
| Identity | `id` attribute | unique in catalog domain/workspace layer |
| Inheritance | `parent` attribute | domain-scoped chain, cycle/missing-parent diagnostics |
| Default template | `default="1"` | readable/preserved; anonymous non-default warned |
| Scalar | field `value` attribute | string/number/boolean accepted without normalization of untouched values |
| Reference | field `Link` attribute | exact typed carrier, dependency resolution and incoming-reference graph |
| Array/map item | field `index` attribute | numeric and token indexes |
| Struct | nested field elements | arbitrary depth through dotted field paths |
| Extension | other attribute/element/comment | lossless preservation; explicitly addressable through `field.setAttribute`/`native.add` |

## Coverage

- Structural read/write: every parsed `C*` catalog object and every nested element/attribute.
- Semantic discovery: a bundled full-corpus registry plus the active workspace/dependency chain; `data.describe_type` reports observed field paths, carriers, indexes, value classes, enum/default candidates, numeric ranges, reference-domain candidates and examples even with no active map.
- References: exact `parent` and `Link` carriers plus conservatively inferred value-carried catalog references; target type/domain is checked against the loaded catalog when evidence permits.
- Inheritance: declared and effective field views with provenance.
- File lifecycle: missing catalog creation and `gada` ComponentList registration.
- Transactions: dry-run, staged draft, expected SHA-256, minimal preview, backup, atomic multi-file write and rollback.
- Linked recipes: evidence-backed expansion for weapon burn graphs and reversible Life-threshold material texture swaps. These remain ordinary `data.apply` operations, so a batch can mix recipes and generic native patches atomically.

## Verified linked-graph evidence

| Feature | Native evidence | Implemented representation |
| --- | --- | --- |
| Periodic weapon burn | `CEffectCreatePersistent`, `CEffectSet`, `CEffectApplyBehavior`, `CBehaviorBuff.Period/PeriodicEffect`, `CEffectDamage` | `recipe.weaponBurn`; six native mutations in one operation |
| Effect visual on target | `CActorModel`, `Host Subject="_Unit"`, `HostSiteOps`, `Effect.*.Start; At Target` | stock/custom model and attachment supplied explicitly |
| Life below 40% | Core `CasterLifeLT40Percent`: `CValidatorUnitCompareVital parent="CasterLifePercent"`, `Compare=LT`, `Value=0.4` | threshold is typed as a fraction in `(0,1]` |
| Continuous state tracking | real `CActorStateMonitor.StateArray`, `StateThinkInterval`, `StateChange; StateValid *` | reversible Healthy/Damaged states |
| Runtime material change | real `CTexture.File/Slot` and actor `TextureSelectById` messages | two `CTexture` objects per requested slot, messages target `_Unit` |

## UNKNOWN / UNTESTED / preserve-only

- `UNKNOWN_NEEDS_RESEARCH`: hidden Editor-only metadata or legal combinations not present in either the real XML corpus or recovered binary descriptors. Observed candidates are evidence, not fabricated exhaustive enums.
- `UNKNOWN_NEEDS_RESEARCH`: destination catalog domain for an unresolved or ambiguous `Link`.
- Preserve-only: unknown C-types, object attributes, field attributes and extension trees until explicitly addressed.
- `UNTESTED L5`: this build was not opened by the Windows SC2Editor Data Module in the current Linux execution environment.
- `UNTESTED L6`: no game-runtime load was executed.
- `UNTESTED L5/L6`: the Reaper texture demo uses two explicit custom DDS paths. Its Data XML is structurally validated, but visual slot compatibility and the asset payload require SC2Editor/game verification with those assets present.
- Packed MPQ/CASC archives still require the existing explicit archive adapter; a component directory is not claimed to be built-in MPQ support.

The generic lossless layer is deliberately broader than the currently known schema, so later Editor-derived metadata can improve typing without changing or corrupting documents.

The generated real-XML registry covers 1,732 Catalog files, 165,161 objects, all 529 observed C-types, 1,277,381 field instances and all 10,509 exact field paths with 0 parse diagnostics, 0 parse failures and 0 byte-round-trip failures. It also records 435 C-type/field paths where repeated unindexed sibling elements are observed and therefore legal (for example `CActorStateMonitor.On` and `.StateArray`). `npm run schema:audit:data` enforces these pre-L5 invariants.

## SC2Editor static registry

The supplied build was additionally scanned at PE/RTTI/xref level. The generated registry contains 1,062 catalog-class candidates, 661 qualified owner/field descriptor paths, 128 exact catalog Link types, 25 Catalog runtime API tokens, 89 Object Editor settings and 619 catalog localization keys. See `DATA_EDITOR_DISCOVERY.md`. These exact binary tokens supplement rather than override real XML evidence.
