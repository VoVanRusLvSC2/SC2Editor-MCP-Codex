# SC2 UI research summary

Sources reviewed and snapshotted for the implementation:

- SC2Mapster `sc2-galaxy-toolkit`: current home of the generated UI schema snapshot.
  https://github.com/SC2Mapster/sc2-galaxy-toolkit
- SC2Mapster `sc2layout-schema`: historical repository; its status notice points to the toolkit.
  https://github.com/SC2Mapster/sc2layout-schema
- Generated SC2 UI API documentation based on that model.
  https://mapster.talv.space/ui-layout
- SC2Mapster `SC2GameData`, including the Core UI corpus used for verification.
  https://github.com/SC2Mapster/SC2GameData
- SC2 archive/file-format documentation for UI layout/style locations and `DescIndex.SC2Layout`.
  https://github.com/sc2-arcade-watcher/sc2-file-format-docs
- MCP TypeScript SDK v2 / MCP 2026-07-28 specification.
  https://ts.sdk.modelcontextprotocol.io/v2/
  https://blog.modelcontextprotocol.io/posts/2026-07-28/

## Confirmed concepts relevant to the MCP

- UI layout documents use a `<Desc>` root and `<Frame type="..." name="...">` descriptions.
- Basic positioning is anchor-based. `Anchor` has `side`, `relative`, optional `pos`, optional `offset`; sides are Top/Left/Right/Bottom and positions include Min/Mid/Max. Frames can have up to four anchors.
- Base `CFrame` exposes many common properties, including width/height, visibility, alpha, enabled/mouse behavior, handle, etc.
- `Button` maps to `CButton` and may hook up Label/NormalImage/HoverImage/HitTestFrame. CButton also has properties such as Text, Style, Toggleable and sounds.
- Common unrestricted types include Frame, Button, Label, Image, EditBox, ListBox, Slider, ProgressBar and many more; the schema also marks many Blizzard-only types.
- Templates are heavily used in Blizzard's layout data (`template="..."`). Standard templates contain nested frames, images, list boxes, scrollbars, edit boxes, states, animations and other structures.
- Frame references can target hierarchy/special references such as `$parent`; handles provide global-style references.
- State groups consist of conditions (`When`) and actions (`Action`) including SetProperty, SetState, SetAnchor, SendEvent, ApplyTemplate and CreateFromTemplate.
- Animations have controllers and keys, with controller types including Visibility, Text, Texture, State, Property, Rotation, Fade, Enabled, Dimension, Anchor and others.
- `.SC2Layout` is loaded as UI layout content; `.SC2Style` is used for UI styles/fonts. Engine/file-format research identifies `UI/Layout/DescIndex.SC2Layout` as the root UI layout index path.

## Design implication

The MCP must not model SC2 UI as just a few fixed XML tags. The long-term source of truth should be a generated schema registry plus the actual Blizzard/community layout corpus. The agent-facing API should remain semantic and stable while schema coverage grows underneath it.

The current corpus pass found 18,585 frame declarations across 378 files, 743 frame types in active Core use, 32 animation controller types, and 2,332 top-level templates. All 377 layout documents passed byte-identical no-op round trips with the source-span reader.
