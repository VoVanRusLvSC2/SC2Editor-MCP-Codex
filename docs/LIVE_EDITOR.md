# Visible Editor collaboration

The separate `live` module provides two explicit backends. **Saved-checkpoint collaboration** works with an
already-open SC2 Editor. Existing authoring tools edit a persistent imported
component project. `live.publish` exports a new verified archive and optionally
requests that the same visible Editor open it through a normal Windows file-drop
message. The user's original archive is never replaced. No test DLL is injected,
no hidden Editor/game is started, and no save/dependency dialog is dismissed.

**Direct in-memory Data editing** uses `live.memory.read/set` and a separate
project-owned visible adapter. It changes a bounded numeric field in the current
document through the original Editor controls, without exporting/reopening an
archive. The pinned hidden-test Toolkit is not repurposed for this mode.

## Setup

On Windows, build the source and small standalone handoff helper:

```powershell
npm run build
npm run live:build
$env:SC2_UI_ROOT = 'D:/SC2Work'
$env:SC2_MCP_PROFILE = 'live'
node dist/index.js
```

For checkpoint operations, the helper uses the installed .NET Framework compiler and ordinary Windows window
enumeration/file-drop APIs. Its source is in `native/live-editor/Program.cs`;
compiled binaries remain local. `SC2_LIVE_BRIDGE` can select an explicitly built
helper. There is no network listener, shell-command input, installation patch,
process-memory access or automatic Editor launcher in the checkpoint path.

## Direct in-memory Data editing

Build the optional adapter with `npm run live:memory:build`. It requires Windows
x64, Visual Studio C++ tools and CMake (or explicit `SC2_LIVE_CMAKE`). The supported
Editor build is 5.0.17.98310 with English Data controls. Keep a map already open
in the visible Editor's Data module; no additional Editor is launched.

1. Select its exact Data `windowId` from `live.windows`.
2. Call `live.memory.read` with `archive`, `windowId`, `unit` and `field`.
   The packed archive identifies the open document and is hashed, not extracted
   or rewritten. Unsaved document values are read from the original inline
   editor; clipped on-screen list text is never used as the numeric value.
3. Call `live.memory.set` with the returned `snapshotId` and numeric `value`.
   Snapshots expire after 90 seconds and are consumed once, including failures.
   Native field ownership, the current complete value, PID/start time, HWND,
   document title and saved archive hash are checked again. A dirty-marker
   transition is allowed; replacing the document is refused.
4. `status=applied` requires fresh native value readback. The result includes
   `before`, `after`, `documentDirty` and `archiveUnchanged`. Save normally in
   Editor when desired. No global undo, Save or Discard command is exposed.

Supported fields on existing map-local **Unit** objects are `LifeMax`, `LifeStart`,
`ShieldsMax`, `ShieldsStart`, `EnergyMax`, `EnergyStart`, `Speed` and `LifeArmor`.
Values must be finite, nonnegative and below 524288. Native numeric normalization
that differs from the requested value returns `verification_failed`, not success.
This backend does not yet create objects or edit Terrain, placements, triggers,
arbitrary XML, arrays or Actor graphs. Field changes are request-driven; this
is not continuous background file synchronization.

Example tool arguments:

```json
{"archive":"D:/Maps/Current.SC2Map","windowId":"123456","unit":"MyMarine","field":"LifeMax"}
```

Then call `live.memory.set` with `{"snapshotId":"<returned UUID>","value":250}`.
Disconnect saved-checkpoint sessions before using the memory backend. Requests
are serialized across clients by exact Editor process identity; an abandoned
lease refuses rather than being stolen automatically. Preserve/review a leftover
lease before removing it after confirming no native operation is active.

Only an explicit memory read/set starts the retained local helper and loads
`sc2-mcp-live-data.dll` into the selected visible Editor. The loader checks the
exact process/build and immutable sibling binary hashes. The adapter subclasses
the selected Data window, dispatches on its GUI thread and invokes the original
Modify Value/inline control. It uses no game DLL, private Toolkit source,
SC2 address offsets, physical input or arbitrary DLL path. The plugin remains
resident until Editor exits; MCP shutdown closes its helper, not Editor.
Compiled binaries and versioned runtime manifests stay local and ignored.

Inspection opens and cancels a native inline editor and **may mark the document
dirty without changing the value**. Do not manually clear this flag. Cancellation
requires the call's token, owned control generation and unchanged inline text;
manual typed input is preserved. A 30-second guard cancels only unchanged owned
inline input. Unknown commit results never trigger a replay or automatic
restoration. Read the current field again before deciding on another edit.

The module pins full or qualified abbreviated title paths; it does not claim an
authoritative SC2 internal document-path API. Readback proves a Data value, not
3D appearance, native Undo, game balance or compatibility with every field/build.

## Saved-checkpoint workflow

1. Open a packed `.SC2Map` or `.SC2Mod` in the visible Editor and save it.
2. `live.windows` lists exact window/process identities. `live.connect` accepts
   `archive` and optional `windowId`; the document title must match the selected
   saved path under the following rules.
   SC2 abbreviates long title paths itself. Such titles require the matching drive
   and at least two named suffix directories, with exactly one selected matching
   window; basename-only titles refuse. This is title-based identity, not an
   authoritative internal document-path API. The explicit archive can be outside `SC2_UI_ROOT`; only that exact file is
   read. The authoring copy and outputs stay inside the MCP workspace.
3. Call `live.author` with `sessionId`, the normal compact `script`, and
   `mode=plan`, `stage` or `save`. Use `live.call` with a normal tool name and
   arguments for advanced Data, UI, terrain, placement, script and trigger work.
   Original schemas, transaction groups, staging and stale guards still apply.
   The session shares its parent's verified CASC cache. On a new workspace, mount
   the map's required installed metadata through `live.call` / `casc.mount` first,
   exactly as in ordinary MCP authoring; missing catalogs are not invented.
4. `live.publish` with `sessionId` and optionally `present=true` exports a new
   checkpoint. Pending drafts block export. The public archive exporter prepares
   load metadata and reopens/verifies archive entries before publication.
5. On windows accepting file drops, the checkpoint receives one normal open
   request. Otherwise `manual_open_required` returns its exact path: open it
   using File / Open in the same Editor. Native save/dependency/load dialogs are
   user-owned. The module never clicks Save, Discard or confirmation buttons.
6. Read `live.status`. A matching actual document path and unchanged checkpoint
   hash establishes `presentation=observed`; inspect the rendered result
   separately. A submitted message alone never establishes load or visual success.
7. For manual user edits, save in Editor and call `live.pull`. It imports a fresh
   revision and releases the previous authoring runtime. Pending MCP edits/drafts
   refuse instead of being discarded or blindly merged. Both versions remain.
8. `live.disconnect` requires staged transactions to be saved or discarded and
   closes only the session's authoring resources. Visible
   Editors, source archives, checkpoints and unfinished work remain untouched.

Example `live.author` script, after connecting to an appropriate map:

```text
data unit id=LiveMarine from=Marine life=250 scale=1.2
objects unit id=LiveMarine at=16,16 owner=1
```

All source edits use the existing public authoring tool executor; there is no
second map-content writer. Abilities, XP and combat stay in native Data, and GUI
organization follows the same project protocol.

## Saved-checkpoint conflicts and evidence

- An unsaved `*]` document title or disabled/modal Editor requires user action.
  Authoring does not race the unsaved visible document.
- Window ID, PID, process creation time and full document path are pinned.
  Switching maps, restarting Editor or reusing a window handle refuses.
- Each source is content-hashed before authoring/presentation. A concurrent save
  requires explicit pull. A source change during export prevents handoff.
- Checkpoint basenames contain the session identity as well as the revision.
  This prevents two long paths abbreviated by Editor from looking like the
  same current checkpoint before a new open request is actually delivered.
- Opening a checkpoint is a once-only request. Unknown delivery remains uncertain;
  the same request is never automatically replayed. Manual opening remains possible.
- The module accepts normal packed archives only. Component-directory documents,
  network shares, arbitrary window classes and ambiguous/basename-only title paths are
  not silently accepted. It does not change executable or account permissions.
- The exported checkpoint is a distinct file. Save As back to the original, if
  desired, is a separate user action. The source is never automatically overwritten.
- Existing GUI generation persistence rules still apply: saving in Editor can
  regenerate Galaxy, and dependency/locale serialization requires its own review.
- Native minimap rebuilding starts a separate hidden acceptance worker and is
  refused inside `live.call`; perform that check separately. The explicit draft
  `overview` backend remains available without starting Editor.
- Archive validation, document observation, actual pixels, compilation and gameplay
  remain separate evidence. No automatic beauty, native Undo or instant refresh claim.

The `live` profile exposes the module independently; `all`, `workflow` and
`map-builder` include it for discovery. An already-running MCP frontend must be
reconnected to load these newly registered tools.

## Recorded verification

The [2026-11-07 memory record](verification/live-memory-data-2026-11-07.json)
retains 27 scoped passing regressions and an actual outer-MCP native sequence:
`ArenaPilot.LifeMax` 1200 → 1234 → 1200 in the same visible Editor window/process,
with fresh complete native readback and unchanged packed archive SHA-256.
The two final write calls took approximately 2.9 seconds each, including readback.
This qualifies that field and build, not every allowed field, rendered appearance,
native Undo, save/reopen persistence, terrain, triggers or gameplay.

The [2026-11-07 checkpoint record](verification/live-editor-checkpoints-2026-11-07.json)
contains 39 passing scoped regressions and actual outer-MCP/visible-Editor
observations: checkpoint opening in the same process, inspected placed units,
dirty manual-camera refusal, native save detection and explicit pull. Native
observations, final static guards, earlier failures and title-identity limits
retain their distinct scopes. No complete Editor/gameplay acceptance is inferred.
