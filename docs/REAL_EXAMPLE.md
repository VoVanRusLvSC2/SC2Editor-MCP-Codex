# Full example: GameUI, your template, toggle, StateGroup and Fade

This example is included in the `examples/UI` as a finished component-directory tree. It is created by the same `ui.apply` used by Codex and GUI, undergoes schema/cross-file validation and is checked by regression testing for exact XML matching.

Important: Structural validation passed. In the current Linux build environment, there is no StarCraft II Windows client installed, so the document does not pass structural PASS for written in-game runtime PASS. It is designed for `npm run runtime:corpus` and external runtime adapter.

## Where does SC2 connect the window?

The main example uses:

```xml
<Frame type="Frame" name="GameUI/UIContainer" file="GameUI">
```

This is the descriptor override of the regular Blizzard `GameUI.SC2Layout`. Inside it is added `CodexWindow`.

Workbench is not limited to this container. In the GUI, there are presets from real Core, and in `ui.create_frame`/`ui.apply` you can transfer any descriptor path:

| Descriptor name | `file` | Layer |
|---|---|---|
| `GameUI/UIContainer` | `GameUI` | general gaming UI |
| `GameUI/UIContainer/FullscreenLowerContainer` | `GameUI` | below the console |
| `GameUI/UIContainer/ConsoleUIContainer` | `GameUI` | elements associated with the console |
| `GameUI/UIContainer/FullscreenUpperContainer` | `GameUI` | above the console |
| any other descriptor path | layout name | custom override |

An example of creating another container in a single transaction:

```json
{
  "op": "create_frame",
  "as": "upper",
  "type": "Frame",
  "name": "GameUI/UIContainer/FullscreenUpperContainer",
  "frameFile": "GameUI"
}
```

The next child uses `"parentPath":"@upper"`. The Slash inside the name in the returned semantic path is screened as `~1`; this does not change XML and should not fall into runtime references.

## Files of the finished component-example

```text
examples/
└── UI/
    ├── FontStyles.SC2Style
    └── Layout/
        ├── DescIndex.SC2Layout
        └── TransactionDemo.SC2Layout
```

`DescIndex.SC2Layout` contains:

```xml
<Include path="UI/Layout/TransactionDemo.SC2Layout"/>
```

When creating your own file, use `ui.create_file` with `includeIn`, or one `add_include` operation in `ui.apply`. Include inserts a minimum patch, no duplicates are created.

## One Codex challenge

The complete call body is stored in [`examples/TransactionRequest.json`](../examples/TransactionRequest.json).

1. Creates `CodexButtonTemplate` on top of the real Blizzard `StandardButtonTemplate`
2. connects `GameUI/UIContainer` with `file="GameUI"`;
3. Creates a 480×240 visible window with anchors
4. Creates two buttons from the user template;
5. Makes the first button toggleable;
6. Launches Fade `0 → 255` over `OnShown`
7. Tracks `Toggled=True/False` through StateGroup
8. Turns off/activates the second button via `$parent/Secondary`
9. Validates the result and returns diff in the same answer.

In MCP, it's one challenge:

```text
ui.apply(<содержимое examples/TransactionRequest.json>)
```

There is no need to do separate round trips for each Width, Anchor, State and Key. `@gameui`, `@window`, `@primary` and other aliases exist only at the time of the transaction. Runtime XML stores native `$this` and `$parent/...`.

## Realistically generated XML

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

Why there are both links to templates:

- `CodexButtonTemplate` inherits the standard Blizzard template and receives its visual hookups/states.
- `Primary` and `Secondary` inherit the `TransactionDemo/CodexButtonTemplate`.
- The name `TransactionDemo` corresponds to the layout file `TransactionDemo.SC2Layout`.

The usual Button template is classified as `ordinary-template / expected-to-work` if the reference is allowed in the target version of Core. For `blizzOnly` types like `LaunchURLButton` and `SceneBrowser`, the result is always `locked-frame-template / may-not-work`: the Blizzard template found is not a promise of bypassing runtime restrictions.

## Verification and preservation

Recommended workflow codex:

```text
ui.query_frames → ui.describe_type → ui.apply → ui.save
```

`ui.apply` already returns validation and minimal diff. First use `dryRun:true`; then repeat the adopted plan with `dryRun:false, stage:true`; after review, call `ui.save` with `backup:true` and the original SHA-256.

Local project review:

```bash
npm run build
npm run lint
npm test
npm run schema:audit
npm run benchmark:codex
```

## GUI and Windows EXE

In GUI:

1. Open or create a layout;
2. In `Attach UI container`, select the preset or enter the custom descriptor path and `file`.
3. Select the created root frame;
4. Add children with the suggested ordinary template.
5. Set properties and anchors;
6. StateGroup builder accepts separate JSON attributes for `When` and `Action`.
7. Animation builder is capable of `OnShown → Reset,Play`, `end` and Fade alpha `0…255`.
8. Check Validation and Diff;
9. press `Save + backup`.

Windows portable package runs through `SC2-UI-Workbench.exe`. Cross-built archive uses installed Node.js 20+; fully self-contained package with `runtime/node.exe` is collected by the `windows/build-portable.ps1` command directly on Windows.
