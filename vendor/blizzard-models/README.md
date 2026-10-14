# Blizzard Models

This package provides the MK3 `m3` and `m3a` codecs, their native encoders, and StarCraft II
model inspection. Shared scene editing, animation sampling, UVM serialization and rendering live
in Modkit scene/UV packages.

## UVM contract

`model.export-uvm` always emits a source-free extended glTF/UVM document. It never embeds the
original M3 or M3A bytes.

Common structures own all data they can represent:

- meshes, indices, normals, tangents, vertex colors and UV sets;
- nodes, skinning, bind pose, animation clips and material animation targets;
- materials, texture references and render parameters;
- sockets, collisions, cameras, lights, billboards and supported effects;
- coordinate and unit transforms.

M3 `CAM_` field-of-view/near/far references and `LITE` color/intensity/attenuation/decay/cone
references are projected through the native sequence evaluator into executable portable scene
tracks. The common renderer samples them by UVM clip identity and time. Camera depth-of-field and
native light specular-only fields remain in the bounded residual until a common consumer exists.

`extras.BlizzardM3` uses schema version 1 and stores only bounded information needed to reconstruct
an M3-family file that common glTF/UVM cannot express. Current residual data includes the target
format/profile, native container version, animation reference headers and unsupported animation
tracks, bone flag differences, rigid-body policies, preview records and M3A binding hashes when
present. It is not a copy of the parsed model and contains no source blob.

M3 and M3A export regenerates native bytes from the common scene plus this residual. Formatting,
section placement, padding and other non-semantic byte layout may change. Only schema version 1 is
accepted.

## Format boundaries

The codec knows only the M3 family. Cross-format conversion is mediated by UVM and the shared
scene API; the codec has no dependency on PIE or any other native model format. M3A remains an
animation-only member of the family and cannot be exported from a UVM document containing active
render meshes.

Native parsers and encoders remain under `src/m3/runtime`. The codec entry point assembles decoded
facets and delegates UVM construction and rendering to shared packages. `model.write`, the
`common.model/native-encoder` provider and edit preparation all call the same source-free encoder.

`src/m3/native` is the one M3 format library: the MD33/MD34 container and version-gated section
table, `structures.xml`, vertex layouts, material/effect/metadata builders and animation
resolution (sequences → STC/STS/SD sampling). It came from MK2 and compiles under its own relaxed
profile (`tsconfig.native.json`) to `dist/m3/native`; every runtime module and test imports that
single compiled copy. Parity with MK2 was reached and is no longer re-run; MK2 stays readable in
`references/modkitmk2`.

M3 has no public specification. The library was cross-checked against real `.m3`/`.m3a` samples,
the `mdx-m3-viewer` project (MIT) and WhiteoutLib's `M3_FILE_FORMAT_SPECIFICATION.md`
(see `REFERENCES.md`).

## Development

```powershell
pnpm typecheck
pnpm build
pnpm exec vitest run --config ./test/vitest.split.config.mjs ./test/m3-uvm-write-operation.test.ts
```

The focused tests verify schema-1 UVM output, native regeneration, M3/M3A target rules, host
native-encoder routing and rejection of unsupported format metadata.
