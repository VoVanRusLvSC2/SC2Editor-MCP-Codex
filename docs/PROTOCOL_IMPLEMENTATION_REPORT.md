# Authoring protocol implementation — 2026-10-20

## Delivered

- English maintained documentation and agent instructions; language-suffixed
  filenames and first-party references migrated to English canonical paths.
  Original documents are preserved in `work/documentation-english/original`.
  Localized map examples and original reference data are intentionally preserved.
- `docs/AUTHORING_PROTOCOL.md` is the short current entry point. The supplied
  trigger organization convention is retained in full as
  `docs/TRIGGER_ORGANIZATION_PROTOCOL.md`. Historical module/version reports
  retain their original scope and evidence limits.
- `project.organize` defaults to Galaxy systems and a versioned ownership
  manifest. Existing source is preserved. GUI organization is explicit.
- `trigger.organize` creates/reuses nested folders, moves exact element IDs and
  orders folder items. It preserves executable XML, external libraries, IDs and
  unknown properties. New folders have localized TriggerStrings names.
  `trigger.plan.create.folder` keeps new global state and helpers with their
  owning system. `create.genre` selects non-mission templates. Legacy category
  names remain compatible. Duplicate/cyclic/dangling ownership is rejected.
- `terrain.catalog`, `terrain.style`, and `terrain.compose` provide bounded
  reference lookup, target Actor selection and named composition reconciliation.
  Exact Actor keys avoid Actor/Model ID collisions. Forests use seeded clusters,
  irregular polygon areas, terrain constraints and rectangular/circular exclusions.
  Constructed groups use explicit measured anchor-relative members.
- Composition state tracks owned IDs and fingerprints. Repeated runs avoid
  duplicates; manual edits to owned objects block replacement. Objects, component
  registration and state save as one transaction, with terrain/dependency guards.
- Browse uses one scoped index snapshot per composition. Repeated resolution
  within the operation does not rebuild the entire dependency index; source
  changes still invalidate a staged transaction.
- The supplied 6.2 catalog is imported as 1331 reference files, about 11.2 MB
  stored versus 103.2 MB original payloads. Large JSON uses deterministic gzip.
  The runtime loads requested files with a bounded LRU. Reimport and integrity
  verification use `catalog:import` and `catalog:verify`.
- Compact `modkit.author` aliases cover these tools. Compact pagination adjusts
  continuation offsets when trimming results. Windows packaging includes the
  reference resources. Report generators now produce English guidance.

## Verification

- TypeScript development and release builds passed.
- The combined regression run passed 94 tests across GUI authoring, scripts,
  batching, terrain, browsing, composition ownership and real stdio MCP transport.
  A subsequent explicit folder-ordering test also passed, with its relevant
  21-test subset: 95 distinct checked tests in total.
- Focused lint passed for changed runtime modules, tests and documentation/report
  tooling. Global lint remains blocked by 24 pre-existing findings in publication
  scripts and the paused cutscene renderer/tests; those findings were not changed.
- English prose checks passed for 100 maintained documents before this English
  report was added. Localized code examples, archived work evidence and source
  resource annotations are exempt. New prose is checked by
  `npm run docs:check-language`.
- All 1331 imported payload checksums and JSON documents verified. Archive
  SHA-256: `208d69863c6fd04a29506059aa0fa181ef2cb653474e4a51d17dadf2fb8559a8`.
- Real stdio MCP tests verified discovery, dry-run, save, repeated organization
  and compact command dispatch. New guide links and renamed target paths exist.
- On the working `CliffCapRepair.components` Agria map, after mounting dependency
  metadata through MCP, a dry-run `terrain.compose` planned four forest objects
  with XML and height checks passing. No composition state or map edits were
  saved. The cold operation took about 55 seconds on this large dependency set.
  This is not a before/after speed benchmark.

Proof logs are under `.sc2mcp-output/doc-language/`, including
`final-regression.tap` and `map-mcp-final-smoke.jsonl`.

## Explicit limits

The supplied density ranges and location fragments remain reference observations
or authored guidance, not engine-tested prefabs or universal placement quotas.
Native foliage distribution, model dimensions, collision footprints, visual
cliff closure and gameplay pathing are not inferred from successful JSON/XML
operations. Texture painting and native foliage remain separate module operations.
No SC2 Editor or game was launched for this implementation.

A fresh MCP process is required to load the new tools. Changes are local; this
implementation has not been pushed to GitHub.
