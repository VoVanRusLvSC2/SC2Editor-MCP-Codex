# Acceptance matrix

PARTIAL means a clear implementation boundary, not a successful validation of the full SC2 engine.

| ID | Status. | Proof/boundary |
|---|---|---|
| M01 | PASS | Typed value effect rename; exact spans, extraneous text saved |
| M02 | PASS | Delete blocks own/inherited incoming refs including new batch operations |
| M03 | PASS | Identity catalog domain + exact ID; identical IDs separated |
| M04 | PARTIAL | Unknown/dynamic/unreadable media give issues and block destructive rewrite; full set of media not declared |
| M05 | PASS | Scoped inline XSD types, attributes, particles and namespace tests |
| M06 | PARTIAL | Defaults/parents/tokens and declared dependencies; conflicting layers unknown with provenance; engine order not confirmed |
| M07 | PASS | Repeats without index have ordinal [#N], do not collapse |
| M08 | PARTIAL | removed/raw evidence saved; unknown reset/merge returns unknown |
| M09 | PASS | Save PI, comments, CDATA and neighboring XML spans |
| M10 | PASS | Graft without Identifier; existing actions saved |
| M11 | PASS | Single quotes, reordered attributes, self-closing XML |
| M12 | PASS | Graph key Library/Type/Id; remap conflict only |
| M13 | PASS | Implicit and named library; qualified :::Id selector; real corpus leaf |
| M14 | PASS | Dangling local refs reject to staging |
| M15 | PASS | External NativeLib identity retained |
| M16 | PASS | Local variables/presets closure; localized strings and missing cross-library resources specifically unsupported to staging |
| M17 | PASS (static) | XML references after save; Editor round-trip NOT_RUN |
| M18 | PARTIAL | Literal/variable/preset/gamelink IR for 7 verified NativeLib functions; Editor compile NOT_RUN |
| M19 | PASS | Unsupported combinations reject without partial recording |
| M20 | PASS | Galaxy literal/global constant/concatenation carriers |
| M21 | PARTIAL | Lexical local/parameter shadowing guards; not full Galaxy compiler |
| M22 | PARTIAL | Dynamic/custom script saved and coverage unknown; not complete native interpreter |
| M23 | PASS | Stale source, schema shards, registry, dependency and new consumer ban apply/save |
| M24 | PASS | Transaction rollback/compensation and recovery suite |
| M25 | PASS | Shared staged state; coupled GUI/Strings/Data drafts; unrelated drafts retained |
| M26 | PASS | Path traversal, Windows junction/UNC/drive, foreign plan and coordinator checks |
| M27 | PASS | Filters before pagination; totals/truncation and bound raw XML |
| M28 | PASS | Re-generation is identical; content-hash cache invalidation |
| M29 | PASS | Real initialize/tools/list/tools/call; dry-run/apply/save/discard, stdout protocol |
| M30 | PASS | Legacy profiles saved; new minimal/focused; stdio integration |
| M31 | PASS (automated) | Complete suite and 10-module audit; GUI visual/Editor NOT_RUN |
| M32 | PASS (portable smoke) | Bundled Node, schemas, native archive, MCP/HTTP outside checkout; launcher GUI execution NOT_EXECUTED |

The main new checks are: src/tests/mcpHardening.test.ts (29), mcpHardeningSchema.test.ts (4), mcpHardeningTransport.test.ts (1). Independent case fragment and provenance: src/tests/fixtures/mcp-hardening/. Fragment is a static sample, not Editor golden.

## Manual inspection of Editor

Created/mcp-hardening/editor-acceptance-20260927 README_LEGACY.md, RESULTS.json, static-report.json, components and exported map. Open a copy TypedGui.SC2Map, check category/localized names and MapInit → Wait(0.5) → DialogDestroyAll, save and reopen. Check compile and execution through breakpoint/trace: the absence of visible dialogs does not in itself prove the start of actions. RESULTS.jsonNow load/save/compile/runtime NOT_RUN; the original user card is not affected.

## Reproduction (PowerShell at the root of the project)

    npm.cmd run build
    npm.cmd run lint
    npm.cmd test
    npm.cmd run project:audit -- generated/mcp-hardening/editor-acceptance-20260927/components
    npm.cmd run build:release
    node scripts/benchmark-mcp-hardening.mjs '--baseline=<read-only audit checkout>'
    node scripts/verify-mcp-hardening-generation.mjs '<catalogsData.xsd>' '<NativeLib97563>'
    node scripts/build-windows-portable.mjs release/SC2-MCP-Hardening-20260927
    node scripts/smoke-project-portable.mjs release/SC2-MCP-Hardening-20260927/app

Baseline checkout is read-only. Generators accept source paths via CLI; runtime does not require Downloads or corpus directories. prepare-mcp-hardening-editor.mjs creates a new package inside generated/mcp-hardening and does not overwrite an existing one.
