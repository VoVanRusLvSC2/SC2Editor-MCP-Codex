# Terrain: инструкция для Codex

Используй существующий MCP-сервер и распакованную карту с native t3-компонентами. Сначала `terrain.inspect`, `terrain.capabilities`, `terrain.palette.get`; координаты бери из фактических bounds. Модуль не создаёт terrain bundle с нуля и не записывает MPQ.

1. Для точечного изменения вызови `terrain.plan` с operations. Для области со стилем — `terrain.generate`. Для дороги, горы, кратера и других форм — соответствующую `terrain.*` команду.
2. Покажи `terrain.preview`, проверь `terrain.validate`, состав файлов и предупреждения. Preview — диагностический PNG, не игровой рендер.
3. `terrain.apply` по умолчанию dry-run. Для черновика передай `dryRun:false, stage:true`.
4. Сохрани **всю группу** через `terrain.save` с возвращённым `transaction.transactionId` и `dryRun:false`. Либо сразу запиши через apply с `stage:false`.
5. `terrain.rollback` с тем же transactionId и `dryRun:false` отменяет группу или восстанавливает сохранённые байты. Журнал доступен только в текущем процессе и ограничен восемью commit-записями. После перезапуска доступны файловые `.sc2uimcp.bak`, автоматического journal undo нет.

Стили: forest, desert, city, snow, jungle, swamp, volcanic, badlands, coastal, space_platform. Это рецепты базового рельефа и покраски. Указывай `materials.base` из реальной активной палитры; необязательный rock используется на склонах. Автоподбор основан на ID доступных материалов, а не на их визуальной оценке. Если подходящего материала нет, используй `terrain.assets`, разрешение dependencies через Browse и `palette.update`; не придумывай asset IDs.

Поддерживаются rectangle/circle/polygon/corridor, strength, edgeBlend, protectedAreas, seeded noise и gaussian/edge_preserving smoothing. Height brushes сохраняют base/mask, защищают дыры и границы разных уровней, а также консервативную область существующих ramps. Нельзя отключить эту защиту XML-параметром.

XML: передай содержимое [forest-road.xml](../examples/terrain/forest-road.xml) сразу в `terrain.recipe.plan`; либо используй `terrain.recipe.parse`, затем `terrain.plan`. Это наш строгий TerrainRecipe DSL, не native XML карты. Параметр `smoothRadius` задаёт радиус фильтра; radius у Area — радиус области. JSON-пример: [raise-smooth.json](../examples/terrain/raise-smooth.json).

Для объектов `placement.addUnit/addDoodad` поддерживают `snapToTerrain:true`. Для общего результата используй `placement.createLocation` с `terrain:{style, materials, relief, ...}`: новые объекты привязываются к запланированной высоте, а возвращённый `plan.id` сохраняется через **terrain.apply/save/rollback**. Ограничения по расстояниям и slope не заменяют model collision/pathing; задавай exclusions и проверяй результат.

Water create/update/remove заблокированы: 56-байтовая таблица не доказана как водоёмы, raw floats не используются как coverage. sourceIndex/sourceWaterIndex не включают неподтверждённый writer. River/lake вырезают русло/впадину без создания водного полигона. Native cliffs/ramps/pathing и water bodies заблокированы. Stamp заменяет весь совместимый terrain bundle и не переставляет прежние Objects/triggers.

Для GUI: вкладка Terrain → Inspect → область и стиль/кисть → Plan → Preview → Stage → Save. Discard отменяет staged-группу. MCP rollback может восстановить commit в текущей сессии.

Проверки на native компонентах четырёх карт подтверждают размеры, сохранение байтов и поддерживаемые структуры. Использован read-only анализ предоставленного SC2Editor 5.0.16.97563. Это не доказывает открытие/сохранение изменённой карты в Editor или работу в игре; такие проверки пока NOT_EXECUTED. Полные команды, форматы и границы: [TERRAIN_MCP.md](TERRAIN_MCP.md).

Alpha.9: для декораций с фильтрами поверхности используй `placement.scatterDoodads`; для обновления высоты существующих объектов — `placement.snapToTerrain`. [Подробные примеры](TERRAIN_DOODADS.md).
