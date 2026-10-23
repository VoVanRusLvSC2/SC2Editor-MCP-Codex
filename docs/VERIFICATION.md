# SC2EditorToolkit: verified scope

## Readiness

The [inline-library runtime checkpoint](verification/inline-library-runtime-2026-10-23.json)
removes the blanket map-root restriction for supported self-contained libraries.
Three previously original-Editor-compiled GUI graphs now generate locally through
MCP and pass two game launches each. Only MapScript changed;37 other payload
components per map, including GUI, strings, Data and Objects, stayed byte-identical.
Six successful launches passed typed-core and registration markers plus four
real UI clicks. Two earlier runs retain a failed SDK `units.length` assertion;
the corrected manifest and raw lists both establish one matching marker.
Full regression:1446pass/1skip;37 focused checks. A358-file frozen candidate
passed private-source comparison against1113 files. This does not renew original
Editor save/reopen, prove all library/reference semantics or certify mission art.

The [registration-discovery checkpoint](verification/registration-discovery-2026-10-23.json)
adds static eligibility metadata to paged search and descriptions. Four actual
MCP requests distinguish supported runtime binding from valid Event XML, including
same-name definitions with different IDs. The112 native Event definitions have
108 statically matched signatures and four explicit refusals; this is not108
native runtime tests. Full regression:1440pass/1skip;32 focused checks. At that
checkpoint both local emitters rejected the exact library-bearing fixture; the
later inline-library checkpoint above supersedes that particular limitation.
Original Editor and exact saved-artifact checks remain separate requirements.

The [reusable-action checkpoint](verification/reusable-action-checks-2026-10-23.json)
confirms five frozen-runtime launches through manifest `game.actions`: six real
Dialog clicks with independent callback readback, six40-damage native casts with
completion and energy readback, and128 explicit fixtures followed by a three-page
baseline. The first four launches share one retained frontend; the stress launch
uses a separate one. Full regression:1438pass/1skip. The real pre-fix native UI
clock failure is retained; accepting its exact handler clock does not fabricate
epoch/map metadata or provide a unique cast ID. Diagnostics remain partial.
Reviewed frames show a readable diagnostic button, not a finished mission UI.
The GUI save/reopen job and the complete quality roadmap remain open.

The [runtime-registration checkpoint](verification/native-runtime-registration-2026-10-23.json)
adds typed explicit-target `Registration` calls without ScriptCode/Custom Script.
Original Editor generation/compile retained the target parameter and local timer;
two game launches passed phase, receiver and exactly-one-callback controls.
Full regression:1426pass/1skip;36 focused checks. The native save/reopen job is
still running beyond its observation deadline: no saved/reopened artifact or
roundtrip equivalence is accepted. Static support for108 matched native signatures
is broader than the single live timer profile; four uncertain bindings reject.
The complete quality roadmap remains open.

The [native Learn/XP checkpoint](verification/native-learn-xp-2026-10-23.json)
checks three native point profiles, level/max-rank gates and per-rank effects
through two clean launches. Thirty Learn orders,14 causal damage/energy casts
and14 XP kills passed; original Editor Data load and generated Galaxy compilation
passed. The map-wide Core recipient search caused nearby heroes to divide kill
XP despite zero behavior-level sharing. Explicit `data.xp.search radius=0` gave
the killer50 and both controls0 in a separate read-only diagnostic. Hero recipes
preserve this map-wide policy by default. Full regression:1422pass/1skip. Reviewed
frames show native Learn/execute icons and level3, with diagnostic fixture clutter
and an edge-framed unit; this is not finished mission UI/art. Real UI activation,
larger talent systems and the complete roadmap remain open.

The [action-event checkpoint](verification/action-events-2026-10-22.json) moves
pre-action history drainage and time/caster-bound observation into `game.action`.
Two clean launches of the unchanged charge fixture passed six ordinary casts,
native completion,120 total damage per launch and energy100→97. Full regression:
1410pass/1 skipped shell fixture;71 focused checks. The wrapper holds its bridge
queue and never retries an ambiguous action. Native multi-page histories, real
UI activation through this wrapper and unique overlapping-cast attribution remain
outside this live corpus. The private SDK and authored map were not modified;
diagnostic coverage remains partial and the complete roadmap is still open.

The [native charge/range checkpoint](verification/native-charges-range-2026-10-22.json)
adds a guarded native Charge recipe, initial-stock handling and explicit level0
range overrides. The exact target-ability archive passed Editor load/compile and
two fresh launches:38 causal casts,24 blocked orders, four pool scopes and five
additional stock/recovery profiles. Each cast waited native completion. Full
regression:1399pass/1 skipped shell fixture. This is a scoped mechanics corpus;
diagnostics remain partial and the complete quality roadmap is still open.

The [card and availability checkpoint](verification/data-card-quality-2026-10-22.json)
adds inherited command-card guards and zero-speed availability warnings to the
MCP. A new ordinary archive passed two clean launches: movement out/back, native
XP thresholds and life/damage deltas. Original Editor load/compile passed; the
reviewed recording shows nine command icons, no hotkey modal and an in-frame
level burst. Full tests:1328 pass/1 skip. Static card resolution is restricted to
the declared supported array/parent profile; user hotkey variants, main-unit
ability animation and finished mission presentation remain open.

The historical [native veterancy checkpoint](verification/native-veterancy-2026-10-22.json)
verifies solo kill XP and cumulative stat progression through the high-level
Data/CSV recipe. Native levels1→2→2→3 at total XP0→50→100→150 passed twice;
life and damage deltas applied without trigger progression. Original Editor
load/compile and a compact current-writer no-op passed. Full tests:1318 pass/1 skip.
An extra recording shows native HUD progression and visible level feedback, but
also a hotkey-conflict warning and camera-clipped large effect. Presentation is
not accepted as finished; inherited card guards and camera framing remain next.

The [targeted Data checkpoint](verification/targeted-data-quality-2026-10-22.json)
adds an explicit native-template ability recipe and local-template resolution.
The Snipe-based archive passed original Editor load/compile and two clean game
launches; the instant regression passed two further launches. Controls observe
no spend/damage on a mechanical target, outside range with an immobile caster,
or with insufficient energy. Valid casts verified 30 damage and 25 energy twice,
early reuse protection and cooldown recovery. Order acceptance confirms submission,
not execution or an explicit illegal-target reason. Separate native impact frames
were reviewed and owned-process PCM was nonzero. Full regression:1316 pass/1 skip;
the local TargetAbility portable passed schema/fingerprint/privacy checks. Other
targeting templates, charges, progression and finished presentation remain open.

The [regional native topology checkpoint](verification/landscape-native-ownership-2026-10-22.json)
adds owned cliff/ramp rows, independent zone rebuild/removal, guarded ancestor
object resnap and catalog cache reuse across native terrain edits. Three exact
ordinary archives passed six clean launches and 48 Marine/Marauder traversals.
The east region's native rows and binary channels remained identical while the
west region was lowered and restored. The full compiled suite passed 1312 tests
with one skipped shell case. Detail frames and a supplemental overview were
reviewed; the original clipped overview is retained as unsuitable framing.
The local NativeOwnership portable passed 20 compiled fingerprint checks and a
private-source comparison against 2331 external files with zero violations.
This restricted native profile does not certify arbitrary topology, native
navigation rebuilding, buildability, finished art or the full roadmap.

The [owned location checkpoint](verification/landscape-groups-2026-10-22.json)
adds measured infrastructure, surface-preserving decor passes, height-editing
budgets and read-only Unit/effect Actor measurements. Three freshly created maps
passed six clean game launches, 48 corridor-bound traversals and 18 view captures
through one retained bridge. All nine first-run views were inspected; repeated
captures establish transport/readback only. The full regression run passed 1281
tests with one existing skipped shell case. A 20-building batch returned 7,991
JSON bytes instead of 35,231 while keeping identical operations. These are
scoped technical results, not a numeric art score or full roadmap readiness.

**Supported authoring workflows have recorded evidence; the full roadmap remains
open.** The current pin is SC2EditorToolkit **0.10.0-rc.1**, native protocol **11**,
on Windows x64 / Editor **5.0.17.98310**. Renewed Vulkan runs passed core native
load/Data, GUI compilation/export, save/reopen, original images and corrected
camera A/B/A. The exact native-saved GUI/Data archive then passed game launch,
bidirectional Marine movement, image delivery and cleanup. Partial runtime
diagnostics and visible Tarmac warnings remain explicit. An initial startup
sendError 187 and a mostly black camera fixture are retained as earlier failures.
All 18 upstream methods were called through MCP on recorded fixtures, including
native GUI XML conversion, cutscene timing/frame capture and a decoded silent
H.264 export. Audio export was not tested by that silent fixture.

Fresh outer MCP checks passed updated ModKit Data/navigation/model preview and
the declared-effect presentation audit. The full topology/startup/library and
ability/cutscene coverage matrices remain open. Refer to the
[historical broad update record](verification/toolkit-update-2026-10-21.json).

The private GameToolkit is now pinned to `v0.1.0-dev.11`; all 18 operations passed
an extended MCP fixture run, including native UI handler activation and silent
MP4 recording. Repeated lifecycle checks, current release integrity and source
exclusion are in the [game update evidence](verification/game-toolkit-dev11-2026-10-21.json).

The later library-import extension passed original conversion, guarded adoption
and export through MCP, but its new fixture failed two game handshakes. An original
save handler on that fixture remains active beyond its advisory deadline; it was
not force-killed. Two subsequent game launches of the known GUI/Data foundation
passed in the same retained game bridge. These results do not certify library
startup or a general save/reopen path.

Four cardinal ramps were generated through MCP. A first game fixture used a point
outside MapInfo's playable bounds. After moving the generated pad inside bounds,
the engine still displaced the test unit at creation; traversal was not accepted.
The explicit no-pathing paint layer was already clear. The remaining cause is not
established; geometry/cache/collision checks remain open. Native geometry plans
now expose `NATIVE_NAVIGATION_NOT_REBUILT` rather than implying that file writes
rebuilt engine navigation. Earlier successful movement evidence remains valid for
its own maps.

The first cliff correction now derives non-ramp CLIF words from the four coarse
corners instead of one fine vertex. It matches 396 original native cells across
12 non-saddle orientations; unsupported saddle, multi-level and void joins are
rejected. A separate generated fixture launched through MCP, showed a closed
convex cap and tiny plateau in reviewed game frames, and passed Marine placement
on both levels plus a high-pad move. A follow-up canonical HMAP/SMAP pass changed
163 fine vertices while leaving every coarse vertex and base height unchanged.
Its generated map passed live Marine placement at a concave corner, and reviewed
UI-free frames show that L-shaped join and the tiny plateau closed. Fine patterns
for all 12 orientations were selected from original native observations. This is a bounded improvement,
not a claim that all black gaps are fixed.

A later cardinal-ramp check isolated another generator bug: native direction
codes had been treated as compass angles. Correct enum/frame pairs now agree
with the original City corpus. Reviewed close-ups show closed side caps in all
four supported directions. On the corrected exact archive, two clean launches
passed 32 Marine/Marauder ascent/descent checks in one retained bridge, with
sampled trajectory corridors preventing a bypass from counting as success.
Maximum observed deviation was 1.33 world units at a 2-unit limit. This accepts
that width-four, adjacent-level Agria fixture, not all ramp widths/tilesets or
an authoritative navigation/collision rebuild.

`terrain.cliff.repair` normalizes registered fine-vertex joins without replacing
coarse corners/base heights. `terrain.ramp.repair` repairs only the diagnosed
legacy direction profile after full measured-channel checks. Its compact MCP
save produced a byte-identical archive to fresh corrected generation; a repeat
left all source terrain bytes unchanged. See the
[terrain checkpoint evidence](verification/terrain-junctions-2026-10-21.json).

The later [location checkpoint](verification/landscape-2026-10-22.json) records
incremental zone ownership, exact Actor palettes, dependency-aware rebuilds and
content-verified Browse caching. A same-map warm repeat fell from 51.87 s to
2.46 s; a parent/overlay update from 55.28 s to 4.94 s. Cold interpretation still
takes about a minute on that fixture. This is measured server time, not token
billing. Named native viewpoints verify camera readback and deliver digest-checked
PNGs through `project.test.report`; art quality still requires pixel review.
These newer source fingerprints supersede earlier fingerprints for the modules
they name without extending the scope of historical native results.

Ground suites now check route centers against playable bounds read from exact
MapInfo bytes, using a bounded native component read and archive-digest cache.
A known route passed with the new reader. A Seed-map point inside the full terrain
but outside its playable left boundary failed before game launch, with source
and private artifact unchanged. These bounds do not certify collision/clearance.

The public product name is **SC2EditorToolkit**. Existing repository links,
`sc2editor-mcp`, tool names, environment variables and historical license/source
credits retain their compatibility identities. A repository relocation is separate.

## Original DLL and protocol acceptance

The historical [machine-readable record](verification/native-editor-0.9.2.json) publishes a
bounded, path-free extract of real local results: package/executable identities,
protocols, timestamps, source/artifact hashes, camera readback and source scope.
Private maps, generated user Galaxy, DLLs and screenshots are not committed.

| Operation | Confirmation | Limit |
| --- | --- | --- |
| MCP initialize/discovery/calls | Real stdio chain: this server → Toolkit → DLL → original Editor | Seven public `editor.*` tools; 18 upstream tools listed, not 18 independently tested features |
| Native connection | Original requests completed under protocol 11 | Previous Win32 126 failure did not reproduce in these runs |
| Map/Data load | Original loader and Data module confirmed; new logs clear | Not exhaustive Data reference/asset validation |
| GUI generation/Compile All | Native generation and compilation passed with zero errors | Recorded fixture/dependencies, not universal GUI conversion |
| Galaxy export | Exact native bytes; artifact SHA-256 checked | Export only follows fresh successful compile |
| Save As/Close/disk reopen | Native commands confirmed; all 60 MPQ components compared | Saved-to-reopened equality; serialization changes reported separately |
| Whole-map PNG | Pixels inspected: terrain, units and decor visible | One fixture, not all water/categories/models |
| Saved camera A/B/A | Target/angle/distance/FOV readback and useful images inspected | Saved placements, not Galaxy-trigger cinematic playback |
| MCP image delivery | Verifier decodes `editor.job(includeImage=true)` and checks PNG/hash | Distinct from a file merely existing |
| Negative cases | Unknown camera and inconsistent yaw refused; old/mixed versions rejected by regressions | Failed captures/compiles cannot substitute old images/Galaxy |
| Source/lifecycle | Archive hashes unchanged; graceful stop; observed desktop/focus counters zero | Only owned hidden workers |

Complete raw logs/images remain in ignored `work/` and `.sc2mcp-output/`. Hashes
identify observations, not independent certification. Another user can repeat
the checks on their own archive using the commands below.

## Module acceptance matrix

`Regression` means automated format/source/transport checks. `Native` means an
actual original Editor operation. Unchecked engine behavior remains unchecked.

| Section | Confirmed supported scope | Partial or not checked |
| --- | --- | --- |
| MCP/authoring protocol | Profiles/discovery, schemas/defaults, batch references, organization/catalog plan/save and repeated organization through real stdio | Natural-language artistic/design quality is not guaranteed |
| Transactions | Staging, coherent writes, stale-read guards and rollback regressions | External edits must still invalidate conflicting plans |
| Data | Catalog XML, bounded reference/parent queries and Actor/effect recipes; fixture Data opened natively | Full engine inheritance/default/token/override semantics; all ability VFX/gameplay |
| Galaxy/GUI | Script/signature checks, bounded GUI import/runtime/folder regressions; fixture compiled natively | Universal GUI roundtrip, all libraries/function shapes |
| Terrain | Supported codecs, height/texture/cliff/ramp/composition regressions and native fixture image | Arbitrary versions, all cliff corners, regenerated navigation/collision and complex water/shorelines |
| Placement/decor | Placement/visibility metadata, measured compositions/ownership and catalog integrity; duplicate-request regression | Universal footprints/collision and consistently professional artistic quality |
| Map/MPQ/Document | Import/export, metadata, supported foundations and native fixture roundtrip | Every format, universal resize and dependency combination |
| CASC/ModKit | Read/snapshot/provenance, adapter and format regressions; fast ModKit preview retained | Every build/asset, unavailable/encrypted payloads, CDN writes and engine rendering parity |
| Settings | Supported lobby/player/variant plans and new-player regressions | Every lobby/team/AI combination in the game |
| UI/Text | Layout/localization/formatting/transaction regressions | Every dynamic in-game binding, resolution and locale |
| AI | Bounded metadata/authoring regressions | Universal live AI behavior |
| Assets | Existing metadata/measurement/palette evidence | Engine collision shapes and complete asset resolution |
| Custom cutscene renderer | Offline authoring/preview and historical material/sampler tests | Full lighting/material/shadow/postprocess, animation blending and FaceFX parity |
| Toolkit cutscene/audio/video | Original cutscene load/seek/frame and silent MP4 passed; all 18 upstream methods have actual fixture calls; nine public Editor tools | Audio export, all FaceFX/links/assets and argument combinations remain open |
| Gameplay | Optional GameToolkit adapter and manifest suite: seed launch/handshake; actual Marine and Marauder arrival in both directions on one declared route; selection, diagnostics, capture and cleanup; dev.11 native menu inspection/activation and silent recording; see [scope](NATIVE_GAME.md) | General startup matrix, all cliff/ramp routes, UI variants and ability presentation remain open; diagnostics remain partial; no general campaign/balance/performance certificate |

Exact core regression files, totals, platform skip and TAP hashes are recorded in
the JSON. This run is broader than the native bridge suite, but is not the entire
repository test suite or full engine coverage. It also records initial failures
and their resolution instead of silently removing them. Local private examples
and fixtures are required for some tests and are excluded from publication.

## Reproduce

```powershell
npm ci
npm run build
npm run build:release
npm run lint
npm run catalog:verify
npm run docs:check-language
npm run evidence:status
npm run evidence:check
npm run native:setup
npm run native:verify
```

`evidence:status` reads the [digest-bound record index](verification/index.json)
and reports each record's declared source scope as matched or changed, without
rewriting historical fingerprints. `--details` lists changed source files;
`--require-ready` exits 2 while a required roadmap item is partial, stale,
unsupported, failed or not checked. A source match retains the original fixture
scope and does not extend its native observations. Broken record digests, unsafe
paths or invalid coverage fail the query. The current index has unresolved
requirements and deliberately reports `roadmapReady:false`.

`evidence:check` retains the earlier broad acceptance gate. It currently fails
because the 2026-10-21 aggregate's source fingerprints changed during later
implementation. Its failure is retained; the new status inventory does not waive
it or certify those old observations against changed code.
`evidence:check` checks evidence integrity and scoped current acceptance;
it does not launch an Editor or certify every feature. Source changes require
renewed evidence scope. `--integrity-only` checks retained record integrity
without requiring the current scoped acceptance gate to pass.
`native:setup` installs the complete pinned, checksum/version/protocol-checked
package and preserves notices. It does not start an Editor or auto-upgrade to a
future version. Restart an existing MCP connection after rebuilding/upgrading.
`native:verify` initializes/discovers/stops the frontend without starting an Editor.

Original native acceptance requires explicit `--live`:

```powershell
npm run native:verify -- --live --workspace "K:/Maps/MyProject" --archive "Test.SC2Map"
# Exact saved IDs enable camera A/B/A:
npm run native:verify -- --live --workspace "K:/Maps/MyProject" --archive "Test.SC2Map" --camera-id 2001 --camera-id 2002 --camera-id 2001
```

Supply your own saved archive and installed dependencies. The bridge works on
private snapshots and checks the source hash. The script prints an ignored private
report path under `work/native-verification/`; failed native calls or image/hash
checks exit unsuccessfully. It never force-kills a native handler. Initial original
loading can take minutes. Review local paths/user diagnostics before sharing logs.

Focused automated checks:

```powershell
node --test dist/tests/nativeEditor.test.js dist/tests/mcpBatch.test.js dist/tests/authoringProtocolTransport.test.js dist/tests/focusedProfileTransport.test.js
```

[Quality improvement roadmap](MCP_QUALITY_ROADMAP.md) ·
[Native lifecycle/details](NATIVE_EDITOR.md) · [Project status](PROJECT_STATUS.md) ·
[Authoring rules](AUTHORING_PROTOCOL.md) · [Historical snapshot](CAPABILITIES_REPORT.md)
