# Private SC2 game testing

For repeatable saved-map suites use [project.test.*](PROJECT_TESTS.md), which
reuses these same retained bridges and adds manifests, route observations,
workflow leases and digest-bound reports. Direct commands below remain available.

SC2EditorToolkit can use an external SC2GameToolkit installation. The game
adapter is separate from the native Editor adapter. Its current upstream version
is experimental `0.1.0-dev`; the pinned release is `v0.1.0-dev.11` and the
observed game build is `5.0.17.98310`. A matching
frontend version is a contract check, not a binary provenance or stability claim.

## Configuration

Keep the private toolkit outside tracked source and portable packages. Configure
the server environment with absolute local paths:

```text
SC2_GAME_TOOLKIT_HOME=<private SC2GameToolkit directory>
SC2_GAME_PYTHON=<Python 3.11+ executable>
SC2_GAME_ALLOW_LAUNCH=1
SC2_GAME_REQUIRED_RELEASE=v0.1.0-dev.11
SC2_MCP_PROFILE=game
SC2_UI_ROOT=<workspace containing saved test maps>
```

`workflow`, `map-builder` and `all` also expose this optional module. Merely
starting SC2EditorToolkit does not start Python or SC2. Missing runtime configuration
is reported explicitly. Without `SC2_GAME_ALLOW_LAUNCH=1`, attach is refused.
`SC2_GAME_BINARIES` optionally selects an external native binary directory.
`SC2_GAME_WORK_ROOT` optionally selects a dedicated absolute local artifact
directory outside the map workspace and private Toolkit installation. Each bridge
creates its own UUID child and retains that child across sequential map tests.
This can keep large recordings on another drive without moving existing evidence
or changing the saved source map. `game.status` reports the planned `work` and
`artifactStorage`; a disconnected status does not create folders. Invalid,
workspace/runtime-overlapping, volume/share-root and reparse paths reject on
connection before the private frontend starts. There is no silent fallback.
Leave it unset for the existing `.sc2mcp-output/native-game/<uuid>` behavior.
Use a client tool timeout of at least 600 seconds for load and recording operations.

`npm run game:setup` explicitly installs the complete pinned private ZIP using
authenticated `gh` access. It never downloads at server startup, starts a game,
overwrites an existing installation or changes a neighboring development checkout.
The ignored `.game-toolkit-runtime/<version>/` installation preserves upstream
notices. The installer checks the pinned archive and its complete 113-file
manifest. Before starting Python the adapter rechecks that manifest, rejects added
executable/source files and refuses a different binary directory. A required
release prevents silently falling back to an unpinned checkout. Deliberate external
development installations without a receipt remain available when the required
release is omitted; status reports `external_unpinned`. These integrity checks
detect accidental mixing or changes, not modifications by a machine administrator.

Changing Codex MCP configuration affects newly connected servers. An existing
chat can retain its old tool inventory until that MCP connection is restarted;
verify `game.ui.inspect` exposes `scope`, `name`, `path`, `text` and `visible_only`
before claiming the direct connection has upgraded. Adapter discovery uses
`game.tools({name:"game.ui.inspect"})` and status includes verified release identity.

## Compact MCP workflow

1. `game.status({connect:true})` initializes the private stdio frontend and reads
   its status, without launching a game.
2. `game.tools({})` lists operation names and descriptions. Request one exact
   upstream schema with `game.tools({name:"game.units.find"})`.
3. `game.attach({map:"Test.SC2Map",timeout:120,renderBackend:"auto"})` explicitly launches a test from
   a saved map inside the workspace. Save/discard drafts first. The upstream
   runtime instruments a separate copy, owns its hidden Windows desktop/process,
   and confirms execution through a live Galaxy handshake.
4. `game.call({method:"game.units.find",arguments:{type:"Marine",limit:16}})`
   inspects the actual game. Use returned IDs and cursors, not guessed values.
   The same route supports diagnostics, orders, selection, camera, capture,
   events, fixtures, UI, recording and bounded test scenarios.
5. `game.detach({})` stops only that bridge's game and checks the source digest.
   Server EOF also drains accepted requests and gracefully closes the frontend.

### One action and its observed events

`game.action` holds the bridge queue across a history drain, one normal order or
UI activation, and bounded event observation. For example, using actual returned
unit IDs:

```json
{
  "action": {"method": "game.order", "arguments": {
    "unit": "<caster ID>", "action": "ability", "ability": "MyPulse",
    "command": 0, "x": 24, "y": 30
  }},
  "events": [{"id": "hit", "match": {
    "kind": "damage", "source": "galaxy", "unit": "<target ID>", "amount": 40
  }}],
  "timeout": 10
}
```

The baseline consumes every returned `game.events` continuation until `hasMore`
is false. It never jumps to `latestCursor`. Subsequent actions reuse the retained
tail, draining unread pages before submission. The adapter correlates matched
events with the same session, epoch and map-load identity and requires finite
event time at or after the action response time. Ability damage automatically
binds `sourceUnit` to the ordered caster; ability events bind its unit and ability.
Contradictory caller filters reject before submission. Ability orders also await
the native `complete` event by default; set `waitForComplete:false` for an explicit
interruption test. This does not prove a particular animation or visual effect.

Only `game.order` and `game.ui.activate` are action methods. Use their discovered
upstream argument schemas. The wrapper is a local MCP workflow, not an operation
advertised by the external Toolkit or an allowed nested `game.test.run` step.
UI events need actual inspected IDs and exact native event fields; this wrapper
does not invent a callback schema or prove its resulting state.

The native UI endpoint reports an exact handler-return time in `clickEvent`
instead of top-level `gameTime`/epoch/map serial. For that declared profile the
adapter requires the matching session, confirmed original native handler,
accepted `native_ui_click`, exact owned timer-counter clock and no contradictory
identity fields. It reports `actionClock=native_ui_click.gameTime` and
`actionIdentity=ui_session_then_event_pages`; it does not fill in absent fields.
A following event page must still match the full baseline session/epoch/map
identity before any positive verdict. Earlier clocks, uncertain handler timing
or map replacement remain inconclusive. The actual UI callback schema and
control IDs are explicit caller filters, not inferred from a frame-registry ID.

Reusable manifests expose the same primitive through `game.actions`, with
before/after state assertions and local `$from` query bindings. See
[action checks](PROJECT_TESTS.md#reusable-action-observations). Upstream
`game.test.run` remains unchanged and does not accept nested `game.action`.

Each event has an exact scalar `match` including `kind` and `source`. The workflow
returns matched events and compact page counts; redacted request, response and
page receipts remain under the bridge's private `action-<uuid>` directory.
Baseline drainage is bounded to 256 pages/10 seconds, subsequent observation to
256 pages and the requested 1..120 seconds. Missing events are inconclusive.
Retention loss stays explicit even for a positive match; positive occurrence
does not certify event absence or full diagnostic coverage.

The action is never retried, including after transport or evidence-write errors.
`actionSubmitted` distinguishes false, true (a response was received) and
`"unknown"` (the response was lost). True does not mean execution succeeded.
Unknown submission needs inspection before deciding on another action. Stream
replacement invalidates accumulated matches. Same-time overlapping casts still
need a distinguishable target/effect or independent state check: the runtime
does not expose a unique cast identity, so correlation alone is not absolute
causality. The command does not alter native Data costs or ability lifecycles.

For native game/mod UI use
`game.call({method:"game.ui.inspect",arguments:{scope:"native",name:"Menu",visible_only:true,limit:16}})`.
The default `registered` scope still reads the instrumented map registry.
Continue native pages with the returned `nextOffset`; handles belong to that
session. Use `game.ui.activate` only on a deliberately selected returned control
and verify its gameplay effect separately from handler acceptance. The adapter
forwards these upstream properties without maintaining a second UI schema.
`renderBackend` also works in `project.test` game manifests; Editor and game
renderer choices are independent.

Text filters match the engine's actual localized text. English maintained
instructions do not force an English game locale. The native GUI corpus uses
the visible ruRU button text, requires a returned enabled button control, then
checks the real callback's state change after activation. Do not guess a control
handle or treat a normal handler return as proof of the intended gameplay result.

For an event wait, obtain `game.events`' cursor before the action, then pass it
to `game.wait`, for example `condition:{kind:"unit_died",source:"galaxy",
unitType:"Marine",owner:1}`. A matching event is returned as the `matched` object,
not boolean `true`; assert its `kind` and the relevant fields. This specific event
contract passed in the GUI corpus. `at_point` remains a separate unit-state
condition. Do not assume arbitrary condition kinds or expression execution.

The bridge serializes up to eight active/queued requests. Nested recording actions
and scenario steps cannot bypass the launch boundary. It exposes no PID attachment,
arbitrary memory access or arbitrary Python execution. It never retries an action
after a lost response. Scenario references are interpreted by upstream.

Native PNG content and failed/unsupported/inconclusive results are preserved.
An accepted order is not proof of a cast; a constructor event is not proof of a
visible effect. Inspect execution/state, then compare actual captured frames.
Unavailable diagnostics remain unknown. Test-owned resource restoration and all
other upstream limitations still apply; see the private toolkit's README/VALIDATION.

## Source privacy and distribution

This repository contains only an integration adapter and no GameToolkit C++,
Python, Galaxy source or binaries. It does not fetch the private repository or
include that external installation in portable builds. Preserve upstream LICENSE,
NOTICE and third-party notices if distributing a runtime separately. The current
Python frontend itself requires readable Python modules locally; this adapter
does not turn them into a closed-source binary distribution.

Portable packaging runs `check-distribution-privacy.mjs` and refuses private
runtime/session directories, test archives and debug artifacts. With
`SC2_GAME_TOOLKIT_HOME` configured it also compares C++/Python/Galaxy source hashes
against the external corpus, detecting exact renamed copies. This is a packaging
guard, not an obfuscator or proof against transformed snippets. The audit report
is saved in the local package as `PRIVACY-CHECK.json`.

Generated maps do not need the test DLL or Python server to run normally. Test
instrumentation belongs only in upstream's disposable map copy. Distribute the
original saved map, never the instrumented copy. SC2Map contents, including Galaxy
and XML, remain extractable by recipients. Neither a private repository nor a
compiled DLL guarantees resistance to reverse engineering. Strict source secrecy
requires keeping that implementation on a controlled machine; packaging alone
does not provide it.

Session artifacts under `.sc2mcp-output/native-game`, or the explicitly configured
external `SC2_GAME_WORK_ROOT`, are private and may contain
authentication material, source scripts, screenshots and personal paths. Do not
publish session folders. The adapter redacts structured token/secret/nonce fields
in JSON replies; this is not a general anonymizer for arbitrary log strings or
map dialogue. Publish only reviewed, selected evidence. The runtime does not modify
the original map or installed game files by design; source hashes provide an
additional check, not a guarantee against every runtime failure.

## Earlier baseline verification on 2026-10-21

The external `0.1.0-dev` frontend initialized through the real SC2EditorToolkit
MCP process and reported 18 operations. A private seed map started with a matching
live Galaxy identity handshake on build `5.0.17.98310`. Status, paged unit search,
engine diagnostics and a 1280x720 native PNG crossed the adapter successfully.
An extended run also created a test-owned Phoenix, verified actual selection,
set the camera, submitted an ordinary move order and observed arrival, read
events, passed an inspect/stop assertion scenario and verified fixture cleanup.
The source SHA-256 stayed unchanged, detach completed and no owned game host
remained. The frame was inspected; existing map Actor warnings were visible and
retained as diagnostics. This verifies integration, not a warning-free map or all
18 operations. Structured UI inspection returned `unsupported` because the seed
had no registered dialog controls; its screenshot fallback was preserved. Ability
visuals, UI activation, recording/audio and other game versions were not certified
by this check. The 25 selected adapter/Editor/profile tests also passed.

Reproduce the frontend check with `npm run game:verify`. Explicit live testing
uses `npm run game:verify -- --live --workspace <directory> --map <saved.SC2Map>`.
The verifier writes private evidence under `work/native-game-verification/` and
never starts a game in frontend-only mode.

## Pinned dev.11 update on 2026-10-21

The complete `v0.1.0-dev.11` private ZIP and its four native binaries matched
published hashes. All 113 manifest entries passed local verification. Both future
Codex server configurations use the isolated version directory; the direct
`sc2game` tool inventory in this chat also refreshed to the native UI schema.
The neighboring development checkout and its active processes were left alone.

An extended real outer-MCP run called all 18 upstream operations successfully on
the known GUI/Data foundation: live launch/build identity, unit search/inspection,
selection, camera, move/arrival, events, diagnostics, debugger inspection, fixture
cleanup, scenario assertions, PNG and a short silent MP4. Native UI checks covered
pagination, name/path/text/visibility filtering, effective state and geometry,
opening the standard menu and resuming through confirmed original handlers, then
reading back that the menu was hidden. The source digest stayed unchanged and
owned detach completed. The PNG was inspected: terrain, objects, hero selection
and the test unit were visible; existing Tarmac warnings remain in the evidence.
Calling every operation does not certify every argument, effect, audio path or map.

An earlier explicit `legacy` launch exited before handshake (exit code 536936448).
The later successful run used `auto`, which selected Vulkan. Both observations
are retained; the failure's root cause is not established. Use the default `auto`
unless testing a specific renderer. Reproduce the extended check with
`npm run game:verify -- --live --native-ui --extended --workspace <root> --map <map>`.
Per-map reports now record the verified GameToolkit release/archive identity in
`gameRuntime`, independently from the game build and map digest.

Four further lifecycle runs (two archives, two runs each, same retained bridge)
passed playable-bound preflight, bidirectional Marine movement, native menu
open/resume assertions and owned cleanup. The archives share a GUI/Data foundation;
this is lifecycle evidence rather than two independent mission genres. A later
positive control exercised the bounded MapInfo reader; the matching deliberate
out-of-bounds Seed fixture stopped before launching a game. Runtime diagnostic
coverage remains partial throughout.
