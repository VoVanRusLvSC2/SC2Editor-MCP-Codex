# SC2 UI MCP — полное руководство для Codex

Сервер alpha.7 также содержит Data/Text/Cutscene/Browse/Placement и native A.I. Module. [AI инструкция](AI_CODEX_GUIDE_RU.md): только CustomAI + ComponentList, read-only Trigger bindings; Trigger Editor и поверхность пока не включены. XML editing не заменяет Editor/runtime tests.

В alpha.6 добавлены отдельные `browse.*` и `placement.*`, включая универсальный `placement.createLocation`. Для поиска ассетов, зависимостей и безопасного размещения см. [инструкцию Browse / Placement](BROWSE_PLACEMENT_CODEX_RU.md). Это не заменяет UI APIs и не подтверждает editor/runtime compatibility.

Это руководство описывает рекомендуемый способ работы Codex и GUI-клиента с файлами StarCraft II UI. Главный принцип проекта: модель редактирует не строки XML, а семантические сущности — файлы, фреймы, свойства, anchors, templates, StateGroups, animations и styles. XML остаётся конечным форматом, но его неизвестные элементы, комментарии и форматирование не должны исчезать.

> Начиная с `1.0.0-rc.2`, основной путь изменения — `ui.apply`. Отдельные `ui.create_frame`, `ui.set_property`, `ui.upsert_state_group` и другие mutation tools остаются для единичных действий и совместимости, но сложный пользовательский запрос следует собирать в одну атомарную транзакцию. `ui.apply` уже возвращает validation и minimal diff, поэтому отдельные вызовы после него обычно не нужны.

Короткий эффективный workflow:

```text
ui.query_frames -> ui.describe_type / ui.describe_property -> ui.apply
```

Внутри `ui.apply` используй `as` и `@alias`, чтобы обращаться к созданным в той же транзакции фреймам. Подробная схема, все operation kinds и полный пример находятся в [UI_APPLY_TRANSACTION.md](UI_APPLY_TRANSACTION.md).

## 1. Что MCP даёт Codex

Без MCP модель должна помнить тысячи деталей SC2Layout:

- точное имя frame type;
- доступные свойства и их типы;
- наследование классов;
- enum-значения;
- обязательные hookups;
- синтаксис `$this`, `$parent` и handles;
- формат table/index/layer properties;
- формат StateGroup и Animation;
- порядок Includes и cross-file templates;
- особенности Blizzard-only/locked типов;
- безопасный способ изменить один атрибут, не переписав весь XML.

С MCP Codex сначала запрашивает Registry, потом выполняет generic-операцию, запускает validation, смотрит diff и только затем сохраняет. Это уменьшает галлюцинации имён и исключает destructive XML rewrite.

## 2. Обязательный рабочий цикл

Для любой задачи Codex должен придерживаться следующего порядка:

1. Вызвать `ui.list_files` и определить фактические layout/style файлы.
2. Прочитать нужный файл через `ui.read_layout`.
3. Найти целевые фреймы через `ui.query_frames` или `ui.get_frame`.
4. Перед созданием нового типа вызвать `ui.describe_type`.
5. Перед неизвестным свойством вызвать `ui.get_schema` или проверить его в результате `ui.describe_type`.
6. Все изменения сначала выполнять с `dryRun: true` либо staged-режимом.
7. После группы изменений вызвать `ui.validate`.
8. Вызвать `ui.diff` и проверить только ожидаемые изменения.
9. Сохранять через `ui.save` с backup.
10. При сомнении вызвать `ui.discard`; не пытаться вручную восстановить исходный XML.

Рекомендуемый mutation-режим:

```json
{
  "dryRun": false,
  "stage": true
}
```

Он изменяет только in-memory draft. Диск меняется лишь после `ui.save`.

## 3. Источники истины и уровень доверия

Registry объединяет несколько уровней данных:

1. Community schema — frame classes, inheritance, properties, scalar/complex types, enums и hookups.
2. Blizzard Core corpus — реально встреченные frame types, properties, templates, states, animation controllers и restricted-frame routes.
3. Workspace corpus — неизвестные элементы, встреченные в текущей карте/моде.

Community schema и исторический Core snapshot не считаются вечной истиной движка. Поэтому Registry сообщает provenance и не удаляет неизвестный XML.

Текущее покрытие проверяется не вручную, а через:

```text
ui.audit_schema_coverage
```

или:

```bash
npm run schema:audit
```

В bundled snapshot:

- 892 известных frame types;
- 892/892 имеют semantic description;
- 1 918 schema-declared properties;
- 1 918/1 918 имеют тип и generic edit path;
- 58 дополнительных Core-observed properties поддерживаются структурно;
- неизвестный будущий XML сохраняется losslessly.

## 4. Семантические пути фреймов

Обычный вложенный путь:

```text
Window/Footer/AcceptButton
```

SC2 допускает descriptor names с `/`, например:

```xml
<Frame type="Frame" name="GameUI/UIContainer" file="GameUI">
```

В semantic path символ `/` внутри имени экранируется по JSON Pointer:

```text
GameUI~1UIContainer
```

Правила:

- `~` внутри имени превращается в `~0`;
- `/` внутри имени превращается в `~1`;
- `$this` означает текущий runtime frame;
- `$parent` означает родительский runtime frame;
- `$this/Child` и `$parent/Sibling` используются в SC2 references, а не в MCP framePath;
- handle может использоваться для SC2 binding/reference, но MCP path всегда строится по descriptor names.

### Штатные GameUI container layers

`GameUI/UIContainer` — не единственный допустимый контейнер. В Blizzard Core `GameUI.SC2Layout` также подтверждены:

| Descriptor override | Назначение |
|---|---|
| `GameUI/UIContainer` | общий UI поверх world |
| `GameUI/UIContainer/FullscreenLowerContainer` | fullscreen слой ниже console |
| `GameUI/UIContainer/ConsoleUIContainer` | UI, привязанный к console |
| `GameUI/UIContainer/FullscreenUpperContainer` | fullscreen слой выше console |

Они создаются одинаково: top-level `Frame`, полный descriptor path в `name`, `frameFile:"GameUI"`. Через generic API разрешён любой другой реальный descriptor path; список GUI — presets, а не whitelist.

```json
{"op":"create_frame","as":"upper","type":"Frame","name":"GameUI/UIContainer/FullscreenUpperContainer","frameFile":"GameUI"}
```

## 5. Discovery API

### `ui.list_files`

Возвращает все `.SC2Layout`, `.StormLayout` и `.SC2Style` внутри `SC2_UI_ROOT`, включая staged новые файлы.

### `ui.read_layout`

Вход:

```json
{
  "file": "UI/Layout/GameUI.SC2Layout",
  "includeSource": false
}
```

Возвращает SHA-256, XML diagnostics и список frames. `includeSource: true` следует использовать только когда нужен точный исходный XML.

### `ui.query_frames`

Поддерживаемые фильтры:

- `name`;
- `type`;
- `template`;
- `property`;
- `handle`;
- `under` — ограничение родительским semantic path;
- `limit`.

Сначала лучше использовать query, а не загружать весь XML в контекст модели.

### `ui.get_frame`

Возвращает:

- type/name/path;
- template/file/handle;
- нормализованное представление properties;
- generic element tree;
- anchors;
- direct child paths;
- точный XML fragment.

## 6. Schema Registry

### `ui.describe_type`

Codex обязан вызывать его перед использованием незнакомого frame type.

Ответ содержит:

- underlying `classType`;
- inheritance chain;
- effective inherited properties;
- property value/element types;
- readonly metadata;
- enum/value information через связанные simple types;
- hookups;
- `blizzardOnly`;
- Core observation count;
- restriction plan и runtime notice.

### `ui.get_schema`

Generic search по категориям:

```text
frameType | frameClass | simpleType | complexType | animation | state | style
```

Примеры:

```json
{"kind":"frameType","search":"Button","limit":100}
```

```json
{"kind":"animation"}
```

```json
{"kind":"state"}
```

### `ui.audit_schema_coverage`

Проверяет:

- наличие описания для каждого frame type;
- наличие underlying class;
- inheritance cycles;
- типизацию declared properties;
- unresolved type references;
- opaque types;
- различие typed и observed-only coverage.

Codex не должен утверждать «движок поддержан на 100%», если audit показывает observed-only или runtime-only ограничения. Корректная формулировка: «все известные bundled-типы поддерживаются структурно, а declared properties — типизированно».

## 7. Создание файлов и Includes

### `ui.create_file`

Создаёт правильный минимальный root:

```xml
<Desc>
</Desc>
```

или:

```xml
<StyleFile>
</StyleFile>
```

Пример:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "kind": "layout",
  "includeIn": "UI/Layout/DescIndex.SC2Layout",
  "dryRun": false,
  "stage": true
}
```

`includeIn` добавляет один duplicate-safe `<Include path="..."/>` минимальным patch. Для `.SC2Style` Include не применяется.

Отдельные операции:

- `ui.add_include`;
- `ui.remove_include`.

## 8. Создание, клонирование и удаление frames

### `ui.create_frame`

Это основной universal constructor. Он не ограничен списком convenience-функций.

Основные поля:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "parentPath": "GameUI~1UIContainer/MyWindow",
  "type": "Button",
  "name": "AcceptButton",
  "template": "StandardTemplates/StandardButtonTemplate",
  "frameFile": "GameUI",
  "properties": [],
  "anchors": [],
  "allowUnknownType": false,
  "allowUnknownProperties": false,
  "allowReadonlyProperties": true,
  "allowBlizzardOnly": false,
  "dryRun": false,
  "stage": true
}
```

`frameFile` — XML attribute `file=`, а не путь layout-файла.

`allowReadonlyProperties` по умолчанию разрешён, потому что readonly metadata community schema нередко противоречит реальным Core layouts. Validator всё равно может сообщить advisory diagnostic.

### `ui.clone_frame`

Копирует точный source subtree, меняя имя и indentation. Это предпочтительнее реконструкции сложного известного шаблона вручную.

### `ui.delete_frame`

Удаляет только выбранный subtree. Перед сохранением обязательно проверить diff.

### Convenience API

- `ui.create_button` — тонкая оболочка над `ui.create_frame`;
- `ui.create_clipped_image` — viewport Frame + oversized child Image;
- `ui.create_from_blizzard_template` — проверенный Core template;
- `ui.create_restricted_frame` — restricted policy route.

## 9. Universal properties

### Чтение

```text
ui.get_property
```

Поддерживает selector:

```json
{
  "index": 0,
  "layer": 1,
  "attrs": {"state":"Hover"},
  "occurrence": 0
}
```

### Запись

```text
ui.set_property
```

Scalar property:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Button",
  "property": "Enabled",
  "value": false,
  "dryRun": false,
  "stage": true
}
```

Indexed/layer property:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Image",
  "property": "Texture",
  "value": "Assets/Textures/MyImage.dds",
  "selector": {"layer": 0},
  "dryRun": false,
  "stage": true
}
```

Complex property:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Image",
  "property": "TextureCoords",
  "attrs": {
    "top": 0.1,
    "left": 0.2,
    "bottom": 0.9,
    "right": 0.8,
    "layer": 0
  },
  "replace": true,
  "dryRun": false,
  "stage": true
}
```

Удаление выполняется той же операцией с `remove: true` и точным selector.

Если найдено несколько одинаковых table properties, операция без selector должна отказаться от двусмысленного изменения.

## 10. Anchors

Чтение: `ui.get_anchor`.

Запись: `ui.set_anchor`.

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "framePath": "Window/Button",
  "anchor": {
    "side": "Left",
    "relative": "$parent",
    "pos": "Min",
    "offset": 24
  },
  "dryRun": false,
  "stage": true
}
```

Sides:

```text
Top | Left | Right | Bottom | All
```

Positions:

```text
Min | Mid | Max
```

`All` представляет side-less anchor. Codex не должен самостоятельно генерировать четыре anchors, если layout использует один all-edge anchor.

## 11. Templates

### Собственные templates

Top-level named Frame может служить template:

```xml
<Frame type="Button" name="MyButtonTemplate">
```

Если файл называется `MyButtons.SC2Layout`, reference обычно выглядит так:

```text
MyButtons/MyButtonTemplate
```

### Blizzard templates

- `ui.list_blizzard_templates` — поиск по каталогу Core;
- `ui.describe_blizzard_template` — точная информация и class compatibility;
- `ui.apply_template` — минимальный patch opening tag;
- `ui.create_from_blizzard_template` — создание только с catalog-verified template.

Каждое template usage получает один статус:

| kind | runtimeExpectation | Значение |
|---|---|---|
| `ordinary-template` | `expected-to-work` | Обычное наследование, если reference разрешается и template есть в версии игры |
| `locked-frame-template` | `may-not-work` | Target frame Blizzard-only/locked; Core evidence не гарантирует runtime |
| `incompatible-template` | `unsupported` | Известный template class несовместим с target type |

Codex не должен называть restricted route «взломом». XML может быть синтаксически правильным, но SC2 runtime может не создать или не разрешить locked frame.

## 12. Hookups и restricted frames

Hookup — ожидаемый дочерний runtime frame, например `Label`, `NormalImage` или controls SceneBrowser.

Validator проверяет required hookups. Они могут быть:

- явно описаны дочерними Frame;
- унаследованы от точного verified template;
- поставляться complete container-template route.

`ui.create_restricted_frame`:

1. проверяет `blizzardOnly`;
2. строит restriction plan;
3. предпочитает exact template;
4. иначе использует compatible base template;
5. для сложных типов ищет container route, покрывающий hookups;
6. возвращает `may-not-work` runtime notice;
7. отказывается, если безопасный автоматический route отсутствует.

Low-level обход возможен только через:

```json
{"allowBlizzardOnly":true}
```

и должен использоваться лишь после ручной проверки hookups и runtime риска.

## 13. StateGroup

Операции:

- `ui.get_state_group`;
- `ui.upsert_state_group`.

Состав:

- `name`;
- optional `template`, `file`, `log`;
- `defaultState`;
- массив `states`;
- в каждом State — `when` и `actions`.

Известные условия включают:

- `Property`;
- `AnimationState`;
- `StateGroup`;
- `Option`;
- дополнительные Core-observed variants.

Известные actions включают:

- `SetState`;
- `SetProperty`;
- `SetAnimationProperty`;
- `SetAnchor`;
- `SendEvent`;
- `PlaySound`;
- `ApplyTemplate`;
- `CreateFromTemplate`.

Пример реакции на toggle:

```json
{
  "name": "ButtonLinkState",
  "defaultState": "Enabled",
  "states": [
    {
      "name": "Disabled",
      "when": [
        {"type":"Property","frame":"$this/Button1","attrs":{"Toggled":true}}
      ],
      "actions": [
        {"type":"SetProperty","frame":"$this/Button2","attrs":{"Enabled":false}}
      ]
    },
    {
      "name": "Enabled",
      "when": [
        {"type":"Property","frame":"$this/Button1","attrs":{"Toggled":false}}
      ],
      "actions": [
        {"type":"SetProperty","frame":"$this/Button2","attrs":{"Enabled":true}}
      ]
    }
  ]
}
```

Чтобы обычный click менял `Toggled`, Button должен иметь:

```xml
<Toggleable val="true"/>
```

## 14. Animations

Операции:

- `ui.get_animation`;
- `ui.upsert_animation`.

Animation содержит:

- events;
- drivers;
- controllers;
- controller keys.

Registry знает schema-declared и Core-observed controller types. Перед незнакомым controller Codex должен вызвать:

```json
{"kind":"animation"}
```

Fade по `OnShown`:

```json
{
  "name": "ShowFade",
  "events": [
    {"event":"OnShown","action":"Reset,Play","frame":"$this"}
  ],
  "controllers": [
    {
      "type": "Fade",
      "frame": "$this",
      "end": "Pause",
      "keys": [
        {"type":"Curve","time":0,"attrs":{"value":0,"out":"Fast"}},
        {"type":"Curve","time":0.3,"attrs":{"value":255,"in":"Slow"}}
      ]
    }
  ]
}
```

Для SC2 Fade обычно используется диапазон alpha `0..255`, а не CSS-подобный `0..1`.

Реально встреченные controller families включают Fade, Visibility, Anchor, Dimension, Texture и другие варианты из Registry. Codex не должен ограничиваться этими примерами — список берётся динамически.

## 15. Images и clipping

`ui.create_clipped_image` создаёт:

- parent viewport Frame заданного размера;
- oversized child Image;
- `<Unclipped val="false"/>`;
- optional `TextureCoords`;
- layer;
- TextureType.

Texture types:

```text
None | Normal | Border | HorizontalBorder | EndCap | NineSlice | Circular
```

Два способа crop:

1. Размер child Image больше viewport, позиция child определяет видимую часть.
2. `TextureCoords` выбирает нормализованный прямоугольник исходной texture.

## 16. SC2Style

Операции:

- `ui.list_styles`;
- `ui.get_style`;
- `ui.upsert_style`.

Style mutation изменяет только нужные attributes. Неизвестные style attributes сохраняются.

Перед установкой `<Style val="..."/>` validator через cross-file resolver проверяет, найдено ли имя style.

## 17. References и bindings

Resolver проверяет:

- Includes;
- template references;
- `$this`/`$parent` frame references;
- handles;
- style names;
- property bindings вида `{$TextSource/@Text}`;
- staged новые файлы.

Binding example:

```xml
<URL val="{$TextSource/@Text}"/>
```

Target может быть найден через:

```xml
<Handle val="TextSource"/>
```

## 18. Validation

`ui.validate` возвращает:

- `valid`;
- число errors;
- число warnings;
- diagnostics с code, message, file и framePath.

Основные классы diagnostics:

- `xml.syntax`;
- `layout.structure`;
- `schema.unknown_frame_type`;
- `schema.unknown_property`;
- `schema.blizzard_only_runtime_uncertain`;
- `property.invalid_value`;
- `property.readonly`;
- `hookup.required_missing`;
- `anchor.invalid_offset`;
- `anchor.unknown_position`;
- `reference.include_missing`;
- `reference.template_missing`;
- `reference.frame_missing`;
- `reference.binding_missing`;
- `reference.style_missing`;
- `state.unknown_condition`;
- `state.unknown_action`;
- `animation.unknown_controller`.

Policy:

- errors блокируют корректный результат;
- warnings требуют review;
- locked runtime warning нельзя скрывать утверждением о class compatibility;
- unknown/forward XML сохраняется, даже если Registry его пока не знает.

## 19. Diff, backup и save

### `ui.diff`

Показывает staged изменение и before/after hashes.

Codex должен проверить:

- изменён правильный файл;
- нет full rewrite;
- комментарии и неизвестные элементы остались;
- изменён только ожидаемый opening tag/property/subtree;
- Include не продублирован.

### `ui.save`

Выполняет:

- optimistic SHA-256 guard;
- optional `.sc2uimcp.bak`;
- запись во временный файл;
- atomic rename;
- очистку staged draft.

Пример:

```json
{
  "file": "UI/Layout/MyWindow.SC2Layout",
  "expectedSha256": "hash-from-read-or-diff",
  "backup": true
}
```

### `ui.discard`

Удаляет только draft в памяти. Диск и backup не меняются.

## 20. Алгоритм Codex для нового окна

Для запроса «создай окно, заголовок, две кнопки, hover, fade, state и template»:

1. Найти DescIndex.
2. Создать отдельный layout и Include.
3. Описать типы `Frame`, `Label`, `Button`, `Image`.
4. Найти ordinary base templates.
5. Создать top-level templates.
6. Выбрать подходящий GameUI/custom container layer и создать descriptor override с правильным `file`.
7. Создать Window и children.
8. Установить typed properties.
9. Установить anchors.
10. Добавить hover StateGroup или inherited hover behavior.
11. Добавить opening Fade Animation.
12. Добавить enabled/disabled StateGroup.
13. Проверить every frame reference/template/style.
14. Запустить validation.
15. Проверить diff.
16. Сохранить новый файл, затем DescIndex.

Полный проверяемый запрос, сгенерированный XML и GUI/EXE workflow: [REAL_EXAMPLE_RU.md](REAL_EXAMPLE_RU.md).

## 21. Когда использовать low-level escape hatches

`allowUnknownType`, `allowUnknown`, `allowBlizzardOnly` допустимы, если:

- элемент реально найден в текущем layout/Core другой версии;
- Registry snapshot его не знает;
- требуется forward-compatible preservation/edit;
- Codex явно сообщает пользователю, какая проверка пропущена.

Их нельзя использовать только для подавления обычной ошибки в имени.

## 22. Границы текущей версии

Поддерживается:

- unpacked/component map/mod directory;
- SC2Layout, StormLayout, SC2Style;
- staged multi-file workflow;
- generic frames/properties;
- schema, inheritance, hookups, templates;
- StateGroup и animations;
- cross-file resolver;
- minimal XML patches;
- GUI/API поверх того же Workspace.

Пока не гарантируется:

- прямое монтирование бинарного MPQ/CASC архива;
- live rendering внутри SC2 Editor;
- runtime-разрешение locked frames;
- полный transaction journal сразу для нескольких файлов;
- визуальный pixel-perfect preview движка SC2.

GUI не должен изображать собственный HTML-preview как точный SC2 renderer. Его задача — semantic editing, schema inspection, validation и diff review.

## 23. Короткий checklist для system prompt Codex

```text
1. Не редактируй SC2Layout строками, если существует ui.* операция.
2. Сначала discover files/frames/schema.
3. Используй generic API; не требуй отдельный tool для каждого property.
4. Все mutations сначала dry-run или stage.
5. Не создавай locked frame без runtime warning и hookup review.
6. Не считай community schema вечной истиной.
7. Сохраняй unknown XML и существующее форматирование.
8. После изменений обязательны validate и diff.
9. Сохраняй только atomic save с backup.
10. При ambiguity остановись, запроси selector или точный framePath.
```
