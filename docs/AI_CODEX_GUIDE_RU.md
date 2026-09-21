# A.I. Module: инструкция для Codex

Модуль `ai.*` редактирует native `CustomAI`, а не создаёт внешний ML-бот. Он перенесён из прежнего SC2Editor MCP alpha.5 в общий alpha.7; Trigger Editor и поверхность пока исключены.

## Быстрый workflow

Сначала `ai.context`: definitions/waves, диагностические сведения, зависимости, Unit references и read-only Trigger bindings. Не загружай native XML без необходимости. Для неизвестного поля используй `ai.describe_type`; evidence имени поля не доказывает его scalar carrier или defaults.

```json
{"tool":"ai.context","arguments":{"file":"CustomAI","definitions":["Enemy"],"units":["Marine"],"includeNative":false,"limit":30}}
```

Создание подтверждённой минимальной Definition, dry-run:

```json
{"tool":"ai.apply","arguments":{"operations":[{"op":"definition.create","id":"EnemyAI","as":"enemy"}],"dryRun":true}}
```

Ответ содержит `files[].preview`, SHA-256, aliases и validation. Затем повтори тот же запрос с `dryRun:false,stage:false,backup:true`, передав `expectedSha256` из `files[].beforeSha256` и `expectedSourceSha256` из `sourceSha256`. Это защищает диск и текущие drafts. `stage:true` вместо записи оставляет общий черновик; сохранять его можно существующим `ui.save`, проверяя diff и hashes.

Для исследования уже существующих волн:

```json
{"tool":"ai.query","arguments":{"kind":"waves","file":"CustomAI","text":"Wave","limit":20}}
```

## Состав и timing — только явное исследовательское включение

Поищи реальный Unit через `browse.search`; используй возвращённый ID, доступный локально или через объявленную dependency. `wave.create` и `composition.patch` не объявлены доказанным Editor format. Нужен `allowUnconfirmedStructure:true`; это принятие ограничения, а не результат редакторского теста.

```json
{"tool":"ai.apply","arguments":{"operations":[{"op":"definition.create","as":"enemy","id":"EnemyAI"},{"op":"wave.create","definition":"@enemy","id":"Wave01","properties":{"Time":60},"composition":[{"unit":"Marine","quantity":4}],"allowUnconfirmedStructure":true}],"dryRun":true}}
```

Этот пример сработает только при реально доступном Marine. До differential Editor fixtures нельзя использовать его как гарантированно игровую волну.

## Границы записи

- Разрешены только `CustomAI` и соседний `ComponentList.SC2Components` с регистрацией `aiai`.
- `updateReferences:true` меняет внутренние AI references, но не `Triggers`. Переименование/удаление объектов с read-only Trigger bindings блокируется даже при `force`, `validate:false` и `allowInvalid:true`.
- `native.*` не снимает запрет Trigger/Terrain записи. Неподтверждённые новые структуры требуют явного opt-in; неизвестные существующие nodes/attributes сохраняются.
- Повторный `definition.create` с тем же ID не создаёт дубль: ошибка. Persistent request journal не добавлен.
- Graph prices/supply берутся из Data/catalogs; `complete:false` означает неполные данные, нули в сумме не являются доказанной бесплатной стоимостью.
- L5 Editor и L6 runtime не выполнялись; parse/validation PASS их не заменяет.

## GUI

Вкладка **A.I. Module**: поиск Definition/Wave, metadata, schema/evidence, подготовка Definition, полный AiOperation[] editor, обязательный preview перед кнопкой apply, diff/validation. Dry-run включён; disk apply использует backup и проверяет прежние hashes. Это не готовая визуальная timeline-копия Blizzard AI Editor.

См. [реализация и ограничения](AI_IMPLEMENTATION_STATUS.md), [native evidence](AI_MODULE_FORMAT_REPORT.md), [отчёт переноса](AI_MIGRATION_REPORT.md).
