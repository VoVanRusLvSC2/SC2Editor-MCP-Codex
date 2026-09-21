# Исполнение плана, alpha.13

Вода: flat v110 water rectangles и CWater material/state authoring реализованы; Includes и Components сохраняются вместе. MCP и GUI-действия доступны. 228 тестов PASS. Изучены 199 записей на 14 native/GitHub tables; 175 Nova-записей прошли byte-exact no-op update. Сложные body/wave sections и cliffs/ramps/pathing остаются без writers. [Подробная инструкция](TERRAIN_WATER_RU.md).

Ниже исторический отчёт этапа alpha.12; отключённые в нём flat water операции заменены ограниченным writer в alpha.13.

# Исполнение плана, alpha.12

Уточнение пользователя: разработка GUI-триггеров исключена; скрипты остаются после Terrain, редактор/игра — в конце.

Выполнено:

1. Аудит воды: неподтверждённое преобразование 56-байтовых записей в «водоёмы» убрано. Writers отклоняются; raw floats доступны для исследования, coverage неизвестно.
2. Комплектный archive backend: закреплённые исходники StormLib, Linux x64 и Windows x64 helper, build script и portable bundling.
3. Экспорт: независимый committed snapshot, временный пакет, повторное извлечение, сверка полного набора пользовательских записей и SHA-256, исходных файлов и целевого архива до публикации.
4. Четыре оригинала прошли полный entry roundtrip: 85 + 525 + 44 + 285 = 939 записей. Неизвестные пользовательские файлы не потеряны; архив как последовательность сжатых байтов может отличаться.
5. MapInfo v39: bounded core-prefix reader, проверка integrity на всех четырёх картах, writer границ/fog/minimap с сохранением непрозрачного хвоста.
6. Одиннадцать map.* tools в общей composition root. Import/export, native clone, inspect/validate, plan/apply/save/discard. Source paths остаются внутри Workspace.
7. Guard полного manifest для metadata plan сохраняется до byte-group save и наследуется при restage. Внешняя правка или добавленный файл блокируют запись.
8. Persistent prepared/committed journal для Workspace text/byte commits и process lock. Прерванная группа восстанавливается при startup/перед mutation; внешнее неизвестное содержимое вызывает conflict до восстановления. Проверены SIGKILL между rename, SIGKILL после всех rename до commit marker и конкурентный increment из двух процессов.

Не завершено: чистый map.create, полная конструкция DocumentHeader/player/variant/defaults, универсальный directory/dependency pin вне map.*, init/resize/derived Terrain, cliff/ramp/body/pathing writers, vertex colors и script.*. Journal проверен на остановке процесса; power-loss сертификация не выполнена. Drafts/commit undo остаются process-local.

Причина, по которой нельзя пока обещать чистую карту: источники — сценарные карты, а не доказанный clean blueprint. Нативный код сериализации из предоставленной копии EXE не восстановлен. Ненулевого bodyCount воды и образца PaintedPathingLayer нет. Текущий clone не выдаётся за генерацию чистой карты.

Windows helper — x64 PE, cross-compiled; выполнение на Windows NOT_EXECUTED. SC2Editor/game не запускались. JSON отчёты и автоматические тесты подтверждают файловую часть, а не реальную работу всех типов в движке.

Следующий необходимый блок: завершение нативных defaults/документа; далее Terrain init/derived/resize. Скриптовый модуль запланирован отдельно без GUI-триггеров.
