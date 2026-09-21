# Architecture — alpha.11

The project is a modular monolith: one MCP server, one localhost GUI, eight authoring modules. It edits component files rather than reimplementing the SC2 engine.

## Composition

`src/app/project.ts` is the shared composition root for MCP and GUI. Independent registries load concurrently. All modules receive one Workspace. Data feeds Browse and AI; Browse resolves assets for Placement and Terrain; Placement and Terrain cooperate on joint location plans. Their explicit bidirectional association remains a future interface-cleanup candidate.

| Layer | Responsibility |
| --- | --- |
| app | Composition and project-wide coverage |
| core | Source-span XML, Workspace, snapshots, transaction queue and compensated writes |
| schema/modules | Registries, evidence and semantic operations |
| mcp/gui | Transport, input validation, presentation; no separate authoring state |
| runtime/archive | Explicit external adapters; configuration is not verification |

GUI has UI, Browse/Placement, AI and Terrain panels, not separate panels for all eight modules.

## Transactions

All component text writes, Cutscene writes, Terrain bytes and font imports use one queue per Workspace and `core/fileTransactions.ts`. Operations mutate private copies. Snapshots pin exact bytes and existence. Rejected operations do not stage or commit candidates.

Text staging records the complete participating group, including unchanged members. Save/discard of any member affects the whole group; save returns `savedFiles`. Partial group edits fail. External changes to staged bases cannot be silently rebased. Binary groups have equivalent guards; conflicting text/binary drafts must first be saved/discarded.

Commit prepares UUID temporary files, rechecks snapshots, then performs per-file atomic rename. Handled failures compensate already-written files only where bytes still match this transaction's output. Drafts clear only after success.

Alpha.11 automatically tracks Workspace text reads during preflight and validation, including external catalog reads and effective drafts. Read snapshots persist in staged groups until save. Data/AI preflight shares that context; AI/Browse bypass cached indexes during tracked editing. Missing root Triggers is explicitly pinned. See [dependency transactions](DEPENDENCY_TRANSACTIONS_RU.md).

This is not crash-wide multi-file atomicity: no persistent recovery journal or cross-process lock. Directory enumeration and untracked binary/adapter reads are not universally pinned. Ordinary symlink destinations and lexical escapes are rejected, but checks cannot eliminate hostile symlink swaps between check and open.

## Coverage

`ui.project_status`, GUI Project coverage and `npm run project:audit` cover all eight sections. The generated audit captures actual registrations, including dynamic tool names. Historical corpus totals are not a newly executed sweep. Preservation of unknown XML does not prove safe creation of unknown structures.

See [full audit](PROJECT_ARCHITECTURE_AUDIT_RU.md). Editor/runtime gates remain NOT_EXECUTED.
