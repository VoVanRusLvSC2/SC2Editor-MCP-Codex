# Перенос A.I. Module — SC2Editor MCP 1.1.0-alpha.7

13 сентября 2026. Перенос выполнен; полнота SC2Editor/runtime не объявляется.

## Источник и архитектура

Активный проект: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex`.

Найдена реальная прежняя реализация в `/workspace/scratch/0f9999397929/sc2editor-mcp-ai-work/project/sc2-ui-mcp-starter`, также есть `SC2Editor-MCP-v1.1.0-alpha.5-ai-source.zip`. Перенесены 7 AI source files, schemas/evidence, scripts, 12 прежних тестов, docs/examples. Текущие улучшенные Data/Text/UI/Cutscene/Browse/Placement сохранены.

SHA-256 core/workspace.ts в обеих ветках совпадает: `03265336883f7dd8dcabe5f26ca2ef687aedb3d0780b4bcecb8794451bef3582`. Core Workspace не менялся; capabilities дополнены AI. Версия повышена alpha.6 → alpha.7 по прежней последовательности development releases, не по уровню совместимости.

AiDocument использует существующий scanner и минимальные span patches. AiWorkspace использует общий Workspace.applyRawTransaction для CustomAI + sibling ComponentList. AiSchemaRegistry сохраняет разные evidence/coverage. Data даёт inherited Unit metrics; Browse проверяет Unit existence и объявленную dependency availability. Reference snapshot обновляется по существующим file fingerprints и draft hashes; unchanged snapshot не перечитывает XML.

AI context добавлен последним optional аргументом createUiServer, старые параметры не сдвинуты. GUI создаёт AI/Data/Browse/Placement на одном Workspace; A.I. Module добавлен к существующим UI и Browse/Placement. Launcher прежний, не новый EXE.

## MCP tools

| Tool | Реализация | Проверки / ограничения |
| --- | --- | --- |
| ai.context | Selective definitions/waves, graph, optional native/raw metadata, read-only bindings | Extracted empty/Definition и synthetic waves; stdio. Native IR строится для документа перед projection; composition semantics inferred |
| ai.query | Definition/wave/reference filters, timing/unit filters, limits | Synthetic populated cases. Legacy reference search присутствия не доказывает объявленную dependency; write validation использует Browse |
| ai.describe_type | 9-node / 27-property registry, EXE evidence | Загруженный registry и tool schema. Runtime functions — evidence, не исполняемые tools; defaults не доказаны |
| ai.apply | 250 operations, aliases, dry-run/stage/disk, diff, backup, two-file atomic apply | Creation/mutations, late-op rollback, safety gates, GUI API, stdio. Populated wave/composition opt-in, нет persistent journal или crash-proof global filesystem transaction |
| ai.validate | Partial L1–L4 XML/schema/reference/semantics | Missing Unit, player/time, duplicate IDs, Trigger links. L5 UNAVAILABLE, L6 UNTESTED |

Operations: definition/wave create/update/rename/clone/delete/reorder; composition.patch; native.add/set/remove. Duplicate definition.create выдаёт ошибку, не upsert. Неоднозначные selectors требуют nativeType/nodeId/occurrence. Recursive native.add не обходит unconfirmed gate. Preview возвращает disk hashes и sourceSha256; expectedSha256 + expectedSourceSha256 защищают диск и drafts при повторном apply.

## Без Trigger / Terrain

Разрешена запись только workspace CustomAI и его sibling ComponentList.SC2Components. Произвольным путём нельзя перенаправить запись в Triggers/Terrain. Старый код Trigger rename patching исключён. aidef/aidefwave читаются для safety; rename/delete связанных объектов блокируется даже с force, native.remove, validate:false, allowInvalid:true. Definition с wave Trigger binding также защищена. Внутренние AI references могут обновляться.

Top-level Trigger/Terrain tools не регистрируются; вкладки поверхности нет. Старые Cutscene Galaxy helpers сохранены, но не выдаются за Trigger Editor MCP.

GUI: metadata/filter, Definition builder, AiOperation[] editor, обязательный reviewed preview перед кнопкой apply, diff/validation, dry-run включён, backup и оба hash guards. Это не визуальная timeline-копия Blizzard AI Editor.

## EXE / evidence

EXE: `/workspace/scratch/0f9999397929/upload/SC2Editor_x64(1).exe`.

Build 5.0.16.97563; 76,470,480 bytes; SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`. Повторный read-only scan: 38/38 tokens, missing: []. Ранее status говорил 39, но script содержит 38 — исправлено. EXE не выполнялся/не изменялся. Декомпиляция: NOT_AVAILABLE_LOCALLY; повторной полной декомпиляции не было.

| Вывод | Evidence | Фактическая проверка |
| --- | --- | --- |
| AIData/Definition/Wave/scalar names существуют | PROVEN_BY_EXE | NUL-terminated offsets в generated/ai-editor-evidence.json; nesting не следует из names |
| AIData + direct Definition Id наблюдались в map extracts | PROVEN_BY_REAL_MAP, inherited extraction provenance | UA3.CustomAI; byte-exact regression; SHA-256 a65627504be38b2f2db8585212356d386d223c688acc2891ec4411cf20ed1ece |
| Empty AIData наблюдался | PROVEN_BY_REAL_MAP, inherited extraction provenance | SC2BW.CustomAI; byte-exact regression; SHA-256 871b36549f0b3430cb22dca60c2da0b4796b56ec5c3b8305d3ad7e0c95e11541 |
| ComponentList aiai → CustomAI | Inherited original-audit evidence | Исходный ComponentList extract отдельно не найден; current synthetic integration, не новый Editor round-trip |
| Wave under Definition, CreateUnits/Unit Type/Count | INFERRED / UNKNOWN_NEEDS_RESEARCH | Synthetic tests, explicit opt-in, не PROVEN_BY_ROUNDTRIP |
| Boolean/time/player/ranges | INFERRED constraints + EXE-exact names | Typed regression; defaults/enums/engine parity unknown |
| Unknown preservation / write safety | Implementation regression proof | Hashes/spans, dry-run/drafts, late failure, backups |
| Editor open/save и игровое поведение | UNKNOWN | NOT_EXECUTED |

Исходные samples находятся в соседнем research/customai-samples; exact base64 bytes и hashes включены в src/tests/fixtures/ai-observed-documents.json. Они не содержат заполненных волн и не закрывают этот пробел.

## Результаты

157 tests / 157 pass / 0 fail / 0 skipped = 135 baseline + 12 прежних AI + 10 migration regressions. Прежний Trigger-write test заменён read-only test, а не объявлен сохранённой Trigger capability.

TypeScript build, ESLint, GUI JS syntax, AI JSON schemas, UI schema audit, Windows portable cross-build: PASS. Native x64 launcher структурно проверен, на Windows не исполнялся. AI + старые tools реально перечислены/вызваны через stdio child process; GUI dispatcher проверен автоматизированно, browser visual QA не выполнена. Дополнительно compiled portable app проверен под Linux Node: stdio ai.query + все 7 namespace и GUI HTTP ai.context/static AI tab — PASS; это не Windows launcher test или browser visual QA.

[Полный лог](../generated/ai-migration-test-report.json). Старый Browse/Placement demo остаётся synthetic, не новый real-map PASS. Повторная XML parse/byte regression выполнена; populated Editor wave round-trip, Editor open/save, visual, runtime, Windows launcher execution и GUI browser visual: NOT_EXECUTED по отдельности.

Build: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex/release/SC2-UI-Workbench-Windows/SC2-UI-Workbench.exe`. Требуется весь portable ZIP и Node.js 20+; Windows runtime не bundled в Linux cross-build.

Packages: SC2Editor-MCP-v1.1.0-alpha.7-source.zip; SC2Editor-MCP-v1.1.0-alpha.7-Windows-portable-node-required.zip.

## Выполненная демонстрация

`npm run ai:demo` восстановил exact UA3.CustomAI bytes на рабочую копию component-directory, выполнил ai.context → definition.create dry-run → diff → backup apply с двумя hash guards → reopen/validate. Исходный Definition raw slice остался byte-identical, backup SHA-256 совпал с исходным extract. XML parse и доступные L1–L4: PASS; редактор/game: NOT_EXECUTED. Это extracted native CustomAI внутри synthetic component directory, не полный real SC2Map scenario и не populated wave proof.

Копия: `/workspace/scratch/8e4176c7d7c1/SC2Editor_MCP_Codex/examples/ai/runs/demo-BeR4R9`. [Реальные запрос/preview/apply/ответы](../examples/ai/runs/demo-BeR4R9/DEMONSTRATION.json).

## Изменённые / добавленные файлы

- src/modules/ai/{types,document,references,schemaRegistry,validator,workspace,tools}.ts.
- src/index.ts, src/mcp/uiServer.ts, src/core/capabilities.ts.
- src/gui/{api,server}.ts и public/{index.html,app.js}.
- src/tests/aiModule.test.ts, src/tests/browsePlacementTransport.test.ts, src/tests/fixtures/ai-observed-documents.json.
- scripts/{discover-ai-module,benchmark-ai-efficiency,generate-ai-schemas,verify-ai-migration,demo-ai-migration}.ts; scripts/build-windows-portable.mjs; windows/README-WINDOWS.md.
- generated/{ai-editor-evidence,ai-module-schema,ai-tools,ai-migration-test-report}.json.
- examples/ai/{CustomAI,ZergPersonalityApply.json,README.md} — theoretical writer честно gated.
- README.md, README_RU.md, CHANGELOG.md; docs/{ARCHITECTURE,PROJECT_STATUS,CODEX_GUIDE_RU,AI_MCP,AI_CODEX_GUIDE_RU,AI_MODULE_FORMAT_REPORT,AI_IMPLEMENTATION_STATUS,AI_MIGRATION_REPORT}.md.
- Portable build output обновлён; остальные source/core и оригинальные карты не перезаписаны.

## Готовность

Перенос/transport/GUI API и безопасное CustomAI editing — реально реализованы и regression-tested. Catalog/dependency используют текущие Data/Browse ограничения. Заполненные waves/composition — исследовательский gated writer, production format и script-generator parity не доказаны. Остаются visual timeline, native MPQ/CASC, defaults/enums, persistent journal и L5/L6 проверки. Trigger/Terrain пока намеренно исключены.
