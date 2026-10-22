# Optional original Editor checks

Uses [SC2EditorToolkit](https://github.com/VoVanRusLvSC2/SC2EditorToolkit) by
VoVanRusLvSC2, formerly SC2NativeToolkit. Compatibility tool/transport names remain.

`map.preview` remains the fast ModKit renderer. The separate `editor.*` tools
provide original GUI-to-Galaxy compilation, operation-scoped Messages/Console
diagnostics, native save/close/reopen comparison and selected original images.
They do not author map content or validate gameplay.

## Setup and lifecycle

Run `npm run native:setup` on Windows. This downloads the pinned
`v0.10.0-rc.1` package (native protocol 11), checks its published SHA-256 and preserves all notices in
the ignored `.native-toolkit-runtime/` directory. The executable hash is recorded
and checked before use. Setup does not launch the Editor. Windows `tar.exe` is
used for extraction. An explicit `SC2_NATIVE_MCP_PATH` can select another local
0.10.0-rc.1 MCP executable; that override is version-checked, but has no package pin.
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

Version 0.10 adds the upstream Vulkan rendering backend for owned hidden workers.
It retains protocol 11 and the same 18 upstream tools. The local installation and
fresh outer MCP schema discovery passed. An initial live load had unconfirmed
startup diagnostics (sendError 187); that failure is retained and its cause remains
unresolved. Later isolated Vulkan runs passed load/Data, compilation/export,
save/reopen, map/region images and corrected-camera A/B/A. A GUI/Data map's exact
native-saved archive also passed revalidation, game launch and bidirectional
Marine movement. A supplementary run completed the remaining methods, including
native GUI XML conversion, diagnostics, cutscene load/seek/frame and silent MP4.
All 18 upstream methods now have actual MCP calls on recorded fixtures. This does
not certify every argument/asset variant; audio and broader FaceFX/link coverage
remain open. Historical 0.9.2 evidence is retained separately.

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
Each bridge keeps a distinct worker directory for its lifetime; another MCP
process using the same map workspace does not share its Toolkit session files.

New sessions keep reports and workers under `.sc2mcp-output/ne`, with a compact
`w/<UUID without separators>` worker prefix. All UUID entropy, private snapshots
and containment checks remain. This reduces failures in upstream Windows archive
operations which still encounter `MAX_PATH`; it does not guarantee arbitrary
workspace/asset path lengths. Prefer a short map workspace for native checks.
Previous `.sc2mcp-output/native-editor` evidence is retained and is not migrated.

## Calls

Nine public tools include two generic entry points. `editor.tools({})` lists all
18 allowlisted upstream methods; `editor.tools({name:"sc2_export_video"})` returns
the exact installed schema. `editor.call({method,arguments})` queues the method on
the same retained bridge. Inputs become guarded private copies and outputs belong
to its job. Poll `editor.job`. XML conversion, object search, native cutscene
seek/frame/video/audio and backend selection are therefore reachable without a
new wrapper for every method. Discovery is not execution or semantic acceptance;
inspect native confirmations and artifacts in the full report.
Generic object search limits each effective page to 100 rows and retains native
offset/nextOffset/totals. Truncated arrays are explicit in `responseTruncation`;
use `editor.cameras` for paged camera retrieval. Complete responses remain in the
owned job report.

For deeper results, `editor.job({jobId,details:{path:"/native/frame",offset:0,limit:8}})`
pages the complete owned JSON report through an RFC 6901 pointer. Escape `/` in
keys as `~1` and `~` as `~0`. Object entries and array items contain bounded previews;
large values are explicitly truncated and can be expanded with a deeper path.
This provides cutscene timing, video/diagnostic metadata and other native fields
through MCP without shell reads or dumping the full report.

`editor.check`, `editor.capture` and `project.test` Editor settings accept
`renderBackend:"auto"|"legacy"|"vulkan"`. The generic call uses the upstream
`render_backend` argument. Keep the selected backend in evidence; a pass under
one backend does not establish the other. A fresh isolated Vulkan run passed
load/Data diagnostics, native compilation/export and save/reopen on a small
fixture; broader map/image acceptance remains separate from that result.

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

Preserve the matching localized `TriggerStrings` in reproduction templates:
root/library name lookup may depend on that table. Distinguish missing context,
GUI generation failure and actual compiler diagnostics. After a hidden Editor
exits before compilation, a retry of identical archive bytes at a shorter path
can isolate a path-related hypothesis. Record both paths, hashes and phase
results; a successful retry alone does not prove path length caused the failure.
Compare native-exported Galaxy against the intended semantics separately from
compilation; see [conversion preservation requirements](TRIGGER_MCP.md#conversion-preservation-requirements).

The Toolkit's `sc2_compile_all` generates from the native GUI tree before
compiling. An empty `Triggers` root with a separately connected Galaxy entry has
no authored context label and is not accepted by that GUI pipeline. Supplying an
invented label does not establish a valid context or verify the original script.
For such a saved-script fixture, keep native load and actual game execution as
separate checks; native GUI generation/compile remains unverified. Reusable
`project.test` manifests forward optional `editor.scope`, `contextLabel` and
`locale` to both the initial check and exact native-saved artifact revalidation.

Full original results and each native operation are retained under the owned
storage paths returned by `editor.status` and the job receipts. Current builds
use `.sc2mcp-output/ne/`; earlier `.sc2mcp-output/native-editor/` evidence is
retained. Consumers must validate artifacts against the exact retained bridge's
declared worker directory rather than a hard-coded shared prefix. Tool replies
contain bounded summaries and paths.
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
custom cutscene renderer is unchanged. Gameplay uses the separate GameToolkit;
complete ability/presentation acceptance remains open.

Capture results include `contentAssessment`: small pixel statistics flag nearly
black or uniform images as `needs_review`. `content_detected` still leaves visual
acceptance unchecked. The heuristic does not infer object identity or certify
framing; intentional dark scenes need review rather than automatic rejection.
During the 0.10 update, a saved camera lacking Near/Far Clip produced a mostly
black frame despite matching numeric readback. This remains failed visual evidence;
whole-map pixels and saved-camera framing are assessed separately.
