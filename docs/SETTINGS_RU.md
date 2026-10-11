# SETTINGS: атрибуты, варианты игры и параметры игроков

Отдельный модуль `settings.*` работает с компонентами **Attributes**, **MapInfo v39** и декларацией Attributes в **ComponentList.SC2Components**. Редактор не запускается. Реализация существующих Terrain/Map/Trigger/UI модулей для этого не меняется: Settings подключён только в общем composition root, выборе профилей и регистрации MCP.

## Что доступно

- Просмотр пользовательских атрибутов, значений, defaults, namespace bindings, скрытых полей и locks вариантов игры.
- Создание атрибута `Global`/`Player`, добавление или обновление значений, Name/Availability/Visibility/Access и default по слоту. ID остаются стабильными; смена типа и удаление значений не добавлены, чтобы не оставлять ссылки в триггерах без цели.
- Копирование существующего варианта вместе с неизвестными секциями, правка ModeName/ModeDesc/CategoryId/ModeId/MaxTeamSize. Правка default/Locked и AttributeHidden у **существующей** namespace+ID привязки.
- Игроки MapInfo: None/User/Computer/Neutral/Hostile, AI/race token `aiName`, цвет 0..16, зарегистрированная стартовая точка, decal token.
- 13 известных битов настроек игры: replay, wait-for-key, trigger preload, FOV, errors, observers, stagger events, countdown, base height, view everyone, take command, recover game. Неизвестные биты сохраняются; integrity hash MapInfo пересчитывается.

MapInfo ID игрока и нулевой `Slot` в lobby Attributes — разные идентификаторы. Команды не переводят один в другой автоматически. `aiName` хранит native token (например `Terr`); окончательное разрешение каталогов/расы не заявлено. `team`, resourceFlags, observed player и startLocationIds доступны для чтения. Писатель не меняет число игроков, их ID, team/alliance matrices и таблицу стартовых точек.

## MCP-команды

| Команда | Назначение |
| --- | --- |
| `settings.capabilities` | Поддерживаемый формат и ограничения |
| `settings.inspect` | Число атрибутов/вариантов, игроки, options, ошибки |
| `settings.attributes.list`, `settings.variants.list` | Пагинация компактных записей |
| `settings.attribute.get`, `settings.variant.get` | Подробности конкретного ID |
| `settings.players.list` | Игроки и игровые options MapInfo v39 |
| `settings.plan` | Пакет операций без записи файлов |
| `settings.apply` | Dry-run или staging подготовленного плана |
| `settings.save` | Сохранение целой группы с backup и stale guards |
| `settings.discard` | Отмена целой группы черновиков |

Входные схемы всех 11 команд: [generated/settings-tools.json](../generated/settings-tools.json). Профиль `settings` включает UI, Settings, Map, Text. Профиль **landscape** включает Terrain, CASC, Settings, Map, Data, Browse, Placement, Text и UI. Старые узкие профили сохраняют прежний набор. `all` включает новый модуль.

## Пример

Создать глобальный атрибут с двумя значениями, поменять игрока и скопировать вариант:

```json
{
  "directory": "MyMap.SC2Map",
  "operations": [
    {"op":"attribute.create","id":7,"type":"Global","name":"Attribute007/Name","access":"Host"},
    {"op":"attribute.value.upsert","id":7,"valueId":1,"name":"Attribute007/Value001/Name"},
    {"op":"attribute.value.upsert","id":7,"valueId":2,"name":"Attribute007/Value002/Name"},
    {"op":"attribute.default","id":7,"slot":"Global","valueId":1},
    {"op":"player.set","playerId":1,"patch":{"control":"Computer","aiName":"Terr","color":3}},
    {"op":"variant.clone","sourceId":4,"id":90,"modeName":"Variant090/ModeName"},
    {"op":"variant.set","id":90,"field":"MaxTeamSize","value":8},
    {"op":"options.set","patch":{"showCountdown":true}}
  ]
}
```

Новые атрибуты должны получить хотя бы одно значение **в том же plan**. Исходный вариант `4` выбирается по `settings.variants.list`; IDs в примере не являются универсальными defaults. Существование standard binding выбирается из `settings.variant.get`; raw `valueId` — числовое on-disk значение, не порядковый номер dropdown. Полной проверки standard enums нет.

Затем `settings.apply({"planId":"...","dryRun":false,"stage":true})` → `settings.save({"transactionId":"...","dryRun":false})`. Все изменённые компоненты сохраняются одной byte transaction. Экспорт упакованной карты выполняется существующим `map.export` после сохранения. Name/Description/ModeName/ModeDesc — **ключи GameStrings**; локализованные надписи редактируются существующим Text модулем отдельно.

## Сохранность и подтверждения

Писатель XML заменяет только выбранные значения или вставляет нужный элемент; сохраняет комментарии, неизвестные элементы, порядок остальных полей и байты вне изменения. MapInfo writer заменяет выбранные spans, не сериализует весь бинарный файл. Player/variant suffix и неизвестные core bytes сохраняются. Отсутствующий Attributes создаётся вместе с его декларацией в ComponentList. Custom-name Attributes roots требуют отдельного профиля и не переименовываются.

Plan закрепляет полный manifest карты и SHA исходных файлов. Новая запись, внешняя правка или пересекающийся черновик блокируют apply/save; проверка сохраняется в общей transaction group. Незавершённый Terrain/Map plan сначала сохраняется либо отменяется. Черновики process-local; восстановление прерванной записи выполняется существующим recovery journal.

Разбор v39 сверяется на четырёх native fixtures (Ant, City, Nydus, Warships): 9/14/13/10 player records. Тесты проверяют неизменность suffix, hash, отказ для незарегистрированных startLocation, multi-file staging, stale guards и настоящий SDK stdio workflow. Исходники fixtures уже входят в существующий map regression corpus.

Локальная декомпиляция SC2Editor содержит токены AttributeHidden/MaxTeamSize и UI labels вариантов; это подтверждение названий, **не доказательство всей семантики**. Дисковый player/core layout и option bits дополнительно сверяются с [binary-research MapInfo format](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/master/mapinfo.md). [Локальный отчёт источников](../generated/settings-evidence.json) различает token evidence, structural checks и engine acceptance.

Остаются: новый вариант без native template, новые standard namespace bindings, defaultVariants regeneration, перестройка teams/alliances, другие MapInfo versions, полные catalog/trigger cross-reference semantics. Editor save/reopen и игровой runtime для Settings **не выполнялись** согласно запросу пользователя.
