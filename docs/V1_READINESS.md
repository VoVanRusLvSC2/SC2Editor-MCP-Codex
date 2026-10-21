# v1.0 readiness matrix

Current version: `1.0.0-rc.2`.

The label is deliberately conservative. “Structurally supports all bundled types” is not the same claim as “all types passed inside a real SC2 build.”

| Gate | RC status | Evidence / remaining work |
|---|---|---|
| One-call transaction API | Complete | `ui.apply`, 100 ordered operations, aliases, rollback, validation and diff |
| Codex tool-call efficiency | Complete | reproducible 14 -> 3 benchmark, 78.6% reduction |
| Lossless/minimal editing | Complete | regression suite and 377 Blizzard layout byte-identical round trips |
| Schema/property coverage | Complete structurally | 892 types; 1,918 declared typed properties; observed-only fields preserved |
| Compound/table schema path | Complete | effective complex inheritance, typed attrs, children metadata, GUI editor |
| StateGroup GUI | Functional builder | registry-driven conditions/actions; graph view is later UX work |
| Animation GUI | Functional builder | registry-driven controllers and keys; timeline/curves are later UX work |
| Runtime corpus generation | Complete | 892 isolated layouts and JSON manifest |
| Real SC2 runtime pass | Blocked externally | requires installed Windows SC2/Editor and adapter run |
| Archive safety wrapper | Complete | temp extract/pack, non-empty check, backup, atomic replacement |
| Production MPQ/CASC adapter | Blocked externally | configure/ship tested StormLib/CASC adapter and real fixture round trip |
| Live preview/reload | Protocol-ready | requires runtime adapter support and real editor process |

## Final release decision

Publish `1.0.0` only after preserving these artifacts:

1. runtime adapter version and SC2 build number;
2. `runtime-corpus.json` plus per-type pass/fail/error report;
3. packed `.SC2Map` extract -> semantic edit -> pack -> reopen verification;
4. hash/backup evidence for the archive round trip;
5. any newly discovered runtime restrictions merged into Schema Registry evidence without overwriting community or Core provenance.

Until then, the project is a feature-complete semantic RC with explicit external verification gates—not a falsely advertised full engine bridge.
