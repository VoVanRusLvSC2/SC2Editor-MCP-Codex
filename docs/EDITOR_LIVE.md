# Current-document editing module

`editorLive` is the separate module for applying MCP authoring to an already-open
SC2 Editor document. Select `SC2_MCP_PROFILE=editor-live`. It exposes the existing
`live.*` current-document tool names without the saved-checkpoint tools. The
legacy `live` profile retains explicitly requested checkpoint collaboration.

Complete current-document coverage is the requested target. The scope below is
progress toward that target, not acceptance of a permanently limited live mode.

## Place a small group in the open document

`live.placement.create_group` places up to eight objects through the original
palette and properties controls without reopening the map. The compact authoring
form avoids an object array, for example:

`live placement.group archive=Current.SC2Map windowId=123 type=Barrels points="26.5,26.5;28.5,26.5"`

Use `mode=stage`. Units require `layer=Units owner=1`; Doodads are the default.
Names must be exact palette display types. Each object is verified separately,
and a failed or unknown placement stops the group without repeating it. Earlier
objects remain in the open document; this is not an atomic transaction. Save
the current file separately when requested. Terrain and editing existing GUI
graphs directly still require other supported workflows.

For a longer series, use `live.placement.job_start` or compact
`live placement.start ... points="x,y;x,y" saveOnComplete=true` and poll
`live.placement.job_status`. The job accepts up to 50 placements but the
existing scene (8192) and matching-type (64, including newly created objects) limits still apply. The 64-object bound retains full property comparisons but may be slow; it has not yet been accepted with a native large-type placement run. The optional
same-file native Save runs once only after every placement succeeds and includes
other unsaved edits. Cancellation waits for the current placement; it cannot
interrupt a Save already submitted. Job IDs and progress belong to the current
MCP process and disappear on restart; inspect the open map after a disconnect,
never replay an uncertain series. The series preflights total and matching-type capacity and explicitly requested names against the first complete scene snapshot; duplicate names or invalid name characters stop before placement. It caches each exact palette lookup for the series, while the native create path still checks the palette hash and exact row before each placement; other errors can still leave an incomplete series. The series is not atomic.

`live.placement.inspect` pages the current scene with `offset`/`limit` and
`nextOffset`; carry `sceneHash` as `expectedSceneHash` on subsequent pages.
Use the corresponding fresh snapshot and object key with
`live.placement.inspect_object` to read one object's native coordinates and
name, even when the scene has more than 32 objects. Large-scene inventory and
one object's verified move were checked on a 406-object fixture; a palette
creation was verified on a separate 312-object fixture.
Native placement at the viewport centre and exact movement of every object
type remain unconfirmed; a failed or unknown result must not be replayed.

## Whole-map height field in the open document

`live.terrain.flatten_all` uses the original Editor's **Modify Height Field**
dialog to set one height across the entire current map. Both `entireMap=true`
and `clearUndo=true` are mandatory: the Editor warns that this operation cannot
be undone and clears all existing Undo history. Call it only when the user has
explicitly authorized those consequences. It can affect cliffs, ramps, terrain
paths and manual sculpting. A matching original warning is accepted once; other
or manually changed dialogs are left alone. The dialog acknowledgement does not
independently verify the resulting terrain, rendering or pathing. Save separately
when requested. This does not implement a regional brush.

## Rename an existing GUI item

`live.trigger.tree` pages the current Trigger Editor tree, returning at most
128 nodes per call. Pass `nextOffset` and the first page's `tree.fingerprint`
as `expectedFingerprint` to reject a changed tree between pages. Native
selection and edits use a fingerprint of the complete tree, up to 8192 nodes.
Labels beyond the native bound or trees deeper than 16 levels are refused. Use
`live.trigger.rename` with an exact slash-separated path such as
`MAIN/Wave Start` and a new name to invoke the Editor's own Rename command.
The path must identify a unique child at each level; sibling name collisions,
inaccessible inline editors and trees over 8192 nodes refuse. The native tree is
checked after the command, and the map is saved separately when requested.
For variables, use the name as displayed in the tree, including any type suffix;
the original inline editor receives only the new name. The native suffix is
preserved and verified on readback.
For an existing trigger, `live.trigger.append_action` can append the built-in
`skip_remaining` action or `wait` with an explicit `seconds` value in Game Time.
It uses the original Action and Real dialogs, checks the new action is last,
and verifies the Wait parameter separately. If parameter editing stops after the
action was created, the result is partial: inspect the existing action, never
append it again blindly. Other action and event types, general graph edits,
compiled runtime behavior and localization remain separate capabilities.
An explicitly selected `builtin_default` action uses the exact built-in name,
optionally its category, and `useDefaults=true`. Its default parameters may be
incomplete or invalid; inspect, configure and validate them before relying on
the action. A successful insertion returns `needs_parameters` and stops a
compact batch before later mutations or Save. Custom Script is rejected.
`live.trigger.append_event` also supports `event=periodic seconds=...` in Game
Time, configuring and verifying the interval in the original Real dialog.
`live.trigger.details section=events` supplies 1-based indices and a guarded
fingerprint for `live.trigger.set_periodic` to edit an existing interval.
An exact built-in event by name can instead use `useDefaults=true`; it returns
`needs_parameters`. Native GUI readback is distinct from runtime registration.
`live.trigger.append_numeric` combines insertion with one named literal Real
or Integer parameter in a single call, for actions and events. Its compact form:

`live trigger.append_numeric archive=Current.SC2Map windowId=456 path="MAIN/Start" kind=action name="Set Global Time Scale" parameter="Time Scale" numberType=real value=2.5`

If other parameters exist, it returns `needs_parameters` and stops a batch
before Save. If setup fails after insertion, inspect the existing item and do
not repeat the insertion. Compilation and gameplay are separate checks.
`live.trigger.details` pages existing direct actions with 1-based indices;
`live.trigger.set_wait` requires that page's `detailFingerprint` as
`expectedDetailHash` and changes the duration of one existing literal Game Time
Wait through the original Real dialog without adding another action. Variable,
expression and non-Game-Time waits are refused. Neither command saves the map.

`live.trigger.parameters` lists direct parameters of an action or event selected
by the 1-based index and guarded detail fingerprint from
`live.trigger.details`. For a direct literal number, use its index and the
returned parameter fingerprint with `live.trigger.set_real` or
`live.trigger.set_integer`, matching the parameter type. The original editor
dialog is used. Existing nested expression leaves can be selected with
`parameterPath`; replacing an expression, variable source or mismatched numeric
type is refused. After a single submission the editor tree is checked;
an uncertain result is never retried automatically. Save separately when
requested. For example, Set Global Time Scale has been edited in the open
editor, as has the Integer count of a Create Units action. This does not
establish compilation or gameplay for arbitrary actions.

`live.trigger.set_unit` uses the same detail and parameter fingerprints to set
one direct literal Unit Type through the original Game Link dialog. Supply the
exact displayed unit name. If the current catalog contains multiple identical
names, the operation refuses rather than guessing; this workflow verifies a
unique displayed selection and GUI readback, not a requested catalog ID. A
saved fixture confirmed the chosen Murloc Marine link. Variables, expressions
and other link kinds still require separate support.

`live.trigger.set_point` uses the same guarded workflow to select one existing
named map point through the original Point dialog. Names must uniquely identify
a displayed point; duplicates and missing points refuse. It does not create
points or accept arbitrary coordinates. On a saved fixture, GUI readback and
the persisted point reference were verified; compilation and gameplay remain
separate checks. Save the current map separately when requested.

## Nested GUI branches and expression leaves

The existing live commands resolve an AI/Terrain/Triggers window to the same
open document's Trigger Editor. The AI panel and existing unsaved changes do
not require closing, a checkpoint copy or a preliminary Save.

`details` accepts `section=actions|events|conditions`. Optional `groupPath`
walks one-based child indexes from that section, for example `3/1/1/2` into a
Then branch. Each returned item has `hasChildren`. Pass the fresh
`detailFingerprint` as `expectedDetailHash` on the next edit. Paths refer to
that snapshot, not permanent identities; inspect again after changes.

`append_action` can append inside a supported Actions/If-Then-Else body with
`groupPath` and a required `expectedDetailHash`. A compound built-in such as
If Then Else adds one subtree, including its native If, Then and Else groups.
The verifier compares structure, labels and sibling order; the Editor may
rebuild/recycle all tree handles after creating a condition. Existing sibling
changes and insertion in another branch still fail verification.

`append_condition conditionName=Comparison useDefaults=true` creates the
observed native default comparison through Configure Condition. It accepts
`section=conditions`, or `section=actions groupPath=...` pointing to an existing
If/Conditions group. It returns `needs_parameters`: the default comparison
(Owner of Triggering unit == 1) is not the requested gameplay condition by
itself. Other boolean functions and source/type selection are not implemented.
Never repeat a successful or uncertain insertion just to configure it.

`parameters` accepts the same `groupPath` plus an optional `parameterPath`
relative to the selected item's parameter root. This walks an existing nested
function, not a new custom script. For example, after inspecting the branch:

`live trigger.parameters archive=Current.SC2Map windowId=456 path="MAIN/Rounds" section=actions groupPath=3/1/1/2 itemIndex=1 parameterPath=2 expectedDetailHash=<fresh-detail-hash>`

The response lists children of that parameter container. `set_integer`,
`set_real`, `set_unit`, `set_point` and `configure` retain both paths. A numeric
leaf inside `(30 + (Round * 10))` can change to 42 while its parent expression,
variable references and unrelated siblings are preserved. `configure` names
are relative to the selected parameter container; append/configure helpers
retain the selected nested action group. User paths are bounded to 16 child
steps and full native tree reads to 8192 nodes.

This is still not arbitrary GUI graph replacement. Creating/rebinding local
variables, changing a parameter between literal/function/variable sources,
changing types, callbacks/references, deleting/reordering arbitrary blocks and
translated trigger content remain separate missing operations. Native GUI
readback, same-file Save, native compilation and gameplay are different checks.
A Toolkit compile of a saved archive does not validate unsaved editor changes.

### Acceptance on 2026-11-14

On an owned original Editor 5.0.17.98310 test document, the adapter edited the
literal 30 to 42 inside `BaseReward = (30 + (Round * 10))`, inserted compound
If/Then/Else blocks under existing Else branches, created a Comparison eight
child steps into a branch, and configured a nested Wait to 0.2 Game Time
seconds. Native tree readback confirmed these operations. The saved archive
hash remained unchanged: these were in-memory edits, with no Save, checkpoint
or document reopen by the live commands. The owned test Editor was stopped
afterward; no user document was changed.

The focused regression run passed 304 tests, including structural verification
when the Editor recycles tree handles, wrong-branch and sibling-change rejection,
stale snapshots, selector propagation and uncertain commits without replay.
TypeScript and the C++/C# adapters built successfully. This does not establish
same-file persistence, compilation or gameplay of that newly edited fixture.
The native compile performed earlier loaded the saved baseline, so it is not
evidence that the unsaved 42-valued expression was compiled.

## Configure several existing GUI parameters

`live.trigger.configure` composes the existing literal setters into one guarded
operation for an existing action or event. Use `live.trigger.details` first and
pass its item index and detail fingerprint. The compact `edits` string accepts up
to eight semicolon-separated assignments, for example:

`live trigger.configure archive=Current.SC2Map windowId=456 path="MAIN/Start" section=actions itemIndex=2 expectedDetailHash=<fingerprint> edits="integer:Count=6;unit:Type=Murloc Marine;point:Point=MCP Spawn Point"`

Types are `integer`, `real`, `unit` and `point`. Parameter names must be unique;
unit and point values use unique displayed names and retain the limitations of
their individual setters. Every assignment is validated and every parameter
located before changing the map. Each verified edit returns the fresh editor
fingerprints that guard the next edit. A partial or unknown result must be
inspected without replay. Unedited parameters produce `needs_parameters`, not
an assertion that their defaults are correct. The call does not save or compile.
A real Editor fixture confirmed the three assignments and same-file persistence;
other actions, runtime behavior and gameplay remain separate checks.

`live.trigger.append_configured` also inserts a built-in action or event once,
then applies the same compact assignments to it. It validates the assignments
before inserting; an unknown or partial result may already have created the item
and must never be retried as another insertion. A real Editor fixture verified
insertion and the three assignments above, with two default parameters still
reported as unverified. The separate native Save confirmed persistence; compiler
and gameplay results were not assessed.

## Begin with an authorized same-file Save

When the user has requested saving, `live.refresh.begin` with
`mode=same_file_refresh` and `saveIfDirty=true` observes the original document,
saves existing manual edits once if dirty, confirms its related native modules
and saved revision, then prepares the same-file refresh session. A clean document
does not receive a redundant Save. The `saveIfDirty` default is false; a dirty
document then returns `save_required` without mutation. Dialogs, pending inline
input and unknown saves stop the workflow without repeating native commands.
The returned Save receipt is retained even if later preparation fails. A guarded
identity/revision comparison prevents preparing a different process or revision
after the initial observation. `live.refresh.prepare` remains available directly
for a clean document. These checks do not establish rendered or gameplay quality.
The same operation is available as the compact command
`live refresh.begin archive=Current.SC2Map windowId=123 mode=same_file_refresh saveIfDirty=true`
in `modkit.author` stage mode. Compact live receipts retain session/recovery IDs,
save outcomes and retry guards. A batch stops before later mutations when a live
Save or refresh is unresolved. A single resource change can use
`live refresh.resource sessionId=... action=add path=Assets/Art/New.dds source=Textures/New.dds`;
the detailed resource tool accepts an atomic multi-file group.
For a single MCP call, a compact script can reference an earlier refresh session
with `sessionId=@s1.sessionId` and supply multiple existing authoring commands in
a `<<TAG` block. The reference must point to an earlier begin/prepare/resume
step. The original batch dispatcher preserves sequential guards and stops after
an unresolved live result; separate command groups are not an all-or-nothing
transaction. The final apply is invoked only after prior authoring succeeds.
The native fixture first edited a UI buffer, confirmed that the default no-save
mode refused, then saved and prepared through `begin`; a subsequent text change
was refreshed in the same file and Editor frame. Eight previously observed UI
template/include errors appeared when that fixture opened its UI module; the
diagnostic snapshots and limits are recorded in the
[refresh-begin evidence](verification/editor-live-refresh-begin-2026-11-08.json).

## Resources in a same-file refresh batch

After `live.refresh.prepare`, `live.refresh.resources` accepts up to 32 changes
under `Assets/<folder>/`: `action=add`, `replace` or `remove`, with `path` and a
workspace `source` for additions/replacements. `expectedSha256` optionally pins
the existing target. One journalled transaction applies the complete group to the
prepared components; the current Editor document is unchanged until the usual
`live.refresh.apply`. The bound is 64 MiB per input/old file and 128 MiB total.
Source and destination bytes are checked again during commit. Executable and
tooling source files are rejected, including PE payloads with disguised extensions.
This operation does not repair Data references, prove that the Editor registered
the imported resource, or establish rendered/gameplay behavior.

The bounded native qualification replaced an existing resource, removed another
that was present in the original Import tree, added a third, and observed the
result in the same Editor process/frame and saved archive. A separate batch also
combined resources with localized text. Eight UI template/include errors were
present before this qualification's preparation and match earlier retained
reports. A Cutscenes invalid-data warning was timestamped during refresh; its
cause is unresolved. The diagnostic comparison began after application, so it
does not establish that the reload was warning-free. See
[resource refresh evidence](verification/editor-live-resource-refresh-2026-11-08.json).
The later [resource-policy check](verification/editor-live-resource-policy-2026-11-08.json)
extends source-code extension exclusions without replaying that native test.

Before closing the current map, package preparation now checks every emitted
component against the complete prepared tree. Original map export may add its
known Editor-load prerequisites; their exact expected bytes are independently
recomputed. Missing, unexpected or concurrently changed components abort before
Close. Reopening the packed archive is required; this check concerns bytes and
does not replace native model, rendering or gameplay verification.

## Ownership and application

`src/modules/editorLive/workspace.ts` owns the direct Data, placement, GUI-library,
UI, localized Text, resource imports, scalar, Save and same-file refresh backends
through one provider list, mutual exclusion, lifecycle and
capability report. The files in
`src/modules/live` retain checkpoint sessions and compatibility exports. Both
routes share the same current-document backend; they cannot create competing
copies of it within one workspace.

Direct Data commands and recipes prepare a working catalog, then submit it
through original Commit XML Changes. Working XML in tool-owned temporary storage
is allowed. Replacing the open map archive with an offline writer, importing a
checkpoint, reopening another map or starting another Editor is not part of this
direct-mode application path. The explicitly accepted same-file refresh variant
instead prepares complete components, releases the original document and reloads
the same path; it does not replace a locked open archive. See its lifecycle below.

Every native write retains exact process/window/document and source guards. A
native acknowledgement, native readback, same-file persistence, rendered result
and gameplay result are separate states. Unknown writes never replay. Native Save
includes the current unsaved user edits and remains a separate operation.

Each active same-file refresh project holds a process-scoped marker in the local
temporary directory in addition to its per-project lease. The updated Editor AI
panel checks these markers before automatically reloading its MCP configuration:
live process markers defer reload, and a failed reload is not marked as complete.
Marker creation and the panel's check/reload request use the same cross-process
workspace lock, closing the race in which a new refresh begins between the check
and reload. If that lock implementation is unavailable or busy, the panel defers
the update rather than guessing it is safe. This coordination requires both
processes to use the same temporary directory and current compatible code.
Owned original Editor tests prepared a text edit through MCP, including one
in-memory staged edit not yet saved to the component workspace. The panel guard
deferred a simulated reload request; after explicit save and same-file apply, the
edit was preserved in the same frame and the guard allowed the simulated request.
See [reload guard evidence](verification/editor-live-reload-guard-2026-11-12.json).
This does not test the actual Codex app-server reload or arbitrary staged binary
and multi-component drafts.
This prevents that automatic panel reload from closing a marked refresh session
and discarding its in-memory drafts. It does not prevent manual shutdown, process
crashes, reloads from other clients, or loss of snapshots from other providers;
older MCP processes without markers are not protected. Markers contain no map
content, dead process markers are ignored, and PID reuse can conservatively delay
an update. The updated panel and MCP must both be running for the guard to apply.

## Direct-mode scope

| Component | Available application | Remaining boundary |
| --- | --- | --- |
| Data | One current map-local XML dataspace through existing MCP recipes; guarded Unit scalars | First local Unit, additional localized/import components and general scalar selection are not qualified |
| Objects | Native filtered-palette Doodad/Unit creation; duplication, coordinates/names and bounded original Clear | Direct deletion checks visible properties in layers up to 32 objects, but does not inspect GUI, Galaxy or other references; whole-document object serialization preservation remains unresolved |
| Save | Original File > Save, same archive, related module captions/XML buffers and stable disk checks | Native errors, pending inline edits, dialogs and unknown outcomes must be retained |
| Terrain | Existing offline authoring remains available | No current-document component application provider |
| GUI triggers | Existing typed generator prepares a new self-contained library; original Import Library applies it to the current document; original export verifies the new graph | Existing-graph replacement/editing, translated/non-name text, other libraries and map-instance references remain unfinished |
| UI | Original Add Layout and current map-local XML buffers; existing typed UI operations and grouped compact commands | Additional linked Text/style/import files remain separate work; buffer readback alone does not qualify native persistence/rendering |
| Text | Original locale export/import; existing typed Text writer and compact commands; native same-file Save plus post-save verification | One exportable locale per batch; deletion, unexported strings, fonts/styles and linked component groups remain unfinished |
| Imports | Original Import Files and folder picker add new resource files under Assets; original tree readback and post-save byte verification | Add-only, flat staging, 16 files/1 MiB each/8 MiB total; replacement, reserved components and linked application remain unfinished |

For Units, explicitly select `live.placement.prepare layer=Units` before inspection.

For a larger layer where direct deletion refuses, the accepted same-file refresh
route can use the compact `objects remove ids=101,102` command after identifying
the exact component IDs using paged `placement.scan` (`offset`/`limit`) inside
the prepared session. The Editor's live `objectKey` is a list-view key and must
not be treated as the component ID. Removal does not rewrite Trigger/Galaxy
references; inspect those separately. Automated component tests now page a
66-object fixture through the actual registered tool, remove 40 exact IDs through
compact authoring, and check the untouched source nodes and custom fields. This
does not itself exercise the refresh lifecycle or an original Editor. A separate
native Editor test used the same-file refresh on a private 1,128-object map and
removed 40 exact Doodad IDs. The original frame and process reopened the same
file, all remaining object records matched, and Triggers bytes were unchanged:
[large removal evidence](verification/editor-live-large-removal-2026-11-12.json).
This evidence does not validate original Editor per-instance readback, visual
appearance, gameplay, collisions, or references to the removed IDs.
For candidate placed-unit IDs, `objects unit_refs ids=101,102` (or
`placement.gui_unit_references`) checks explicit typed unit literals in the
selected `Triggers` component. It reports the owning GUI element and reads
staged text. This is a read-only, partial check: Galaxy, Custom Script, other
libraries, dynamic IDs, Doodad references and other representations remain
uncovered. Zero results do not prove deletion is safe; the tool does not rewrite
references. Batch planning and placement apply refuse a Unit removal if they find
one of these exact GUI literals. Apply checks again in the transaction and records
the Triggers read as a dependency, so an intervening change also blocks a later
staged save. This guard does not cover the other reference forms above. Run the
read-only check in the prepared refresh session using `live.refresh.author` to
inspect known references, then assess the uncovered forms separately.
Two separate original Editor captures of the saved before/after revisions show
one tree disappearing while a nearby conifer remains. Both use the same verified
camera; the visible tree was not tied to an individual component ID. See
[render evidence](verification/editor-live-large-removal-render-2026-11-12.json).
The same snapshot/instance/property workflow duplicates or moves a Unit and
preserves its owner. The final native qualification created a ninth Unit from an
existing Odin, confirmed `(24, 24)` and saved the same archive. Earlier properties
timeouts were retained; after changing message handling, the targeted case passed.
This qualifies the existing-template path, not arbitrary Unit types, every Unit
property, rendered animations or gameplay. See the
[scoped verification record](verification/editor-live-module-2026-11-07.json).

The Doodad input guard now distinguishes input directed at the owned properties
dialog from unrelated pointer movement. The delayed baseline still preserves
early field input and later property fingerprint changes. An empty or nonnumeric
coordinate is not accepted as zero. Only the visible active layer is reported;
cached hidden layer controls do not establish context.

## New types from the original palette

Call `live.placement.prepare` with the desired layer, then `inspect`. Use that
fresh snapshot in `live.placement.catalog query=...`. The returned rows are exact
original display names, not Data IDs; active Editor filters still apply. Pages
contain at most 16 matches and a whole-palette stale guard. Selecting List style
changes UI presentation only.

Pass the snapshot, exact `catalogRow`, `catalogHash`, `type`, half-grid `x/y` and
unique `name` to `live.placement.create`. Units require an explicit `owner`;
Doodads reject it. The original palette/owner controls select the native brush.
The palette response lists available owners. `expectedId` can additionally pin
the native brush's catalog ID before creation, independently of its display name;
the returned `nativeCatalogId` is not a Model ID. Unknown native IDs remain null.
One click creates the object, existing properties are compared, and original
properties set/verify its coordinates and name. No existing instance of that
type is required. It uses no clipboard or map archive writer.

The Editor can adjust Doodad coordinates for its native footprint/grid rules.
Requested `(26, 26)` for Barrels read back as `(26.5, 26.5)` in the native test.
That receipt correctly remained `verification_failed`. A fresh snapshot of the
same instance confirmed the legal half-cell coordinates before native Save;
creation was never replayed. Do not convert such mismatches into a success or
create another object. A lost/ambiguous creation also remains unknown/partial.

The native qualification created a previously absent Zergling for owner 1 at
`(6, 26)` and a previously absent Barrels Doodad, preserving every prior placed
object in both native-saved archives. Models, animation and gameplay retain
their separate acceptance requirements.
See the [live catalog evidence](verification/editor-live-catalog-2026-11-08.json).

## Bounded native deletion

`live.placement.delete snapshotId=... objectKey=...` consumes a fresh active-layer
snapshot. The original Clear command requires one exact selected Doodad/Unit,
matching source row/type/name, scene hash, process and saved archive. Layers over
32 objects refuse before properties are opened. Every surviving instance's
visible native properties are compared as a multiset, because rows can reindex.
Unknown results never replay, and native confirmation dialogs remain untouched.
The operation does not save or reopen the map.

The owned fixture removed exactly its selected Zergling and Barrels, and native
Save persisted those two removed IDs. All other active-layer property fingerprints
matched; Triggers, UI and localized text stayed byte-equivalent. The saved Objects
comparison nevertheless found four changed surviving nodes. The exact pre-run
Objects component was not retained, so these differences are not dismissed as
formatting or attributed conclusively to inspection versus native serialization.
Whole-document object preservation remains unaccepted. Future targeted native
checks retain both component versions; do not recreate/delete the passing targets
just to renew evidence. See [deletion evidence](verification/editor-live-delete-2026-11-08.json).

## Current GUI library application

Game Link literals now use the same document's original Data lists, rather than
an empty generator workspace or a mirror of last-saved catalog XML. The adapter
temporarily selects the native catalog, All Data and raw-ID search, requires an
exact unique ID and source, then restores its owned filters. `live.trigger.catalog`
accepts up to 32 domain/ID references and an AI/Terrain/Triggers/Data window ID.
Loaded dependencies and committed unsaved local objects qualify. Pending XML,
inline edits, changed filters, unavailable native domain views and unresolved IDs
stop without dismissing input or submitting a trigger import.

`live.trigger.create` binds only these verified identities to the existing typed
generator, including batch planning. It rechecks the live identities before native
Import Library; disappearance/source changes refuse as stale. No fake Data entries
or game assets are added to its component workspace. Evidence covers exact identity
and source, not effective field values, model playback, native compile or gameplay.
These checks do not provide an authoritative engine document/revision lock against
concurrent human edits. Catalog views not exposed by this English native Data UI
remain unsupported. The same-ID case is significant (`move` differs from `Move`).

The retained native check resolved Unit, Ability and Effect identities from loaded
dependencies and from newly committed, unsaved local XML. A generated GUI library
then retained those custom Unit/Effect initializers plus a native Marauder creation
action. Original re-export omitted redundant `ValueType.GameType` attributes; the
comparison now normalizes them only when the owning VariableType or exact Core
ParamDef independently establishes that same single domain. Wrong/unknown domains
still differ. Verification was recovered on the already imported library, without
replaying import. The saved archive changed and its original generated Galaxy
retained the library, custom initializers and Marauder creation. The Save receipt
remained unknown because the semantically committed Data XML still had its native
modified flag; Save was not replayed. Clean-document acknowledgement, native
compilation and game execution are not claimed by this check.

`live.data.append_xml` exposes the existing add-only XML commit path for 1–64 new
entries in one `live.data.read` snapshot. Replacements/duplicate domain+ID entries
refuse. It requires an existing local Unit anchor and preserves snapshot, archive
and pending-input guards. Native XML readback is not complete Data validation;
use the existing typed recipes for common mechanics and save separately.

For new self-contained GUI systems prefer `live.trigger.create` with an inline
typed `plan` (one existing trigger request or a batch). It accepts the current
AI, Terrain or Triggers window, resolves the same process/document's Trigger
Editor, and opens that native module when necessary. Existing unsaved work and
the open AI panel do not require an advance Save. Genuine blocked native dialogs
still refuse without dismissing user input. No external plan file, workspace
change, map copy or reopen is needed.

For periodic mineral income, use a single compact command:

```text
live trigger.income archive="K:/Maps/Current.SC2Map" windowId=<current-window> player=1 every=5 amount=100 name="Mineral Income"
```

The recipe uses the shared typed generator for a game-time periodic event and
an Add Minerals action. It does not save implicitly. For requested same-file
saving, follow with `live.document.status` and `live.document.save` using the
returned archive hash. Preserve `planId` and verification status on uncertain
results; never repeat an import to recover missing acknowledgement.

The separate staged workflow uses the exact current **Triggers** window from
`live.windows`. `live.trigger.inspect` reads bounded original root labels.
`live.trigger.prepare archive=... windowId=... name="Round system"
planFile=plans/rounds.json` (or inline `plan`) reuses `trigger.plan_file`, `trigger.apply` and
`trigger.save` in a tool-owned component workspace. The saved plan contains one
existing typed GUI request or a batch, with no new map archive. Its generated
folders, events, actions, functions and variables remain ordinary editable GUI.

`live.trigger.apply planId=...` consumes the prepared library before native
submission, invokes the original Import Library file dialog and re-exports the
uniquely named new library. The native import file is SHA-256 checked and held
read-only while the original command runs. Only the tool-owned unchanged dialog
may be submitted/cancelled. User dialogs and manual input remain protected.

The library transfer embeds English display names. Currently only self-contained
root graphs and implicit `Ntve` references qualify; custom script, map-instance
references, translated strings and other localization forms refuse before import.
This adds a new native library; it does not replace existing map-root or library
graphs. The existing graph compiler/converter remains the generator, not a second
trigger implementation inside the live adapter.

The Editor reorders element definitions and unique scalar metadata on export.
Verification normalizes those known changes while retaining executable reference
list order, IDs, all field values and meaningful literal whitespace. The initial
native receipt retained `verification_failed`; `live.trigger.verify` checked the
same already-imported library after the comparison correction. Import was not
replayed. This recovery tool selects and exports a named current library against
a saved expected component file without changing map content.

The qualification imported two GUI triggers, a shared integer, native map-init
and periodic events, assignment and arithmetic into real `MAIN`/`GAMEPLAY`
folders. Original re-export matched, then `live.document.save` saved the same
open fixture archive. Native compilation, game execution and arbitrary existing
graph edits are separate requirements. See the
[GUI library evidence](verification/editor-live-gui-library-2026-11-08.json).

## Current UI layout application

Use the exact current **UI** window, archive and layout name with
`live.ui.create` to add a new local layout through original Add Layout. This
native command opens its name dialog asynchronously. Its token/input guard stays
alive across that deferred opening, protects early manual input, and releases
only its own hooks after closure. Unknown submissions never replay. Existing
layout names refuse before creation.

`live.ui.read` snapshots the current layout XML, including pending typed content.
It selects the map-only source filter or another layout only if that preserves
manual XML. An already selected pending buffer is captured without moving focus
or selecting the tree again. Whole-buffer, archive, window and process guards
apply before `live.ui.author` writes once. `live.ui.release` drops unused tokens.

`live.ui.author` reuses the existing UI writer/schema/transaction engine. Omit
`file=` inside this scope. `apply=false` prepares; `apply=true` submits the
candidate to the original XML editor. Ordinary commands are concise:

```text
ui frame type=Frame name=Panel width=360 height=100 left=48 top=48
ui frame type=Label name=Status parentPath=Panel width=340 height=40
ui property framePath=Panel/Status property=Visible value=true
ui anchor framePath=Panel/Status side=Top pos=Min offset=8
ui remove framePath=Panel/Status
```

Advanced typed operations use `ui.apply operations=...` with the existing
operation schema, including clone, state-group and animation operations.
Adjacent compatible commands coalesce up to 100 operations into one original
atomic `ui.apply` and one component save. Result references, explicit source
guards, command-scoped aliases and alias paths retain their boundaries. Invalid
groups leave no earlier partial UI candidate saved. Additional component files
refuse before a native XML write. The common layout writer now expands native
self-closing `<Desc/>`/`<Frame .../>` containers by replacing only their own span;
it preserves unrelated attributes, comments and sibling bytes.

A `buffer_applied` result proves native XML readback, not rendered appearance or
full native model acceptance. Native File > Save flushes the UI model. The
qualification then checked the saved registered layout against the prepared XML
and inspected its native Frame/Label tree. Original Add Layout created the
`DescIndex.SC2Layout` Include without an offline archive edit. Fifty further
distinct frame operations used one typed UI group and persisted to the same map;
existing Objects and Triggers remained byte-equivalent. The work used one Editor,
with no application-time map copy/reopen. See the
[UI evidence](verification/editor-live-ui-2026-11-08.json).

Current bounds: 1 MiB per XML buffer, four 10-minute snapshots, 128 local layout
roots and ASCII layout names up to 80 characters. Linked Text, styles and imports
remain unsupported in the same batch; native visuals/gameplay remain separate.

## Current localized Text application

Use the exact **Text** window and existing locale with `live.text.read`. It
exports original local text, including GUI names/hotkeys, without saving the map.
`live.text.author` runs the existing Text writer in a component workspace. Compact
`text set key=DocInfo/Name value="Map title"` defaults to the captured locale;
`table=TriggerStrings` or `table=GameHotkeys` chooses another native text table.
Literal value whitespace, rich text and other tables are preserved. Additional
styles/assets/locales and key removal refuse before native submission.

`apply=true` returns **import_submitted**, not verified text. The original
locale exporter continues to read its previous cache until original File > Save.
Repeating import against that cache can overwrite pending work. The adapter
therefore reserves a bounded shared pending record before submission. It blocks
further Text snapshots/writes across MCP sessions, retaining unknown outcomes.
After an explicitly requested `live.document.save`, call `live.text.verify` with
the returned `pendingId`. It compares a fresh native export, checks the same
clean changed archive and resolves the guard without replaying import. A
conflicting manual result remains `verification_failed`; it is not normalized
into success. Component source bytes and exact owned parent/child file dialogs
are guarded, including their locale checkboxes and deferred transitions.

Native qualification changed a map name, GUI trigger name and hotkey, plus a
second locale, then confirmed actual saved text tables. A further clean-document
case checked dirty-state transition, same-file Save, cross-session pending guard
and native re-export. Objects, GUI graph and existing UI layout stayed
byte-equivalent. No application-time map copy or reopen occurred. Unreferenced
strings absent from native export, visual rendering and gameplay remain outside
this evidence. See [Text evidence](verification/editor-live-text-2026-11-08.json).

## Immutable helper lifecycle

`npm run live:build` builds the C# bridge into a source-tagged immutable
`native/bin/windows-x64/live-bridge/<tag>/sc2-mcp-live.exe`, then activates a pinned
`sc2-mcp-live-bridge.json`. Existing helper clients keep their loaded version;
another chat's locked EXE does not require killing it or the Editor. A new client
verifies the activated binary hash. An invalid manifest never silently falls
back to the stale fixed-path helper. Legacy installations without a manifest
and the explicit `SC2_LIVE_BRIDGE` override retain compatibility.

The separately versioned native adapter remains under `live-memory/<tag>`.
Portable packaging copies only the activated helper/native versions with their
manifests. The panel's runtime fingerprint includes both manifests and current
provider modules so the next supported connection refresh can observe updates;
editing source alone does not prove an already-running chat has reconnected.

## Current resource imports

Use `live.import.prepare archive=... windowId=... prefix=Assets/MyEffects/`
with `files=[{source: "resources/Glow.dds", name: "Glow.dds"}]` in the exact
**Import** window. Sources must be regular workspace resource files. The adapter
checks both the complete bounded native Document Files tree and saved archive
entries, then stages only the resource bytes in a unique tool-owned directory.
It does not copy or replace the open map archive.

`live.import.apply snapshotId=...` consumes that snapshot and opens the original
Import Files dialog, selects the staged directory through its original folder
picker, verifies the checked files and target prefix, and submits once. Native
read handles pin all staged bytes and their SHA-256 manifest until the original
handler returns. Manual input or stale component/process/archive state refuses.
New paths and preservation of prior visible paths are checked separately.

Keep the returned `pendingId`, including after unknown submissions. The shared
pending-component journal also serves localized Text without changing its
existing record format. It serializes against the original Editor process lease
and survives MCP session closure. Request native same-file Save separately, then
call `live.import.verify` with the exact Import window and pendingId. Verification
compares the saved resource bytes; it never repeats the import. A clean saved
conflict remains `verification_failed`, rather than being overwritten.

The native qualification imported one new text resource through public MCP,
observed the new original tree path and pending-save state, saved the same map,
and verified exact bytes. Objects, Triggers, t3Terrain.xml, the tested UI layout
and three English text tables were byte-equivalent before/after. This is resource
persistence evidence, not rendered model, terrain geometry or gameplay evidence.
No existing fixture is replayed to renew this result. See
[resource-import evidence](verification/editor-live-imports-2026-11-08.json).

Current limits are 16 flat files, 1 MiB each/8 MiB total, 128 native tree nodes and
four ten-minute snapshots. Destination prefixes stay under `Assets/<folder>/`.
Reserved map components, executable/source distribution, replacing/removing
existing imports, larger models and atomic UI/Data/Text dependencies are separate
unfinished application paths. A prepared snapshot can be released; an uncertain
submitted import cannot be silently discarded or replayed.

## Same-file refresh with existing generators

The user accepts updating the same map file followed by the original Editor's
external-change refresh/OK confirmation. That explicitly permits this alternate
application path when native reload, unsaved-buffer preservation and component
readback are proven. It does not authorize another working map or blindly
dismissing save/dependency/error dialogs. The original direct-document providers
remain available independently.

The first controlled packed-map probe attempted an export with unchanged
component content to the current `Qualification.SC2Map`. Original `map.import`
and `map.export` were used through MCP; the dry run required no placement-load
changes. Publication failed with `EPERM` at the atomic rename. A separate
non-writing read/write-open probe returned `EBUSY`, and Windows Restart Manager
identified the same SC2Edit process as the locking owner. The saved source hash
stayed unchanged. No external change was applied, no reload notification was
qualified, and no dialog was automatically accepted. Local evidence is retained
under `work/live-placement-20261107/SAME_FILE_*`.

The follow-up native source-release probe succeeded. The adapter checked a clean
document, no pending writable XML buffers or focused inline editor, and a fresh
native frame fingerprint. Original File > Close released the map while preserving
the same Editor process and empty Terrain frame. A non-writing read/write-open
then confirmed the archive was no longer locked. The existing native file-drop
handoff reopened the same path in the same frame/process; the source hash stayed
unchanged. This qualifies clean release/reopen only: it did not publish changed
components, prove dirty-buffer recovery, or create public refresh authoring tools.
See [source-release evidence](verification/editor-live-refresh-2026-11-08.json).

The implemented `same_file_refresh` provider now reuses all existing component
generators. Select this mode when the user accepts reloading the same file; that
acceptance persists in the conversation. It is distinct from direct memory edits
and from the separately requested checkpoint workflow. There is no need to ask
again for every package. The current implementation uses original Close/Open to
release the archive lock; it does not depend on an external-change notification.
It resets native Undo and requires one clean current map/mod document. Native
dialogs remain visible; save, dependency and error prompts are never auto-accepted.

1. Call `live.refresh.prepare` with the current archive, exact Terrain window and
   `mode="same_file_refresh"`. It captures the source revision and extracts a
   private component workspace without changing or closing the visible document.
2. Use `live.refresh.author` for repeated compact command batches, or
   `live.refresh.call` for existing detailed authoring/query tools. Data, Terrain,
   placements, GUI, UI, Text, settings, lighting and resources reuse their existing
   writers and validation. No new working map, nested live session or test worker
   is created. Commit complete component groups before applying.
3. Call `live.refresh.apply` once. It validates and packs first, rechecks source,
   process, native frame and pending buffers, retains an internal rollback archive
   and shared recovery journal, then closes the original document, atomically
   publishes to the same path and opens that path in the same Editor/frame.
4. Inspect the returned status, changed components and actual native readback.
   `refreshed` establishes same-file publication and loading, not visual/gameplay
   acceptance of every generator or a promise that the Editor will remain stable.

`publication` reports the observed on-disk revision (`original`, `candidate`,
`conflict`, or `unknown` after a failed inspection). `sourcePublished=true` can
accompany `pending_open` or `pending_native`: the file contains the prepared
package while the Editor is still loading or requires attention. A matching clean
title alone is insufficient; native clean-document inspection must also pass
before `refreshed` is returned. Saved revisions are rechecked after inspection.

If the MCP session ends during preparation, `live.refresh.resume` takes the
preserved `preparedDirectory` and exact current Terrain target. It validates the
original source hash and refuses a live prepared-project owner. It preserves
completed commands instead of generating them again. Release unused sessions with
`live.refresh.release`; their component files remain available.
Prepared-project ownership and stale-owner reclamation use the existing shared
workspace lock, independently of the per-Editor native lease. Two Editors or MCP
connections cannot concurrently reclaim one abandoned preparation.

Package validation and staging live in `refreshPackage.ts`; session coordination
remains in `refresh.ts`, native state transitions in `refreshTransfer.ts`, and
prepared ownership in `refreshProject.ts`. When the workspace and original map
are on different volumes, a verified internal package is staged in a unique
`.sc2mcp-refresh-*` directory beside the map before any native Close. Publication
then remains a same-volume rename. `Staging.json` records this internal artifact;
it is never opened as a working map. Same-volume workflows avoid this extra copy.
An existing valid rollback from a failed pre-close reservation is reused after
hash verification; conflicting rollback bytes are retained and refuse application.

After an uncertain native apply, keep `pendingId` and use `live.refresh.recover`.
Recovery never repeats Close or publication. It compares the exact original
process/frame and archive hashes; a persistent opening marker permits only one
original file-open request. Conflicting documents, dialogs and manual edits stay
untouched. Prepared edits and `OriginalArchive.rollback` survive failed refreshes;
this recovery artifact is not another user working map. Source handles are never
force-closed. A replaced process/frame requires explicit further recovery work.

A public MCP package of 55 commands applied 50 UI frames, Unit health, a bounded
height edit, localized text and one Marine placement to the same file. The final
settings command was a no-op. Original UI XML and Unit health were read back after
reloading in the same process/frame. A later placement-layer inspection timed out
and the Editor process disappeared; its graphics log records a DirectX error but
the termination cause is not established. Scene, terrain-native and gameplay
acceptance therefore remain separate incomplete checks. Historical source-release
evidence above is retained unchanged.

See [mixed-package evidence](verification/editor-live-refresh-package-2026-11-08.json).
A subsequent read-only launch reported that the graphics device was unavailable,
before scene inspection could proceed. No application package was repeated and
other game processes were preserved. The fresh MCP contract exposes API
`editor-live-2026-11-08-refresh` and seven refresh tools. An older attached
connection still reported `editor-live-2026-11-08-gui-library`; it must reconnect
to expose current tools. Panel runtime fingerprints and authoring guidance now
include refresh providers, but this does not hot-reload an already-running chat.

Subsequent native inspection confirmed ten Units, including the added Marine at
`(8, 12)` for player 1. The actual viewport displayed Marine/Odin models, ground
textures and point lights; this is bounded visual evidence, not every terrain
cell or gameplay. The saved archive remained byte-identical. A real three-document
case refused refresh before preparation; the clean qualification document was
closed and the original dirty document restored without Save. Original `-loadfile`
can forward to an existing Editor instead of creating another instance, so test
setup must not assume a new PID owns the opened document. See
[resumed readback evidence](verification/editor-live-refresh-readback-2026-11-08.json).

A later native before/after camera comparison used the retained original and
result of that same package, with matching map hashes and identical confirmed
camera parameters. The after image visibly shows the local raised surface.
This establishes bounded rendering evidence, not navigation, exact numerical
height, or all terrain operations. See
`verification/editor-live-terrain-render-2026-11-08.json`.
On the same saved result, an owned game test also observed a Marine reaching
the raised area's center `(22, 10)` and returning to `(19, 10)` after normal
move orders. The intermediate route was not sampled; this single unit and
location do not establish navigation for all terrain edits. See
`verification/editor-live-terrain-movement-2026-11-08.json`.

The resumed case also exposed a binding gap: long filenames can leave only
`/directory/basename` after the title's ellipsis. That gap is now addressed for
local `.SC2Map` archives by the shared `documentIdentity.ts` boundary. Exact and
guarded multi-directory captions keep their existing route. A shorter map caption
is only a candidate: the helper additionally requires the exact archive to be
owned by the same Editor PID/creation time and exactly one matching name in the
original Window menu. It rechecks the frame and document list after inspection.
Windows Restart Manager is used only for read-only ownership discovery; no restart
or shutdown API is declared. No Save As dialog, application input, hidden test DLL
or title-only cache is used. Scalar, Data, placements, GUI, UI, Text, imports,
document Save and refresh recovery share this guard.

Short Mod captions, duplicate names, missing ownership, mismatched roots/suffixes
and changed frames refuse. These checks do not provide a native document/revision
ID. Original descriptor schemas stay unchanged. The immutable C# bridge now builds
`ArchiveIdentity.cs` alongside its existing sources; old connections retain their
loaded binary and need a supported reconnect to observe the new manifest. Public
MCP accepted the real long-name map and rejected an unowned same-name file in
another matching-suffix directory without altering the source. Writable XML-buffer
and broader component-native acceptance remain incomplete.
See [document-identity evidence](verification/editor-live-document-identity-2026-11-08.json).

Refresh refusal reports `LIVE_REFRESH_SINGLE_DOCUMENT_REQUIRED` for a multi-document
case and `LIVE_REFRESH_NATIVE_DIALOG_PRESENT` for native dialogs. Remaining dirty
or pending buffers retain `LIVE_REFRESH_SAVE_PENDING_BUFFERS_FIRST`. A staged
package that becomes stale preserves `LIVE_REFRESH_STALE_DOCUMENT` with its cause;
do not keep saving to work around an open-document-count restriction.

## Component process context and persisted UI buffers

`transferDirectory.ts` resolves UI, Data, GUI-library, locale and resource-import
transport under the selected Editor's reported per-user `.sc2mcp/transfer` store.
The client may have a different TEMP/TMP, including an SDK-owned private Editor.
AppData writes from a packaged Codex client can also be redirected into its own
LocalCache, making them invisible to the original Editor. The shared physical
store is outside that redirection and keeps original dialog paths below MAX_PATH,
including the longest accepted import filename. The pinned adapter's read-only
operation supplies the paths; no application desktop is switched. Fixed
namespaces, regular directories, realpath and native parent/file reparse guards
remain enforced. Native file I/O uses extended Windows paths; original dialogs
retain their normal display paths. Arbitrarily long user-profile paths refuse
before the dialog instead of pretending legacy Shell controls support them.

Native File > Save can persist UI source while its Scintilla modified flag stays
set. `savedUiBuffer.ts` reads only the selected map-local layout, compares exact
bytes to the stable saved archive, then acknowledges that buffer's savepoint.
The final original native command rechecks the source fingerprint and clean
window. It changes no source or Undo history. Different, unknown or concurrently
edited buffers are preserved. `live.document.save`, including `already_clean`,
reports these observations separately from archive persistence. A reconciliation
error never turns a known saved archive into an invented failed Save or permits
automatic replay.

The isolated pending-UI fixture qualified refusal without changing its pending
source or saved archive. A later same-file package introduced a real GUI folder,
trigger/variable, linked timer layout/styles/DescIndex, player color and text,
then reloaded in the same PID/frame. Native UI XML and tree readback are separate
from rendering and gameplay. See the
[transfer-context verification record](verification/editor-live-transfer-context-2026-11-08.json);
the earlier historical reports retain their original sources and limitations.
Current physical-store/native-export and deployment observations are recorded in
[shared-transport evidence](verification/editor-live-shared-transport-2026-11-08.json).

`documentState.ts` is the shared observation boundary for status, Save decisions
and post-Save acceptance. Native inspection includes hidden related module frames
and writable XML buffers of the same document, rather than trusting Terrain's
caption alone. Read-only generated code and unmodified search controls are not
pending edits. A focused native inline value or modified text input refuses Save
until that existing edit is completed. An outdated native state response refuses
instead of silently falling back to a clean-looking caption. Original File > Save
is requested once; acceptance requires stable same-file bytes and clean related
modules, with exact saved-UI reconciliation where applicable.

The related-module fixture imported a new native GUI library, saved the original
archive and re-exported the same graph. Both Terrain and Triggers were dirty in
that native run; the clean-Terrain/dirty-related-frame boundary is covered by the
adapter regression, not claimed as an additional native observation. Library
file dialogs can enter their modal loop before the initialization timer has
observed them. Matching token/root requests wait for that initialization without
reopening or resubmitting import. The original failed, pre-submission attempt and
its guarded owned-fixture cancellation remain in the evidence.
See [document-state evidence](verification/editor-live-document-state-2026-11-08.json).

The final shared-store qualification added a resource through original Import
Files, saved to the same archive and verified exact saved bytes and preservation
of previous native import paths. Fresh native UI, Data XML and localized Text
exports also use the shared physical store. The Data initializer now observes
the original list selection before changing view and restores that same anchor
once if XML View cleared it; a new manual XML buffer prevents reselection.
Native module initialization can outlast an adapter observation deadline. Inspect
the same owned frame and pending operation; never request another module opening
or restart an Editor merely because the observation expired.

The workflow/checkpoint compatibility facade exposes the current refresh route,
UI/GUI/Text/import capabilities and transfer context at top level. Its current
document provider is the authority for application scope; legacy checkpoint
defaults must not hide same-file refresh. Panel runtime fingerprints include
composition and CASC hydration changes as well as live providers. Rebuilding
does not hot-reload a previously attached stdio server: inspect its API version.

## Native document API extension

The compact same-file batch route has been exercised in an owned native Editor:
one MCP author request prepared the open document, applied 50 localized text
changes and reopened the same path in the same window and process. The saved
trigger and object components and a sampled imported asset retained their exact
bytes. This establishes the tested text batch, not universal component fidelity,
rendering, gameplay or a native undo-preserving in-memory edit. See
`verification/editor-live-compact-batch-2026-11-08.json` for the evidence.

Applying a prepared session with no component changes returns `unchanged`,
releases its project lease and consumes the session without closing the Editor.
A subsequent edit can prepare a new session. This lifecycle is covered by the
refresh adapter regression test; it is not a separate native Editor observation.

A further bounded same-file refresh appended a typed action to the existing
`RefreshLinkedInit` trigger in an owned test map. The same frame/process reopened
the same path; its saved GUI XML retained the trigger ID and original action,
contained two actions, and the Objects component remained byte-identical. The
Triggers module opened and its root tree was readable, but the modified action
tree, native compilation, regenerated runtime and gameplay were not checked.
The existing MapScript may therefore need regeneration before the edit can be
considered playable. See
`verification/editor-live-existing-gui-refresh-2026-11-08.json`.

An unchanged runtime has now been confirmed in that fixture. Before native Close,
`live.refresh.apply` refuses changed `Triggers` when `MapScript.galaxy` still
matches the baseline, keeping the preparation available. For supported graphs,
use `live.refresh.call` with `trigger.generate_runtime` (`dryRun=false`,
`stage=true`), then save its coupled group in the prepared session. Unsupported
graphs need a separately qualified native regeneration path; do not replace a
map's script blindly. This hash guard is conservative: it can refuse non-executable
GUI-only changes, and different runtime bytes alone do not prove correspondence,
successful compilation or gameplay.

In the existing-trigger fixture the local runtime emitter refused the graph with
`GUI_RUNTIME_LIBRARY_ROOT`. Original Editor compilation on an isolated copy
passed and exported Galaxy containing both the previous assignment and the new
assignment; the source archive was unchanged. The native diagnostics snapshot
was not complete in that compile result, and no gameplay or automatic adoption
of the exported script into a refresh session was verified. See
`verification/editor-live-gui-native-runtime-2026-11-08.json`.

The native bridge now exposes an internal full-map compilation proof: it accepts
only a successful unscoped compile/export job, rechecks the source archive and
reads the exact job-owned Galaxy artifact with its recorded hash and size. A
scoped compile, changed archive, altered output or unknown job refuses. This is
an integration boundary; by itself it does not insert anything into the map.

`live.refresh.compile_snapshot` now exports a checked, internal test archive from
the current prepared session and records its component manifest. It never closes
or publishes the user's open document. The stale-runtime guard is bypassed only
for this test snapshot, not for `live.refresh.apply`. The snapshot is not a new
working map; compilation, checking its correspondence to the still-current
prepared components, and adoption are separate steps. The snapshot handle is
currently session-local, so reconnect requires preparing a new snapshot.
After an unscoped `editor.check` compile job in the same MCP process,
`live.refresh.adopt_compiled` checks its full-map proof, snapshot path and hash,
and the entire prepared component manifest before a journalled MapScript write.
It does not touch the open document; use `live.refresh.apply` afterward. This
path has now passed one end-to-end native qualification on an owned fixture:
an existing trigger gained an action, the isolated snapshot compiled, its exact
native Galaxy was adopted, and the same map reopened in the same Editor frame.
Saved GUI and Galaxy retained both old and new actions; Objects stayed byte-equal.
The changed action tree and gameplay were not observed. See
`verification/editor-live-compiled-adoption-2026-11-08.json`.

For fewer calls, `live.refresh.compile_begin` prepares the snapshot and queues
one owned native compilation; `live.refresh.compile_finish` observes that job and
adopts its verified result when complete. It waits up to 20 seconds by default
(`waitMs=0` for an immediate check; maximum 30000) without repeated MCP calls.
`compile_pending` stops a surrounding
batch before any later apply. Repeated calls in the same MCP process observe the
same job/receipt; unknown submission or adoption is not replayed. These shortcut
bindings are process-local and capped at 128 runs. At capacity, a terminal
successful or failed run is evicted only if its prepared session was consumed or
released; pending and uncertain runs are retained. After reconnect inspect the
retained native report and resume the prepared workspace. The new bridge does not
automatically trust or adopt a previous process's job; prepare a new snapshot and
compile again only after the earlier job is known to be terminal.
The shortcuts now also have native end-to-end evidence on a resumed prepared
fixture: repeated begin/finish observed the same job and receipt, and the same
map reopened with both GUI actions and their generated Galaxy assignments. The
first native export failed with an SDK job-history access error; the prepared
session was retained and resumed without creating the trigger again. See
`verification/editor-live-compile-shortcut-2026-11-08.json`.

For a concise agent-facing workflow call `modkit.author_help` with
`section=live`. Its guidance also survives compact `modkit.batch` responses;
the currently connected MCP process must be restarted to load new tool schemas.
The compile-and-apply workflow was introduced with marker
`editor-live-2026-11-08-compile-apply`. The current marker is
`editor-live-2026-11-12-gui-catalog`; reconnect an older process before
relying on the new multi-parameter trigger tools. Inspect actual tools as well:
a marker alone does not verify the editor or a particular operation.
Compact `live.capabilities` responses preserve this marker, the limitations of
direct editing and the same-file refresh route in both `editor-live` and
`workflow` profiles. A fresh workflow stdio process has been checked for these
fields; existing attached processes do not change their schemas in place.

If prepared components change after adoption, `compile_finish` reports
`compile_stale` and stops a batch; call `compile_begin` to snapshot and compile
the changed session again. An unchanged adopted session reuses its receipt.
Concurrent requests cannot submit duplicate jobs; an unknown submission or
adoption is never retried automatically. An owned native Editor test compiled
two successive GUI edits, blocked the stale result and refreshed the same path,
frame and process, preserving the original action and Objects. This single
fixture did not verify gameplay, the visual GUI action tree or diagnostics.
See `verification/editor-live-repeat-compile-2026-11-08.json`.
After a confirmed `compile_failed`, correct the prepared components and use
`live.refresh.compile_begin` with `retryFailed=true` to submit a new job.
The retry is explicit and unavailable for an unknown submission or outcome.
When the native job reports compiler messages, `compile_finish` returns up to
eight bounded messages with available line and file information and the full
report path. Missing diagnostics remain unknown; a generated line is not
automatically mapped to a GUI element.
The compact result was verified against a read-only replay of an actual native
failure report; see `verification/editor-live-compiler-diagnostics-replay-2026-11-08.json`.
Failure recovery also has one native qualification: the Editor reported one
compiler error, the failed job was not automatically repeated, and an explicit
retry after correcting the test fixture compiled and refreshed the same path and
frame. Gameplay and the visual action tree were not checked. See
`verification/editor-live-failure-retry-2026-11-08.json`.
When saving was requested, `live.refresh.compile_apply` combines observing and
adopting an already-started compilation with the existing guarded same-file
apply. Pending, failed, stale and unknown compilation states do not apply; an
uncertain application requires `live.refresh.recover`, never blind repetition.
An owned native Editor run observed pending compilation, then the shortcut
compiled and refreshed the same path, frame and process with its original GUI
action and Objects preserved. Gameplay, visual action tree and independent
diagnostics were not checked in this run. See
`verification/editor-live-compile-apply-2026-11-08.json`.
An owned native probe could not establish a compiler failure: its handcrafted
Custom Script was absent from exported Galaxy. This is not evidence of general
Custom Script behavior; see `verification/editor-live-failure-retry-probe-2026-11-08.json`.

Applying after any prepared component changes following compiled adoption refuses
until a fresh compilation. The session writes and flushes an append-only
attestation before writing the prepared runtime; resume validates its identity and
restores the guard. A partial newest record refuses resume. A native qualification
reconnected MCP, deliberately changed an owned fixture's prepared Triggers file,
observed refusal, restored the exact fixture bytes and applied in the same Editor
frame. A Cutscenes invalid-data warning appeared between native diagnostics; its
cause is not established. See
`verification/editor-live-durable-attestation-2026-11-08.json`.
Independently changed runtime bytes are not by themselves proof of GUI/runtime
correspondence.

A subsequent isolated game launch matched the final archive hash, and the
original Trigger Debugger recorded `gt_RefreshLinkedInit_Func` running at map
initialization. The final variable value was not directly read, so this confirms
trigger invocation rather than the effect of its new action. Diagnostics coverage
was partial. The separate pre-existing user game remained running. See
`verification/editor-live-compiled-adoption-game-2026-11-08.json`.

A separate observable-action fixture appended a native GUI action setting
player 1 minerals to 613, compiled and adopted it through the compact workflow,
and refreshed the same map. A private game launch matched that saved archive
hash; the debugger recorded the trigger firing and the game reported 613 minerals.
This confirms the tested action in that fixture, not arbitrary trigger semantics.
Game diagnostics coverage was partial; an Editor Cutscenes warning also appeared
during refresh with cause unestablished. See
`verification/editor-live-observable-action-2026-11-08.json`.

Compact batches stop before subsequent operations when native authoring reports
`preparation_failed`, or refresh reports `not_published` or `context_changed`.
For a compiler failure, the compact receipt retains the failed step and a bounded
error, including whether a native mutation was attempted. These are dispatcher
regressions; they do not establish native rendering or gameplay acceptance.

For refresh steps whose session ID references an earlier result, the dispatcher
preflights the remaining static fields using the session ID's UUID contract.
Invalid static arguments therefore stop the batch before an earlier `begin` can
save a dirty document. Compact `modkit.author` also compiles nested refresh
command syntax and checks the component-only policy before beginning. The actual
child registry still validates tool schemas and executes against the prepared
component workspace; this early syntax check is not semantic or native validation.

The module is the application boundary for existing generators. Broader live
coverage needs original Editor operations behind this boundary, rather than
another terrain generator or raw writes to guessed process addresses. The next
provider contract should supply:

1. `document.inspect`: authoritative document ID, revision, current path and dirty
   state, independent of abbreviated window titles.
2. `document.snapshot`: requested current components, including unsaved edits,
   exported into bounded tool-owned storage with their source revisions.
3. `document.apply`: component deltas against the expected document revision,
   using native creation/change/deletion and an explicit undo group. Each
   component must declare supported operations and atomicity. Partial application
   is reported per operation; a command batch alone does not imply rollback.
4. Object application registers instances, actors/models and scene changes.
   Terrain application invalidates/rebuilds the appropriate native geometry and
   navigation state. Data, GUI and UI application updates their native registries,
   references, strings and dependencies.
5. `document.readback` and native diagnostics establish the applied model state;
   `document.save` uses the same current document. Rendering and gameplay require
   their own observations.

These are extension requirements, not implemented native endpoints. Existing
generators should produce the delta once and dispatch through a supported live
provider. Unsupported components refuse before native application. Private
Toolkit sources, instrumented games, maps, assets and binaries remain excluded
from source publication.
