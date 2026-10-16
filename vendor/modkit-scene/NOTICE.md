# ModKit static texture filtering

The filtering method in `src/modules/cutscenePreview/materialTextures.ts` adapts
`packages/scene/src/render/texture-filtering.ts` from
https://github.com/hometlt/ModKit/blob/72253b49adff4f572c4763cd1ca5c980264afe41/packages/scene/src/render/texture-filtering.ts
by Modkit contributors, under MIT. The package at that revision declares MIT.
The permission and copyright notice is retained inside the serialized adapter
and in `LICENSE-MIT.txt`. This method is excluded from the root custom license.

Local adaptation: static 2D images only; finite capability validation; maximum
8x anisotropy or the device limit; cache both presence and absence per context;
report the selected factor. Existing trilinear mipmaps remain the fallback.
RTT, video, ambient cubes, palettes and postprocess targets use their existing
sampling. This is a preview quality setting, not a recovered SC2 sampler default.

The rest of ModKit / ModKit-Blizzard is research input and was not vendored here.
