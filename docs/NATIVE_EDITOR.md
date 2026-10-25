# Optional original Editor checks

Uses [SC2EditorToolkit](https://github.com/VoVanRusLvSC2/SC2EditorToolkit) by
VoVanRusLvSC2, formerly SC2NativeToolkit. Compatibility tool/transport names remain.

`map.preview` remains the fast ModKit renderer. The separate `editor.*` tools
provide original GUI-to-Galaxy compilation, operation-scoped Messages/Console
diagnostics, native save/close/reopen comparison and selected original images.
They do not author map content or validate gameplay.

## Setup and lifecycle

Run `npm run native:setup` on Windows. This downloads the pinned
`v1.0.0` package (native protocol 15), checks its published SHA-256 and preserves all notices in
the ignored `.native-toolkit-runtime/` directory. The executable hash is recorded
and checked before use. Setup does not launch the Editor. Windows `tar.exe` is
used for extraction. An explicit `SC2_NATIVE_MCP_PATH` can select another local
1.0.0 MCP executable; that override is version-checked, but has no package pin.
Older frontends are rejected instead of mixing incompatible native protocols.

`SC2_NATIVE_TOOLKIT_HOME` selects an absolute external directory for the complete
pinned package, including its receipt and archive. Setup and runtime discovery use
the same setting, captured at process/bridge startup. Setup verifies an existing
matching installation without downloading or overwriting it; mismatched or
unmanaged directories reject. Fresh installs extract into a separate staging
folder, validate member paths and pinned metadata, then rename into the target. Failed
staging evidence and older versions remain untouched. This setting is independent
of `SC2_NATIVE_WORK_ROOT`, which controls private job evidence.

`native-toolkit-release.json` is the single reviewed version/protocol/package-hash
pin used by setup, runtime discovery and the MCP handshake. Setup rejects changed
published checksums, wrong legacy build versions/protocols and mixed runtime receipts.
The 1.0 self-contained archive uses `win64.zip` and an exact filename entry in
`SHA256SUMS.txt`. It embeds its components and includes `BUILD.json` with the
version, protocol and source commit; this layout is explicit in the pin. Setup
checks that metadata against the reviewed archive pin while
the live MCP handshake independently requires the exact frontend version.
It installs a complete matching package in a separate version directory; copying
one DLL from another release is unsupported. The portable distribution includes
the same pin and installer. Previous runtime directories remain available.

Updates are explicit: edit the release pin after compatibility review, run
`npm run native:setup`, then restart the MCP connection. Starting an authoring
session does not download or automatically upgrade executable dependencies.

Version 0.14 introduced `sc2_audit_data` / queued `audit_data`. Version 1.0
retains that operation and extends the guarded allowlist to31 operations. `editor.data.audit` submits a full effective Data
traversal on a private saved archive with an explicit native deadline. Poll its
outer `editor.job`, then observe the returned native job through
`editor.call(method="sc2_job_status", arguments={job_id: ...})` or wait/cancel.
Queue admission is not audit completion. `limit` bounds finding samples only.
Inspect `catalogTraversalComplete`, `referenceAndFileValidationComplete`,
`allObservedTypedTargetsPresent`, `validationPassed` and coverage separately.
Counts, catalog/finding pages and artifact descriptors are bounded in MCP;
complete original JSONL reports remain in the private Toolkit worker. Unknown
types, unresolved tokens, optional/default references and loaded dependency
revisions retain their limits. File presence does not prove model playback,
binary integrity or gameplay. Audits do not enter the single-object Data reuse
cache. Native acceptance is recorded separately from frontend discovery.

The retained0.14 frozen-package qualification completes one original 109-catalog audit:
87,052 objects, 15,953,492 visited fields and zero getter errors. Independent
streamed SHA/byte/row/count checks match both complete JSONL artifacts. Native
diagnostics are clear, but reference/file coverage is false and
`validationPassed` is null; optional/default missing targets are not gameplay
failures. The next source's full audit fails original resource confirmation
(controller error171). Its partial rows preserve every baseline object and add
only the authored missing-file Model; no complete negative audit is claimed.
The 45 → 73 → original Unit read still fails exact XML identity on return.
Explicit audit cancellation discards only the owned Editor, and the next Marine
main-file check passes. Both retained sessions close cleanly. See
[0.14 audit and recovery evidence](verification/native-editor-014-data-audit-2026-10-24.json).

On a terminal background observation, use `editor.job` details with
`path="/native/result/findingSamples"` for bounded native samples; direct
`sc2_audit_data` jobs use `/native/findingSamples`. Follow nested paths when a
sample exceeds its preview budget. Complete JSONL content remains available
through the private SDK artifacts, without an implicit model-context dump.

Version 0.13 changed the native protocol to 14 and advertised 26 upstream tools.
The eight additions cover background jobs, revision-bound map reports, original
effective Data, associations and main Model file presence. Package installation,
repeat verification and all 26 advertised names/eight new schemas are confirmed.
The wrapper implements all 26 with guarded nested job inputs, output ownership,
separate observation admission and bounded Data/report pages. Focused regression
and actual protocol-14 calls are tracked separately from discovery; the broader
native acceptance corpus and final package renewal remain open.
Discovery is not execution or semantic acceptance. Use the complete matching
package and restart only the MCP workers you own. Older active workers cannot
be upgraded in place.

A current retained-worker reproduction fails native whole-map export after GUI
compilation on both 0.12 and 0.13: the original export settings are not confirmed
(native error 91). Fresh exports and ordinary map switches pass. Explicitly
opening Terrain before export succeeds once but fails on repetition, so it is
not an accepted fix. Failed exports keep source hashes and unconfirmed filters;
the MCP does not replay them automatically or publish a successful image.
This remains a native lifecycle finding, independent of successful game movement.

Historical version 0.12 introduced protocol 13 and the Unit/Doodad model filters.
Its original image geometry and filter acceptance remain separately dated.

Historical version 0.10 adds the upstream Vulkan rendering backend for owned hidden workers.
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

The later [GUI roundtrip check](verification/native-gui-reopen-2026-10-23.json)
passes explicit-target timer registration through original generation/compile,
40-component save/reopen equality and six scenarios on the exact saved artifact.
A separate reference graph fails native compilation on an empty generated
structure-variable type; a literal zero-bound array also loses its array form.
Its successful local-emitter game runs do not establish native GUI validity.
Keep this failure explicit while correcting serialization; do not bypass original
generation with a replacement script when full GUI is requested.

The original installed Editor and actual map dependencies must be available.
The Toolkit targets Editor 5.0.17.98310. Its own acceptance matrix applies.
No installed executable, visible user Editor or source map is changed.

The `editor` module is included in `all`, `workflow` and `map-builder` profiles.
The `editor` profile enables just UI and native tools. Focused workflow clients
discover them with `modkit.tools` and enable selected tools or use `modkit.batch`.
Restart an existing MCP process after installing server changes.

`editor.status({connect:true})` initializes the retained Toolkit MCP frontend;
it does not start SC2 Editor. `editor.check` and `editor.capture` explicitly may
start a bridge-owned hidden Editor. Work is serialized and reuses that worker;
native status/wait/cancel use a separate bounded observation queue so a full work
queue cannot prevent observation. Source files stay workspace-contained. Jobs use
private archive snapshots; pending drafts and queued source changes are rejected.

The SDK stdio loop holds control replies behind a synchronous operation. The
transport therefore submits the same 21 work operations through the SDK queue
and observes them with bounded 500ms waits, returning the original operation
result to existing callers. This does not reopen documents, change arguments or
replay work. `transportJob` retains the native ID/state. Lost admission or an
unconfirmed observation sets `frontend.queueRecoveryRequired`; further work is
refused until explicit owned-frontend shutdown. Native operation failure and an
incomplete result remain distinct from transport uncertainty.
An identified terminal native job can arrive with MCP `isError:true`. Its
operation failure and full result are retained with `transportJob.responseError`;
this is not a lost observation and does not require restarting the frontend.
The complete final envelope, including its original result and exception metadata,
stays in the private report as `nativeQueueReport`; it is not copied into the
compact reply. Inspect it through `editor.job` details when needed.
Public job controls likewise retain terminal FAILED/CANCELLED/TIMED_OUT/INTERRUPTED
states. Missing or mismatching job identity remains unconfirmed and cannot be
used to release an active job or certify a result.

`editor.job` returns progress immediately. `deadlineExceeded` is advisory, not
cancellation. Explicit native cancellation is described below. Active work must
finish or unwind before `editor.stop`.
MCP EOF/shutdown drains outstanding work and closes only the owned worker.
Each bridge keeps a distinct worker directory for its lifetime; another MCP
process using the same map workspace does not share its Toolkit session files.

New sessions keep reports and workers under `.sc2mcp-output/ne`, with a compact
`w/<UUID without separators>` worker prefix. All UUID entropy, private snapshots
and containment checks remain. This reduces failures in upstream Windows archive
operations which still encounter `MAX_PATH`; it does not guarantee arbitrary
workspace/asset path lengths.
Previous `.sc2mcp-output/native-editor` evidence is retained and is not migrated.

`SC2_NATIVE_WORK_ROOT` optionally places reports and owned workers in a short
private local directory outside the map workspace and Toolkit installation, for
example `L:\\NE`. The value is captured when the bridge is created. Relative,
volume/share, overlapping and reparse-point roots are refused. Separate bridges
still have distinct full-entropy worker IDs; sequential jobs reuse one worker.
This does not authorize reading source maps outside the map workspace.

`editor.status.pathBudget` checks the pinned SDK's known save layout, including
its unpacked `.SC2Map.temp` directory and localized `TriggerStrings.txt`. On
Windows a known file path of 260 or more characters, or directory path of 248 or
more, rejects before frontend startup. A queued rejection writes no output and
returns `reportPersistence:"memory_only"`; inspect its job error. Configuration
inspection does not create folders. Arbitrary archive member lengths and actual
native save success still require separate verification. An already running
handler is never reset or redirected by this configuration.

## Calls

Nine public tools include two generic entry points. `editor.tools({})` lists all
26 allowlisted upstream methods; `editor.tools({name:"sc2_export_video"})` returns
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

### Background jobs and original Data

`editor.call` with `sc2_submit_job` accepts `operation`, nested `arguments` and an
optional `timeout_seconds` (1..14400). The nested map/template/scene/string files
receive the same workspace and snapshot checks as synchronous calls. Caller
`output`/`overwrite` and nested control envelopes are refused. A submission
returns an outer MCP job; poll `editor.job` to obtain `result.nativeJob.id`.
That native ID is distinct from the outer UUID. `QUEUED` confirms admission,
not completed execution, compilation or visual correctness.

Observe that ID through `editor.call` with `sc2_job_status`, `sc2_job_wait`
(`wait_ms` 0..30000) or explicit `sc2_job_cancel`; poll each outer observation
with `editor.job`. Only IDs admitted by this bridge are accepted. Inspect
`nativeJob.state`, `queueSucceeded`, `operationOutcome`, `operationSucceeded`,
`operationResult` and the operation's own confirmations separately.
`operationSucceeded` requires both queue success and an explicit completed
operation envelope. Missing or partial results remain incomplete. Terminal observations recheck the original inputs
and private snapshots. An older response cannot regress a known terminal state.
Admission and observation evidence remain separate immutable reports.

Cancellation is not rollback. A queued cancellation prevents execution; a running
cancellation/deadline may discard only the SDK's owned private Editor, retaining
its IPC until the handler unwinds. The wrapper clears current-document/capture
state. It never automatically retries an uncertain admission or adopts an async
GUI conversion as a verified source import. `editor.stop` refuses known active
native jobs; EOF drains known work before closing the owned frontend.

`sc2_check_map` provides a revision-bound native load/Data/generation/compile
report, with optional save/reopen. `sc2_read_data` reads effective original Data
values as strings; `complete` refers to the native serialization, while our
returned page remains bounded. `sc2_data_links` keeps catalog-qualified native
Explorer associations, without inventing edge direction or global usage.
`sc2_check_resources` currently checks the selected Model's main-file presence.
It does not certify nested textures, animations, sound or actual effect playback.
Full reports remain private; `response.extended`/`operationResult.extended`
contain explicit bounded pages for fields, links, objects and resource findings.

Current SDK14 qualification retains a separate repeated-open failure: a Unit
row and native field text can contain the requested Marine/LifeMax while the
later XML control contains an empty Catalog. The exact-ID check correctly
refuses this read. In one controlled same-archive sequence the first explicit
read and the following implicit current-document read pass; another explicit
read fails. Explicit calls use independent immutable snapshots. This does not
prove a general map-switch cause or repair. Do not substitute cached fields,
disable XML identity, silently restart the worker or relabel the failed sequence.
For consecutive inspections of an unchanged, successfully opened source, the
documented current-document form omits `map`/`template`; keep the same bridge and
poll each job before the next selection. This avoids requesting another open.
It is not recovery after a failed operation. Supply the explicit archive when
switching sources, and keep source-change/owned-document guards in force.

`editor.call` also recognizes consecutive pure `sc2_read_data`, `sc2_data_links`
and `sc2_check_resources` requests for that same archive. After a complete native
selection confirms the source SHA-256, map revision and unchanged private input,
it can omit the redundant open even when the next request supplies the archive.
`documentReuse` reports this decision and the owning read job. Each request still
performs original native selection/serialization; field results are never cached.
The real source pathname and digest must both match. Other native operations,
extra configuration/transform arguments, failure, incomplete identity, changed
or unavailable snapshots and stop invalidate the proof. A native operation
interleaved during a read prevents that read from reinstalling the proof.
Native source identity is checked again after reuse; a mismatch fails without
replay. This optimization does not establish that the Toolkit can safely reopen
or switch arbitrary documents. A direct Toolkit control using the exact same
pathname also reproduced the empty XML, independently of our per-job snapshots.
The proof concerns the loaded native document; archive SHA-256 does not pin
installed/transitive dependency changes. After changing that dependency context,
explicitly reload the document or restart the owned frontend. See
[current document-reuse evidence](verification/native-data-document-reuse-2026-10-24.json)
for the qualified same-source/resource sequence and the retained source-return
failure. A separate planned `sc2_open_document` followed by `sc2_read_data` also
reproduces the return failure; explicit opening is not a demonstrated repair.
For main Model resources, confirmed absence is `exists:false` with
`resourceErrors[].type:"MAIN_MODEL_FILE_MISSING"`; unsupported catalogs remain
incomplete. See the [terminal-error and Data findings](verification/native-editor-013-terminal-errors-2026-10-24.json).

PNG delivery accepts only the exact owned SDK worker or the original submitting
job directory, including a later background observation. Sharing an external
work root with another bridge never authorizes sibling workers/jobs. File size
and ownership are checked again when `editor.job(includeImage:true)` reads it.

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
{"tool":"editor.check","args":{"archive":"MyMap.SC2Map","checks":["load","save_reopen","compile"],"contextLabel":"MAIN","includeDiffs":true}}
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
When `compile` or `gameArtifact:"native_saved"` is requested, planning requires
an explicit nonblank `contextLabel` before starting any native worker. The latter
mode always recompiles the exact saved archive. A supplied label is an input,
not proof that the named GUI context exists; native checks still verify it.
The `MAIN` example above assumes the map actually contains that authored folder.

Full original results and each native operation are retained under the owned
storage paths returned by `editor.status` and the job receipts. Current builds
default to `.sc2mcp-output/ne/`, or the explicit private `SC2_NATIVE_WORK_ROOT`;
earlier `.sc2mcp-output/native-editor/` evidence is
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

Native Terrain viewport/overhead export is available. Map/region capture accepts
independent `includeUnits` and `includeDoodads` booleans, both defaulting to true.
Viewport requests reject these filters. `size` is horizontal pixel count; height
follows the native map aspect, rather than promising a square image. Compact
`objectFilters.verified` requires the upstream confirmation plus matching DLL
`native.terrainExport.actualUnits/actualDoodads` readback with confirmed custom
options. DLL integer flags accept only exact 0/1 (alongside booleans); strings
and other values remain unknown. Missing, checkbox-only
or mismatching readback yields an incomplete result, even if the upstream response
claims success; full evidence preserves that response. Sequential typed captures
of the unchanged source reuse the last verified loaded map. Other native calls
invalidate this shortcut. Water coverage still requires separate review. Saved-camera framing is available with original
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


## Version 1 contracts and immutable audit inspection

The complete pinned 1.0.0 release uses native protocol15 and provides31 MCP
operations. Its BUILD.json records version, native protocol, source commit and
embedded helper hashes; the installer verifies the exact ZIP and executable.
The client validates each public tool's input fields, types and nested queued
arguments before admission. Unknown keys are rejected, never silently removed.
`sc2_convert_xml` accepts either triggers_xml or triggers_file, not both.

Use `editor.tools` for supported operations and `editor.tools(name)` for the
exact upstream schema. `editor.call` supports `sc2_doctor` without a map: it
checks installation/package/storage prerequisites without launching an Editor.
A null graphicsReady is not a successful live graphics test.

A new1.0 Data audit provides reportId, an immutable index and project revision
metadata. `sc2_query_audit`, `sc2_find_object_uses` and `sc2_compare_audits` take
opaque report IDs from the same persistent Toolkit artifact store. They operate
without an owned document or Editor startup, directly or through sc2_submit_job.
Historical0.14 reports have no index; they are not silently converted. Unknown,
changed and cross-store artifacts remain errors. Query pages retain offsets,
totals, omission flags and full private-artifact references. If the compact
response retains fewer rows than the native page, nextOffset advances only past
the inline rows; nativeNextOffset/nativeReturned retain the original page
metadata. Use editor.job details for the complete stored page.

Preserve result.outcome and errorInfo separately from queued-job state.
SUCCEEDED means the operation returned, not that its native validation passed.
Failed/cancelled results remain failures, incomplete/unknown coverage remains
incomplete, and error metadata retains its code, next step and retry policy.
No automatic retry is added. Full original responses remain available through
editor.job details. Existing private-input, source identity, dirty-state,
owned-output and shutdown guards apply to all document operations.

Incoming uses cover typed native Data references; they exclude opaque Actor
strings and trigger/computed/runtime references. Comparison covers recorded
object/reference/resource observations, not every scalar effective value.
Project manifests cover declared local archives and installed build identity;
native physical cache paths and every CASC resource byte remain unverified.
The [SDK 1.0 scoped check](verification/native-editor-100-scoped-2026-10-25.json)
confirms 31 actual schemas, two exact native-saved forest suites (32 route legs
and 16 captures), two Game-only framing runs and clean owned-process closure.
Both full Data audits timed out at their unchanged 3,600-second deadlines without
indices; 45 → 73 → source return still fails with empty native XML. That run did
not exercise positive indexed queries or native warm Data reuse. The record
qualifies its frozen target, before the later authored-mod export change.

A later [Core-only indexed-query check](verification/native-core-index-2026-10-25.json)
verifies two immutable indices (1,924 and1,926 object rows), exact direct/queued
object/finding pages, incoming typed uses, three independently reconstructed row
differences and fresh native45→45 Data reads around document-free queries.
Fourteen positive calls complete, and the same retained frontend/document is
preserved. Both underlying audits still have incomplete reference/resource
coverage and null validationPassed. The small Core corpus does not repair the
separate full-map timeouts, original-source return or resource171 finding.
Art and current whole-package readiness remain unaccepted.
