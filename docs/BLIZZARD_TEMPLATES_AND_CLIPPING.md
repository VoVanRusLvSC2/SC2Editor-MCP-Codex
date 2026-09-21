# Blizzard templates, restricted frames, and image clipping

## Findings from real Core.SC2Mod files

The current schema declares `LaunchURLButton` as `blizzOnly="true"`, maps it to `CLaunchURLButton`, and gives it `URL` and `Nydus` in addition to inherited `CButton`/`CControl`/`CFrame` properties. Its optional hookups are `Label`, `NormalImage`, `HoverImage`, and `HitTestFrame`.

This is not merely theoretical: Blizzard's own layouts use the type repeatedly. Examples in the bundled research snapshot include:

- `Layout/Common/StandardDialog.SC2Layout`, where `LaunchURLButton` inherits `StandardTemplates/StandardGlueButton`;
- `Layout/Glue/ScreenCustomFeatured.SC2Layout`, whose `CTABannerTemplate` contains a `LaunchURLButton` and binds both `Text` and `URL`;
- `Layout/Glue/WarChestComicTemplate.SC2Layout` and `WarChestFrame.SC2Layout`.

The project therefore has two creation paths:

- `ui.create_frame`: direct low-level creation; a restricted type needs `allowBlizzardOnly: true`;
- `ui.create_from_blizzard_template`: catalog-verified creation; the template must be observed in Core and its base class must be compatible with the requested type.
- `ui.create_restricted_frame`: automatic policy route for any restricted type; it chooses either a direct template or a containing Core template that supplies required hookups.

This does not bypass SC2 security. It makes the intent and evidence explicit, preserves the XML, and lets validation report what is known. Actual behavior can still depend on game version, UI context, and Battle.net/runtime policy.

The API deliberately distinguishes two cases in `usage` results:

- ordinary templates are marked `ordinary-template` and `expected-to-work` when their reference resolves and the target version contains them;
- any template applied to a `blizzOnly`/locked target is marked `locked-frame-template` and `may-not-work`, even when the template is found in Core and its class is compatible.

Locked-template creation is therefore an evidence-backed XML construction feature, not a promise that SC2 will instantiate or permit the frame. `ui.describe_type`, `ui.describe_blizzard_template`, `ui.list_blizzard_templates`, `ui.create_frame`, `ui.create_from_blizzard_template`, `ui.create_restricted_frame`, `ui.apply_template`, and `ui.validate` all expose this distinction.

## SceneBrowser

`SceneBrowser` is also `blizzOnly`. Unlike `LaunchURLButton`, it requires six hookups: `BrowserImage`, `ForwardButton`, `BackButton`, `GoButton`, `ScrollBar`, and `AddressEditBox`. A naked frame is therefore rejected by validation.

The generated Core-route registry finds the complete instance inside `StandardDialog/BrowserDialogTemplate`. The automatic operation emits this merge-friendly pattern:

```xml
<Frame type="SceneBrowserDialog" name="MyBrowser" template="StandardDialog/BrowserDialogTemplate">
    <Frame type="SceneBrowser" name="SceneBrowser">
        <Address val="https://example.invalid"/>
    </Frame>
</Frame>
```

The outer Core template supplies the browser controls and required hookups; the nested description is only the semantic override. The same discovery and selection algorithm is applied to every schema-marked Blizzard-only type. If no verified route covers its required hookups, the automatic tool refuses and leaves only the explicit low-level override path.

For the supplied example:

- `ScreenCustomFeatured/CTABannerTemplate` is cataloged as a `Frame` template;
- `StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate` is cataloged as a `Button` template;
- `LaunchURLButton` derives from `Button`, so the latter template is class-compatible;
- `{$TextSource/@Text}` resolves through a hidden Label with `<Handle val="TextSource"/>` and is checked as a binding reference.

## Two kinds of cropping

### Viewport clipping

A large child `Image` is placed inside a smaller parent `Frame`. SC2 clips descendants by default. `<Unclipped val="true"/>` opts out, so the helper emits `false` explicitly. Change the child anchors/offsets to pan the image inside the viewport.

### Texture-coordinate cropping

`Image.TextureCoords` selects a normalized rectangle from the texture, for example:

```xml
<TextureCoords top="0.1" left="0.2" bottom="0.9" right="0.8" layer="0"/>
```

`ui.create_clipped_image` supports both mechanisms at once. The generic `ui.set_property` can later edit `TextureCoords`, `PixelTextureCoords`, sizes, anchors, or `Unclipped` without adding property-specific MCP tools.

## Evidence and provenance

- Schema snapshot: `SC2Mapster/sc2-galaxy-toolkit`, commit `95d1ff82b8e89fb0078c4b8e5e6622271b927b94`.
- Blizzard UI corpus snapshot: `SC2Mapster/SC2GameData`, commit `6dd323aae4209a01f110719a00b4e8f7a88389bc`.
- Generated catalog: `schema/core-observations.json` (378 UI files, 2,332 top-level templates and 2,790 restricted-frame routes).

The schema and corpus evidence are deliberately stored separately; neither community metadata nor one historical Core snapshot is treated as timeless engine truth.
