# SC2EditorToolkit: verified scope

## Readiness

**The tested MCP authoring workflows and original Editor bridge work.** The
current bridge uses SC2 Native Toolkit **0.9.2-rc.1**, native protocol **11**, on
Windows x64 / Editor **5.0.17.98310**. This is a working toolkit for supported
formats and workflows. It does not implement or certify every Editor/game feature.

The public product name is **SC2EditorToolkit**. Existing repository links,
`sc2editor-mcp`, tool names, environment variables and historical license/source
credits retain their compatibility identities. A repository relocation is separate.

## Original DLL and protocol acceptance

The [machine-readable record](verification/native-editor-0.9.2.json) publishes a
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
| Toolkit cutscene/audio/video | Available upstream; separate from these seven wrappers | Not locally certified by this acceptance; enumeration is not execution |
| Gameplay | Historical user observations are map-specific | No general campaign/balance/navigation/ability/performance certificate |

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
npm run evidence:check
npm run native:setup
npm run native:verify
```

`evidence:check` checks the published record against its source fingerprints; it
does not launch an Editor or turn recorded checks into a new native run.
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

[Native lifecycle/details](NATIVE_EDITOR.md) · [Project status](PROJECT_STATUS.md) ·
[Authoring rules](AUTHORING_PROTOCOL.md) · [Historical snapshot](CAPABILITIES_REPORT.md)
