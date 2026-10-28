# Refactoring implementation, 2026-10-28

## Delivered

- Added the original project-specific `sc2-mcp-refactoring` skill, referenced from
  AGENTS.md. It adapts incremental refactoring, typed boundaries and concise MCP
  design to existing SC2 authoring, transaction and native-ownership rules.
- Split tool registration/discovery policy, execution, compact command tools,
  result summaries and telemetry. The SDK registration method is no longer
  overwritten. Direct and batch execution share one executor.
- Added parent/child invocation spans. Internal payloads are excluded from
  model-facing token totals. Actual model/billing usage remains unavailable.
- Added typed lazy service composition. Unused providers are not instantiated;
  Data/Browse defer CASC/native-catalog initialization to their refresh hook.
- Added shared idempotent resource disposal in reverse dependency order. One
  close failure does not skip later resources. MCP and GUI share Project.close().
- Extracted Data catalog discovery/cache, inheritance resolution, reference graph,
  recipe dispatch and catalog registration helpers behind the existing facade.
  Recipe candidates still use the original validation and grouped transaction.
- Removed the trigger-authoring and asset-measurement value-import cycles through
  lower-level XML fragments and a pure model transform module.
- Extracted combined terrain/object location planning behind narrow ports. The
  generated candidate retains terrain, Objects and component registration together.
- Consolidated native/Game child-process framing and request correlation. Original
  handshake versions, public errors, queued-job uncertainty and ownership remain
  in their separate clients. No automatic retry of native mutations was added.
- Shared terrain operation names between tool registration and status inventories,
  replacing the obsolete assertion that cliff/ramp generation is unsupported.
- Added scoped Prettier commands, static architecture checks and a Windows offline
  CI workflow. Historical architecture documentation is explicitly labelled;
  current architecture describes the implemented journal/locks and boundaries.

## Validation

| Check | Result |
| --- | --- |
| TypeScript production/test build | Passed |
| Runtime release build | Passed |
| ESLint | Passed; the existing unused-expression test error was corrected |
| Scoped formatting | Passed |
| Static architecture | Passed; no value-import cycles or pure-boundary violations across 403 production TS files |
| Maintained documentation language | Passed; 120 files, no violations |
| First targeted set | 84 passed |
| Data, lifecycle, native transport and landscape targeted set | 123 passed |
| Isolated investigation of full-run failures | Six passed |
| Full bounded suite | 1,770 passed, zero failures/cancellations, one existing Windows shell-fixture skip |

The initial full run used the previous default concurrency. It ended with one
Windows directory-rename refusal and one timed-out/cancelled MCP test. Both cases
passed in isolation. With four test-file workers, the complete suite passed in
about 129 seconds. The first run took about 80 seconds but did not pass. The bounded
runner is a reliability choice, not a claimed throughput improvement; explicit
runner arguments can select another concurrency for a different machine.

Tests cover static/offline behavior and simulated native frontends. No original
Editor/game session was launched for this refactoring. Historical native evidence
was not rewritten or relabelled as a new live check. The new CI configuration was
added locally; a GitHub-hosted run is not claimed.

Local evidence and the pre-change source snapshot are under
`work/refactoring-20261028/`. They are not part of the public runtime package.
The publication inventory includes the new formatter configuration, CI workflow
and project skills. No commit or push was requested for this task.

## Remaining boundaries

The project remains a modular monolith with compatibility facades. The larger GUI
compiler and owned-landscape planner can be split further when those areas change.
Small bundled registries still load eagerly. Some historical capability text
outside terrain remains to migrate. ModKit's production backend remains under
scripts until its packaging boundary is migrated. Operation-specific transport
timeouts require explicit uncertain-outcome/reconciliation design; this extraction
does not silently change that policy. A clone-graph feature is separate work.

See [architecture](ARCHITECTURE.md), [migration plan](ARCHITECTURE_REFACTOR_PLAN.md)
and [refactoring skill](../.agents/skills/sc2-mcp-refactoring/SKILL.md).
