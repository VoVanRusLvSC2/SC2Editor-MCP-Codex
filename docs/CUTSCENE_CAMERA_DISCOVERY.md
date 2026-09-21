# Camera discovery — SC2Editor 5.0.16.97563

This report is generated from the supplied x64 Editor plus the 1,488-file native StormCutscene corpus. Static evidence is pinned to SHA-256 `9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164`.

## Native camera types

| Native type | Meaning/status | Corpus observations |
|---|---|---:|
| `CCutsceneNodeBaseCamera` | EXE-confirmed base camera class; concrete serialization not observed | 0 |
| `CCutsceneNodeCamera` | Concrete game/orbit camera | 2,060 |
| `CCutsceneNodeTargetCamera` | Eye/target camera | 66 |
| `CCutsceneNodeActiveCamera` | Director camera-selection track, not a camera object | 1,357 |
| `CCutsceneElementActiveCamera` | A Director cut/shot event referencing a camera GUID | 1,447 |

No distinct `CCutsceneNodeGameCamera` token was found. “Game Camera” must not be invented as a fourth native class; for this build the confirmed concrete general camera is `CCutsceneNodeCamera`.

## Editor Camera property cluster

All 24 entries below are present in the Editor property/localization cluster and have exact XML matches in the corpus.

| Property/XML attribute | Type | Runtime name match | Status |
|---|---|---|---|
| `fov` | Decimal/angle | `c_cameraValueFieldOfView` | `SUPPORTED_TYPED` |
| `nearClip` | Decimal | `c_cameraValueNearClip` | `SUPPORTED_TYPED` |
| `farClip` | Decimal | `c_cameraValueFarClip` | `SUPPORTED_TYPED` |
| `shadowClip` | Decimal | `c_cameraValueShadowClip` | `SUPPORTED_TYPED` |
| `depthOfField` | Native decimal toggle/value | `c_cameraValueDepthOfField` | `SUPPORTED_TYPED` |
| `focalDepth` | Decimal | `c_cameraValueFocalDepth` | `SUPPORTED_TYPED` |
| `falloffStart` | Decimal | `c_cameraValueFalloffStart` | `SUPPORTED_TYPED` |
| `falloffEnd` | Decimal | `c_cameraValueFalloffEnd` | `SUPPORTED_TYPED` |
| `falloffStartNear` | Decimal | `c_cameraValueFalloffStartNear` | `SUPPORTED_TYPED` |
| `falloffEndNear` | Decimal | `c_cameraValueFalloffEndNear` | `SUPPORTED_TYPED` |
| `fstop` | Decimal | — | `SUPPORTED_TYPED` |
| `maxcoc` | Decimal | — | `SUPPORTED_TYPED` |
| `doftype` | Native numeric selector | — | `SUPPORTED_TYPED` |
| `roll` | Decimal/angle | `c_cameraValueRoll` | `SUPPORTED_TYPED` |
| `verticalFOV` | Native bool/int | — | `SUPPORTED_TYPED` |
| `distance` | Decimal | `c_cameraValueDistance` | `SUPPORTED_TYPED` |
| `yaw` | Decimal/angle | `c_cameraValueYaw` | `SUPPORTED_TYPED` |
| `heightOffset` | Decimal | `c_cameraValueHeightOffset` | `SUPPORTED_TYPED` |
| `eyePositionX/Y/Z` | Three decimals | camera-position runtime API, not one-to-one proven | `SUPPORTED_TYPED` |
| `targetPositionX/Y/Z` | Three decimals | camera-position runtime API, not one-to-one proven | `SUPPORTED_TYPED` |

The complete effective matrix contains 53 unique names: 35 corpus-supported and 18 inherited/EXE-only preserve/generic fields. It includes shared/inherited `pitch`, `position`, `rotation`, `scale`, visibility/filter/locking, terrain behavior and reference fields. See `generated/camera-property-matrix.json`; do not treat the 24 declared Camera labels as the entire effective property set.

Runtime name matches are candidates, not proof that Galaxy units/defaults equal Cutscene serialization. The two registries remain separate.

## Creation in one apply

```json
{
  "op": "camera.create",
  "as": "wide",
  "id": "Wide Camera",
  "nativeType": "CCutsceneNodeCamera",
  "duration": 15000,
  "lockedToEnd": true,
  "properties": {
    "position": "8.000000,-12.000000,2.000000",
    "fov": 45,
    "nearClip": 0.1,
    "farClip": 600,
    "shadowClip": 75,
    "depthOfField": 1,
    "focalDepth": 12,
    "falloffStart": 1,
    "falloffEnd": 8,
    "distance": 15,
    "pitch": 18,
    "yaw": 135,
    "roll": 0,
    "heightOffset": 1.5
  }
}
```

`camera.create` emits the proven `CCutsceneElementObject duration/lockedToEnd` child when a duration is supplied. `camera.pose` applies many validated properties to an existing camera in the same transaction.

Director cuts use `CCutsceneElementActiveCamera objectGuid="…" cameraIndex="0"`. Their `start` is the cut time. No native `end` attribute has been observed; a shot ends at the next active-camera element or scene end, so the MCP refuses to invent one.

## Remaining proof work

- Recover `CCutsceneNodeBaseCamera` inheritance through MSVC COL/vtable metadata.
- Determine DOF type enum names/defaults and exact UI ranges/units.
- Determine camera shake/follow/look-at composition where represented by sibling native nodes rather than Camera attributes.
- Run controlled A/B Editor saves for every property/default and L5 import/open.
- Execute L6 game playback only through a configured adapter; static validation is not runtime PASS.
