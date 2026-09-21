# Timeline, time and keyframes

The model distinguishes native node/track, element/block, keyframe, hierarchy and raw extension data. No element is discarded because its type is unknown.

`CutsceneTime` keeps the original token and parses seconds, milliseconds and timecode as decimal text. Large native tick values remain strings, avoiding IEEE-754 loss.

Accepted inputs are `125ms`, `1.5s`, `00:00:12.500`, or an integer native value. Seconds-to-ticks conversion is blocked until discovery records the time base for the installed Editor build. Existing native tokens round-trip unchanged.

The generic keyframe representation preserves every attribute and child, including unknown interpolation tokens, tangent handles, flags, IDs and editor metadata. Unknown interpolation is never replaced with Linear.

SC2Editor `5.0.16.97563` confirms the native serialization fields `curveInType`, `curveOutType`, `curveInValue`, and `curveOutValue`, plus eight UI tokens: `Custom`, `Fast`, `Flat`, `Linear`, `Slow`, `Smooth`, `Step`, and `Auto`. Corpus values include integer IDs `0`, `3`, `4`, `5`, `6`, and `7`, but the exact token-to-ID descriptor was not recovered. The bridge therefore preserves/accepts exact numeric IDs and does not infer the mapping from string order.

Operations:

- `timeline.add/remove`
- `keyframe.add/update/remove`
- `property.animate` for a complete property track plus many keyframes in one transaction
- `property.set/reset`
- `raw.patch` as a bounded final escape hatch

`keyframe.add` requires a schema-observed `NativeNodeSpec`; it does not synthesize guessed tags.
