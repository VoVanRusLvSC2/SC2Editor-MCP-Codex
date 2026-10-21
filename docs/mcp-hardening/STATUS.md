# MCP hardening: Outcome 2026-09-28

Project: E:\SK2\SC2Editor_MCP_Codex. Codex/mcp-hardening-20260927 branch; baseline df3e0a39454fac7725ff49e306493714a7d0a7a5, alpha.20 User changes saved; commit/push not performed.

Corrections have been made to Data/XSD, Common Link Graph, Structural GUI graft, Limited Typed GUI authoring, Galaxy binding/stale guards, General Transaction and Focused Profiles.The initial three audit regressions are reproduced as FAIL and corrected.

Verifications: 316 tests: 315 PASS, 0 FAIL, 1 former Windows shell fixture SKIP. Baseline: 282/281 PASS/1 SKIP. Added 34 tests, including real stdio. TypeScript, ESLint, build:release and project:audit PASS. Project audit: 181 tools, 10 modules. Regeneration of XSD (3314 files) and NativeLib registry determined. Node 24.14.1; minimum engines >=20 retained.

Portable: release/SC2-MCP-Hardening-20260927. For the final smoke and limitations, see generated/project-portable-smoke.json. Isolated Editor card: generated/mcp-hardening/editor-acceptance-20260927/components/.sc2mcp-output/TypedGui.SC2Map. Static Map/GUI/Data checks and native archive export PASS; Editor load/save/compile/runtime NOT_RUN. This is not proof of full engine semantics.

Details: [ACCEPTANCE](ACCEPTANCE.md), [COMPATIBILITY](COMPATIBILITY.md), [MEASUREMENTS](MEASUREMENTS.md). Logs and JSON: generated/mcp-hardening/. Editor's original maps and settings are unchanged.


The final portable smoke PASS: bundled Node outside checkout, MCP/HTTP, native export/reopen, XSD and NativeLib runtime resources. Launcher visual and Editor runtime remain NOT_EXECUTED. git diff --check PASS.

## Continuation 2026-09-29

Current results and S01–S17: [CONTINUATION_2026-09-29](CONTINUATION_2026-09-29.md).Previous numbers (316/181/7 functions) refer to checkpoint on September 28.Previous state: 326 tests / 325 PASS / 0 FAIL / 1 former SKIP, 183 tools in all, 9 verified GUI FunctionDef, 2 read-only label tools; Editor NOT_RUN.
