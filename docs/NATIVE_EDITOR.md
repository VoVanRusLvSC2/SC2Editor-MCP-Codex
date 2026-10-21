# Optional original Editor checks

Uses SC2 Native Toolkit by VoVanRusLvSC2:
https://github.com/VoVanRusLvSC2/SC2NativeToolkit.

`map.preview` remains the fast ModKit renderer. The separate `editor.*` tools
provide original GUI-to-Galaxy compilation, operation-scoped Messages/Console
diagnostics, native save/close/reopen comparison and selected original images.
They do not author map content or validate gameplay.

## Setup and lifecycle

Run `npm run native:setup` on Windows. This downloads the pinned
`v0.9.2-rc.1` package (native protocol 11), checks its published SHA-256 and preserves all notices in
the ignored `.native-toolkit-runtime/` directory. The executable hash is recorded
and checked before use. Setup does not launch the Editor. Windows `tar.exe` is
used for extraction. An explicit `SC2_NATIVE_MCP_PATH` can select another local
0.9.2-rc.1 MCP executable; that override is version-checked, but has no package pin.
Older frontends are rejected instead of mixing incompatible native protocols.

`native-toolkit-release.json` is the single reviewed version/protocol/package-hash
pin used by setup, runtime discovery and the MCP handshake. Setup rejects changed
published checksums, wrong build versions/protocols and mixed runtime receipts.
It installs a complete matching package in a separate version directory; copying
one DLL from another release is unsupported. The portable distribution includes
the same pin and installer. Previous runtime directories remain available.

Updates are explicit: edit the release pin after compatibility review, run
`npm run native:setup`, then restart the MCP connection. Starting an authoring
session does not download or automatically upgrade executable dependencies.

Version 0.9.2 changes the owned startup bootstrap to initialize callbacks on the
Editor's GUI thread, replacing the cross-process DLL-hook registration that
failed with Win32 126 in 0.9.1. Original document/PID/thread checks and private
desktop isolation remain. Local compilation/rendering evidence is separate from
successful installation; the upstream prerelease is not a general map certificate.

The original installed Editor and actual map dependencies must be available.
The Toolkit targets Editor 5.0.17.98310. Its own acceptance matrix applies.
No installed executable, visible user Editor or source map is changed.

The `editor` module is included in `all`, `workflow` and `map-builder` profiles.
The `editor` profile enables just UI and native tools. Focused workflow clients
discover them with `modkit.tools` and enable selected tools or use `modkit.batch`.
Restart an existing MCP process after installing server changes.

`editor.status({connect:true})` initializes the retained Toolkit MCP frontend;
it does not start SC2 Editor. `editor.check` and `editor.capture` explicitly may
start a bridge-owned hidden Editor. A single queue serializes native jobs and
reuses that worker. Source files and outputs are workspace-contained. Jobs use
private archive snapshots; pending drafts and queued source changes are rejected.

`editor.job` returns progress immediately. `deadlineExceeded` is advisory, not
safe cancellation. Active native handlers must complete before `editor.stop`.
MCP EOF/shutdown drains outstanding work and closes only the owned worker.

## Calls

```json
{"tool":"editor.check","args":{"archive":"MyMap.SC2Map","checks":["load","save_reopen","compile"],"includeDiffs":true}}
{"tool":"editor.job","args":{"jobId":"JOB_UUID"}}
{"tool":"editor.capture","args":{"archive":"MyMap.SC2Map","mode":"map","size":1024}}
{"tool":"editor.job","args":{"jobId":"CAPTURE_JOB_UUID","includeImage":true}}
{"tool":"editor.cameras","args":{"archive":"MyMap.SC2Map","locale":"enUS","offset":0,"limit":40}}
{"tool":"editor.job","args":{"jobId":"CAMERAS_JOB_UUID"}}
{"tool":"editor.capture","args":{"archive":"MyMap.SC2Map","mode":"viewport","cameraId":"2001"}}
{"tool":"editor.diagnostics","args":{}}
{"tool":"editor.stop","args":{}}
```

Export component directories using the existing `map.export` before checking.
Checks run in load, save/reopen, compile order. A hard native failure stops later
phases; unknown diagnostic completeness stays null. Compile-only checks open the
supplied archive first. Successful native compile also exports exact Galaxy to
the job directory. `scope`, `contextLabel` and `locale` can disambiguate native
trigger context. No native-generated script is automatically copied into source.

Full original results and each native operation are retained under
`.sc2mcp-output/native-editor/`; tool replies contain bounded summaries and paths.
The returned saved-archive and component-comparison artifacts are evidence,
not replacements for user sources. A failed check remains visible in job state.
Image content is requested explicitly and must be a bounded PNG inside worker
storage. Source SHA-256 and unchanged-source checks accompany completed jobs.

`editor.cameras` reads saved ObjectCamera metadata from a private archive snapshot
without starting the Editor. Its result is paginated (maximum 100 cameras per
page); original parameters and full backend evidence remain in the job directory.
Use an exact `cameraId` with `mode:viewport`. The Toolkit selects the original
camera palette entry and reads back target XY, pitch/yaw/roll, distance and FOV.
The returned `capture.mapCamera` preserves saved/actual values, checked and
unchecked fields, tolerances and selection verification. Ambiguous IDs/names,
missing targets and readback mismatches fail. This shows saved editor placements,
not trigger execution, trigger-created cameras or a played cinematic.
Camera authoring fixtures need coherent `Rotation` (radians) and `Yaw` (degrees),
plus deliberate near/far clip values. Readback verification covers the reported
core fields; inspect the actual PNG separately before accepting visible framing.

Failed checks retain `failureKind`, `failureStage`, `failureNative` (including
available controller exit/stderr), `failureEvidence`, `ownedWorkerReset` and
`automaticRetry`. Missing native diagnostics stay unknown. Compile-only open
failures are visible under `checks.open`. A failed attempt cannot export the
previous Galaxy through the bridge; exports are requested only after a fresh
successful compile. Recovery after a failed startup is a new explicit job.

## Evidence limits

Compiler results, load/Data observations, stable save/reopen component bytes,
native image contents and gameplay are separate claims. Original Data opening
may remain silent for some invalid references. Unreadable logs are unknown.
Existing baseline messages are not silently reclassified as new errors.

Native Terrain viewport/overhead export is available. Water and category-exclusion
coverage remains incomplete. Saved-camera framing is available with original
readback; arbitrary camera overrides are not. Region mode still crops a full-map
image, with the Toolkit's experimental coordinate flag. The paused
custom cutscene renderer is unchanged. Native gameplay/ability testing is absent.
