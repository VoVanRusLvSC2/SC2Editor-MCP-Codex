# Optional original Editor checks

Uses SC2 Native Toolkit by VoVanRusLvSC2:
https://github.com/VoVanRusLvSC2/SC2NativeToolkit.

`map.preview` remains the fast ModKit renderer. The separate `editor.*` tools
provide original GUI-to-Galaxy compilation, operation-scoped Messages/Console
diagnostics, native save/close/reopen comparison and selected original images.
They do not author map content or validate gameplay.

## Setup and lifecycle

Run `npm run native:setup` on Windows. This downloads the pinned
`v0.8.0-rc.1` package, checks its published SHA-256 and preserves all notices in
the ignored `.native-toolkit-runtime/` directory. The executable hash is recorded
and checked before use. Setup does not launch the Editor. Windows `tar.exe` is
used for extraction. An explicit `SC2_NATIVE_MCP_PATH` can select another local
0.8.x MCP executable; that override is version-checked, but has no package pin.

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

## Evidence limits

Compiler results, load/Data observations, stable save/reopen component bytes,
native image contents and gameplay are separate claims. Original Data opening
may remain silent for some invalid references. Unreadable logs are unknown.
Existing baseline messages are not silently reclassified as new errors.

Native Terrain viewport/overhead export is available. Water and category-exclusion
coverage remains incomplete. Region mode crops a full-map image, with the Toolkit's
experimental coordinate flag; it is not a camera-controlled close-up. The paused
custom cutscene renderer is unchanged. Native gameplay/ability testing is absent.
