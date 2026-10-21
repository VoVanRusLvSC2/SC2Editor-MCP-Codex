# Compact commands for AI

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
text set key=Mission/Title value="Defend the base" locale=enUS
settings player id=2 control=Computer color=3
```

Use `mode=plan` to inspect a request without staging edits. `mode=stage` applies
supported operations to a draft. `mode=save` also saves the complete transaction
group. Multi-command scripts execute sequentially: if a later command fails,
earlier saved commands remain committed. Original schemas, dependency checks,
stale guards and backup behavior apply. Read-only commands should use plan mode.

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

`project organize` creates a genre-based system scaffold and ownership manifest.
Mission systems are FUNCTIONS, MAIN, GAMEPLAY, OBJECTIVES and CINEMATICS. Existing
source files remain intact. The scaffold does not activate itself in InitMap.
For GUI, use `target=gui`, or `trigger.organize` with exact element assignments.
New typed GUI plans accept `create.folder`, for example GAMEPLAY/WAVES.

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

The workflow profile exposes compact entry points while retaining other tools
for hidden dispatch and explicit activation. Restart the MCP process after
updating the server. Offline validation does not certify SC2 engine behavior.
