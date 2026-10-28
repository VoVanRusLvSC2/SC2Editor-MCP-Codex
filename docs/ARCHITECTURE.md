# Architecture

Updated 2026-10-28. This is a modular monolith with MCP and localhost GUI adapters,
shared authoring state and optional retained external Toolkits. Older alpha audits
are historical; current code and scoped verification describe current behavior.

## Composition and lifecycle

[project.ts](../src/app/project.ts) wires typed lazy providers through
[ModuleContainer](../src/app/moduleContainer.ts). MCP and GUI share one Workspace.
Module selection is resolved once; tool visibility remains separate from service
demand. Capability reads can instantiate providers without launching the Editor
or game. Small bundled registries still load at project creation.

Data/Browse defer CASC mounts and native catalog initialization to their dependency
refresh hook, preserving tracked reads and build/dependency invalidation.
[ResourceScope](../src/core/resourceScope.ts) closes initialized resources in reverse
dependency order and collects errors without skipping later cleanup.
Project.close() is idempotent and shared by MCP and GUI. Test workflows drain
before retained bridges close. Native handlers keep graceful EOF and ownership.

## Tool dispatch

| Component | Responsibility |
| --- | --- |
| toolRegistry.ts | Definitions, schemas, discovery, enabled state and SDK binding |
| toolPolicy.ts | Profile visibility; not an authorization boundary |
| toolExecutor.ts | Common invocation and parent/child execution spans |
| commandTools.ts | Compact authoring, discovery, usage and batch tools |
| authoringScript.ts | Compact commands to existing typed tool steps |
| mcpBatch.ts | Schema preflight, ordering, result references and stopping |
| toolResults.ts | Bounded summaries and diagnostic continuations |
| telemetry.ts | Payload metrics and durations, without registration policy |

The bound SDK adapter preserves method receivers without replacing the SDK
instance's registration method. Direct calls and internal steps share an executor.
Existing text envelopes, schemas and defaults remain compatible. Batches also
accept structured result bodies.

Internal metrics are excluded from model-facing payload totals to avoid counting
nested results twice. Payload token counts do not represent actual model billing.
Nested durations are inclusive and cannot be summed as end-to-end wall time.

## Domain boundaries

DataWorkspace remains the public facade. DataCatalogRepository owns discovery,
active layers and parse caches. effectiveData.ts resolves inheritance, tokens and
array uncertainty. DataReferenceGraph owns catalog/script/GUI/object consumers.
recipePlanner.ts dispatches recipes against the evolving candidate document;
the workspace retains grouped validation and commit. Catalog registration XML
is an independent helper used by terrain.

Trigger authoring retains its typed graph, type system, native profile, GUI import,
organization and Galaxy emitter. Shared XML/type fragments no longer depend on
declaration orchestration, removing the former value-import cycle. Further compiler
phase extraction remains possible behind the facade. Compilation and semantic
equivalence remain separate.

Terrain and Placement retain native codecs, seeded algorithms and ownership.
locationPlanner.ts coordinates combined terrain/object plans through narrow ports.
Placement receives a delegated terrain context instead of a direct workspace
back-reference. The larger owned-landscape planner remains in TerrainWorkspace.

Asset transforms live in a pure module shared by triangle and attachment
measurement, without the former measurement import cycle.

## External runtimes

integrations/jsonLineProcess.ts shares child-process lifecycle, JSON-line framing,
request correlation and bounded messages. Editor/Game clients retain different
handshakes, error codes, job/session policies and limits. Editor queue uncertainty
does not authorize replay. The transport does not add a cancellation/timeout policy.

ModKit stays optional and retained. Runtime JavaScript still lives under
scripts/modkit; migration of that packaging boundary is deferred. Private Toolkit
sources and instrumented copies stay outside distributed map content.

## Transactions

Text/binary candidates share Workspace coordination. Bytes, existence, dependency
reads and group identity guard plans and staged saves. Partial coupled saves are
refused; unknown XML and unrelated/manual edits are preserved.

fileTransactions.ts, workspaceLock.ts and recoveryJournal.ts provide serialized
writes, process locks, atomic per-file rename, handled-failure compensation and
interrupted-commit recovery. This is not a universal filesystem transaction or
power-loss certification. Untracked adapter reads and hostile concurrent path
changes retain explicit limitations.

A tool batch is a sequence of guarded operations. Earlier committed groups remain
saved if a later command fails; the batch is not one all-or-nothing transaction.

## Capabilities and checks

Terrain's operation manifest is shared by registration and capability summaries.
Implementation inventory, runtime availability and static/compiler/render/gameplay
evidence are distinct. Evidence must match the artifact, dependencies and runtime.
Other historical capability text still needs gradual migration to domain manifests.

Run npm run build, relevant regressions, npm run lint, npm run format:check and
npm run architecture:check for changed scope. Formatting covers the extracted
boundary, excluding vendored codecs and paused renderer research. Architecture
checks inspect static value imports after type erasure, rejecting cycles and
violations of the extracted pure boundaries. Dynamic imports and external runtime
internals are outside that scan.

See [refactoring plan](ARCHITECTURE_REFACTOR_PLAN.md),
[authoring protocol](AUTHORING_PROTOCOL.md) and
[dependency transactions](DEPENDENCY_TRANSACTIONS.md).
