# Пауза разработки и подготовка публикации, 2026-09-29

Рабочий проект: E:\SK2\SC2Editor_MCP_Codex. Активный объём следующего этапа по просьбе пользователя — Data и Galaxy. Сделанные ранее GUI/Trigger изменения сохраняются в публикационном наборе, но новые GUI-задачи отложены.

## Точка остановки

- Data: strict authoring по XSD и типизированным ссылкам, data.batch, data.plan/apply_plan, защита от stale source/consumer/schema, изолированные сценарии A/B/E. Подробная матрица: docs/mcp-hardening/AUTHORING_ACCEPTANCE_2026-09-29.md.
- Galaxy: проверка известных native calls, return/condition, локальных областей видимости, while, арифметических/логических выражений и составных присваиваний для сценария C. Статус сценария C — VERIFIED_SUBSET; полный язык, compiler и Editor не проверены.
- Сценарии A–E пересобраны в generated/authoring-scenarios-20260929-r2, SHA-256 и статусы в REPORT.json. Editor и игра — NOT_RUN.
- Portable-кандидат из текущего исходного кода: release/SC2-MCP-Authoring-20260929-r3; это локальный артефакт, release/ игнорируется Git.

## План завершения Data и Galaxy

1. Data effective model. На Editor-saved/XSD golden-файлах проверить defaults, parent, same-ID layers, token scopes и правила merge indexed/unindexed/nested arrays. Для каждого значения хранить происхождение и unknown, не выдавая непроверенный merge за движковую истину. Регрессии F03/F05/F06.
2. Data multi-file transaction. Расширить batch/plan на clone/dependency-aware rename/delete и будущий граф нескольких файлов, включая typed Actor/Galaxy consumers, collision/stale checks, simulated write failure и restart recovery. Сценарии A/B/E и F07/F15–F18.
3. Galaxy language model. Ввести AST и таблицу символов для полного заявленного subset: globals/locals, shadowing, arrays, structs/member access, operators, calls, for/do/while, returns, include activation. Проверять типы и связи на независимых fixtures; неизвестный синтаксис оставлять INCOMPLETE. F08/F09 и сценарий C.
4. Galaxy integration. Подключить native API и includes к binding, выполнить scope-aware rename в соседних областях, создать корректную инициализацию/callback сценария C. Найти подтверждённый compiler adapter или документировать точный внешний blocker; не называть typechecker Blizzard compiler. F09/F10.
5. Совместный Data+Galaxy plan. Один prospective plan с pinned source/dependencies/schema/config/consumers, единым diff и атомарным save/rollback. Проверить rename, unrelated strings, появление нового consumer после plan и fault injection. GUI-часть общего плана вернётся в работу после отдельной команды пользователя.
6. Приёмка. Повторить unit/regression, lint, release build, portable smoke и изолированные A/B/C/E. Проверить Editor load/save/reopen/compile/runtime в отдельной копии при наличии подтверждённого способа запуска и необходимых BNet-зависимостей. До этого runtime остаётся NOT_RUN.

## Сравнение с GitHub перед публикацией

- origin: https://github.com/VoVanRusLvSC2/SC2Editor-MCP-Codex
- На момент проверки git ls-remote origin refs/heads/main и локальный HEAD совпадают: df3e0a39454fac7725ff49e306493714a7d0a7a5 (Add GUI trigger inspection and graft tools). Значит публикационный набор целиком состоит из пока не опубликованных локальных изменений.
- До staging: 3344 изменённых отслеживаемых файла; 3314 — пересобранный generated/data-xsd-index (примерно 8.5 МБ) и 30 прочих. В рабочем дереве есть также новые исходники, тесты, документы, скрипты, runtime registry, сценарии и временные результаты.
- Публиковать нужно исходный код/тесты/документы/необходимые runtime-индексы и воспроизводимые доказательства. Исключить target/, .codebase-memory/, .vscode/, временные *-temp.ts, старые сценарии без актуального C и локальные сборки release/. Конкретный staged перечень сохранить в docs/mcp-hardening/PUBLISH_FILES_2026-09-29.txt и сверить до commit/push.
- Включение артефактов A–E и Editor-пакетов не означает Editor/game PASS. Их RESULTS.json и отчёты должны сохранять NOT_RUN.
- Локальный release asset: release/SC2-MCP-Authoring-20260929-r3.zip, 45 463 034 байта, SHA-256 fc4b62ed16b6b74ce7ae594ac4d2a8ce85e9efb5e342544c47bf394db2a9c64f. Архив содержит 7886 entries, включая app/dist/index.js, XSD manifest, bundled node.exe и BUILD-INFO.json. Portable smoke прошёл и из r3 directory, и из отдельно распакованного ZIP; Editor/runtime остаются NOT_RUN.

Не выполнять push, GitHub release или merge до отдельной команды «опубликовать». Перед такой командой ещё раз проверить remote SHA, staged diff, отсутствие секретов, тесты и состав release asset.
