# Data Module pre-L5 coverage

This report defines what “100% before Editor testing” can be proved without calling the SC2Editor UI or the game runtime.

| Gate | Current result | Meaning |
| --- | --- | --- |
| Lossless corpus | 100% | 1,732/1,732 Catalogs parsed; 165,161 objects; zero diagnostics, parse failures, or byte-round-trip failures |
| Observed C-type registry | 100% | 529/529 observed C-types bundled |
| Observed field registry | 100% | 10,509/10,509 exact paths and 1,277,381 instances accounted for |
| Unknown preservation | PASS | untouched unknown attributes/elements/comments remain byte-stable; generic edits are minimal patches |
| Static Editor evidence | PASS | supplied 5.0.16.97563 executable, SHA-256 pinned; 1,062 class candidates and 661 qualified field descriptors recovered read-only |
| Atomic workflow | PASS | dry-run, stage, SHA guard, backup, multi-file transaction and failed-operation rollback covered by tests |
| L3 references | EVIDENCE-BOUNDED | native parent/Link plus observed value-reference diagnostics; dependency targets require the real dependency chain |
| L4 semantics | EVIDENCE-BOUNDED | observed booleans/numbers/enums/ranges/default/reference domains; absent hidden rules remain `UNKNOWN_NEEDS_RESEARCH` |
| L5 SC2Editor | UNTESTED | requires opening/saving the generated component in the supplied Windows Editor |
| L6 game runtime | UNTESTED | requires a runtime map test including actual M3/DDS assets |

The first five coverage rows are reproducibly checked by `npm run schema:audit:data`. A “100% Data Editor semantics” claim is intentionally withheld until L5 differential tests prove Editor defaults, hidden constraints, upgrade behavior and asset compatibility.
