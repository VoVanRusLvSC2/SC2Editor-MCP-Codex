# Матрица приёмки

PASS относится к указанному автоматическому контракту. PARTIAL означает явную границу реализации, а не успешную проверку полного движка SC2.

| ID | Статус | Доказательство / граница |
|---|---|---|
| M01 | PASS | Typed value Effect rename; точные spans, посторонний текст сохранён |
| M02 | PASS | Delete блокирует own/inherited incoming refs, включая новые операции batch |
| M03 | PASS | Identity catalog domain + exact ID; одинаковые ID разделены |
| M04 | PARTIAL | Неизвестные/dynamic/нечитаемые носители дают issues и блокируют destructive rewrite; полный набор носителей не заявлен |
| M05 | PASS | Scoped inline XSD types, attributes, particles и namespace tests |
| M06 | PARTIAL | Defaults/parents/tokens и declared dependencies; конфликтующие layers unknown с provenance; engine order не подтверждён |
| M07 | PASS | Повторения без index имеют ordinal [#N], не схлопываются |
| M08 | PARTIAL | removed/raw evidence сохранены; неизвестные reset/merge возвращают unknown |
| M09 | PASS | Сохранение PI, comments, CDATA и соседних XML spans |
| M10 | PASS | Graft без Identifier; существующие действия сохранены |
| M11 | PASS | Single quotes, reordered attributes, self-closing XML |
| M12 | PASS | Graph key Library/Type/Id; remap только конфликта |
| M13 | PASS | Implicit и named library; qualified ::Id selector; реальный corpus leaf |
| M14 | PASS | Dangling local refs reject до staging |
| M15 | PASS | External NativeLib identity сохранена |
| M16 | PASS | Local variables/presets closure; localized strings и missing cross-library resources конкретно unsupported до staging |
| M17 | PASS (static) | Порядок XML references после save; Editor round-trip NOT_RUN |
| M18 | PARTIAL | Literal/variable/preset/gamelink IR для 7 проверенных NativeLib functions; Editor compile NOT_RUN |
| M19 | PASS | Unsupported combinations reject без частичной записи |
| M20 | PASS | Galaxy literal/global constant/concatenation carriers |
| M21 | PARTIAL | Lexical local/parameter shadowing guards; не полный Galaxy compiler |
| M22 | PARTIAL | Dynamic/custom script сохранены и coverage unknown; не полный native interpreter |
| M23 | PASS | Stale source, schema shards, registry, dependency и новый consumer запрещают apply/save |
| M24 | PASS | Transaction rollback/compensation и recovery suite |
| M25 | PASS | Shared staged state; coupled GUI/Strings/Data drafts; unrelated drafts сохранены |
| M26 | PASS | Path traversal, Windows junction/UNC/drive, foreign plan и coordinator checks |
| M27 | PASS | Filters до pagination; totals/truncation и bounded raw XML |
| M28 | PASS | Повторная генерация идентична; content-hash cache invalidation |
| M29 | PASS | Реальные initialize/tools/list/tools/call; dry-run/apply/save/discard, stdout protocol |
| M30 | PASS | Legacy profiles сохранены; новые minimal/focused; stdio integration |
| M31 | PASS (automated) | Полная suite и 10-module audit; GUI visual/Editor NOT_RUN |
| M32 | PASS (portable smoke) | Bundled Node, schemas, native archive, MCP/HTTP вне checkout; launcher GUI execution NOT_EXECUTED |

Основные новые проверки: src/tests/mcpHardening.test.ts (29), mcpHardeningSchema.test.ts (4), mcpHardeningTransport.test.ts (1). Независимый корпусный fragment и provenance: src/tests/fixtures/mcp-hardening/. Fragment является статическим образцом, не Editor golden.

## Ручная проверка Editor

Пакет generated/mcp-hardening/editor-acceptance-20260927 содержит README_RU.md, RESULTS.json, static-report.json, components и экспортированную карту. Открыть копию TypedGui.SC2Map, проверить категорию/локализованные имена и MapInit → Wait(0.5) → DialogDestroyAll, сохранить и вновь открыть. Проверить compile и выполнение через breakpoint/trace: отсутствие видимых диалогов само по себе не доказывает запуск действий. Зафиксировать build Editor, сообщения и runtime evidence в RESULTS.json. Сейчас load/save/compile/runtime NOT_RUN; исходная пользовательская карта не затронута.

## Воспроизведение (PowerShell в корне проекта)

    npm.cmd run build
    npm.cmd run lint
    npm.cmd test
    npm.cmd run project:audit -- generated/mcp-hardening/editor-acceptance-20260927/components
    npm.cmd run build:release
    node scripts/benchmark-mcp-hardening.mjs '--baseline=<read-only audit checkout>'
    node scripts/verify-mcp-hardening-generation.mjs '<catalogsData.xsd>' '<NativeLib97563>'
    node scripts/build-windows-portable.mjs release/SC2-MCP-Hardening-20260927
    node scripts/smoke-project-portable.mjs release/SC2-MCP-Hardening-20260927/app

Baseline checkout используется только для чтения. Генераторы принимают source paths через CLI; runtime не требует Downloads или corpus directories. prepare-mcp-hardening-editor.mjs создаёт новый пакет внутри generated/mcp-hardening и не перезаписывает существующий.
