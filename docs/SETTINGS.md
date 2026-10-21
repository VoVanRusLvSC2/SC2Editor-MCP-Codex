# SETTINGS: attributes, game options and player parameters

A separate `settings.*` module works with **Attributes**, **MapInfo v39** and the Attributes declaration in **ComponentList.SC2Components**. The editor does not start. The implementation of existing Terrain/Map/Trigger/UI modules does not change for this: Settings is connected only in general composition root, selection of profiles and registration of MCP.

## What's available

- View user attributes, values, defaults, namespace bindings, hidden fields, and locks of game options.
- Creating the `Global`/`Player` attribute, adding or updating values, Name/Availability/Visibility/Access and slot default. ID remain stable; type change and deletion of values are not added so as not to leave links in triggers without a purpose.
- Copy the existing version along with unknown sections, edit ModeName/ModeDesc/CategoryId/ModeId/MaxTeamSize. edit default/Locked and AttributeHidden at **existing** namespace+ID anchor.
- MapInfo: None/User/Computer/Neutral/Hostile, AI/race token `aiName`, color 0..16, registered starting point, decal token.
- 13 known bits of game settings: replay, wait-for-key, trigger preload, FOV, errors, observers, stagger events, countdown, base height, view everyone, take command, recover game. Unknown bits are saved; integrity hash MapInfo is recalculated.

MapInfo player ID and zero `Slot` in lobby Attributes are different identifiers. Commands do not automatically translate one to another. `aiName` stores native token (e.g. `Terr`); final directory/race resolution is not declared. `team`, resourceFlags, observed player and startLocationIds are readable. Writer does not change the number of players, their ID, team/alliance matrices and starting point table.

## MCP teams

| Team team. | Appointment |
| --- | --- |
| `settings.capabilities` | Supported format and limitations |
| `settings.inspect` | Number of attributes/options, players, options, errors |
| `settings.attributes.list`, `settings.variants.list` | Pagination of compact records |
| `settings.attribute.get`, `settings.variant.get` | Details of a specific ID |
| `settings.players.list` | Players and game options MapInfo v39 |
| `settings.plan` | Package of operations without writing files |
| `settings.apply` | Dry-run or staging prepared plan |
| `settings.save` | Maintaining a whole group with backup and stale guards |
| `settings.discard` | Abolition of a whole group of drafts |

Entrance schemes of all 11 teams: [generated/settings-tools.json](../generated/settings-tools.json)Profile. `settings` The profile **landscape** includes Terrain, CASC, Settings, Map, Data, Browse, Placement, Text and UI. Old narrow profiles retain the old set. `all` Includes a new module.

## Example

Create a global attribute with two values, change the player and copy the option:

```json
{
  "directory": "MyMap.SC2Map",
  "operations": [
    {"op":"attribute.create","id":7,"type":"Global","name":"Attribute007/Name","access":"Host"},
    {"op":"attribute.value.upsert","id":7,"valueId":1,"name":"Attribute007/Value001/Name"},
    {"op":"attribute.value.upsert","id":7,"valueId":2,"name":"Attribute007/Value002/Name"},
    {"op":"attribute.default","id":7,"slot":"Global","valueId":1},
    {"op":"player.set","playerId":1,"patch":{"control":"Computer","aiName":"Terr","color":3}},
    {"op":"variant.clone","sourceId":4,"id":90,"modeName":"Variant090/ModeName"},
    {"op":"variant.set","id":90,"field":"MaxTeamSize","value":8},
    {"op":"options.set","patch":{"showCountdown":true}}
  ]
}
```

New attributes must have at least one value ** in the same plan**. The original `4` is selected by `settings.variants.list`; the IDs in the example are not universal defaults. The existence of standard binding is selected from `settings.variant.get`; raw `valueId` is a numerical on-disk value, not a dropdown sequence number. There is no complete standard enums check.

Then `settings.apply({"planId":"...","dryRun":false,"stage":true})` → `settings.save({"transactionId":"...","dryRun":false})`. All modified components are saved by one byte transaction. Export of the packaged card is performed by the existing `map.export` after saving. Name/Description/ModeName/ModeDesc - ** GameStrings keys**; localized inscriptions are edited by the existing Text module separately.

## Conservation and confirmation

The XML writer replaces only selected values or inserts the desired element; saves comments, unknown elements, the order of other fields and bytes unchanged. MapInfo writer replaces selected spans, does not serialize the entire binary file. Player/variant suffix and unknown core bytes are saved. The missing Attributes is created with its declaration in ComponentList. Custom-name Attributes roots require a separate profile and are not renamed.

Plan fixes the full manifest maps and SHA of the source files. A new record, external editing or intersecting draft blocks apply/save; verification is stored in the general transaction group. An unfinished Terrain/Map plan is first saved or canceled. Process-local drafts; restoration of an interrupted record is performed by an existing recovery journal.

The v39 parsing is checked against four native fixtures (Ant, City, Nydus, Warships): 9/14/13/10 player records. Tests verify the immutability of suffix, hash, failure for unregistered startLocation, multi-file staging, stale guards and a true SDK stdio workflow.

Local decompilation SC2Editor contains the AttributeHidden/MaxTeamSize tokens and UI labels of variants; this is a confirmation of names, **not a proof of all semantics**. Disk player/core layout and option bits are further verified with [binary-research MapInfo format](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/master/mapinfo.md). [Local source report](../generated/settings-evidence.json) distinguishes between token evidence, structural checks and engine acceptance.

Remain: new version without native template, new standard namespace bindings, defaultVariants regeneration, rebuild teams/alliances, other MapInfo versions, full catalog/trigger cross-reference semantics. Editor save/reopen and game runtime for Settings ** were not executed** according to the user's request.
