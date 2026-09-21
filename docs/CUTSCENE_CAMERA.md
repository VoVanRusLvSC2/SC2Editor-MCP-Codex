# Camera and Director

## Runtime registry

The available `natives.galaxy` contains these automatically indexed camera values:

`FieldOfView`, `NearClip`, `FarClip`, `ShadowClip`, `Distance`, `Pitch`, `Yaw`, `Roll`, `HeightOffset`, `DepthOfField`, `FocalDepth`, `FalloffStart`, `FalloffEnd`, `FalloffStartNear`, `FalloffEndNear`.

It also contains `c_cameraPositionEye`, `c_cameraPositionTarget`, and `c_cameraPositionBoth`. Near falloff therefore has two fields beyond the baseline in the original requirement.

Runtime constants are not assumed to equal Cutscene Editor XML names. Runtime and serialization mappings remain separate.

## Confirmed serialization

The verified Blizzard file establishes `CCutsceneNodeDirector`, `CCutsceneNodeActiveCamera`, and `CCutsceneElementActiveCamera`, with `cameraIndex` and `objectGuid` on the active-camera element. It also establishes active-light and bookmark tracks.

The supplied Editor and corpus now confirm `CCutsceneNodeCamera`, `CCutsceneNodeTargetCamera`, the complete 24-entry Camera property cluster, and 53 unique effective camera fields after inherited/corpus entries are included. Consequently:

- `camera.create` accepts a confirmed native camera type and can emit its native duration child;
- `camera.pose` accepts every effective schema property in one operation;
- `shot.add` accepts confirmed native starts but refuses the unobserved `end` attribute;
- generic `object.add`, `timeline.add`, `keyframe.add` and `property.set` remain available for observed native structures.

This prevents plausible-looking but unproven `Camera`, `Keyframe`, or `FieldOfView` tags from entering a real map.

The authoritative per-property status is in [CUTSCENE_CAMERA_DISCOVERY.md](CUTSCENE_CAMERA_DISCOVERY.md) and `generated/camera-property-matrix.json`. Differential pairs are still required for defaults/ranges/units, DOF enum semantics, shake/look-at/follow composition, interpolation/tangent IDs and L5 Editor acceptance.
