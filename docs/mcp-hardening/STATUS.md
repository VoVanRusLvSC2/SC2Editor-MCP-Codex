# MCP hardening: итог 2026-09-28

Проект: E:\SK2\SC2Editor_MCP_Codex. Ветка codex/mcp-hardening-20260927; baseline df3e0a39454fac7725ff49e306493714a7d0a7a5, alpha.20. Пользовательские изменения сохранены; commit/push не выполнялись.

Выполнены исправления Data/XSD, общего графа ссылок, структурного GUI graft, ограниченного typed GUI authoring, Galaxy binding/stale guards, общей транзакции и focused profiles. Начальные три audit-регрессии воспроизведены как FAIL и исправлены.

Проверки: 316 tests: 315 PASS, 0 FAIL, 1 прежний Windows shell fixture SKIP. Baseline: 282/281 PASS/1 SKIP. Добавлены 34 теста, включая настоящий stdio. TypeScript build, ESLint, build:release и project:audit PASS. Project audit: 181 tools, 10 modules. Повторная генерация XSD (3314 files) и NativeLib registry детерминирована. Node 24.14.1; минимальное engines >=20 сохранено.

Portable: release/SC2-MCP-Hardening-20260927. Итоговый smoke и ограничения см. generated/project-portable-smoke.json. Изолированная Editor-карта: generated/mcp-hardening/editor-acceptance-20260927/components/.sc2mcp-output/TypedGui.SC2Map. Статические Map/GUI/Data checks и native archive export PASS; Editor load/save/compile/runtime NOT_RUN. Это не доказательство полной семантики движка.

Подробности: [ACCEPTANCE](ACCEPTANCE.md), [COMPATIBILITY](COMPATIBILITY.md), [MEASUREMENTS](MEASUREMENTS.md). Логи и JSON: generated/mcp-hardening/. Исходные карты и настройки Editor не изменены.


Итоговый portable smoke PASS: bundled Node вне checkout, MCP/HTTP, native export/reopen, XSD и NativeLib runtime resources. Launcher visual и Editor runtime остаются NOT_EXECUTED. git diff --check PASS.

## Продолжение 2026-09-29

Актуальные результаты и S01–S17: [CONTINUATION_2026-09-29](CONTINUATION_2026-09-29.md). Предыдущие числа (316/181/7 функций) относятся к checkpoint 28 сентября. Текущее состояние: 326 tests / 325 PASS / 0 FAIL / 1 прежний SKIP, 183 tools в all, 9 verified GUI FunctionDef, 2 read-only label tools; Editor NOT_RUN.
