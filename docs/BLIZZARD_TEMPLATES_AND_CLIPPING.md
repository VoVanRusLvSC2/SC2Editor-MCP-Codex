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

## Generic Frame inheritance

Use `type="Frame"` as the generic carrier for an existing Core template. It is
compatible with every known frame template; applying a specialized class check
to this generic form incorrectly rejects valid template inheritance. Specialized
authored types still retain their normal compatibility checks.

For locked features, prefer a Core **container** that already owns the required
typed child. Override the existing child by its exact name using `type="Frame"`.
This preserves the supplied hookups and child type without creating a new locked
instance directly. For example:

```xml
<Frame type="Frame" name="VideoPanel"
       template="CommanderSelectionPopupContainers/MovieContainerTemplate">
    <Frame type="Frame" name="MovieFrame">
        <File val="Assets/Textures/briefing_video_thanson01_00.ogv"/>
        <Visible val="true"/>
        <Loop val="true"/>
    </Frame>
</Frame>
```

The generic root retains **Frame properties**. Do not put `File`, `Loop`, or other
MovieFrame-only properties on that root: build 98310 reports unknown start tags.
The MCP resolves exact recorded Core container-child paths when validating
creation, property edits and layouts. Ambiguous or unknown child types remain
unresolved rather than silently accepting arbitrary properties.

Use `ui.create_from_blizzard_template` with `type="Frame"` for the container,
then `ui.create_frame` for the named child override. Save and register the custom
layout through `ui.assets.register` / `ui.assets.save`. The compatible descriptor
is separate evidence from native instantiation, decoded video, web loading or
YouTube playback; record those actual results independently.

`ui.create_restricted_frame` now defaults to `construction="inherited-frame"`:
it chooses a verified Core container with a direct typed child and emits both
the container and child override as Frame. `construction="typed"` preserves the
explicit legacy construction. Missing verified containers are reported rather
than treating a generic root as a specialized widget. In build 98310, `IsPlaying`
is actually read-only; supplying File starts the tested local movie. Use native
movie controls/hookups for playback state instead of assigning IsPlaying in XML.

## SceneBrowser

`SceneBrowser` is also `blizzOnly`. Unlike `LaunchURLButton`, it requires six hookups: `BrowserImage`, `ForwardButton`, `BackButton`, `GoButton`, `ScrollBar`, and `AddressEditBox`. A naked frame is therefore rejected by validation.

The generated Core-route registry finds the complete instance inside `StandardDialog/BrowserDialogTemplate`. The automatic operation emits this merge-friendly pattern:

```xml
<Frame type="Frame" name="MyBrowser" template="StandardDialog/BrowserDialogTemplate">
    <Frame type="Frame" name="SceneBrowser">
        <Address val="https://example.invalid"/>
    </Frame>
</Frame>
```

The outer Core template supplies the browser controls and required hookups; the nested description is the existing child override. The automatic `ui.create_restricted_frame` operation uses this generic construction by default. Selecting a route is separate from proving native behavior. If no verified container covers the required hookups, report that gap.

For the supplied example:

- `ScreenCustomFeatured/CTABannerTemplate` is cataloged as a `Frame` template;
- `StandardBattlenetTemplates/BattlenetMediumAlternateButtonTemplate` is cataloged as a `Button` template;
- `LaunchURLButton` derives from `Button`, so the latter template is class-compatible;
- `{$TextSource/@Text}` resolves through a hidden Label with `<Handle val="TextSource"/>` and is checked as a binding reference.

The same inherited-child schema is used by individual property commands and
`ui.apply` batches. A failed batch must not stage its preceding property edits.
Fit the Core background and browser children to the actual Dialog Pane. A
`visible:true` native frame can still be clipped outside its parent's hit area.
Browser texture dimensions, actual navigation and web video playback are separate
checks. A local MovieFrame clip is not evidence for a YouTube URL. In the observed
build 98310, an actual YouTube embed page rendered a player configuration error.
The normal watch URL loaded YouTube's "Please update your browser" page. This
establishes web page rendering inside SC2, but not video playback. Do not label
YouTube playback supported or keep changing Frame compatibility to conceal that
browser/runtime limitation. The particular embed error code was not exposed.

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
