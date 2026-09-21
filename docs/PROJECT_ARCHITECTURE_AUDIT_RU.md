# Архитектурный аудит — alpha.10

Проверены архитектура доступного исходного проекта, восемь модулей, запись, черновики, схемы и тесты. Это не новый полный анализ машинного кода SC2Editor и не запуск редактора.

## Исправлено

- Общая фабрика createProject для MCP/GUI; параллельная загрузка независимых схем.
- Общая очередь текстовых/бинарных операций, UUID temporary files и компенсация ошибок записи.
- Cutscene использует общий Workspace вместо отдельного состояния.
- Черновики pin-ят исходные байты и существование файла; внешний edit блокирует сохранение без ручного SHA.
- Text/Data/AI связанные файлы сохраняются/отбрасываются всей группой; частичные изменения запрещены.
- Прямой commit очищает старый draft; identity-команда сохраняет подготовленный draft.
- Font import использует общий бинарный writer и проверку отсутствия назначения.
- Symlink назначения и не-UTF8 текст блокируются до записи.
- Настройка runtime/archive adapter не выдаётся за выполненную проверку; .SC2Map directory не считается архивом.
- Для удобства: ui.project_status, /api/project/status, кнопка Project coverage, npm run project:audit.

## Покрытие восьми разделов

Числа получены из текущих registries и фактической регистрации. Это не проценты всех возможностей оригинального редактора.

| Раздел | Команд | Покрыто | Пробелы до 100% |
| --- | ---: | --- | --- |
| UI | 40 | 892/892 известных frame types, 1918 declared properties; generic editing и declared scalar validation | 58 observed-only properties без полной типизации; hidden rules и locked-frame поведение |
| Cutscene | 20 | 52 типа: 43 supported, 9 preserve-only; 664 свойства: 531 supported, 118 Editor-only, 15 runtime-only | Preserve-only не означает semantic creation; playback/Editor acceptance не проверены |
| Text | 6 | 21/21 известных Font Style attributes; 2839 styles, 176 constants, 9 font groups; locale keys/rich text | Не все rich-text конструкции имеют semantic operations; glyph coverage, rendering/fallback не проверены |
| Data | 5 | Generic editing всех observed C-types/fields; consistency с историческими 529 типами/10509 field paths | 100% observed corpus не равно всем данным SC2; hidden enums/defaults/combinations и зависимости |
| AI | 5 | 9 nodes/27 properties; root/direct Definition подтверждены; 3 nodes gated, 4 preserve-only | 26 properties gated-unconfirmed; populated waves opt-in; Config/Script/runtime не подтверждены |
| Browse | 11 | Каталоги, loose assets, localization, references, declared/installed layers | Неизвестен полный asset universe; отсутствующие roots, непроверенный MPQ/CASC adapter; нет engine 3D preview |
| Placement | 16 | Unit/Doodad XML, seeded scatter/spacing, ground snap, joint location plans | Другие native object kinds не имеют полных редакторов; footprint/pathing/collision не проверяются |
| Terrain | 25 | Height/noise/smoothing/textures/style/XML recipes/sampling/byte groups; water template rectangle cloning | Нет cliff/ramp/pathing editing; water payload/level opaque; native fixtures только четырёх карт/известных версий |

Cutscene 646 в старых discovery-документах — исторический счётчик. Текущий загрузчик объединяет дополнительные свойства и выдаёт 664. Общий аудит берёт цифры из кода.

Все восемь разделов присутствуют, но **100% полной семантики SC2 не установлено даже до тестирования в редакторе**. Глобальный процент не вычисляется: полный знаменатель неизвестен. Data 100% consistency с сохранённым observed corpus и UI 100% generic coverage известных declarations — узкие проверяемые утверждения, не полная поддержка движка.

## Проверка релиза

Build/ESLint PASS; полный Node suite: 198 PASS, 0 failures, 12 новых тестов. Проверены text/binary concurrency, queue recovery, group save/discard, external edits, discard during async validation, second-rename failure с восстановлением обеих файлов/сохранением drafts, UTF8/symlink safety, binary existence pinning и shared Cutscene state.

Исторические большие corpus sweeps не выполнялись заново. SC2Editor L5, gameplay L6, Windows launcher execution и визуальная браузерная QA — NOT_EXECUTED. Portable HTTP/MCP smoke фиксируется отдельно в generated/project-portable-smoke.json.

## Следующий порядок

1. Полные dependency snapshot read sets и persistent recovery journal.
2. Native populated AI fixtures; дополнительные Terrain versions и water/cliff/ramp/pathing discovery.
3. Позитивные/негативные semantic cases по операциям каждого раздела.
4. L5 save/reopen в SC2Editor 5.0.16.97563 и byte/semantic diffs по каждому case.
5. L6 runtime probes с результатами каждого case, не флагом adapter configured.

Остаются: очередь внутри одного Workspace, без межпроцессной блокировки; не все dependency reads pin-ятся; нет crash-wide atomicity/постоянного undo; symlink checks не защищают от враждебной гонки смены пути. Ограничения явно отражены в ui.project_status.
