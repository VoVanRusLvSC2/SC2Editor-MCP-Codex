# SC2Editor MCP alpha.15 — выполненные изменения и границы поддержки

Дата: 2026-09-14. Версия: 1.1.0-alpha.15. Это рабочее обновление по аудиту alpha.14; весь список развития ещё не завершён. GUI-триггеры исключены. Galaxy-скрипты остаются в плане.

## Что изменилось

- XML: ошибки повторных/некавыченных атрибутов, сущностей, корней и закрывающих тегов теперь диагностируются. Значения сущностей декодируются для поиска и переименования; исходные span сохраняют точное представление нетронутых фрагментов. Исправлена запись апострофов в single-quoted attributes.
- Rich text: границы тегов учитывают кавычки и символ `>` внутри значения; незакрытый тег сообщает ошибку.
- Cutscene: timecode с минутами/секундами выше 59 отклоняется. Конвертация native ticks остаётся ограничена до подтверждения timebase.
- Terrain: чтение child/attribute полей света, directional lights и binding CTerrain. Поддержаны TimePerDay, TimePerLoop, TimeStart, Dawn/Dusk через lighting.patch. Новые поля пишутся в наблюдаемом native представлении; неизвестные поля сохраняются. Без предположений о единице сырого TimePerLoop="05".
- Изменения только высоты больше не зависят от валидности LightData. Landscape создаёт один план, область optional согласована MCP/HTTP. Локальные свет/вода подключаются через GameData Includes при соответствующих операциях.
- Data/Browse: явные GameData Includes, recursive catalog activation, отказ при циклах/path escapes. Неактивный объект не объявляется готовой зависимостью. Без index состояние UNVERIFIED_LOOSE; это не подтверждение engine activation.
- Data: ограниченный parse cache (128 entries, 32 MiB исходного текста), индекс родителей на context. Native слой/default/removal/index merge ещё не завершён.
- Points: placement.points.inspect/plan/apply для ObjectPoint v27. Общий ID space, позиция/имя/Normal/StartLoc, stage/save Objects вместе с ComponentList. StartLoc не назначает игрока; incoming references и GUI ещё требуют работы.
- Валидаторы Data/Text/AI/Cutscene явно показывают validationScope, semanticCoverage=PARTIAL и unresolvedRules. Text constants/font groups собираются до проверки ссылок.
- Версия MCP/HTTP/capabilities берётся из package.json. Data/Cutscene схемы загружаются относительно приложения, независимо от cwd.
- Сборка: отдельные dev incremental/release configs; runtime без тестов, declaration и source maps; portable использует только необходимые runtime schema files и native exe/dll, без PDB.

## Проверка

243 теста: PASS, 0 FAIL, 0 SKIP. TypeScript build и ESLint: PASS.
9 модулей, 147 MCP-команд (Placement 19, Terrain 30).
Portable MCP и HTTP smoke: PASS, включая запуск MCP из другой текущей папки, lighting plan/stage/save, совместное сохранение layout+Include и HTTP project status.
Windows launcher, визуальный GUI, SC2Editor и игра: NOT_EXECUTED в доступной Linux-среде.
Архитектурный отчёт сохраняет completeEngineCoverage=false; общий процент не вычисляется без полного перечня правил движка.

## Что ещё нужно закончить

1. Data: native effective слои/defaults/indexed arrays/removal, типизированные обязательные ссылки, безопасный graph rename/delete.
2. UI/Text/Cutscene: runtime relationships, localization graph, timebase и asset-aware semantic validation.
3. Placement: incoming point references, Regions/Cameras, footprints/pathing и составные локации.
4. Terrain: полный light ToD/effective inheritance/fog/sky, cliffs/ramps/pathing, неплоская вода и дополнительные surface layers. Для неизвестных binary layouts нужны редакторные donor pairs с контролируемым изменением.
5. Map: полный foundation manifest, verified minimal blueprint, игроки/teams/variants, resize/rebase и дополнительные MPQ profiles.
6. AI: native evidence заполненных waves/composition. Galaxy scripts: отдельный модуль, связь с картой и проверка целевой среды.
7. Финальная проверка открытия, сохранения и запуска карты в Windows SC2Editor/SC2.

Стабильные ID аудита и фактические done/partial/planned сохранены в backlog. Ни один неподтверждённый writer не добавлен путём угадывания формата. Исправлена ошибка O07 исходного аудита: Binary undo уже имел лимит 8; общий byte budget остаётся открытым.
