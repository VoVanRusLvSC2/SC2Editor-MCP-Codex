# Authoring performance

Use one retained workflow MCP process for a map, compact `modkit.author` commands,
and one candidate/save per coherent feature. Keep map edits in components; export
a completed checkpoint. Native checks keep their separate acceptance scope.

## Fewer calls and balance edits

Adjacent compatible Data, Text, Settings, Terrain and single-object Placement
commands coalesce after their original schemas/defaults are checked. Reads,
external result references, differing options/files and advanced guards retain
their boundaries. Limits still apply to each resulting candidate. Earlier
distinct groups may remain committed if a later group fails.

```text
data unit.configure id=Hero life=800 speed=3 scale=1.4
data spell.configure id=Pulse damage=50 energy=20 cooldown=8
```

Configure commands change explicit local scalar fields. They preserve omitted
values, unknown/manual XML, ability targeting, command cards and Actor animation
graphs. Unsupported or ambiguous graphs reject; creation recipes remain
creation-only. See [Data MCP](DATA_MCP.md#compact-compound-recipes).

The `compilation` receipt reports original command count, expanded/grouped calls,
avoided calls, declared files/directories and validation tools. Actual changed
files and validation results remain in module receipts. For example, 200 adjacent
compatible text commands in save mode become two underlying calls instead of
400. These are call counts, not measured model-token billing.

For bounded model selection without images:

```text
assets inspect_many files=Assets/Units/Terran/Marine/Marine.m3,Assets/Units/Terran/Marauder/Marauder.m3
```

`assets.inspect_many` accepts up to 24 exact paths, preserves request order and
rejects a changed CASC build. Inspection does not prove animation playback.
For several samples of one cutscene, use one `cutscene show` request with
`times=0,1000,2500` in native ticks. `snapshots=false` skips CPU contact-sheet work.

## Prepared work and freshness

- Dependency preparation is shared within a guarded logical operation. Terrain,
  lighting, document resolution, UI/cutscene previews and AI apply retain that
  scope; compound Browse consumers share a snapshot. Later operations recheck
  inputs rather than trusting a time-to-live or modification timestamp.
- Script plans retain unchanged candidate documents. GUI readers share bounded,
  frozen exact-content XML and prepared reference graphs. Large/raw AI IR views
  are excluded from retention; ordinary IR is source/schema specific.
  Compound GUI plans share guarded dependency-library preparation across their
  virtual candidate steps. Distinct base registries/catalog requirements remain
  separate, and public apply rechecks the plan against the live source.
- Browse exact-ID, declaration and relationship queries use per-snapshot lookup
  tables. Layered duplicates retain their original order and ambiguity. Related
  queries share preparation rather than rebuilding the index at each graph hop.
- Text changes use one indexed table per candidate file and preserve sequential
  bytes, including duplicate keys and whitespace. Player/option changes use one
  span-based candidate, preserving native flags, integrity and opaque tails.
- Terrain height brushes read the affected region plus the smoothing halo.
  Original component bytes, diagnostics and touch order are regression fixtures.
  Ordinary plans reuse the already parsed candidate state. Native geometry and
  final validation remain authoritative within their recorded coverage.
- Cross-file UI indexes cache raw frame/include/handle/style metadata by exact
  source. They do not cache schema-dependent validity verdicts. Returned indexes
  and metadata are isolated from later callers.
- M3 inspection, measurement and previews share bounded geometry, metadata and
  attachment preparation. UI previews reuse decoded textures and XML; lighting
  reuses parsed catalogs and ambient cubes. Current source bytes/build are still
  read and checked. Cache entry, byte and XML structure budgets bound retention.
- Map and asset preview artifacts are reused only after checking their actual
  bytes. Missing/changed files regenerate. Map source revision, camera, mode,
  dimensions and backend identity control reuse; derived-file reuse never skips
  the saved-source snapshot integrity check.
  Restarting the server discards artifact trust; existing files are regenerated
  before reuse. Snapshot identity and verification share computed source hashes,
  while cached snapshot files are still read and checked.

Archive pack receipts separate input/snapshot manifests, private copy, native
adapter work, reopened verification, final source checks, publication callbacks
and publication time. Keep these phases separate from caller preparation and
temporary-directory cleanup. Private copies and final freshness/reopen checks
remain enabled.
Manifest hashing reads at most four small files concurrently. Files larger than
8 MiB stay serial; started reads finish before the first ordered error returns.
No map or private native copy is removed to obtain a faster benchmark.

## Measurement limits

Local preparation benchmarks compare the saved live source baseline with the
changed implementation and check complete serialized results or output bytes.
They do not establish whole-map speed, native visuals, balance or gameplay.
Small maps can gain little or regress by a few milliseconds in an individual
brush benchmark; large-grid savings do not imply every operation is faster.

Regression tests cover call grouping/budgets, rollback, manual edits, equal-size
edits, input additions, cache isolation/eviction, artifact corruption, source
guards and terrain reference bytes. Reuse retained native evidence where its
revision and behavior remain relevant; run a focused native check for changed,
unverified behavior rather than renewing the entire historical matrix.
