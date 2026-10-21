# Data Editor MCP

`data.*` edits the native StarCraft II Data Editor catalogs: unit, actor, ability, effect, weapon, and other catalog definitions stored in `<Catalog>` files below `GameData`.

## Public tools

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

## Operations

- `object.create`, `object.clone`, `object.rename`, `object.delete`, `object.setParent`, `object.setType`, `object.setAttribute`, `object.removeAttribute`
- `field.set`, `field.setLink`, `field.setAttribute`, `field.removeAttribute`, `field.remove`
- `array.append`
- `native.add` for exact native structures discovered in a real map or dependency
- `recipe.weaponBurn` — one compact operation expands to the native Damage → Buff → ApplyBehavior → Set → weapon carrier → Actor graph
- `recipe.unitTextureByVital` — one compact operation creates reversible health-threshold texture states for one or more model material slots

Fields use SC2-shaped paths such as `LifeMax`, `FlagArray[ArmySelect]`, `WeaponArray[0]`, or `CardLayouts[0].LayoutButtons[3]`. Unknown elements, attributes, comments, formatting and extension trees are retained. A clone is a byte copy with only the requested identity/parent change.

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
