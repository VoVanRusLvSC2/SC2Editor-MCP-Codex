# Continuation: Verified scenarios for September 29, 2026

Initial state: HEAD df3e0a39454fac7725ff49e306493714a7d0a7a5, branch codex/mcp-hardening-20260927; dirty tree already existed. Node 24.14.1, npm 11.11.0; XSD SHA256 cf5ac8c452a695f95048481c16422719f8e2a07a898dca0a9802d100390488; NativeLib 97563 SHA256 c230258bush5; Users Edbush5245bash5,4,0,0,0,0, and the user did not commit me.

The September 29 audit detected one unstable EPERM at the rename manifest.json (314 PASS/1 FAIL/1 SKIP), a separate repeat of the 3/3 file. Our work additionally observed EPERM while reading .sc2mcp-lock.json during the test of the two processes. For both pathways, a limited repeat was added only on EPERM/EACCES/EBUSY with a state check; the cause of the external single failure is not established. Save does not make delete-before-written. FileTransactionFailure contains the external repair code and reclaimed before reclaming/recovering.

GUI authoring: 9 pinned NativeLib FunctionDef. Added CinematicMode E92E544E, GlobalCinematicSetting 4A703103, separate verified nativeCall PlayerGroupAll 00000192 for playergroup. Preset On=00000538, Off=00000545. Other enclosed calls and blocks are deflected to staging. Functions are available through the former describe/plan/validate generated/apply; Triggers - original view, Galaxy and Editor compilation NOT executed.

Visual tags: trigger.labels and trigger.label_of read 67 NativeLib Label (enUS/ruRU, icon/color) and local tags with the exact key Library/Type/Id. Self tag differs from confirmed inherited FunctionDef; unknown dependence gives. set/clear/default are not implemented without an unknown Editor-saved sample, especially for None against the absence of its own label. Classification is not limited to the type of action; this is read-only discovery.

## Matrix S01-S17

| ID | Status. | Certificate and boundary |
|---|---|---|
| S01 | PASS | mcpHardeningTransport.test.ts: real stdio initialize/list/call, stdout JSON |
| S02 | PASS | Full npm test + stdio legacy profiles; new tools added without changing old names |
| S03 | PASS | minimal=3, focused-data=11, focused-script=26, focused-authoring=34; no UI tools |
| S04 | PASS | mcpHardening.test.ts M01/M03: typed value and catalog identity |
| S05 | PASS | M04/M22: Unknown/dynamic consumers block affected disruptive transactions |
| S06 | PASS (subset) | M23/read-set tests: source/schema/registry/new consumer stale; unknown engine input out of scope |
| S07 | PASS (fault tests) | recoveryTransactions.test.ts: 11 checks, transient/persistent EPERM, target rename, crash/restart, external conflict, corrupt journal; rare external source of EPERM unknown |
| S08 | PASS | M25 coupled GUI/Strings drafts and shared transaction |
| S09 | PASS (static) | cinematicAuthoring.test.ts: NativeLib IDs, preset, playergroup scope, dry-run/save/re-read; Editor compile NOT_RUN |
| S10 | PASS (supported subset) | M14–M16 closure; localized/cross-library unsupported rejected to staging |
| S11 | PARTIAL | CinematicMode E92E544E and GlobalCinematicSetting 4A703103 are different; static map ready, Editor NOT_RUN |
| S12 | PARTIAL | trigger.label/label_of list/get PASS; set/clear/default UNSUPPORTED without Editor-saved before/after None/default |
| S13 | PASS (conservative) | M06/M08: conflicting layers/reset remain Unknown; full engine semantics not declared |
| S14 | PASS (static) | Round-trip after save, no-op preservation, Native archive export/reopen; Editor round-trip NOT_RUN |
| S15 | PASS | M27 bounds/pagination/error, additional labels pagination |
| S16 | PASS (portable smoke) | Bundled Node, runtime schemas/registry, MCP/HTTP/native archive outside checkout; Windows launcher visual NOT_RUN |
| S17 | NOT_RUN | Editor load/save/reopen/compile/runtime waiting for a manual check of the prepared copy of the card |

## One supported MCP sequence

With SC2_MCP_PROFILE=focused-authoring and without SC2_MCP_MODULES: initialize → tools/list → trigger.describe_function(CinematicMode) → trigger.labels(query=Debug) → trigger.plan(create={library:A1000001,identifier:CinematicAcceptance}, call=[MapInit, CinematicMode On(PlayerGroupAll,0),(0.5), CineMode Offloader(Playmode), activated by GlobalPlaycmacinemacinemic,29) src/tests/cinematicAuthoring.test.ts; real stdio call verified src/tests/mcpHardeningTransport.test.ts.

## Data Helper contract (comparison, no shared library)

Both projects separate the declaration (catalog, case-sensitive ID, source/layer, position) from the cautious effective value; retain the raw token/expression and origin; the same IDs of different catalogs are not combined. Unindexed repeats remain different raw declarations. Unknown layer order, reset/merge or consumer gives Unknown and does not prove unused/Safe. MCP supports specific typesd mutation paths; Data Helper has its own diagnostics/probe. Equality of status names between projects does not mean the same full engine coverage. Comparison is based on read-only docs/data-core-hardening/THEORETICAL_STATE_RU.md and existing M03/M06/M07/M08/M20/M22 fixtures; the Data Helper source did not correct.

## Reproduction

    npm.cmd test
    npm.cmd run lint
    npm.cmd run build:release
    npm.cmd run project:audit -- generated/mcp-hardening/editor-cinematic-20260929/components
    node scripts/verify-mcp-hardening-generation.mjs <catalogsData.xsd> <NativeLib97563>
    node scripts/benchmark-mcp-hardening.mjs '--baseline=<read-only audit checkout>'
    node scripts/build-windows-portable.mjs release/SC2-MCP-Continuation-20260929
    node scripts/smoke-project-portable.mjs release/SC2-MCP-Continuation-20260929/app

Manual card: generated/mcp-hardening/editor-cinematic-20260929/components/.sc2mcp-output/CinematicAcceptance.SC2Map. Archive export/reopen 18 entries PASS. Editor/load/save/reopen/compile/runtime NOT_RUN; see README_LEGACY.md and RESULTS.json next to the card.
