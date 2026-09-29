# Продолжение: проверенные сценарии на 29 сентября 2026

Исходное состояние: HEAD df3e0a39454fac7725ff49e306493714a7d0a7a5, ветка codex/mcp-hardening-20260927; dirty tree уже существовал. Node 24.14.1, npm 11.11.0; XSD SHA256 cf5ac8c452a695f9504048481c16422719f8e2a07a898dca0a9802d100390488; NativeLib 97563 SHA256 cbb2302825dce57ff9bb8efd44f9b0ed5cb056eee00265e5b711b0824d872396. Пользовательские источники, Editor и Data Helper не менялись; commit/push не выполнены.

Аудит 29 сентября зафиксировал один нестабильный EPERM при rename manifest.json (314 PASS/1 FAIL/1 SKIP), отдельный повтор файла 3/3. В нашей работе дополнительно наблюдался EPERM при чтении .sc2mcp-lock.json во время теста двух процессов. Для обоих путей добавлен ограниченный повтор только на EPERM/EACCES/EBUSY с проверкой состояния; причина внешнего единичного отказа не установлена. Сохранение не делает delete-before-rename. FileTransactionFailure содержит written/restored/recoveryRequired/stagedState и код первопричины. Recovery повторно сверяет файл прямо перед восстановлением и не перетирает внешнюю правку.

GUI authoring: 9 pinned NativeLib FunctionDef. Добавлены CinematicMode E92E544E, GlobalCinematicSetting 4A703103, отдельный проверенный nativeCall PlayerGroupAll 00000192 для playergroup. Preset On=00000538, Off=00000545. Другие вложенные вызовы и блоки отклоняются до staging. Функции доступны через прежние describe/plan/validate/apply; Triggers — исходное представление, generated Galaxy и компиляция Editor НЕ выполнены.

Визуальные метки: trigger.labels и trigger.label_of читают 67 NativeLib Label (enUS/ruRU, icon/color) и локальные метки с точным ключом Library/Type/Id. Собственная метка отличается от подтверждённо унаследованной FunctionDef; неизвестная зависимость даёт unknown. set/clear/default не реализованы без Editor-saved образца, особенно для None против отсутствия собственной метки. Классификация не ограничена типом действия; это read-only discovery.

## Матрица S01–S17

| ID | Статус | Свидетельство и граница |
|---|---|---|
| S01 | PASS | mcpHardeningTransport.test.ts: настоящий stdio initialize/list/call, stdout JSON |
| S02 | PASS | Полный npm test + stdio legacy profiles; новые инструменты добавлены без смены старых имен |
| S03 | PASS | minimal=3, focused-data=11, focused-script=26, focused-authoring=34; без UI tools |
| S04 | PASS | mcpHardening.test.ts M01/M03: typed value и catalog identity |
| S05 | PASS | M04/M22: неизвестные/dynamic consumers блокируют затронутые destructive операции |
| S06 | PASS (subset) | M23/read-set tests: source/schema/registry/new consumer stale; неизвестный engine input вне охвата |
| S07 | PASS (fault tests) | recoveryTransactions.test.ts: 11 checks, transient/persistent EPERM, target rename, crash/restart, external conflict, corrupt journal; редкий внешний источник EPERM неизвестен |
| S08 | PASS | M25 coupled GUI/Strings drafts и общая транзакция |
| S09 | PASS (static) | cinematicAuthoring.test.ts: NativeLib IDs, preset, playergroup scope, dry-run/save/re-read; Editor compile NOT_RUN |
| S10 | PASS (supported subset) | M14–M16 closure; localized/cross-library unsupported rejected до staging |
| S11 | PARTIAL | CinematicMode E92E544E и GlobalCinematicSetting 4A703103 различны; статическая карта готова, Editor NOT_RUN |
| S12 | PARTIAL | trigger.labels/label_of list/get PASS; set/clear/default UNSUPPORTED без Editor-saved before/after None/default |
| S13 | PASS (conservative) | M06/M08: конфликтующие layers/reset остаются Unknown; полная engine semantics не заявлена |
| S14 | PASS (static) | Round-trip после save, no-op preservation, Native archive export/reopen; Editor round-trip NOT_RUN |
| S15 | PASS | M27 bounds/pagination/error, дополнительно labels pagination |
| S16 | PASS (portable smoke) | Bundled Node, runtime schemas/registry, MCP/HTTP/native archive вне checkout; Windows launcher visual NOT_RUN |
| S17 | NOT_RUN | Editor load/save/reopen/compile/runtime ждут ручной проверки подготовленной копии карты |

## Одна поддержанная MCP-последовательность

С SC2_MCP_PROFILE=focused-authoring и без SC2_MCP_MODULES: initialize → tools/list → trigger.describe_function(CinematicMode) → trigger.labels(query=Debug) → trigger.plan(create={library:A1000001,identifier:CinematicAcceptance}, calls=[MapInit, CinematicMode On(PlayerGroupAll,0), Wait(0.5), CinematicMode Off(PlayerGroupAll,0), GlobalCinematicSetting On, GlobalCinematicSetting Off]) → trigger.apply({planId,dryRun:false}) → trigger.validate → trigger.save → trigger.get. Точные IDs/аргументы и готовая карта: generated/mcp-hardening/editor-cinematic-20260929. Для автоматического теста применяется src/tests/cinematicAuthoring.test.ts; реальный stdio вызов проверен src/tests/mcpHardeningTransport.test.ts.

## Контракт с Data Helper (сопоставление, без общей библиотеки)

Оба проекта отделяют декларацию (catalog, case-sensitive ID, source/layer, position) от осторожного effective value; сохраняют raw token/expression и происхождение; одинаковые ID разных catalog не объединяются. Неиндексированные повторы остаются разными raw declarations. Неизвестный layer order, reset/merge или consumer даёт Unknown и не доказывает unused/Safe. MCP поддерживает конкретные typed mutation paths; Data Helper имеет собственные diagnostics/probe. Равенство названий статуса между проектами не означает одинакового полного движкового охвата. Сопоставление основано на read-only docs/data-core-hardening/THEORETICAL_STATE_RU.md и существующих M03/M06/M07/M08/M20/M22 fixtures; исходники Data Helper не правились.

## Воспроизведение

    npm.cmd test
    npm.cmd run lint
    npm.cmd run build:release
    npm.cmd run project:audit -- generated/mcp-hardening/editor-cinematic-20260929/components
    node scripts/verify-mcp-hardening-generation.mjs <catalogsData.xsd> <NativeLib97563>
    node scripts/benchmark-mcp-hardening.mjs '--baseline=<read-only audit checkout>'
    node scripts/build-windows-portable.mjs release/SC2-MCP-Continuation-20260929
    node scripts/smoke-project-portable.mjs release/SC2-MCP-Continuation-20260929/app

Ручная карта: generated/mcp-hardening/editor-cinematic-20260929/components/.sc2mcp-output/CinematicAcceptance.SC2Map. Archive export/reopen 18 entries PASS. Editor/load/save/reopen/compile/runtime NOT_RUN; см. README_RU.md и RESULTS.json рядом с картой.
