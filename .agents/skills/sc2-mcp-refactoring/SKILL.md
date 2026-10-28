---
name: sc2-mcp-refactoring
description: Refactor or review SC2EditorToolkit server architecture, TypeScript module boundaries, MCP dispatch and native integration lifecycle while preserving authoring behavior. Use for server restructuring and maintainability work. Do not activate for ordinary map creation, decoration or ability tuning.
---

# SC2 MCP refactoring

Read `AGENTS.md`, the shared `docs/AUTHORING_PROTOCOL.md`, and only the relevant
section of `docs/ARCHITECTURE_REFACTOR_PLAN.md`. These remain the sources of project
policy. This skill is for server development; map-authoring skills own map design.

## Workflow

1. Inspect the live working tree, affected callers, public schemas and existing
   regressions. Retain unrelated and untracked work. Record a baseline before
   structural changes; a historical commit is not necessarily the live baseline.
2. Identify one responsibility to extract and its compatibility contract. Prefer
   small typed interfaces and pure functions behind existing facades. Keep the
   modular monolith, public tool names/defaults and compact authoring entry points.
3. Separate tool definitions, invocation, transport presentation and telemetry.
   Direct and batch paths use the same executor. Retain errors, continuations,
   truncation, uncertainty and provenance in compact results. Internal execution
   metrics are distinct from model-facing payload totals and actual billing.
4. Keep XML/binary source preservation, grouped commits, stale guards, dependency
   read sets, recovery and manual-edit protection. Extracting classes must not
   split one transaction into independently saved operations. A command batch is
   sequential and does not roll back earlier committed groups.
5. Model external responses as unknown until validated. Preserve retained bridge
   ownership, leases, private copies and uncertainty after transport failures.
   Never blindly replay native mutations or kill an active native handler.
6. For Data/GUI changes preserve inheritance, indexed arrays, actor event phases,
   explicit registration targets/timing, reference/callback semantics, zero bounds
   and localized TriggerStrings. Generated semantics are a compatibility contract.
7. Format only the changed scope using the project formatter. Preserve embedded
   XML/Galaxy/shader text, fixtures and third-party notices. Avoid unrelated global
   formatting, new frameworks and complex types without a demonstrated need.
8. Run the build, scoped formatting/architecture checks and affected regressions.
   Add focused tests for new boundaries and failure handling, not tests that merely
   restate an implementation. Reuse passing native evidence within its scope.
9. Review the complete diff against the recorded baseline. Report changes, actual
   checks, remaining work and measured performance only. Commit/push only when
   requested. Never update historical evidence to make changed source look tested.

## Completion

The changed scope builds, affected regressions pass, public contracts and native
ownership are preserved, and its responsibilities are easier to locate. Report
compiler, static, visual and gameplay evidence separately. Keep incomplete plan
items explicit; one successful extraction does not complete the entire roadmap.

## Design references

This is original project-specific guidance informed by public role descriptions:
[refactoring-specialist](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/06-developer-experience/refactoring-specialist.md),
[typescript-pro](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/02-language-specialists/typescript-pro.md),
[architect-reviewer](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/architect-reviewer.md),
and [mcp-builder](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/SKILL.md).
Their generic framework, coverage, model and orchestration preferences are not
project requirements. Load only this skill for this workflow; no agent delegation
or additional role installation is required.
