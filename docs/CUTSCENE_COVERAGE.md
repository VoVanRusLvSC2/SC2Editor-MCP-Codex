# Cutscene coverage

Version: `1.1.0-alpha.5`. This report deliberately distinguishes static support from Editor/runtime proof.

## Measured coverage

| Metric | Result |
|---|---:|
| Supplied Editor build | `5.0.16.97563`, x64 |
| Editor executable hash | `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164` |
| EXE Cutscene class/type candidates | 61 |
| EXE candidates with native XML-name evidence | 51 |
| EXE property-panel entries | 299 |
| EXE properties also matched to corpus XML | 181 |
| EXE properties paired with an adjacent internal token | 67 |
| EnvironmentLight fields paired inside its internal registry cluster | 9 |
| Display-derived names still needing serializer proof | 42 |
| Merged native types | 52: 43 corpus-supported, 9 preserve-only |
| Merged schema properties | 646: 528 supported, 118 editor-only |
| Effective property-matrix rows including runtime values/bootstrap | 664 |
| Camera property-panel entries | 24/24 matched to corpus serialization |
| Director/ActiveCamera/ActiveShot property-panel entries | 14 |
| EXE enum groups | 8 |
| Tangent tokens | 8; integer mapping not proven |
| Runtime functions/constants indexed | 142 / 45 |
| Full native StormCutscene files parsed | 1,488 |
| Native objects parsed | 96,040 |
| Animation blocks / scene lights parsed | 11,112 / 2,356 |
| Corpus XML/no-op round-trip failures | 0 / 0 |
| Automated tests | 76 PASS |
| L5 Editor runs | 0 — UNAVAILABLE on this Linux runner |
| L6 game runtime runs | 0 — UNAVAILABLE |

## What is editable now

- Byte-identical no-op parsing and source-span minimal edits; unknown nodes, attributes, ordering, comments and native precision are preserved.
- Atomic `cutscene.compose`/`cutscene.apply` with aliases, rollback, validation, semantic diff, dry-run, backup and atomic save.
- Native Camera and TargetCamera fields, including FOV, clips, DOF/focal data, near/far falloff, roll, vertical FOV, distance/yaw/pitch/height and eye/target XYZ.
- Director, active-camera/light tracks, shot starts proven by the inherited native `start` field, bookmarks and references. Shot end is represented by the next cut, not an invented `end` attribute.
- Animation layers and blocks: `anim`, EXE-confirmed `animId`, priority, original duration/move speed, looping/play flags, blend in/out, offset, `timeScale`, `weight`, EXE-confirmed `rightAligned`, and generic schema properties.
- Scene lights plus the EXE EnvironmentLight registry: tone mapping, colorization, terrain/creep, SSAO, key/fill/back directions and color multipliers.
- Fog, Text, Path/PathMarker, RTTChannel, ModelMaterial, HaloController, Sound/SoundGroup, Attachment, LookAt, Conversation and Fade through their native typed/generic registry entries.
- Dependency-aware asset lookup, Unit/Actor/Model graph resolution, custom paths, and exact M3/M3A `SEQS` animation plus `ATT_` attachment discovery when model bytes are available.

The main API remains compact. These capabilities are operations inside one `cutscene.apply`, not hundreds of MCP tools.

## Explicit unknowns

| Area | Status |
|---|---|
| 42 display-derived property XML names | `EDITOR_ONLY`; visible in schema, not claimed serializer-confirmed |
| 9 EXE-only XML node types absent from the corpus | `SUPPORTED_PRESERVE_ONLY`; generic construction is possible but native child/default rules are unproved |
| Tangent IDs for Custom/Fast/Flat/Linear/Slow/Smooth/Step/Auto | Tokens confirmed; integer mapping remains `UNKNOWN_NEEDS_RESEARCH` |
| Class inheritance/vtables/factories | Type and RTTI tokens recovered; COL/vtable/factory mapping not recovered |
| Active For Shot semantics | Native `CCutsceneNodeActiveShot` and its `cameraGUID/cameraIndex` are confirmed; complete multi-shot behavior needs differential Editor tests |
| Defaults, ranges, units and read-only flags | Not consistently present in the recovered string registry |
| EnvironmentLight creation | Schema-generic creation implemented; no corpus instance or L5 Editor execution yet |
| Packed MPQ/CASC write-back | External archive-adapter boundary only |
| L5/L6 | Never reported PASS unless an actual adapter executes successfully |

The last table is why this release remains alpha rather than “full v1”. `generated/cutscene-schema-gap.json` lists every EXE property and its exact status; nothing is silently dropped.
