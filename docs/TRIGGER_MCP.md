# MCP GUI Triggers and the AST Model

## Native generator risk review

`trigger.plan` and `trigger.validate` return `nativeProfile`, also retained in
compact workflow receipts. This bounded static review reports known missing
library qualifiers, literal-zero array bounds and named-library references to
map globals. Its compiler status stays `NOT_EXECUTED`; no-known-risks is not a
native compile certificate. The original generator resolved structure variables
after preserving their explicit TypeElement library. A standalone Array tag did
not stop a literal zero bound from becoming a scalar. Preserve the intended
range and verify an explicit constant bound in the original Editor. For newly
declared literal-zero dimensions, authoring creates a separate visible global
`MCPZeroBound_<variableId>_<dimension>` integer constant with value zero in the
same library and keeps the original one-cell range. Fields and function locals
use the same representation. Existing user constants are not reused or changed.
`nativeProfile.loweredZeroBounds` identifies the emitted helpers; manual helper
edits become review findings and are preserved. Imported XML is not rewritten.

Library functions are emitted before map-global declarations in the observed
output. Keep reusable shared state in its owning library or pass arguments.
Do not silently move an imported variable or callback to hide this risk. A
deliberately reorganized diagnostic fixture is separate evidence from the
original graph's equivalence. Native compilation, save/reopen and execution of
the exact saved artifact remain distinct checks.

## Reviewed Trigger Revize imports

`trigger.import_revised` stages a reviewed XML file from the workspace with its
generated Galaxy and localized labels as one transaction. Supply the current
Triggers and MapScript SHA-256 hashes. Five main folders are a recommendation,
not an import constraint; other counts, names and valid nested folders are allowed.
The importer rejects ScriptCode and Custom Script fallbacks and validates scoped
references and folder ownership. Save with `trigger.save`. It does not launch
Trigger Revize or SC2 Editor; native conversion remains an explicit job.

The default offline path checks its supported emitted runtime, including
self-contained inline libraries. References use Library/Type/Id identities;
same IDs/names in separate libraries are independent. Map-owned declarations get
native `lib<Id>_` namespaces, library triggers retain explicit Root order, and
array initializers assign each cell. Supported record-reference parameters emit
`structref<...>` rather than silently copying the record. Cyclic inline-library
initialization dependencies, local unit-reference parameters and unavailable
external implementations reject before staging. Compilation and equivalence
still require their own evidence.

For external implementation sources or other original-compiler semantics:

1. Export the saved target context and call `editor.call` with method
   `sc2_convert_xml`, its `template`, the reviewed `triggers_file`,
   `scope: "mapRoot"` and `compile: true`. Use a template containing the intended
   localization. Supply `context_label` when the native root name is ambiguous.
2. Poll `editor.job`; require `nativeGuiImportEligible: true`. Compilation of one
   library is not a complete map runtime. Calls with external `trigger_strings`
   or `game_strings` overrides are not eligible for adoption; include these tables
   in the template instead.
3. Pass that job's `nativeJobId` to `trigger.import_revised` in the same MCP
   session. The importer checks exact XML, original output bytes and every template
   component except the replaced Triggers/runtime/TriggerStrings. Different Data,
   Objects, metadata, dependencies or extra compile-context files stop import.
   Save pending drafts before this operation. Template/output/context changes
   invalidate the coupled transaction through save.

This path retains library-qualified IDs and editable GUI folders and adopts the
original compiler's Galaxy without a Custom Script wrapper. It requires an unpacked
target matching the saved template. A native compile proves only that context;
save/reopen and expected gameplay remain separate acceptance checks.

The [2026-10-22 native corpus](verification/gui-core-events-2026-10-22.json)
passed original generation/compilation and four clean gameplay launches across
two exact archives. It covers library coexistence, nested control flow,
structures, global/local arrays, presets, function defaults/parameters/returns,
native Dialog click callbacks, event parameters and dynamic per-player indices.
The [2026-10-25 GUI matrix](verification/native-gui-matrix-current-2026-10-25.json)
subsequently passed native save/reopen, saved-artifact recompilation and expected
gameplay for three declared profiles, including the typed core and explicit-target
registration. Do not repeat those controls because the earlier record lacked
save/reopen. Other functions, libraries, revised-import equivalence and controls
are not certified by that representative corpus.

The offline emitter supports native boolean groups, exclusive If/Else If chains,
integer increments, Skip Remaining and abilcmd literals with ValueId indices.
Unsupported constructs still fail before staging.

`trigger.plan` creates native XML `Triggers`. By default, everything is at the root of the map, without a separate resource library. It does not invoke the converter. Reviewed external converter output can be imported separately as described above. The element model and canonical serialization are transferred from our AST project; the source files and SHA are listed in `generated/trigger-ast-reuse.json`.

## Conversion preservation requirements

Treat a native event declaration and runtime event registration separately.
`TriggerAddEventTimer`, for example, may be indexed as a GUI event rather than an
ordinary action. Runtime use now has a distinct `Registration` representation:

```json
{
  "kind": "Registration",
  "function": "TriggerAddEventTimer",
  "trigger": {"kind": "trigger", "name": "Receiver"},
  "args": {"t": {"kind": "variable", "name": "Clock"}}
}
```

The `trigger` is an explicit typed GUI expression: a trigger element reference
(`id` or unique `name`, optional `library`), variable/array/member, function
parameter or supported call. Event arguments retain their normal aliases,
types, defaults and reference flags. Registration executes at its Action/body
position, including local parameter evaluation; it is not an initialization Event.
Ordinary `Action` calls to event-only definitions still reject.

Discover this role before planning: `trigger.search_functions` accepts
`registration:true` to page Event definitions, including rejected cases. Each
Event has `registration.supported`, `callKind`, `targetType` and bounded `reasons`.
This is separate from ordinary `supported` / `serializerSupported`: valid Event
XML alone does not verify the native registration signature. Single and batched
descriptions return the same metadata. Names shared by multiple definitions need
an exact ID; a rejected binding is not silently redirected to another definition.
All discovery remains static (`compiler:NOT_EXECUTED`) and does not modify GUI.

The serializer creates a hidden native Action signature with the verified
first `trigger` argument and typed parameter bindings. The visible call and all
arguments remain GUI elements; it adds no ScriptCode or Custom Script. Only
Ntve native Event definitions with matching authoritative native/API-to-GUI
identities are accepted. Arbitrary library/custom Event wrappers are separate;
their runtime registration is not inferred. Original Editor compilation,
save/reopen and actual callbacks remain distinct acceptance gates.

Keep the explicit target `trigger` expression and original call arguments. Do not
silently hoist the call into startup, substitute the current trigger, or add
guards to a callback to make conversion pass. If the current API cannot express
this, report the unsupported case instead of claiming equivalent GUI output.

Keep the template's localized `TriggerStrings` with the authored root/library
and use the real context label. Missing root-name localization can prevent native
context discovery even when the GUI graph is valid; an invented label or unrelated
strings table is not a repair.

Graph validation, native generation/compilation, exported-source comparison and
gameplay are separate evidence. A compile pass alone does not establish conversion
equivalence. Compare the original and native-exported source for reference and
`structref` parameters, nested array indexing, callback bodies, explicit trigger
targets and event argument references. Account for generated identifier changes
without discarding semantic differences. Keep unresolved differences visible.

## Types and variables

The original Editor can elide a mutable string's initial value when its exact
spelling is a canonical scalar default (`"0"`, `"false"`, `"null"`), even with
`ValueType=string`. New variable authoring retains these values through the stock
Combine Strings expression with an empty literal. It creates no runtime helper,
Native definition or raw script. Leading zeros, signs, decimals and whitespace
remain direct string literals. Constant declarations and function-return literals
retain their existing representation; previously saved GUI is not migrated.

All 83 specific codes from the GUI dictionary provided are supported. The other 10 are void and contextual/generalized rules, not stand-alone variable declarations. `dialog`, `control`, `sound`, `portrait`, `unitfilter`, `wave`, `filepath`, attribute types and others retain their GUI name; they are not substituted for a universal string. Specialized values are given by calling a suitable function/reference; arbitrary numerical literals for living objects are not accepted.

Variable: `name`, `type`, `scope` global/local, `initial`, `constant`, `arraySizes`, `gameType` for gamelink and `typeElement` for preset/struct. `typeElement` accepts a name or ID and library. Own types are first declared via `presets`/`structures`, or resolved from declared dependency.

```json
{
 "structures":[{"name":"PlayerState","fields":[
   {"name":"score","type":"int"},
   {"name":"history","type":"int","arraySizes":[4]}
 ]}],
 "variables":[
   {"name":"PlayerCount","type":"int","constant":true,"initial":{"kind":"literal","type":"int","value":8}},
   {"name":"States","type":"struct","typeElement":{"name":"PlayerState"},"arraySizes":[{"variable":"PlayerCount"}]}
 ]
}
```

The constant receives the native `VariableType/Constant`. It can not be written or used as a changeable iterator. Constant initializers allow the literal, preset and previously declared constant; arbitrary call is not allowed. `arraySizes` preserves SC2's serialized inclusive upper index, rather than a JavaScript length: `0` declares one cell at index0, and `2` declares indices0..2. A bound is a nonnegative integer or a reference to a global int constant with that meaning. Existing XML is not silently resized. Up to four dimensions are available in the API (observable form of GUI, not a statement of a universal limit of all internal arrays). For a literal index, type, sign and known inclusive boundary are checked; dynamic index requires int. Unindexed array is not given a scalar.

Owned functions, records, presets and global variables are indexed across the
map root and its inline libraries. Unqualified function names keep the current
library's scope; use `LibraryId::Function` for another library and `::Function`
for the map root. Value/type references use their explicit `library`, including
`library:""` for the root. Foreign locals remain inaccessible. Serialized
references and stored defaults retain their defining owner, including an explicit
empty Library attribute when called from a named library. This does not provide
an external library's implementation or certify every native reference variant.

Read/write `States[2].history[1]`:

```json
{"kind":"variable","name":"States","indices":[{"kind":"literal","type":"int","value":2}],
 "members":[{"field":"history","indices":[{"kind":"literal","type":"int","value":1}]}]}
```

This reference is suitable for `SetVariable.var`, expression and argument. XML contains the chain `Variable`, `Array Type=Param` and `StructMember Type=Param`, as in AST. Record fields remain members of Structure, not global variables. Field type and presence are checked; direct/reciprocal recursive entries are rejected.

## Presets

`presets`: name, baseType int/fixed/bool/string, values with name/value/default, integer, asBits, generateConstants. Common preset retains explicit values; ordinal uses `PresetInteger`, without arbitrarily substituted numbers; bit - `PresetAsBits`. One default is allowed. Preset identity is retained: two presets with the same numbers are not considered to be the same type.

```json
{"presets":[{"name":"Mode","baseType":"int","values":[
 {"name":"Easy","value":1,"default":true},{"name":"Hard","value":2}
]}],"variables":[{"name":"CurrentMode","type":"preset","typeElement":{"name":"Mode"},
 "initial":{"kind":"preset","preset":"Mode","name":"Easy"}}]}
```

Bit combination: `{kind:"presetBits",preset:"Flags",values:["Ground","Air"]}`. Own and connected presets are available. `trigger.types` provides a short page of types, presets and records with fields.

## User definitions

`functions` supports Action, Condition, Event, and Function. There are typed parameters, local variables, calls, and returns. Condition has bool, Function has returnType. The inside-body parameter is `{kind:"parameter",name:"value"}`; it also supports members/indices when the type allows it.

Parameters support default, limits in the native format `min,max`, reference, multiple, variableOnly. For Multiple, an argument can be a GuiValue array; each element gets its own Param with the same ParamDef ID. The empty list of operators is rejected. The untransmitted argument is taken from the stored Default chain; it is not replaced by an arbitrary zero.

Additional definition options: CreateThread (Action only), Hidden, NoScriptPrefix, grammar, hint. Existing other flags are read from libraries. Restricted, CustomAI and CustomScript are not declared proven universal support; Inline is not created without a native view.

Calls by name or ID; `custom:Name`/`native:Name` resolves conflict; `Lbty::Name` explicitly selects library; Direct/reciprocal recursive user calls are rejected; Examples of four roles and signal: `examples/triggers/custom-gui-functions.json`.

## CASC and Library Index

For an application project, the downloader checks the current Core over SHA/build, reads DocumentInfo, and recursively connects only the declared dependencies. CASC materializes real SC2Lib/triggerlib/root Triggers and strings; LibraryList selects active libraries. An installed but not declared library does not become available automatically.

The index is stored compressed from the source print and restored in a new session. XML, library/type/id spaces, no conflicts and loops are checked. Materialized files are matched to the original CASC hashes. The new ensurePackage reuses a fully verified mount, without re-bypassing the entire package. Plan/apply checks for changes to DocumentInfo, libraries, NativeLib, strings, objects and directories. The game remains a read-only source.

NativeLib 98310 matched our SHA profile. The fixed index is supplemented from AST: ReturnType/TypeElement/GameType, presets, 407 variables, and Default settings. To use GameLink, the required declared directories are automatically connected; the absence/partiality of the source remains a mistake.

## Save text and benchmark

Local build functions are found in `src/modules/trigger/builder.ts`: integer/real/boolean, variable/parameter/preset, call/action/event/condition, at/member. They return the same strict plan; no additional library appears in the map. ID and XML model writes itself. Packages are described by short JS, and summaries and pages are returned to context, not the entire index.

`node scripts/benchmark-trigger-authoring.mjs` creates three identical tasks in the Galaxy and GUI: start-up resources, array revenue, array record/preset/constant/action. `python scripts/count-trigger-benchmark-tokens.py` then counts o200k_base via tiktoken (set it locally in work/trigger-ast-completion/tokenizer).

Separately, the Galaxy, the GUI builder short source, JSON and XML. Time is the Galaxy structural check/write and the plan/apply/save GUI, one cold and five warm repeats in one client; the reset is not included. This is not the LLM generation time, not the real pricing/reasoning tokens, and not the game execution time. GUI-IR is verified by an independent simulation; the external AST parser additionally reads XML through the virtual space, without changing the stored map. The SC2 compilation is not executed in this test.

## GUI and executable script

Graphical organization means actual categories inside `Triggers`, never just
Galaxy filesystem directories. `trigger.organize` creates nested folders and
moves exact element IDs; `modkit.author` provides `gui folder path=...` and
`gui move type=Trigger id=... folder=...` as compact equivalents. Pass the actual
genre, for example `genre=arena`. Genre roots now place FUNCTIONS before MAIN,
so shared Custom Script prototypes precede code that calls them in the Editor.

`trigger.custom_script` upserts explicit visible native Custom Script declarations
or actions in a folder. An action takes an existing `triggerId`; its GUI events
are still authored with `trigger.plan`. Stable IDs, XML escaping, native ScriptCode
indentation and grouped stale-source checks are retained. The compact form is:

```text
gui script identifier=RoundHelpers folder=ROUNDS/WAVES genre=arena <<END
void PrepareRound () { }
END
```

This is a graphical shell containing visible code, not conversion of every
Galaxy statement into a native GUI action. Ordinary GUI variables and event
nodes can coexist with these blocks. `trigger.generate_runtime` emits those
explicit declarations and Custom Script actions from the same tree, after GUI
global declarations. Unknown script templates still fail closed. Native Editor
compilation remains a separate target check.

Native Data owns hero abilities, effect graphs, costs, cooldowns, command-card
buttons and Veterancy thresholds/stat gains by default. GUI Triggers own match
flow, selection, UI, objectives and Bank synchronization, and may issue native
ability orders or grant an explicit native XP reward. Do not implement a second
cooldown, damage or level progression system in trigger loops.

For `trigger.custom_script`, a declaration item with `remove:true` and `code:""`
removes the exact named map-root declaration and its folder item. Missing names,
ambiguous names and non-folder XML references fail closed. Raw Galaxy references
are not inferred; remove callers/prototypes in the same batch and validate the
regenerated runtime before export. Action deletion is not supported by this flag.

`Triggers` is a GUI tree; the game executes `MapScript.galaxy`. After changing the GUI, the editor must generate and save the corresponding script. The MCP plan is not declared a Galaxy compiler. This corrects the previous incorrect expectation that having a GUI itself triggers events.

The existing Agria_GUI_Ready contains a user-provided compiled script; the user has confirmed the message and attacks. The new AST designs are software-tested and available for real CASC sources, but have not yet been separately confirmed by the compiler/game. SC2 Editor has not been controlled; the converter has not been changed or launched.

The previous graft, normalizeScriptLayout, get/inspect/apply/save/discard are saved. Complete schemes of arbitrary raw ExpressionText/ValueParam and recovery of any unknown Galaxy remain a separate task of the converter.


## Offline assembly and economical transport

`trigger.plan_file` accepts one GuiRequest or an array of requests from JSON inside workspace. The array is built on an isolated staged image: the source files and drafts of the calling project do not change. The result is applied by one `trigger.apply`, stored by one group. `trigger.describe_functions` returns up to 40 compact signatures with limited preset lists.

Runtime receipts default to `response="compact"`: source previews alone are
omitted; diagnostics, hashes and incomplete/unsupported states remain. Choose
`response="full"` to retrieve the original transaction previews.

Reviewed native GUI imports can retain exact declarative Action-splice macros
when an eligible original-Editor compilation proves the supplied tree. The
accepted template is only `#SUBFUNCS(actions)`, with one matching scoped Action
subfunction declaration and a void return. Extra Galaxy code, foreign roles and
ordinary Custom Script remain refused. This exception does not extend the local
runtime emitter or establish general converter equivalence.

`trigger.generate_runtime` generates and stages MapScript from the GUI XML graph,
without a separately maintained Galaxy implementation or converter call. Its
explicit subset includes root and self-contained inline-library structures,
arrays, presets, functions, conditions, actions, events, supported if/integer-loop
forms and standard calls. Qualified references retain their owning library.
Unavailable external implementations, unsupported control flow/threads and raw
custom code stop emission; this is not a full Galaxy compiler. Field prefixes
preserve valid native identifiers. The
[native reference fixture](verification/native-gui-references-2026-10-23.json)
checks specific record-reference, nested-array, default-argument and deferred
timer profiles in two game launches. It does not establish universal library
compatibility or original Editor save/reopen equivalence.

Castomy Event receives implicit `trigger t`. For registration calls inside its body, a hidden native signature is created with the explicit first argument t; the resource Library is not created. The only internal ScriptCode parameter contains the expression t, not the user script. Verification by the real compiler remains separate.

`trigger.recipe_skirmish` parameterizes the saved mission recipe instead of retransmitting a large JSON. Existing Objects IDs, ability, and UI templates are needed. `ui.recipe_timer`, `ui.assets.register`, `ui.assets.save`, `ui.hookup.validate` create/register only custom styles, DescIndex, and font/ui components.

The SC2_MCP_PROFILE=map-builder profile shortens the initial list of schemes. The remaining tools are available through modkit.tools and modkit.enable_tools; the profile is all saved. modkit.usage measures MCP arguments and text responses through o200k_base and the length of handlers. Texts are not written into a log; actual model tokens, reasoning and billing are not available.


Scalar variable and structure-field initializers can use a stock preset when the
selected preset owner declares exactly the variable's GUI base type (for example,
No Control for a control field). The initializer resolves the actual variable
by owner and ID; foreign libraries and different base types remain errors.
Event/Action argument selectors and nominal preset types keep their existing
ParamDef and preset-owner validation. This does not create a Native definition
or infer a conversion from a matching script-value string.
