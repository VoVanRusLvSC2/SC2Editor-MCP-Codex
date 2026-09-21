# SC2Editor MCP alpha.17 — исправления и готовность к тестированию

Дата: 2026-09-14. 10 модулей, 159 MCP-команд. GUI-триггеры исключены по принятому scope. Версия source/portable alpha.17.

## Результат

Все шесть воспроизведённых дефектов предыдущего аудита исправлены и проверены. 260 тестов проекта PASS, 0 FAIL, 0 SKIP. TypeScript build/release и ESLint PASS. Portable MCP/HTTP smoke PASS. Nydus Conspiracy проходит доступный офлайн-preflight и допускается к следующим редакторным тестам; предупреждения остаются видимыми.

Готовность к тестированию реализованных операций подтверждена в этом офлайн-scope. Полной поддержки всех стандартных функций разделов пока нет; её подтверждение невозможно без завершения отсутствующих native writers/semantic models и целевых Editor/runtime gates. readyForEditorTest не означает готовую карту, успешную Galaxy compilation или полный функциональный эквивалент редактора.

## Исправлено

| Аудит | Исправление |
|---|---|
| R01/R02 XML | Invalid literal characters, malformed comments, пробел после `<`, пустые tags, `/ >`, CDATA вне root и `]]>` в обычном тексте диагностируются. Spans считаются от точного raw offset. Data mutation запрещена при XML errors; исходный текст остаётся нетронутым |
| R03 Data discovery | Disk + text/binary drafts + overrides учитываются до save. Explicit native Includes индексирует каталоги вне обычных имён GameData. Data/Browse видят staged objects и корректные activation flags |
| R04 Parent resolution | Неактивные catalogs исключены из effective parents; активный объект не наследует неподтверждённого loose parent. Missing/cyclic parents отмечены явно. Native defaults/layer/indexed/removal merge остаётся PARTIAL |
| R06 Galaxy connect | Existing conditional/loop/expression-bound init call вызывает ENTRY_INIT_CONTROL_FLOW_UNVERIFIED до staging. Проверенный обычный zero-argument call остаётся idempotent. Новый init добавляется, если отсутствует |
| R07 Empty scripts | Scoped requireMissing и сохранение create intent в shared drafts учитывают existence change. Empty creation видна в dry-run, stage/save и совместной группе; competing external creation блокирует save |
| R08 Text entities | Inline style refs берутся из parsed rich-text nodes/attrs. Entities и quoted `>` читаются логически; реальная missing-style диагностика сохраняется |

Дополнительно синхронизированы self-description: Points и basic light cycle fields перечислены в coverage, script включён в capabilities, activation warnings доступны в Data context. active schema counters считают verified active objects.

## Новая удобная проверка

`ui.test_readiness` собирает доступные map/terrain/UI/cutscene/text/data/browse/placement/AI/script static checks и pending drafts одной командой. Тот же read-only report доступен через `/api/project/preflight`.

- readyForEditorTest=true: нет FAIL доступных offline checks и нет несохранённых text/binary drafts.
- NOT_APPLICABLE означает отсутствие соответствующих компонентов, а не доказательство полного раздела.
- standardFunctionCoverage=PARTIAL и targetChecks=NOT_EXECUTED остаются явными.
- Warnings/unresolved references требуют рассмотрения; этот флаг не является результатом компиляции/запуска.

Перед редакторным тестом: сохранить/discard drafts → ui.test_readiness → разобрать diagnostics/warnings → map.export выбранной карты → открыть в целевом SC2Editor → save/reopen component diff → Galaxy compile → SC2 runtime probes. Использовать существующую native карту: verified clean foundation пока нет.

## По разделам

| Раздел | Поддерживаемый фундамент | Открыто |
|---|---|---|
| UI | Layout authoring, свойства, anchors/states/animations/templates/hookups; registry 892 types | Restricted/container/version-specific runtime constraints |
| Cutscene | Native XML/GUID/cameras/time operations; registry 52 types/664 properties | Preserve-only/Editor-only semantics, timebase, playback |
| Text | Localization keys, rich text, styles/constants/font groups | Полный locale/glyph/rendering/semantic graph |
| Data | Generic C objects/fields/attrs, native refs, recipes, staged activation | Native layers/defaults/indexed/removal merge, typed required refs/graph rename |
| AI | CustomAI definitions, guarded operations/bindings, unknown preservation | Populated waves/composition and Config/Script semantics remain gated |
| Browse | Catalog/loose asset/dependency/name/reference discovery | Полный resolver, CASC и engine previews |
| Placement | Unit/Doodad/Point v27, scatter/create_location, ground snapping | Regions/Cameras, incoming Point refs, footprints/pathing/collisions |
| Terrain | Heights/noise/smooth/textures/recipes, supported flat water, light/basic cycle fields | Cliff/ramp/pathing writers, complex water/surface layers, full ToD/fog/sky/postprocess |
| Map | Native import/export/clone, manifest guards, MapInfo v39 core edits | Clean creation/blueprint, player/team/variants, resize и дополнительные MPQ profiles |
| Script | Token/structural index, bounded context, guarded edits/connect, periodic recipe; 2200 pinned native sigs | Full AST/type/scope binding, libraries/resources, target compiler; Editor regeneration persistence |

## Доказательства и границы

Full test suite: 260 PASS. Девять добавленных regression/preflight checks покрывают шесть исходных дефектов, scoped empty creation safety, readiness gating и nonconventional native Includes. Повтор исходных reproduction cases PASS (R05 остаётся честно заявленной PARTIAL semantic limitation).

Portable smoke: 159 tool registrations, 10 modules, Galaxy recipe/connect/stage/save, readiness scope, light plan/stage/save/inspect, grouped layout+Include save, HTTP health/project status. Это Linux execution of portable JS; Windows launcher/native helper runtime не выполнялись.

Nydus preflight: map/terrain, text, data, browse, script PASS; UI/Cutscene/Placement/AI NOT_APPLICABLE для фактически присутствующих файлов. 4 map/terrain warnings и 2 browse warnings. Editor/compiler/runtime NOT_EXECUTED.

Historical registry/corpus/EXE evidence не считается свежим выполнением всех native rules. EXE strings/RTTI candidates не являются восстановленной бизнес-логикой. Исходные proprietary EXE/maps не входят в release ZIP.

Для подтверждения всех стандартных функций ещё нужны controlled Editor donor pairs, завершение native formats/semantic models и финальный Windows gate. Программа готова начать целевые тесты имеющегося функционала; общий проект ещё не завершён.
