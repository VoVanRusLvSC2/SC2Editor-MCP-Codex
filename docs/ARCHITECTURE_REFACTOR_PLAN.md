# Architecture review and incremental refactoring plan

Date: 2026-10-28. Status: approved; the foundational refactoring was implemented on this date.
See [current architecture](ARCHITECTURE.md) and [implementation report](REFACTORING_REPORT_2026-10-28.md).

## Scope and evidence

Reviewed the current working tree, not only committed HEAD (`e330320`). Many runtime,
documentation and test files are modified or untracked. Do not reset this tree or
use HEAD as the complete implementation baseline.

The review covers composition, MCP and GUI entry points, authoring, domain modules,
transactions, native adapters, verification, packaging and agent guidance. It uses
structural inventory across `src`, focused reads of implementation boundaries and
representative complex workflows, plus TypeScript and ESLint checks. It is not a
line-by-line correctness audit of every algorithm or an audit of private DLL source.

Local evidence: `work/architecture-review-20261028/metrics.json` records source hashes,
inventory, import-cycle methodology and check results. That local evidence is not
part of the public runtime package.

- 383 production TypeScript files, 44,630 physical lines under `src`, excluding
  `src/tests`. This includes imported surface codecs and embedded source strings.
- 222 `*.test.ts` suites; file count is not coverage or a passing-test claim.
- TypeScript `--noEmit`: passed.
- ESLint scanned 695 files: one error, zero warnings. Existing error:
  `src/tests/uiFrameInheritance.test.ts:15`, `no-unused-expressions`.
- Static import analysis after type erasure found two value-import cycles:
  `assets/measurement <-> assets/attachmentMeasurements`, and
  `trigger/authoring -> trigger/declarations -> trigger/variables -> trigger/authoring`.
  These are coupling findings, not evidence of an observed runtime failure.
- No game launch, Editor session, full test replay, map modification, dependency
  installation, commit or push was performed for this review.

## Decision

Keep the modular monolith and the existing public MCP commands. Improve internal
boundaries incrementally. One local server with retained external runtimes fits
the current workload; a microservice rewrite would add lifecycle and deployment
work without addressing the main sources of complexity.

Preserve these foundations:

- Shared `createProject` composition for MCP and GUI.
- Shared text/binary transaction coordination, snapshots, stale guards, process
  locks, compensated commits and persistent recovery journal.
- Source-preserving XML editing and explicit unknown/unsupported states.
- Domain-specific Data recipes, native presentation checks and typed GUI AST work.
- Retained ModKit, Editor and Game bridges; private test copies and workflow leases.
- Distinct static, compiler, visual and gameplay evidence.
- Compact authoring, bounded discovery and existing revision-aware caches.
- Publication inventory and private-runtime exclusion checks.

The existing `docs/ARCHITECTURE.md` and `PROJECT_ARCHITECTURE_AUDIT.md` describe older
alpha versions. In particular, their missing-journal/missing-lock statements must
not drive duplicate implementations: `core/recoveryJournal.ts` and
`core/workspaceLock.ts` already exist.

## Findings and proposed boundaries

### 1. Separate tool invocation from registration, telemetry and presentation

Evidence: `src/app/telemetry.ts:18` replaces `server.registerTool`, records usage,
owns tool/profile discovery, collects callbacks for batches and registers the
compact authoring language. `mcpBatch.ts` recovers domain results from JSON text
and has domain-specific summaries in one central function.

Batch callbacks are stored as the original `callback`, rather than the instrumented
wrapper. Consequently, outer batch usage and direct per-tool usage do not describe
the same granularity. This is visible in the code, not a measured billing estimate.

Proposed responsibilities:

- `ToolRegistry`: definitions, schemas, visibility and lookup.
- `ToolExecutor`: parse, invoke, classify result, record child span, summarize.
- `McpAdapter`: MCP envelopes and notifications only.
- `BatchRunner`: references, ordered execution and stopping rules.
- `AuthoringCompiler`: compact commands to existing typed tool steps.
- `ToolTelemetry`: payload metrics and durations only.

Keep typed internal values until the transport boundary. Add structured results
compatibly; preserve existing text envelopes, command names and defaults. Give
each domain its own summary function. Errors, incomplete diagnostics, cursors,
truncation and native uncertainty must survive compact responses.

Batch execution remains sequential with earlier commits retained on later failure.
Do not relabel it as an atomic transaction. Record parent/child spans without
double-counting their payloads as actual model usage. Hidden tool discovery is a
presentation policy, not an authorization boundary.

### 2. Make the composition root profile-aware and own disposal

Evidence: `app/project.ts` constructs almost every subsystem; the only explicit
load option is `loadUiSchema`. It restores CASC mounts and may open the ModKit port
for catalog files before focused tool registration occurs. `app/server.ts` filters
exposure later. This is an eager dependency path, not a measured startup regression.

Introduce a small module descriptor table with declared dependencies, factory,
tool registration and disposal. Pass selection/configuration once at startup.
Resolve the dependency closure, share one Workspace, and initialize expensive
providers only when needed. Prefer this explicit table over a DI framework.

Distinguish module availability, initialization and tool visibility. Enabling a
tool later must resolve its dependencies correctly. Keep the current `Project`
facade while consumers migrate; avoid turning every property into an unchecked
optional field.

`src/index.ts:12` and `gui/server.ts:107` duplicate sequential shutdown. An early
rejection can skip later cleanup; initialization has no corresponding central
cleanup scope. Introduce idempotent `Project.close()` with dependency-ordered
cleanup, collected errors and cleanup on failed construction. Drain owned work
before closing its bridge; unrelated disposable resources can still close when
one close operation fails. Do not indiscriminately parallelize all shutdown calls.

### 3. Split the Data workspace by responsibility

Evidence: `modules/data/workspace.ts` is about 99 KB, with 141 lines longer than
200 characters. `applyTracked` spans 283 physical lines and combines catalog
reads, reference analysis, recipes, mutation, preloads and transaction assembly.

Extract incrementally behind the existing public facade:

- `CatalogRepository`: layers, active dependencies, provenance and read snapshots.
- `EffectiveDataResolver`: inheritance, tokens, indexed arrays and uncertainty.
- `ReferenceGraph`: typed domain references, supported rewrites and coverage gaps.
- `DataOperationPlanner`: operation dispatch and ordered candidate changes.
- `RecipeRegistry`: existing pure recipe implementations and their contracts.
- `DataValidationPipeline`: structural, semantic and presentation findings.

Keep one grouped commit and its dependency read set. Do not split a multi-file
recipe into independently saved files just to obtain smaller classes.

A later feature can add a clone-graph plan with explicit old-to-new IDs and shared
dependencies. It must reuse the reference machinery, preserve intentionally shared
IDs, and report dynamic/unknown references. This is a separately tested behavior
addition, not a cosmetic refactor or a global XML string replacement.

### 4. Establish an explicit trigger compiler pipeline

Evidence: `trigger/authoring.ts`, `variables.ts` and `declarations.ts` have a value
import cycle. `trigger/workspace.ts` combines planning, organization, conversion,
native import binding, runtime generation and persistence. There is already an AST,
type system and native-profile review; reuse them.

Proposed flow:

`request/import -> typed graph -> scope/reference/type checks -> native-profile
review -> GUI serialization / Galaxy emission -> guarded apply`

Move shared types, ID/scope helpers and XML fragments into small lower-level modules
with no imports back into orchestration. Separate conversion, organization and
native evidence binding. Use a narrow native-evidence port instead of exposing an
entire Editor bridge to the compiler.

Preserve explicit event-registration targets and timing, callbacks, references,
zero bounds, localized TriggerStrings and manual edits. Native compilation and
semantic equivalence remain separate. No new IR rewrite unless the existing AST
cannot express a demonstrated requirement.

### 5. Separate terrain planning from placement orchestration

Evidence: `terrain/workspace.ts` has 1,149 lines; `placement/workspace.ts` has 1,332.
Composition assigns `placement.terrain = terrain`, while terrain also receives
placement. This is object-level bidirectional coupling; the imports themselves
are type-only and must not be misreported as a runtime module cycle.

Introduce narrow read interfaces for height/slope/water sampling, placeable asset
resolution and reserved-area queries. Move joint location workflows into a
`LandscapePlanner` or equivalent application service. Retain the existing codecs,
native geometry algorithms, recipes and seeded placement.

Keep topology, materials, placement and ownership as distinguishable planning
steps. Assemble their files/read sets into the existing transaction mechanism.
Manual object protection, route reservations, deterministic seeds and resnapping
must survive. Source hashes and dependency revisions remain part of cache keys.

Move `transformPoint` and `Transform` to a pure asset math module to remove the
measurement import cycle. Do not generalize every geometry type into one global
utility package.

### 6. Share transport primitives, preserve Editor/Game differences

Evidence: `integrations/native/transport.ts` and `game/transport.ts` duplicate
process startup, line buffering, request correlation, parsing and pending calls.
Both raw `rpc` implementations can wait without a local response deadline. Editor
already has queued-job and uncertain-job handling; Game has distinct event and
launch semantics. Neither should be flattened into a generic retry loop.

Extract a typed line-RPC/process adapter with explicit connection states, bounded
messages, process identity, response validation and actionable errors. Keep
Editor job policy and Game session policy above it. Return `unknown` at external
boundaries and narrow using schemas instead of spreading `Record<string, any>`.

Transport timeout means an uncertain outcome, not a cancelled native action.
Do not resend mutations automatically. Preserve active native handlers, ownership,
private copies and the ability to reconcile an existing job/session. Avoid
force-killing the user's Editor/game or closing another chat's session.

`modules/testing/gate.ts` currently uses a Proxy and method-name allowlist. Replace
that hidden policy gradually with explicit read/control operations and a lease
context while retaining the single retained bridge workflow.

Move production ModKit adapter code currently under `scripts/modkit/` into a clear
runtime adapter boundary when packaging tests are ready. CLI setup/build scripts
stay under `scripts`. Preserve optional loading and runtime pins.

### 7. Separate capability declarations from verification evidence

Evidence: `app/coverage.ts:29` still says native cliff/ramp generation is unsupported;
registered terrain tools and the current implementation include those operations.
`app/server.ts` also embeds capability counts and historical verification labels.
Documentation, tool discovery and reports therefore have multiple editable sources.

Use per-module capability manifests, plus evidence references with explicit scope:

- implemented operations, supported format/profile and known limits;
- runtime availability, negotiated version and actual loaded identity;
- static/compiler/render/gameplay result independently;
- artifact/dependency hashes, runtime build, check revision and evidence location;
- partial/unavailable diagnostic coverage and unverified cases.

Generate inventories and status sections from those sources. Keep explanatory
architecture decisions handwritten. Retained evidence supports its exact case;
it must not certify a changed artifact or every future map. A configured DLL is
not a successful native test. Do not invent a universal readiness percentage.

### 8. Improve readability with automated, scoped rules

The main readability issue is dense handwritten code, not simply total file size.
For example `cutscenePreview/workspace.ts` has only 67 physical lines but about
47 KB. Conversely, `manualCoverage.ts` is mostly declarative data and is not the
first extraction target merely because it has 1,865 lines.

Add one formatter and a check command; separate formatting changes from semantic
changes. Start with the modules being refactored. Keep embedded XML/Galaxy/GLSL,
generated strings, fixtures and upstream codec provenance intact.

Use descriptive names for nontrivial concepts, explicit return types at module
boundaries and exhaustive operation switches. Introduce stricter lint/type rules
for touched boundaries first. Do not switch on every TypeScript strictness option
across the whole tree in one patch or add complex generics for their own sake.

Extract generic file transactions/read tracking from UI-specific Layout/Style
methods in `core/Workspace` only after callers have narrow interfaces. The present
shared core works; preserve it behind a compatibility facade during this move.

### 9. Keep tests, packaging and instructions aligned with the architecture

Use existing regression suites rather than rebuilding a large acceptance matrix.
Add tests for changed boundaries: registry parity, child telemetry, disposal
failures, profile initialization, import rules and plan equivalence.

Public tool names/defaults, semantic generated content and transaction guarantees
are compatibility contracts. Ignore only documented unstable IDs/timestamps in
comparisons. Never normalize away XML indices, argument order or event timing.

No `.github` workflow directory was present in this working tree. Add a bounded
public CI job for install, typecheck, lint, relevant offline tests, contract checks
and package privacy. Native tests need a separate opt-in machine with installed
SC2 and private Toolkits. A public CI pass cannot imply native visual acceptance.

Retain `publication-policy.json` and `check-distribution-privacy.mjs`. Test the built
package outside the repository so imports of scripts, generated catalogs and
private/local assets cannot accidentally pass only on the development machine.
Private DLL source protection remains a distribution boundary; this audit does
not assert that shipped binaries are impossible to reverse engineer.

## Target dependency direction

```text
MCP adapter / GUI adapter / compact command frontend
                         |
                 typed tool executor
                         |
          application workflows and planners
                         |
            domain operations and contracts
                         |
        workspace transactions / adapter ports
                         |
       XML/binary codecs, CASC, archive, Toolkits
```

Concrete implementations are wired in the composition root. Domain code should
not depend on MCP response envelopes or GUI routes. Small shared contracts are
appropriate; a global `utils` directory or one universal base workspace is not
the goal. Preserve the existing module layout where it already expresses ownership.

## Approved migration sequence

| Batch | Scope | Acceptance before moving on |
| --- | --- | --- |
| 0 | Capture dirty-tree baseline and public contracts; fix the one lint error; add scoped formatting and dependency checks | Existing modifications preserved; typecheck/lint pass; reference metrics retained |
| 1 | Extract registry/executor, batch runner and telemetry; migrate one small tool family, then the remaining registrations | Direct and batch calls have the same schemas/defaults/errors; correct parent/child metrics; compact output retains uncertainty |
| 2 | Central project disposal, typed config, profile dependency closure and lazy providers | Minimal/script profile does not start unrelated native/CASC services; failed creation cleans owned resources; shutdown failure does not skip unrelated cleanup |
| 3 | Extract Data catalog/effective/reference services and operation planner | Existing reference, inheritance, actor/card/animation, stale-guard and grouped-save regressions pass; generated semantics preserved |
| 4 | Untangle trigger compiler and import boundaries | Value-import cycle removed; registration/ref/callback/zero-bound/localization behavior preserved; native check only for changed output semantics |
| 5 | Extract terrain/placement planning interfaces and asset math | Deterministic plans, ownership/manual-edit guards and byte-group boundaries preserved; measured changes justify any native rerun |
| 6 | Consolidate RPC mechanics, capability/evidence manifests, packaging and guidance | Uncertain outcomes are recoverable without replay; status matches implementation; clean-package and privacy gates pass |

Each batch is independently reviewable and must leave a working facade. Reorder
small prerequisite extractions when needed, but do not combine every migration
into one giant patch. Native experiments and new gameplay features are separate
from structural refactoring. Cutscene renderer/converter research remains paused
unless explicitly included by the user.

Measure outcomes with cold/warm startup per selected profile, unnecessary provider
initializations, response bytes/tokens for the same workflow, import cycles,
public-contract parity and time to locate/change a domain operation. The review
does not claim a measured speedup or token-reduction percentage.

## Candidate agents and skills

Searched public primary sources on 2026-10-28. Nothing was installed or delegated.
These are reusable instructions, not new model capabilities or SC2 expertise.

| Candidate | Useful contribution | Adaptation needed |
| --- | --- | --- |
| [VoltAgent refactoring-specialist](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/06-developer-experience/refactoring-specialist.md) | Incremental behavior-preserving extraction, characterization and rollback planning | Remove generic orchestration/commit assumptions; preserve this project's transaction and source-format invariants |
| [VoltAgent typescript-pro](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/02-language-specialists/typescript-pro.md) | External boundary typing, discriminated states and public contracts | Prefer simple types; remove arbitrary coverage targets, framework requirements and model pin |
| [Anthropic mcp-builder](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/SKILL.md) | Discoverability, concise responses, schemas and structured output | Adapt to the installed SDK and local retained sessions; preserve existing tools and compact workflows |
| [VoltAgent architect-reviewer](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/architect-reviewer.md) | Independent review of boundaries and migration tradeoffs | Read-only review by default; no microservice or orchestration machinery by default |
| [VoltAgent mcp-developer](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/06-developer-experience/mcp-developer.md) | Alternative general MCP checklist | Overlaps mcp-builder; select one rather than load both |

Also reviewed [architecture-and-design](https://github.com/danielteles/awesome-agent-skills/blob/main/skills/architecture-and-design/SKILL.md).
It is frontend-oriented and includes broader web architecture concerns, so it is
not the first choice for this native authoring server.

Approved skill arrangement:

- Keep the three existing map-authoring skills and the common authoring protocol.
- Add one focused `sc2-mcp-refactoring` development skill: compatibility baseline,
  boundaries, small migrations, selected checks and measurable completion.
- Add `sc2-native-integration-review` only if the distinct lifecycle/version/
  evidence/privacy workflow warrants a separate reusable skill.
- Keep universal dependency directions and commands in AGENTS.md; detailed
  migration notes in this document, not copied into every skill.
- Use Sol as the next implementation model as requested. Agent profiles may guide
  a single worker sequentially; installing them does not require running multiple
  agents or changing the current one-agent working preference.
- Before copying third-party instruction text, check its current license and
  retain required attribution. No arbitrary global coverage or folder-count
  target becomes a project requirement.

## Stop conditions

A refactoring batch is not complete if it breaks public tools, alters generated
semantics without an explicit behavior change, loses transaction grouping or
recovery, bypasses ownership leases, drops diagnostic uncertainty, or requires
private runtime sources in the public package. If a benchmark regresses, report
the measurement and narrow/revise the extraction. Do not hide it by repeating
unrelated native success cases.

## Implementation status, 2026-10-28

Implemented the project skill, scoped formatter, value-import checks, registry and
shared executor, separate internal metrics, lazy provider composition, shared
ordered disposal, Data catalog/effective/reference/recipe extractions, trigger XML
fragments, combined-location planning ports, shared Toolkit JSON-line process
mechanics, shared terrain capability inventory and an offline CI workflow.

The bounded full suite passed: 1,770 tests, zero failures/cancellations, one existing
Windows shell-fixture skip. The unbounded initial run exposed a timeout and a
Windows rename refusal; both isolated cases passed and the four-worker full run
passed. This is not a native engine test or a new visual certification.

Remaining optional depth: extracting every GUI compiler phase and the larger
owned-landscape planner; migrating the remaining historical capability text;
moving ModKit backend JavaScript out of scripts with its packaging contract;
operation-specific transport deadlines and reconciliation policies. Small bundled
registries still load at project creation. Clone-graph authoring is a behavior
feature and was not added as a refactoring side effect. These are not claimed
complete by this migration.
