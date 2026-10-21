# Scenario measurements 2026-09-29

The same isolated fixtures; baseline read-only audit checkout and current dist. Bytes is JSON protocol, not model tokens (NOT_MEASURED). Calls are not cut; for baseline, incorrect results are not equal to speed comparisons. Single measurements, with no promise of overall acceleration.

| Option. | Script | Calls | Request bytes | Response bytes | Elapsed ms | Cold ms | Warm ms | Correct |
|---|---|---:|---:|---:|---:|---:|---:|---|
| baseline | linked-data | 3 | 676 | 8549 | 178.96 | 584.41 | 10.43 | true |
| baseline | rename-external | 3 | 491 | 9102 | 147.36 | 513.15 | 7.02 | false |
| baseline | gui-graft | 4 | 534 | 2870 | 54.85 | 510.63 | 1.54 | false |
| baseline | gui-author | 0 | 0 | 0 | 0.04 | 505.39 | - | unavailable |
| baseline | galaxy-body-connect | 6 | 889 | 4235 | 135.22 | 510.81 | 3.36 | true |
| current | linked-data | 3 | 680 | 9278 | 266.95 | 588.18 | 23.95 | true |
| current | rename-external | 3 | 495 | 11817 | 250.65 | 502.72 | 14.75 | true |
| current | gui-graft | 4 | 534 | 3160 | 73.49 | 507.58 | 1.85 | true |
| current | gui-author | 4 | 549 | 2387 | 59.15 | 546.98 | 2.59 | true |
| current | galaxy-body-connect | 6 | 889 | 4235 | 231.53 | 435.92 | 8.21 | true |

Tools list through the present stdio: all=183 / 356010 bytes; data=63 / 53055 bytes; script=67 / 48245 bytes; minimal=3 / 983 bytes; focused-data=11 / 14296 bytes; focused-script=26 / 14509 bytes; focused-authoring=34 / 27822 bytes. Baseline tools/list 50654 → focused-data 14296 bytes; baseline script 42373 → focused-script 14509 bytes. Now Data operations in this single-script cannot be accelerated as a percentage of JONlist tasks; focused-directed by JONlist paths: focused-focused bytes. generated/mcp-hardening/scenario-measurements.json and stdio-measurements.json.
