# Project status — SC2Editor MCP 1.1.0-alpha.11

Eight modules, 128 MCP tools. Build, lint and 205 automated tests PASS. Alpha.11 adds seven dependency regression tests to the 198 alpha.10 tests; snapshots cover read files, existence and effective drafts through staged save. See [dependency transaction scope](DEPENDENCY_TRANSACTIONS_RU.md).

Alpha.10 unifies composition and component writes without replacing document models or public semantic operations. It adds ui.project_status and GUI Project coverage. Configured adapters no longer count as executed proof; map-suffixed directories are correctly recognized.

Complete engine coverage is not established, even theoretically. Known UI declarations and observed Data fields have generic structural coverage, not proof of hidden semantics. AI/Terrain have unconfirmed or unsupported areas. L5/L6 and Windows execution remain NOT_EXECUTED.

Current detail: [audit](PROJECT_ARCHITECTURE_AUDIT_RU.md), [architecture](ARCHITECTURE.md), generated/project-architecture-coverage.json. Other module reports retain historical evidence and may contain old release/test counts.
