# Полный пример: GameUI, свой шаблон, toggle, StateGroup и Fade

Этот пример входит в `examples/UI` как готовое component-directory дерево. Он создаётся тем же `ui.apply`, которым пользуется Codex и GUI, проходит schema/cross-file validation и проверяется regression-тестом на точное совпадение XML.

Важно: structural validation пройден. В текущем Linux build-окружении нет установленного Windows-клиента StarCraft II, поэтому документ не выдаёт structural PASS за записанный in-game runtime PASS. Для него предназначен `npm run runtime:corpus` и внешний runtime adapter.

## Куда SC2 подключает окно

Главный пример использует:

```xml
<Frame type="Frame" name="GameUI/UIContainer" file="GameUI">
```

Это descriptor override штатного Blizzard `GameUI.SC2Layout`. Внутрь него добавляется `CodexWindow`.

Workbench не ограничен этим контейнером. В GUI есть presets из реального Core, а в `ui.create_frame`/`ui.apply` можно передать любой descriptor path:

| Descriptor name | `file` | Слой |
|---|---|---|
| `GameUI/UIContainer` | `GameUI` | общий игровой UI |
| `GameUI/UIContainer/FullscreenLowerContainer` | `GameUI` | ниже консоли |
| `GameUI/UIContainer/ConsoleUIContainer` | `GameUI` | элементы, связанные с консолью |
| `GameUI/UIContainer/FullscreenUpperContainer` | `GameUI` | выше консоли |
| любой другой реальный descriptor path | соответствующий layout name | custom override |

Пример создания другого контейнера в одной транзакции:

```json
{
  "op": "create_frame",
  "as": "upper",
  "type": "Frame",
  "name": "GameUI/UIContainer/FullscreenUpperContainer",
  "frameFile": "GameUI"
}
```

Следующий child использует `"parentPath":"@upper"`. Slash внутри имени в возвращённом semantic path экранируется как `~1`; это не меняет XML и не должно попадать в runtime references.

## Файлы готового component-примера

```text
examples/
└── UI/
    ├── FontStyles.SC2Style
    └── Layout/
        ├── DescIndex.SC2Layout
        └── TransactionDemo.SC2Layout
```

`DescIndex.SC2Layout` содержит:

```xml
<Include path="UI/Layout/TransactionDemo.SC2Layout"/>
```

При создании собственного файла используйте `ui.create_file` с `includeIn`, либо одну операцию `add_include` в `ui.apply`. Include вставляется минимальным patch, дубликаты не создаются.

## Один вызов Codex

Полное тело вызова хранится в [`examples/TransactionRequest.json`](../examples/TransactionRequest.json). Семантически оно выполняет:

1. создаёт `CodexButtonTemplate` поверх реального Blizzard `StandardButtonTemplate`;
2. подключает `GameUI/UIContainer` с `file="GameUI"`;
3. создаёт видимое окно 480×240 с anchors;
4. создаёт две кнопки из пользовательского шаблона;
5. делает первую кнопку toggleable;
6. запускает Fade `0 → 255` по `OnShown`;
7. отслеживает `Toggled=True/False` через StateGroup;
8. выключает/включает вторую кнопку через `$parent/Secondary`;
9. валидирует итог и возвращает diff в том же ответе.

В MCP это один вызов:

```text
ui.apply(<содержимое examples/TransactionRequest.json>)
```

Не нужно делать отдельные round trips для каждого Width, Anchor, State и Key. `@gameui`, `@window`, `@primary` и другие aliases существуют только во время транзакции. Runtime XML сохраняет нативные `$this` и `$parent/...`.

## Реально сгенерированный XML

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<Desc>
    <!-- Existing unknown content remains untouched. -->
    <FutureMetadata owner="user"/>
    <Frame type="Button" name="CodexButtonTemplate" template="StandardTemplates/StandardButtonTemplate">
        <Width val="180"/>
        <Height val="48"/>
    </Frame>
    <Frame type="Frame" name="GameUI/UIContainer" file="GameUI">
        <Frame type="Frame" name="CodexWindow">
            <Width val="480"/>
            <Height val="240"/>
            <Visible val="true"/>
            <Anchor side="Top" relative="$parent" pos="Mid" offset="-120"/>
            <Anchor side="Left" relative="$parent" pos="Mid" offset="-240"/>
            <Frame type="Button" name="Primary" template="TransactionDemo/CodexButtonTemplate">
                <Text val="Primary"/>
                <Toggleable val="true"/>
                <Anchor side="Bottom" relative="$parent" pos="Max" offset="-32"/>
                <Anchor side="Left" relative="$parent" pos="Min" offset="32"/>
                <StateGroup name="ToggleState">
                    <DefaultState val="NotToggled"/>
                    <State name="Toggled">
                        <When type="Property" frame="$this" toggled="True"/>
                        <Action type="SetProperty" frame="$parent/Secondary" enabled="False"/>
                    </State>
                    <State name="NotToggled">
                        <When type="Property" frame="$this" toggled="False"/>
                        <Action type="SetProperty" frame="$parent/Secondary" enabled="True"/>
                    </State>
                </StateGroup>
                <Animation name="Show" speed="1">
                    <Event event="OnShown" action="Reset,Play" frame="$this"/>
                    <Controller type="Fade" frame="$this" end="Pause">
                        <Key type="Curve" time="0" value="0" inout="Smooth"/>
                        <Key type="Curve" time="0.25" value="255" inout="Smooth"/>
                    </Controller>
                </Animation>
            </Frame>
            <Frame type="Button" name="Secondary" template="TransactionDemo/CodexButtonTemplate">
                <Text val="Secondary"/>
                <Anchor side="Bottom" relative="$parent" pos="Max" offset="-32"/>
                <Anchor side="Right" relative="$parent" pos="Max" offset="-32"/>
            </Frame>
        </Frame>
    </Frame>
</Desc>
```

Почему ссылки на шаблоны присутствуют обе:

- `CodexButtonTemplate` наследует штатный Blizzard template и получает его визуальные hookups/состояния;
- `Primary` и `Secondary` наследуют уже пользовательский `TransactionDemo/CodexButtonTemplate`;
- имя `TransactionDemo` соответствует имени layout-файла `TransactionDemo.SC2Layout`.

Обычный Button template классифицируется как `ordinary-template / expected-to-work`, если ссылка разрешается в целевой версии Core. Для `blizzOnly` типов вроде `LaunchURLButton` и `SceneBrowser` результат всегда остаётся `locked-frame-template / may-not-work`: найденный Blizzard template не является обещанием обхода runtime-ограничений.

## Проверка и сохранение

Рекомендуемый workflow Codex:

```text
ui.query_frames → ui.describe_type → ui.apply → ui.save
```

`ui.apply` уже возвращает validation и minimal diff. Сначала используйте `dryRun:true`; затем повторите принятый план с `dryRun:false, stage:true`; после review вызовите `ui.save` с `backup:true` и исходным SHA-256.

Локальная проверка проекта:

```bash
npm run build
npm run lint
npm test
npm run schema:audit
npm run benchmark:codex
```

## GUI и Windows EXE

В GUI:

1. откройте или создайте layout;
2. в `Attach UI container` выберите preset или введите custom descriptor path и `file`;
3. выберите созданный root frame;
4. добавляйте children с предложенным ordinary template;
5. задавайте properties и anchors;
6. StateGroup builder принимает отдельные JSON attributes для `When` и `Action`;
7. Animation builder умеет `OnShown → Reset,Play`, `end` и Fade alpha `0…255`;
8. проверьте Validation и Diff;
9. нажмите `Save + backup`.

Windows portable package запускается через `SC2-UI-Workbench.exe`. Cross-built архив использует установленный Node.js 20+; полностью self-contained пакет с `runtime/node.exe` собирается командой `windows/build-portable.ps1` непосредственно на Windows.
