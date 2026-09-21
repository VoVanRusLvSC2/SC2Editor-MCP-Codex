# Browse / Placement MCP — alpha.6

## Architecture

`BrowseWorkspace` indexes structured definitions from the existing `DataWorkspace`/schema registry, localized labels from the existing `StringTableDocument`, and loose physical files. No catalog whitelist is introduced. Unknown C* classes remain generic definitions and are not automatically considered placeable.

`PlacementWorkspace` resolves an exact Browse key/ID before creating a plan. `PlacementDocument` edits only selected XML source spans. Preview operates on an isolated document; apply delegates Objects and ComponentList to the existing shared transaction implementation. Existing UI/Text/Data/Cutscene APIs and aliases are unchanged.

Search returns bounded ranked JSON. Exact IDs, case-insensitive substrings, Unicode tokens, labels, text keys, file paths and linked IDs contribute to `matchedBy`. Use `ids` for batch ID searches and `offset`/`limit` for pagination. Confidence is a heuristic, not an editor acceptance probability.

Index snapshots are cached in memory and invalidated by file path/size/mtime and existing staged-draft hashes. Unchanged searches do not reread catalog XML. A changed fingerprint currently rebuilds the snapshot; per-file persistent index caching is not implemented. Force refresh after an external edit that deliberately preserves both mtime and size. Newly staged, not-yet-created catalog files require save/refresh.

## Roots and dependencies

`SC2_UI_ROOT` must be an unpacked component directory. `SC2_ASSET_ROOTS` supplies additional unpacked mod roots; `SC2_BROWSE_INSTALLED_ROOTS` supplies optional discovery-only roots. Use the OS path delimiter (`:` on Linux, `;` on Windows).

Browse reads `DocumentInfo` dependency Value entries, resolves `file:` mod names against configured roots, and follows their DocumentInfo declarations with cycle protection. A root becomes `AVAILABLE_THROUGH_DEPENDENCY` only when declared. Unmatched mods are reported as `MISSING_DEPENDENCY`; undeclared catalogs remain `INSTALLED_BUT_NOT_DECLARED`. Ambiguous basenames and remote bnet-only dependencies are not guessed. There is no automatic CASC/MPQ mounting or Battle.net download.

## Tools

All 25 tools below have executable implementations and generated JSON input schemas in `generated/browse-placement-tools.json`. All are tested with the synthetic fixture `src/tests/fixtures/browse-placement-map`; none has been editor-open/save tested in this release.

| Tool | Actual operation | Format / limitation |
| --- | --- | --- |
| browse.index | Build/force-refresh fingerprinted index | Unpacked catalog XML/string tables/loose assets |
| browse.status | Compact counts, roots, warnings | Same index |
| browse.search | Filtered ranked paginated search | No embedded MPQ/CASC asset decoding |
| browse.get | Original structured definition and Data-resolved fields | Data MCP parent-chain semantics; engine defaults not proven |
| browse.resolve | Exact selection or explicit ambiguity | Duplicate source-layer IDs require a key |
| browse.related | Bounded incoming/outgoing graph | Some value-field link types are marked INFERRED |
| browse.dependencies | Declared/local/missing root graph | Configured unpacked roots only |
| browse.catalogs | All observed types and counts | Unknown classes preserved |
| browse.assets | Physical and catalog-referenced asset paths | A reference is not proof of a physical file |
| browse.usage | Incoming definitions and filenames | Not every packed map, Trigger or Galaxy use |
| browse.validate | Duplicate-layer and unresolved-link diagnostics | Not runtime validation |
| placement.scan | List ObjectUnit/ObjectDoodad and generic nodes | Plain XML PlacedObjects; Version 27 fixture |
| placement.addUnit | Browse-resolved Unit plan | UnitType, position, rotation, scale, player, variation |
| placement.addDoodad | Browse-resolved CActorDoodad plan | Type, position, rotation, scale, variation |
| placement.addBatch | Mixed Unit/Doodad plan | 1..5000 objects |
| placement.move | Minimal Position edit | Numeric placed-object Id |
| placement.rotate | Minimal Rotation edit | Numeric radians convention is INFERRED |
| placement.scale | Minimal three-component Scale edit | Positive finite components |
| placement.remove | Selected object span removal | Trigger references are not updated |
| placement.decorate | Custom query-based scatter plan | Deterministic seed/spacing/exclusions |
| placement.createLocation | Universal themed location plan | Object-only; no terrain painting |
| placement.preview | Plan operations, validation and source diff | No state changes |
| placement.validate | XML/IDs/dependencies/explicit bounds/spacing | Pathing and runtime collision UNAVAILABLE |
| placement.apply | Shared guarded staged or disk transaction | Dry-run/stage/backup default true |
| placement.rollback | Discard drafts or restore available backups | Dry-run default true; one backup generation |

## Placement safety contract

Plans pin both the effective draft and disk hashes of Objects/ComponentList. Any intervening edit rejects the plan as `STALE_PLACEMENT_PLAN`. Dependencies are rechecked before apply. ID allocation uses max+1 within positive signed32, with a first-free fallback; this is a conservative allocator, not an editor algorithm recovered from the EXE.

Commit requires `dryRun:false`. `stage:true` stores drafts, not a disk save; `stage:false` writes through the shared transaction layer. Individual renames are atomic and caught failures restore earlier files, but this is not a crash-atomic multi-file filesystem transaction. XML is reparsed before writing. Existing unknown XML, comments and attributes are not serialized or normalized; unrelated binary components are untouched. Binary Objects is rejected rather than fabricated.

Idempotency covers repeated creation/apply of the exact same request within the same server session. Plans are in memory; restart-persistent idempotency/undo journals are not implemented. The same plan marked applied cannot be used as a new addition; deliberately change the request/seed when making a different placement.

Only observed `HeightAbsolute` flag values 0/1 may be newly emitted. Arbitrary flags, tint, custom names/attributes and unknown binary formats are not invented. Rotation is supplied in the inferred radian convention. Z is written literally; terrain-relative/absolute semantics and editor defaults remain unproven. Bounds must be supplied explicitly when reliable map dimensions are unavailable. Minimum distance checks concern planned object centers, not model footprints or existing map objects.

Rollback discards both staged components, or restores available Objects/ComponentList backups. It does not remove a newly created component that has no pre-existing backup and it is not a general multi-level undo system. Inspect the returned file list.

## createLocation

Presets: forest, desert, city, village, industrial, militaryBase, ruins, swamp, cave, alien, terran, protoss, zerg, mixedNature, custom. Presets contain search vocabulary, not fabricated catalog IDs. Only dependency-ready CActorDoodad candidates are chosen; search results and rejected/unavailable sources remain inspectable through Browse.

Natural presets produce seeded scatter. City/village/industrial/base additionally reserve two crossing corridors and populate their surrounding quadrants. Corridors constrain centers only: they are not proven navigable roads. Optional landmarks enlarge a requested subset. Count/budget/density, scale/rotation ranges, exclusions, excluded objects and query overrides are supported. `includeUnits:true` is explicitly rejected; place gameplay units separately. A scene that lacks matching real candidates is rejected, not populated with mocks.

## Request examples

These are request templates. Obtain the actual key from the current index; never copy the fixture's model paths into a real map as evidence.

```json
{"tool":"browse.search","arguments":{"query":"Marine","catalogType":"Unit","placeable":true,"limit":5}}
{"tool":"browse.search","arguments":{"query":"fire","objectKind":"Doodad","placeable":true,"limit":10}}
{"tool":"browse.search","arguments":{"query":"rock","objectKind":"Doodad","placeable":true,"limit":10}}
{"tool":"browse.search","arguments":{"query":"plant","objectKind":"Doodad","placeable":true,"limit":10}}
{"tool":"browse.related","arguments":{"key":"<key from search>","depth":3,"limit":30}}
{"tool":"placement.addUnit","arguments":{"key":"<Unit key>","position":{"x":30,"y":40,"z":0},"owner":1}}
{"tool":"placement.addUnit","arguments":{"key":"<Unit key>","position":{"x":30,"y":40,"z":0},"owner":1,"count":6,"layout":{"type":"circle","radius":5}}}
{"tool":"placement.addDoodad","arguments":{"key":"<Doodad key>","position":{"x":50,"y":50,"z":0},"rotation":1.5,"scale":0.9}}
{"tool":"placement.createLocation","arguments":{"locationType":"forest","area":{"type":"circle","center":{"x":64,"y":64,"z":0},"radius":20},"objectCount":20,"seed":1234,"minimumDistance":1.5,"scaleRange":{"min":0.85,"max":1.15},"bounds":{"minX":0,"minY":0,"maxX":128,"maxY":128}}}
{"tool":"placement.preview","arguments":{"planId":"<returned plan ID>"}}
{"tool":"placement.apply","arguments":{"planId":"<returned plan ID>","dryRun":true}}
{"tool":"placement.apply","arguments":{"planId":"<returned plan ID>","dryRun":false,"stage":false,"backup":true}}
{"tool":"placement.rollback","arguments":{"dryRun":true}}
{"tool":"placement.rollback","arguments":{"dryRun":false}}
```

Actual request/response traces for the fixture demonstration are in `examples/browse-placement/runs/demo-72Uc1f/DEMONSTRATION.json`; this is explicitly not a real-map/standard-assets proof.
