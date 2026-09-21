# Browse / Placement: инструкция для Codex

Продолжай работу в существующем сервере SC2Editor MCP. `browse.*` ищет определения и ассеты; `placement.*` размещает выбранные каталоговые объекты. Обычный файл .m3 не становится Unit/Doodad только потому, что найден на диске.

1. Работай с копией распакованной карты. Укажи SC2_UI_ROOT и распакованные mod roots в SC2_ASSET_ROOTS. Наличие root не означает объявленную dependency: проверь browse.dependencies и DocumentInfo.
2. Вызови browse.search с query и ограничением типа. Для Marine: catalogType=Unit, query=Marine. Для декора: objectKind=Doodad, query=tree/rock/plant/fire. Используй locale для локализованного имени.
3. Проверь availability, evidence и цепочку browse.related. Для подробных полей/наследования используй browse.get. Выбери конкретный key; не угадывай ID и не скрывай неоднозначность слоёв.
4. Создай план placement.addUnit/addDoodad/addBatch. Для группы выбери line/grid/circle/scatter. Для целой локации используй placement.createLocation: лес, пустыня, город, база, руины или custom — один план, а не сотня отдельных вызовов.
5. Покажи placement.preview: операции, diff, validation. Задай проверенные bounds. Z пока вводится вручную. Pathing, коллизии моделей и высота поверхности не подтверждаются этой версией.
6. placement.apply по умолчанию — dry-run. Только после выбора пользователя применяй dryRun=false, stage=false, backup=true. stage=true — это черновик; его сохранение не происходит автоматически.
7. Повторно вызови placement.scan/validate. Для отката сначала placement.rollback dryRun=true, затем при подтверждении dryRun=false. Это один уровень backup, не постоянный undo journal.

GUI: вкладка Browse / Placement в прежнем launcher. Поиск → выбор результата → Plan Unit/Plan Doodad либо Generate location preview → diff → Apply. Dry-run включён; для настоящей записи его нужно снять. Доступен только metadata-preview, не 3D.

Если получен STALE_PLACEMENT_PLAN, не обходи hash guard: прочитай изменённую карту и подготовь новый запрос. Повтор того же запроса в той же сессии не создаёт случайный дубль. После перезапуска такой гарантии пока нет.

Не называй fixture-демонстрацию реальной картой; не считай XML parse доказательством открытия SC2Editor. Open, editor-save, визуальную проверку и runtime отмечай независимо. Примеры JSON и schemas: BROWSE_PLACEMENT_MCP.md и generated/browse-placement-tools.json.
