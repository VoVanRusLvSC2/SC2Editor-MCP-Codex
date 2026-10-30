# Compact commands for AI

The bounded Galaxy checker accepts nullable strings and string/text `+=`
concatenation. Array/member selection and unsupported bitwise expressions retain
an `INCOMPLETE` verdict; it does not infer a selected field's type from its
container. Known enclosing call arity and supported operand types are still
checked. Native compilation remains separate.

`modkit.author` accepts a `script` string with one command per line:
`section verb name=value`. Quote values containing spaces. Use dotted keys for
nested fields, such as `position.x=25`; complex arrays can use quoted JSON or an
existing `*.plan_file` tool. The command language routes to existing MCP tools.
It does not execute JavaScript, PowerShell or Galaxy inside the server.

```text
project organize genre=mission
terrain catalog tileset=Agria section=vegetation limit=8
terrain style tileset=Agria profile=forest
terrain compose zone=west_forest tileset=Agria profile=forest rect=10,10,30,30 count=40 seed=42
objects unit id=Marine at=25,31 owner=1 count=3
data set id=MyMarine path=LifeMax value=600
data actor.ability_animation id=PulseMotion actor=HeroActor unit=Hero ability=Pulse cast=Attack loopCast=true
text set key=Mission/Title value="Defend the base" locale=enUS
settings player id=2 control=Computer color=3
```

Use `mode=plan` to inspect a request without staging edits. `mode=stage` applies
supported operations to a draft. `mode=save` also saves the complete transaction
group. Compatible adjacent Data setters and ability, veterancy or main Actor
animation recipes for the same catalog share one graph validation and one save,
up to 500 operations per group. A failure rolls back that entire group before
saving. Different files, reads, result references, transaction options and
advanced low-level operations preserve their boundaries. Groups execute
sequentially: if a later group fails, earlier saved groups remain committed.
Original schemas/defaults, dependency checks, stale guards and backup behavior
apply. Read-only commands should use plan mode.

Compatible adjacent Text, Settings, Terrain and single-object placements also
share candidates and saves. The `compilation` receipt reports expanded/grouped
call counts and declared scopes; it does not measure model billing.
Use `settings player.set id=1 color=2` to patch an existing player;
`settings player` creates a new player and rejects an existing ID.
For units, `player=1` is a compact alias of `owner=1`; supplying both rejects.
Exact native IDs can occur in several dependencies: select the verified
`browse.search` key rather than guessing a layer. Keep unknown availability
explicit. A compact spell slot maps to a visible cell but inherited native
button indices can differ from visible coordinates. Inspect card conflicts and
their `compactSlotSuggestions`; these suggestions do not certify native hotkeys.

`document empty ...` in save mode plans and creates one component document.
It has no draft lifecycle, so stage mode rejects. To select models without
rendering every image, use `assets inspect_many files=Path/A.m3,Path/B.m3`
(up to 24 exact paths). For a multi-time scene preview, use
`cutscene show file=Scene.SC2Cutscene times=0,1000,2500`; times are native ticks.
See [performance contracts and measurements](PERFORMANCE.md).

**Galaxy is the default logic language.** Literal source blocks preserve code:

```text
logic function file=Scripts/GAMEPLAY/WAVES/Module.galaxy <<GALAXY
void SpawnWave() {
    // Implement this system's Galaxy logic here.
}
GALAXY
```

This compiles to `script.plan`, followed by `script.apply` and `script.save` for
the selected lifecycle. `logic file` creates a source file; `logic body` replaces
one function body. GUI authoring is explicit: `gui plan file=plans/mission.json`
or `trigger.plan`. There is no automatic Galaxy-to-GUI conversion.

Native handle types from the pinned API also participate in bounded local
declaration checks. Names such as `marker`, `timer` and `wave` are reserved type
identifiers, including when the local variable itself has type `unit` or `point`.
Use distinct local names. Known handle assignments, call arguments and return
types are checked; aliases, arrays, references and the full target grammar retain
their explicit partial-coverage status. A successful structural plan still needs
target compilation for native readiness.

`project organize` creates a genre-based system scaffold and ownership manifest.
Mission systems are FUNCTIONS, MAIN, GAMEPLAY, OBJECTIVES and CINEMATICS. Existing
source files remain intact. The scaffold does not activate itself in InitMap.
For GUI, use `target=gui`, or `trigger.organize` with exact element assignments.
New typed GUI plans accept `create.folder`, for example GAMEPLAY/WAVES.

For a large Galaxy authoring request, `script.plan_file` reads a strict JSON
request from the workspace (at most 1 MiB). It creates the same immutable plan as
`script.plan`; apply and save remain explicit. `file.replace` requires the exact
current `expectedSourceSha256`, in addition to the ordinary apply/save stale
guards. Use this explicit operation when a complete source replacement is
intentional; do not disguise replacement as a function patch.

`trigger.generate_runtime` returns compact receipts by default. These retain
transaction hashes, diagnostics and completeness states while omitting the
unsolicited source preview. Set `response="full"` when the source diff is needed.
This reduces transport output, not the size or fidelity of the saved runtime.

`terrain catalog` is paged reference lookup; `terrain style` adds profile guidance
and target Actor candidates. `terrain compose` owns a named group of placements,
keeps seed/parameters, and replaces only its recorded objects on repeated calls.
Forests support irregular polygons, seeded clusters and reserved-path masks.
Infrastructure recipes require explicit measured members relative to an anchor.
See [AUTHORING_PROTOCOL.md](AUTHORING_PROTOCOL.md) for placement constraints.

Other aliases include `map status/check/preview`, `terrain paint/blend/cliff/ramp`,
`terrain raise/lower/flatten/nav`, `objects doodad`, `data find`, `ui timer`,
`cutscene show/create/compose`, `assets find`, `casc find`, and `lighting status`.
Use `modkit.author_help` for the current command list and original module schemas
for detailed arguments. Limits: 64 KiB source and 20 underlying MCP steps.

`terrain ramp.place` accepts `bounds=minX,minY,maxX,maxY` and
`offset=x,y` (or explicit `offsetX`/`offsetY`, never both forms). For example:

```text
terrain ramp.place donorDirectory=Donor rampIndex=2 bounds=96,14,128,42 offset=-80,0 cliffSetIndex=1
```

Plan mode returns a guarded joined-ramp plan. Stage mode adds
`terrain.modkit.apply`; save mode also saves the complete transaction through
`modkit.save`. The default `adjoining=prepare_closed` prepares measured enclosed
high landings on clear flat ground; `adjoining=verify` checks existing landings.
Both retain native rendering/navigation as separate acceptance checks. The
older `terrain ramp` alias still uses the measured cardinal ramp creator.

The workflow profile exposes compact entry points while retaining other tools
for hidden dispatch and explicit activation. Restart the MCP process after
updating the server. Offline validation does not certify SC2 engine behavior.


### Existing landscape refinement

`terrain landscape.inspect` lists bounded owned-zone summaries. Select
`zone=west_trees field=terrain.materials` or page array values using
`itemOffset`/`itemLimit`; measured members use `field=groups group=relay`.
The returned `requestHash` is required by
`terrain landscape.zone zone=west_trees expectedRequestHash=<hash> changes.config.clusterRadius=8`.
The alias invokes `terrain.landscape.zone.plan`; stage/save follows the existing
Terrain apply/save transaction. Only config and terrain merge. Arrays and other
objects replace whole fields; do not submit a truncated inspection page as a
complete replacement. See [owned-zone refinement](LANDSCAPE_OWNERSHIP.md).

`project quality.plan` is a direct read-only planning command. It prepares a
bounded review plan and does not start Editor or game jobs. Explicit suite
execution remains `project.test.run` in stage mode.
