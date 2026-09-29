# Измерения сценариев

Одинаковые изолированные fixtures; baseline read-only audit checkout и текущий dist. Байты JSON, реальные tool calls; model tokens NOT_AVAILABLE. Cold startup и отдельный последующий warm read не входят в elapsed сценария. Это одиночные замеры, не стабильный performance benchmark. Baseline correctness failures сохранены. Batch операции одинаковы; сокращение calls не заявляется.

| Вариант | Сценарий | Calls | Request bytes | Response bytes | Elapsed ms | Cold ms | Warm ms | Correct |
|---|---|---:|---:|---:|---:|---:|---:|---|
| baseline | linked-data | 3 | 676 | 8549 | 172.26 | 542.07 | 10.31 | true |
| baseline | rename-external | 3 | 491 | 9102 | 149.92 | 569.8 | 6.51 | false |
| baseline | gui-graft | 4 | 534 | 2870 | 53.19 | 520.62 | 2.21 | false |
| baseline | gui-author | 0 | 0 | 0 | 0.04 | 536.93 | - | unavailable |
| baseline | galaxy-body-connect | 6 | 889 | 4235 | 128.26 | 544.27 | 3.13 | true |
| current | linked-data | 3 | 680 | 9278 | 274.57 | 1126.87 | 24.25 | true |
| current | rename-external | 3 | 495 | 11817 | 286.18 | 476.89 | 14.53 | true |
| current | gui-graft | 4 | 534 | 3160 | 64.28 | 482.3 | 2.05 | true |
| current | gui-author | 4 | 549 | 2387 | 60.61 | 453.39 | 2.53 | true |
| current | galaxy-body-connect | 6 | 889 | 4235 | 204.61 | 430.71 | 7.95 | true |

tools/list bytes: baseline Data 50654 → focused-data 14296 (−71.8%); baseline Script 42373 → focused-script 13317 (−68.6%). Общего ускорения Data не заявляем: безопасный shared reference/read-set анализ увеличивает стоимость и ответы. Отдельные SDK stdio measurements в generated/mcp-hardening/stdio-measurements.json выполнялись во время full suite и могут испытывать нагрузку параллельных тестов.
