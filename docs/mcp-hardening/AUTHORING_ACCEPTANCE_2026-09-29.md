# Data + Scripts/Triggers authoring: актуальная приёмка, 2026-09-29

Рабочее дерево: `E:\SK2\SC2Editor_MCP_Codex`. Этот документ — **единственная текущая матрица F01–F22** для задания authoring. Старые файлы `docs/mcp-hardening/CONTINUATION_2026-09-29.md` и другие отчёты относятся к предыдущему этапу. В исходном дереве уже были многочисленные изменения; они не сбрасывались и не коммитились.

Статусы PASS означают только указанную рядом проверку. Статус XML/статического анализа не равен успешной компиляции Editor или поведению игры.

| ID | Статус | Доказательство и граница |
|---|---|---|
| F01 | PASS | `dataAuthoring.test.ts`: три случая исходного `probe.mjs` через настоящий `createProject` отклонены до staging. |
| F02 | PASS | Новое неизвестное поле отклоняется strict, неизменённый неизвестный XML сохраняется; permissive только с явным `authoringPolicy:"compatibility"`. |
| F03 | PARTIAL | XSD inheritance, inline members, enum/facets и typed links проверяются для изменённого XML; полные движковые сочетания/defaults не доказаны. |
| F04 | PASS | Отсутствующая цель и неполный dependency scope дают разные коды; проверено тестом. |
| F05 | PARTIAL | Existing effective model хранит источник/unknown, но runtime layer order, некоторые reset/override формы не доказаны. |
| F06 | PARTIAL | Numeric/enum/unindexed/nested fields и raw declarations сохраняются; полное правило merge каждого массива не доказано. |
| F07 | PARTIAL | `data.batch` атомарно создаёт/редактирует несколько каталогов и проверяет будущую ссылку/alias; dependency-aware clone и multi-file destructive plan ещё отсутствуют. |
| F08 | PARTIAL | Existing scope-aware function rename отличает локальную тень и поле; полная Galaxy symbol table не готова. |
| F09 | PARTIAL | Сценарий C теперь получает VERIFIED_SUBSET для locals, scopes, while, operators, compound assignment и native calls; массивы, структуры, for/do/switch и полный язык не проверены. |
| F10 | NOT_RUN | Blizzard compiler/Editor adapter отсутствует. Установлен `SC2Editor_x64.exe`, но проверенного headless интерфейса нет; CLI-флаги не выдумывались. |
| F11 | PARTIAL | Индексируются 3196 NativeLib FunctionDef и 230 zero-arg native expressions, доступен поиск; root serializer остаётся ограниченным поддержанными формами. |
| F12 | PARTIAL | Nested typed return calls и IfThenElse с NativeLib SubFuncType проверены структурно; loop с переменной, local и custom function не реализованы. |
| F13 | PARTIAL | Existing graft сохраняет часть closure/IDs; полное копирование локальных строк/библиотек и конфликтов не доказано. |
| F14 | PASS | GUI-путь меняет Triggers, Galaxy-путь — исходные .galaxy; необходимость Editor regeneration и compiler NOT_EXECUTED сообщаются явно. |
| F15 | PARTIAL | Existing typed cross-reference rename обновляет GUI/Galaxy consumers и сохраняет unrelated text; единого Data+GUI/Galaxy plan API нет. |
| F16 | PARTIAL | Известные dynamic/unknown consumers блокируют опасные rename/delete; неизвестные внешние carriers остаются пределом анализа. |
| F17 | PARTIAL | `data.plan/apply_plan` pinning исходников, consumers и XSD; общая версия GUI/Galaxy/compiler/config в одном плане не собрана. |
| F18 | PARTIAL | Существующие recovery/fault tests проходят; отказ посередине *общего* Data+GUI+Galaxy плана не проверен, поскольку такого плана нет. |
| F19 | PARTIAL | Подготовлены пять изолированных компонентных копий A–E и `REPORT.json`; полные условия каждого сценария и Editor/game проверка не пройдены. |
| F20 | PASS | Portable stdio initialize/list/call, 187 tools, strict Data rejection/plan/batch проверены. |
| F21 | PASS | Итоговые `npm test`, `npm run lint`, `npm run build:release`, portable build/smoke: см. раздел проверки ниже. |
| F22 | PASS | Editor/game явно NOT_RUN, XML не представлен как игровое доказательство. |

Реально поддержанные новые формы: Data `object.create/clone`, существующие field/array/native operations, будущие связи в одном файле и между catalog-файлами через `data.batch`; typed XSD/facet/enum/reference checks для authored delta. Galaxy: lexical structure, includes/cycles/arity, direct numeric/string/bool argument types, simple local assignments, return/condition checks, guarded rename. GUI: 3196 описаний для поиска, девять исходных root FunctionDef serializers, 230 zero-arg native return expressions, вложенные NativeLib return calls с параметрами, IfThenElse children с проверенными SubFuncType ролями. Это **не** исчерпывающий список языка/движка.

Миграция: `data.apply` теперь strict по умолчанию и отклоняет отсутствующие typed links, новые неизвестные поля и ошибочные XSD значения. Для старого исследовательского редактирования явно задавайте `authoringPolicy:"compatibility"`; ответ всё равно содержит `authoring.accepted/status/completeness/diagnostics`. `allowInvalid:true` и `validate:false` не отключают strict authoring. Поле `validation.valid` сохранено для старой статической области и не означает Editor/game success. MCP-отклонение Data возвращает структурированный `accepted:false`, код и diagnostics. `data.plan` всегда strict, `data.apply_plan` проверяет свежесть, `data.batch` всегда strict и возвращает общий diff.

Пять копий находятся в `generated/authoring-scenarios-20260929-r2/{A,B,C,D,E}/components`, отчёт с SHA-256 — `generated/authoring-scenarios-20260929-r2/REPORT.json`. Пересоздание из исходных native fixtures: `npm run build`, затем `node scripts/prepare-mcp-hardening-editor.mjs generated/mcp-hardening/editor-authoring-20260929` в новом пустом пути, затем `node scripts/prepare-authoring-scenarios.mjs` в новом пустом output. Текущие output-пути уже заняты; скрипты намеренно отказываются их перезаписывать.

- **A:** `data.batch` создаёт отдельные Unit/Weapon/Effect/Behavior/Validator/Actor/Model каталоги и периодический урон. Негатив: отсутствующий Effect отвергнут. BNet-зависимости исходного native fixture и реальный M3 asset не проверены; authoring `INCOMPLETE`, Editor/game `NOT_RUN`.
- **B:** `data.batch` создаёт AbilEffectInstant, два Damage, Set, Validator, cooldown и Unit binding. Негатив: отсутствующий Effect отвергнут. BNet dependency scope `INCOMPLETE`, Editor/game `NOT_RUN`.
- **C:** script.plan/apply/save создаёт Galaxy модуль с параметром, local, while, if/else, return и native call. Bounded typecheck теперь VERIFIED_SUBSET (unknown=0) для этой формы; неверные return/native argument/condition/operator и выход из local scope отклонены регрессиями. InitMap отсутствует в native fixture; compiler/Editor NOT_RUN.
- **D:** `trigger.plan/apply/save` создаёт Event и IfThenElse с typed condition, вложенным return call, then/else. Негативы — отсутствующее условие и неверный тип вложенного аргумента. Loop/local/custom function `NOT_IMPLEMENTED`; Editor `NOT_RUN`.
- **E:** `data.batch` создаёт Unit, `script.plan/apply/save` добавляет известный Galaxy carrier `UnitCreate`, `data.apply` typed rename обновляет строковый аргумент. Это последовательные операции, не один joint plan. У E в изолированной копии убраны BNet зависимости только для статического rename-теста; это не Editor-ready реальный мод.

Проверки после последнего изменения (обновлять по фактическим exit code): `npm test` — 0, `npm run lint` — 0, `npm run build:release` — 0, `node scripts/build-windows-portable.mjs release/SC2-MCP-Authoring-20260929-r3` — 0, `node scripts/smoke-project-portable.mjs release/SC2-MCP-Authoring-20260929-r3/app` — 0. Один тест Windows archive shell fixture пропускается исходным условием. Отчёт smoke: `generated/project-portable-smoke.json`. Verification logs and per-step exit codes: `generated/authoring-acceptance-20260929/verification.json` and adjacent `npm-test.log`, `lint.log`, `release-build.log`, `portable-smoke.log`. The report records 345 tests (344 pass, 0 fail, 1 skip), SHA-256 of key inputs and outputs, and compiler/Editor/runtime NOT_RUN.

Исследованы внешние варианты Galaxy: [galaxy-parser](https://github.com/rameshvarun/galaxy-parser) (MIT, неполная опубликованная грамматика), [sc2-tools](https://github.com/Prometheus3375/sc2-tools) (MIT Python parser/typechecker, документация сама говорит «almost complete» и о потере форматирования), [sc2-galaxy-toolkit](https://github.com/sc2-arcade-watcher/sc2-galaxy-toolkit) (work in progress). Ни один не объявлен Blizzard compiler и не включён без отдельного pinning/licence/compatibility теста.

Следующие точные эксперименты: (1) открыть A–E копии в отдельной сессии установленного Editor, зафиксировать load/save/reopen, regenerated Galaxy и diagnostics, затем игру; (2) получить Editor-saved golden для IfThenElse/loop/local/custom FunctionDef и сравнить SubFuncType/closure с нашим XML; (3) встроить полноценный Galaxy parser/typechecker с pinned источником или расширить свой и закрыть loop/array/struct; (4) реализовать единый Data+GUI/Galaxy prospective plan с rollback test. Пока эти шаги не выполнены, полная цель задания не достигнута.
