# Development pause and publication preparation, 2026-09-29

Working project: E:\SK2\SC2Editor_MCP_Codex. Active scope of the next stage at the request of the user - Data and Galaxy. previously made GUI/Trigger changes are saved in the publication set, but new GUI-tasks are postponed.

## Stopping point

- Data: strict authoring on XSD and typed links, data.batch, data.plan/apply_plan, protection against stale source/consumer/schema, isolated A/B/E scenarios. Detailed matrix: docs/mcp-hardening/AUTHORING_ACCEPTANCE_2026-09-29.md.
- Galaxy: Check known native calls, return/condition, local areas of visibility, while, arithmetic/logical expressions, and composite assignments for script C. Scenario C status is VERIFIED_SUBSET; full language, compiler, and Editor are not verified.
- The A–E scripts are reassembled into generated/authoring-scenarios-20260929-r2, SHA-256 and statuses in REPORT.json.
- Portable candidate from current source code: release/SC2-MCP-Authoring-20260929-r3; this is a local artifact, release/ ignored by Git.

## Data and Galaxy Completion Plan

1. Data effective model. On Editor-saved/XSD golden files, check defaults, parent, same-ID layers, token scopes and merge indexed/unindexed/nested arrays. For each value, store origin and unknown without passing off unverified merge as engine truth. Regression F03/F05/F06.
2. Data multi-file transaction: Extend batch/plan to clone/dependency-aware rename/delete and a future graph of several files, including typed Actor/Galaxy consumers, collision/stale checks, simulated write failure and restart recovery scripts A/B/E and F07/F15–F18.
3. Galaxy language model. Enter AST and character table for full claimed subset: globals/locals, shadowing, arrays, structs/member access, operators, calls, for/do/while, returns, include activation. Check types and relationships on independent fixtures; unknown syntax leave INCOMPLETE. F08/F09 and scenario C.
4. Connect native API and include to binding, execute scope-aware rename in neighboring areas, create correct initialization/callback of scenario C. Find a confirmed compiler adapter or document an exact external blocker; do not call typechecker Blizzard compiler. F09/F10.
5. Collaborative Data+Galaxy plan: One prospective plan with pinned source/dependencies/schema/config/consumers, single diff and atomic save/rollback. Check rename, unrelated strings, new consumer appearance after plan and fault injection. GUI part of the overall plan will return to work after a separate user command.
6. Repeat unit/regression, lint, release build, portable smoke and isolated A/B/C/E. Check Editor load/save/reopen/compile/runtime in a separate copy if there is a validated launch method and the necessary BNet dependencies.

## Comparison with GitHub before publication

- origin: https://github.com/VoVanRusLvSC2/SC2Editor-MCP-Codex
- At the time of verification, git ls-remote origin refs/heads/main and local HEAD match: df3e0a39454fac7725ff49e306493714a7d0a7a5 (Add GUI trigger inspection and graft tools).
- Up to staging: 3344 modified trackable files; 3314 reassembled generated/data-xsd-index (approximately 8.5 MB) and 30 others. The work tree also features new source codes, tests, documents, scripts, runtime registry, scripts, and temporal results.
- Publish source code/tests/documents/required runtime indices and reproducible evidence. Delete target/, .codebase-memory/, .vscode/, temporary *-temp.ts00, old scenarios without current C and local release/ assemblies. Save the specific staged list in docs/mcp-hardening/PUBLISH_FILES_2026-09-29.txt and check to commit/push.
- The inclusion of A-E and Editor packets does not mean Editor/game PASS. Their RESULTS.json and reports must store NOT_RUN.
- Local release asset: release/SC2-MCP-Authoring-20260929-r3.zip, 45,463,034 bytes, SHA-256 fc4b62ed16b6b74ce7ae594ac4d2a8ce85e9efb5e342544c47bf394db2a9c64f. The archive contains 7886 entries, including app/dist/index.js, XSD manifest, bundled node.exe and BUILD-INFO.json. Portable passed and from Ed3RRR.

Do not run push, GitHub release or merge until a separate "publish" command, before such a command, check remote SHA, staged diff, no secrets, tests, and release asset composition.
