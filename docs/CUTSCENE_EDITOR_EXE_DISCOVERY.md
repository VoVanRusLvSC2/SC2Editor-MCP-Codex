# SC2Editor executable discovery

## Identity and safety

The analyzed input is `SC2Editor_x64.exe`, version `5.0.16.97563`, product `SC2Edit (Retail)`, x64 PE32+, 76,470,480 bytes. SHA-256 is `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`. Its COFF timestamp is `2026-07-15T02:29:52Z`; its PDB path identifies branch `SC2.5.0.a`.

The discovery command performs read-only file access. It does not execute, patch, inject into, rewrite or redistribute the Blizzard binary.

```bash
npm run cutscene:discover:editor -- /absolute/path/SC2Editor_x64.exe
```

## Pipeline

1. Parse DOS/COFF/PE32+ headers and section mappings.
2. Compute SHA-256 and extract version-resource/PDB evidence.
3. Extract ASCII and UTF-16LE strings with file offsets.
4. Convert file offsets to PE RVAs.
5. Extract MSVC Cutscene RTTI names.
6. Recover the contiguous `Cutscenes/Category`, `Cutscenes/Property`, `Cutscenes/PathElement` and `Cutscenes/Value` registry clusters.
7. Pair display keys with adjacent internal tokens where present.
8. Cross-check every candidate XML name against all 1,488 parsed native scenes.
9. Merge the evidence without overriding stronger corpus provenance.
10. Generate an explicit gap report and property matrix.

## Generated artifacts

| File | Contents |
|---|---|
| `generated/editor-build.json` | PE identity, versions, timestamp, image base, sections and hash |
| `generated/cutscene-object-types.json` | 61 Cutscene type/class candidates: 51 XML-name records and 10 RTTI-only base/UI classes |
| `generated/cutscene-properties.json` | 299 property entries with category, candidate XML name, type and confidence |
| `generated/editor-rtti-cutscene.json` | 59 MSVC Cutscene class records |
| `generated/camera-property-matrix.json` | 24 declared Camera entries plus 53 effective properties across camera variants |
| `generated/cutscene-tangent-modes.json` | Eight confirmed tangent tokens and explicit unknown numeric IDs |
| `generated/cutscene-schema-gap.json` | Editor-versus-MCP status for every recovered property |
| `generated/ui-editor-evidence.json` | Supplementary 654 UI Frame/FrameDesc string/RTTI candidates cross-checked with UI schema |
| `generated/cutscene-schema.json` | Merged runtime registry used by MCP |

## Object registry result

The EXE confirms scene/timeline classes beyond the original small bootstrap: Camera/BaseCamera/TargetCamera, Director/ActiveCamera/ActiveShot/ActiveLight, Actor, AnimLayer, Sound/SoundGroup/MasterSound, Conversation/ConversationDriver, Light/EnvironmentLight, Attachment/LookAt, Path/PathMarker/FollowPath, Fog, RTTChannel, Text, Fade, Bookmark, ModelMaterial, HaloController, M3A, File, Folder, property curves/values, root and generic node/object classes.

Nine XML-name types have no instance in the materialized corpus. They remain `SUPPORTED_PRESERVE_ONLY`; their class token is real, but default values, required children and Editor acceptance are not fabricated. Ten RTTI-only classes such as `CCutsceneNode`, `CCutsceneElement`, `CCutsceneFrame` and `CCutsceneField` stay in the evidence/class graph and are not incorrectly exposed as concrete XML nodes.

## Property registry result

Of 299 property-panel entries:

- 181 have exact corpus XML matches;
- 67 have adjacent internal-name tokens in the same Editor registry block;
- 9 EnvironmentLight names match internal tokens from its registry cluster;
- 42 currently have only display-derived XML candidates.

All 299 are inspectable. The last 42 are not silently treated as serializer truth: they have `EDITOR_ONLY`/name-needs-proof status in the generated reports. Existing unknown native XML remains losslessly preserved regardless of registry status.

## Why factory/vtable fields are null

The current targeted scan found the RTTI strings but no direct absolute or ordinary RIP-relative references from code to the property localization strings. That is consistent with an indirection/hash/string-table registration path, but the reason has not been proven. The project therefore does not invent function, vtable or factory addresses. A future pass can recover MSVC Complete Object Locators and analyze the decompilation report if supplied.

## Next differential experiments

The highest-value Windows-side A/B saves are:

1. all eight tangent selections to bind token → integer ID;
2. the 42 display-derived properties, especially `attenuationFar`;
3. EnvironmentLight creation and one-field-at-a-time edits;
4. `CCutsceneNodeBaseCamera` and any “Game Camera” UI command;
5. Active For Shot ranges and multiple-camera overlap behavior;
6. DOF type values/defaults and camera ranges/units;
7. RTTChannel creation and material/camera linkage;
8. Text style/localization behavior.

Each experiment should use temporary copies and `npm run cutscene:diff-experiment -- before after`. L5 becomes PASS only when the exact produced file is opened/saved successfully by this Editor build.
