# Galaxy scripts — SC2Editor MCP alpha.16

Added a separate script.* within the existing project. Now 10 modules and 158 MCP commands. GUI Triggers are not editable. Galaxy event APIs in custom scripts are allowed.

## Teams.

| Team team. | Appointment |
|---|---|
| script.inspect | Files, hashes, Includes, diagnostics, provenance native API, cache state |
| script.symbols | Pagination functions/prototypes/globals/structs and their signatures |
| script.references | Index of Identifiers and Candidates of String Links |
| script.context | One feature and signatures with the exact limit of JSON characters |
| script.validate | Structure, lines/comments/brackets, Include safety/cycles, native arity |
| script.plan | file.create, function.add, function.body, guarded function.rename, connect |
| script.apply | dryRun diff or atomic stage with source verification |
| script.connect | Include + init call plan for existing void entry function |
| script.recipe | Init scaffold or periodic callback around an existing void action |
| script.save | Staged text group with backup and stale guards |
| script.discard | Cancel all associated staged text group |

## Normal work.

1. Script.inspect, then script.symbols with query and limit.
2. Script.context with file/name/maxChars, e.g. 8000. Complete files are not required; source/dependency metadata truncation is explicitly indicated.
3. Script.plan with the necessary operations.
4. script.apply (planId, dryRun=true) for diff.
5. script.apply (planId, dryRun=false) for staging.
6. Script.save (file, backup=true).

Before applying, source values, existence and the full Galaxy file set are checked. Before script.save, staged values and the same set of files are checked. A new Include dependency, a change in source or the appearance of a new Galaxy file block the record. Shared transaction stores checks on existing dependencies and a compensated record. Full crash-atomicity or no interprocess races are declared.

## Example of periodic income

In the existing MapScript.galaxy add script.plan/function.add:

```galaxy
void GiveIncome () {
    PlayerModifyPropertyInt(1, c_playerPropMinerals, c_playerPropOperAdd, 10);
}
```

After apply/save:

```json
{"file":"Scripts/Income.galaxy","name":"IncomeInit","kind":"periodic","seconds":2,"action":"GiveIncome"}
```

These are script.recipe arguments: a plan creates callback, trigger variable, and IncomeInit with TriggerCreate/TriggerAddEventTimePeriodic. After apply/save, call script.connect:

```json
{"file":"Scripts/Income.galaxy","init":"IncomeInit","entryFile":"MapScript.galaxy","entry":"InitMap"}
```

Then apply/save the connection plan. An example involves the availability of NativeLib in the real entry chain. Behavior in the game has not yet been verified. Reconnect does not add a second Include/call; early return to entry blocks automatic connection. Repeated call init in runtime does not have separate protection against re-registration.

## Savings

The disassembled files are cached from the source code: 128 entries / 32 MiB source bytes. Modified files are re-indexed; the ID/string index and call list are reused. Plans: up to 8 and 128 MiB of the source code being accounted for. These budgets are not equal to the full RSS process. JSON context is limited to maxChars; pagination and short answers reduce the transfer of the model code. The general file scan/hash is still performed for the stale; worker safety pool and disk-backed index are not added.

## Inspections and limitations

251 tests of the whole project passed; 8 new check scripts. TypeScript build and ESLint PASS. Portable MCP/HTTP smoke PASS, including Galaxy recipe/connect/apply/save from another cwd. 4 real MapScript: lexical/structural parse without diagnostics, modified exact source.

2200 Core native signatures extracted from pinned SC2GameData commit 6dd323aae4209a01f110719a00b4e8f7a88389bc; provenance/hash in generated/galaxy-native-api.json.This is an index of declarations, not the full current API of all GameData libraries and target builds.

The current model is tokens + structural declarations, not full AST/compiler. Native arity is tested; expression/assignment types, full local scope binding, Include activation, dynamic function strings and Data/Points/UI resource links are not yet complete. Rename blocks string candidates and ambiguous token bindings. valid=true means no errors in the enumerated scope, semanticCoverage remains PARTIAL.

MapScript can be recreated by the editor. Connect does not change opaque native headers or create a map foundation. Windows launcher, Editor persistence, compilation, and runtime NOT_EXECUTED in an accessible Linux environment.

Next step: Full Galaxy AST/type resolver, read-only installed/dependency library adapter, explicit resource link graph, additional recipes and native compiler/editor final gate.
