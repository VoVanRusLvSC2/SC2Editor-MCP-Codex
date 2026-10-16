# Locally vendored user-supplied model renderer

Source: C:/Users/Vladimir/Downloads/models.zip, package @modkit/blizzard-models 1.0.0. Package declares GPL-2.0-only. Native TypeScript sources and the supplied binding provenance are retained. Source commit in supplied provenance: 1a14ba4eddd0ae88de273348ebd44cfb98a0581d. The browser chunks are self-contained supplied material/simulation implementations; no CDN or package code is executed from the archive during preview.

Adaptations:
- dist/m3/native/builder/effects.js: replace missing @modkit/codec-kit MAX_EFFECT_RIBBON_SIDES import with 32, verified in supplied bundle. Source counterpart retained unchanged.
- browser/effects-sim.js: copied supplied self-contained chunk-DU6XODLA.js.
- browser/material-entry.js: expose createStandardMaterialPrograms from supplied chunk-7HCZNWOX.js; four referenced chunks retained.
- browser/material-bundle.js: esbuild IIFE of material-entry.js, global CutsceneMaterials, minified with legal comments inline. Sources/chunks retained for rebuilding.

The host adapters and WebGL2 renderer are in src/modules/cutscenePreview. The original package is not represented as an official Blizzard SDK. SC2 game assets are read locally from the user's installation; they are not included in the distribution.

2026-10-15 native MAT bit 11: source/dist m3/native/builder/standard-material and source/dist m3/native/encoder correct the polarity of specularEnergyConservation. Base98310's binder enables specular dimming when 0x800 is set; it also enables environment blur, which remains a separate unimplemented preview route. Original sourceFlags stay authoritative for export. Importer and the isolated encoder flag helper are tested; the complete encoder roundtrip is unavailable without @modkit/codec-kit. These modifications retain this vendor's GPL-2.0-only terms and existing authorship.

2026-10-13 native shader math: editable browser/chunk-7HCZNWOX.js and the new browser/native-material-math.js implement locally verified Base98310 material operations, separate diffuse/emissive team colors, AO/lightmap lighting placement, and copy-on-write property sampling. No canonical shader TypeScript counterpart exists in the supplied package; browser/material-bundle.js is regenerated from material-entry.js. Source hashes, conditions, preview defaults, tests, and remaining native limits are recorded in NATIVE_MATERIAL_MATH_PROVENANCE.json. Engine parity remains false; no game assets or reverse-engineered EXE copies are embedded in these browser artifacts.
