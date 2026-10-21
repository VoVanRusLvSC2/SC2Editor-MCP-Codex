# Codex Manual: Creating and Editing SC2Cutscene

Bridge version: `1.1.0-alpha.5`, Editor schema: `5.0.16.97563`.

## 1. Basic principle

Codex doesn't write `.SC2Cutscene` manually.

```text
намерение пользователя
→ cutscene.context
→ один cutscene.compose или cutscene.apply
→ schema/reference/semantic validation
→ minimal diff
→ atomic save
```

`compose/apply` works with the Cutscene Editor scene itself. Galaxy playback is not needed to create a camera, models, light, timeline or animation. `cutscene.runtime.*` is a separate optional check/integration boundary.

## 2. Cost-effective workflow

A new scene usually requires two challenges:

1. `cutscene.context` with categories and, if necessary, multiple `assetQueries`.
2. `cutscene.compose` with all objects/operations and `dryRun:false, stage:false`.

Editing the existing scene:

1. `cutscene.context` with `file`.
2. One `cutscene.apply` with all operations.

Separate `validate`, `diff`, `save` are needed only when the user wants a staged review. `apply/compose` already perform validation and return semantic diff. Benchmark: 20 changes - 2 tool calls instead of 24, saving 91.7%.

## 3. How to choose native types and properties

Don't guess. Use:

```json
{ "objectType": "CCutsceneNodeCamera" }
```

via `cutscene.schema.inspect`, or request categories `camera`, `animation`, `lighting` directly to `cutscene.context`.

Each field has `coverage` and provenance.

- `SUPPORTED`: Serialization occurs in native corpus or is more strongly confirmed.
- `EDITOR_ONLY` - Editor shows the field, but the exact XML/default/runtime behavior has not yet been proven.
- `SUPPORTED_PRESERVE_ONLY`: A class exists in EXE, but there is no corpus instance.
- `RUNTIME_ONLY` - Galaxy registry, not XML Cutscene
- `UNKNOWN_NEEDS_RESEARCH`: Use raw/native evidence only.

Do not turn `EDITOR_ONLY` into L5 promise. It is available through generic schema property, but the result should be checked in Editor.

## Assets and Locations of Zerus/Kaldir

First, perform one batched context:

```json
{
  "categories": ["actor", "camera", "lighting", "animation"],
  "assetQueries": [
    { "query": "Zerus", "types": ["Model", "Actor"] },
    { "query": "Kaldir", "types": ["Model", "Lighting"] },
    { "query": "Umojan Marine", "types": ["Unit", "Actor", "Model"] }
  ]
}
```

Use the returned `cutsceneUse.modelLink` or `modelPath`; do not invent an ID. For a particular model, call `cutscene.animations.list` only once. If M3/M3A is available, the `SEQS` list is accurate; `complete:false` means it is only a catalog/corpus fallback. `ATT_` attachment points are returned with the list.

Custom `.m3/.m3a` is supported via `modelPath`, and additional dependency roots are specified by `SC2_ASSET_ROOTS`.

## 5.Camera

The creation of the camera is included in the general batch:

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

For the eye/target camera, select `CCutsceneNodeTargetCamera` and `eyePositionX/Y/Z`, `targetPositionX/Y/Z` fields.

Cut is created by `shot.add`. The native shot has `start`; a separate `end` is not found in the corpus. The end of the shot is determined by the next cut or the end of the scene. Bridge does not write the fictional `end`.

## 6 Animation, speed and weight

```json
[
  {
    "op": "animation.layer.add",
    "as": "base",
    "object": "@marine",
    "name": "Base Animation"
  },
  {
    "op": "animation.add",
    "as": "walk",
    "layer": "@base",
    "anim": "Walk",
    "animId": 0,
    "duration": 6000,
    "originalDuration": 3000,
    "looping": true,
    "timeScale": 0.5,
    "weight": 2,
    "blendTime": 250,
    "blendOutTime": 250,
    "rightAligned": false,
    "lockedToEnd": true
  }
]
```

`timeScale=0.5` is playback speed; `weight=2` is layer/block weight; `priority` is a separate field. `animId` and `rightAligned` are found in Editor EXE. The name `anim` is chosen from `cutscene.animations.list` if M3 is available.

## 7. Lights.

Ordinary scene light. `CCutsceneNodeLight`All corpus fields (`type`, RGB, multiplier, attenuation/range, hotspot/falloff, shadow/specular, transforms `properties` operation `light.add`.

EnvironmentLight:

```json
{
  "op": "light.add",
  "as": "environment",
  "nativeType": "CCutsceneNodeEnvironmentLight",
  "name": "Kaldir Night",
  "properties": {
    "timeOfDay": 20,
    "hdrExposure": 0.8,
    "hdrBloomThreshold": 1.2,
    "hdrAmbientMultiplier": 0.35,
    "colorizationSaturation": 0.7,
    "ssaoOcclusionRadius": 3.5,
    "ssaoOcclusionPower": 1.4,
    "keyDirectionX": 0.2,
    "keyDirectionY": -0.8,
    "keyDirectionZ": 0.5
  }
}
```

Registry contains 65 EnvironmentLight fields: HDR/tone mapping, colorization, terrain/creep, SSAO, key/fill/back. The full list is obtained from schema, do not copy from prompt. Creation passes L1–L4, but before Windows A/B test is not considered L5 PASS.

`light.activate` adds a Director active-light event. This is different from creating the light object itself.

## 8 Property curves and tangents

`property.animate` creates `CCutsceneNodePropertyValue` and `CCutsceneElementPropertyCurve`. You can transfer native `start`, `time`, `value`, `curveInValue`, `curveOutValue`, `curveInType`, `curveOutType`.

Editor confirms eight tangent names: Custom, Fast, Flat, Linear, Slow, Smooth, Step, Auto. Their integer ID has not yet been proven. So Codex does not have to translate the name into a number in order of a list. It is allowed to save an existing number or use a number from a confirmed differential example.

## 9.Fog, Text, Path, RTT and Rare Types

- Fog: `CCutsceneNodeFog`, confirmed color XYZ, falloff, density, start height.
- Text: `CCutsceneNodeText`, native `text` plus inherited object/timeline fields.
- Path: `CCutsceneNodePath` + `CCutsceneNodePathMarker`; FollowPath exists as a separate node/element.
- RTT: `CCutsceneNodeRTTChannel`; class and `RTTChannel` field confirmed by EXE, full link workflow requires A/B test.
- ModelMaterial, HaloController, Attachment, LookAt, Conversation, Fade and Sound are all in the schema registry.

If high-level alias is not available, use `object.add`, `timeline.add` or `property.set` inside the same `cutscene.apply`.

## 10. Unknown preservation

If Blizzard Cutscene is opened and one camera field is changed, unknown attributes/nodes are not deleted. No-op byte-identical. Changing existing attribute replaces only its value span. Adding child uses existing newline/indent. `raw.patch`00 - only the latest escape hatch and rolls back in malformed XML.

## 11.Save and security

- `dryRun:true` – result/diff only
- `stage:true` - draft in memory
- `stage:false` + `dryRun:false` - validation and atomic disk commit in one call
- staged `cutscene.save` uses optimistic SHA-256, `.sc2editormcp.bak`, temp file and atomic rename.
- The error of any operation rolls back the entire batch.

## Ready-made verifiable example

- request: `examples/cutscene/editor_discovery/Request.json`;
- generated native XML: `examples/cutscene/editor_discovery/EditorDiscoveryDemo.SC2Cutscene`;
- generator: `npm run cutscene:example:editor`.

An example creates Director/shot, Camera, Marine, animation layer, animation speed/weight, EnvironmentLight and Fog with one set of operations. Its local validation is L1–L4 PASS, L5/L6 UNAVAILABLE.

## 13. Checklist Codex

```text
1. Создавай/редактируй сам SC2Cutscene через context + compose/apply.
2. Не используй Galaxy playback для построения сцены.
3. Не угадывай asset или animation ID.
4. Проси schema только для нужных object types/categories.
5. Собирай все изменения в один atomic batch с @aliases.
6. Не придумывай XML tags, shot.end и tangent IDs.
7. Сохраняй unknown native data.
8. Не называй L1–L4 validation Editor/runtime PASS.
9. Используй dry-run/stage или immediate atomic write с backup.
10. Сообщай пользователю все EDITOR_ONLY/PRESERVE_ONLY поля.
```
