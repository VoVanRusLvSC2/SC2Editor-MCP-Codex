# Cutscene MCP guide

## Recommended Codex workflow

1. Call `cutscene.context` once with the intended categories and optional batched asset queries.
2. Call `cutscene.compose` once for a new scene, or `cutscene.apply` once for an edit.
3. Use `dryRun:false, stage:false` when immediate validated atomic save is desired. Otherwise review the returned validation/diff and call `cutscene.save` later.
4. Before archive export, stage document scenes under `Base.SC2Data/Cutscenes` and call `cutscene.register_document`. Standalone scene authoring does not automatically register the native document component.
5. Use `cutscene.runtime.validate` only with an actual Editor/SC2 adapter.

`compose` and `apply` already validate and return semantic diff/status. Separate `validate` and `diff` calls are optional inspection tools, not mandatory steps.

| Tool | Purpose |
|---|---|
| `cutscene.context` | One compact scene/schema/assets/operation context for Codex |
| `cutscene.list_files` | List SC2Cutscene and StormCutscene resources |
| `cutscene.register_document` | Atomically register the native `cuts` component; preserve existing version metadata or require an exact Editor-produced template |
| `cutscene.create/open/inspect` | Create and read native documents/objects |
| `cutscene.compose` | One-call scene creation from confirmed native objects |
| `cutscene.apply` | Atomic batch editing; main modification API |
| `cutscene.validate/diff/save/export` | Review and commit safely |
| `cutscene.schema.inspect/coverage` | Provenance and coverage introspection |
| `cutscene.assets.search/inspect/status/refresh` | Catalog graph, extracted dependencies and custom asset files |
| `cutscene.animations.list` | Exact M3/M3A `SEQS` and `ATT_`, with honest partial fallback |
| `cutscene.runtime.validate` | External adapter only |
| `cutscene.runtime.generate_trigger` | Signature-gated Galaxy generation |

## Atomic apply

Document registration preserves all unrelated `ComponentList.SC2Components` bytes and appends only `DataComponent Type="cuts"` with logical root `Cutscenes/Index`. The logical root is not a fabricated XML file listing scenes: native saved documents carry `Base.SC2Data/Cutscenes/Index.version`. Its opaque bytes are preserved. When it is missing, supply `versionTemplate` pointing to an exact Editor-produced marker inside the workspace. No timestamps, counters or native version fields are invented. Archive export fails closed for unregistered native document scenes. Registration is offline only and does not prove that the Editor can open a scene or that it plays correctly.

```json
{"versionTemplate":".sc2mcp-cutscene-index.version-template","dryRun":false,"stage":false,"backup":true}
```

```json
{
  "file": "Cutscenes/Example.SC2Cutscene",
  "operations": [
    {
      "op": "object.add",
      "as": "marine",
      "object": {
        "nativeType": "CCutsceneNodeActor",
        "attrs": { "name": "Marine", "modelLink": "Marine" }
      }
    },
    {
      "op": "property.set",
      "object": "@marine",
      "path": "@shadowBox",
      "value": false
    }
  ],
  "dryRun": false,
  "stage": true,
  "validate": true
}
```

If operation 2 fails, operation 1 is neither staged nor written. The result includes aliases, validation and semantic diff.

Property paths end in an attribute: `@modelLink`, `SomeNativeChild/@value`, or a longer child chain. Unknown properties require `allowUnknown: true`; no unknown enum/property is replaced with a default.

An unrecognized native node is returned as `unknown-native-type` with complete attributes, exact raw XML, unknown child IDs and preservation metadata. It stays editable without joining a handwritten whitelist.

Creation/modification default to `dryRun=true` and `stage=true`. Existing files get `.sc2editormcp.bak`; final replacement uses a same-directory temporary file and atomic rename.

## Animation blocks, speed and weight

Animation editing is part of the same atomic `cutscene.apply`; it does not require a separate MCP tool call. `timeScale` and `weight` are independent native `CCutsceneElementAnim` attributes. Weight is not priority. The corpus contains real values such as `timeScale="0.500000"` and `weight="2.000000"`.

```json
{
  "file": "Cutscenes/AnimationLight.SC2Cutscene",
  "operations": [
    {
      "op": "animation.layer.add",
      "as": "baseAnim",
      "object": { "name": "Marine" },
      "name": "Animation Layer"
    },
    {
      "op": "animation.add",
      "as": "walk",
      "layer": "@baseAnim",
      "anim": "Walk",
      "duration": 4000,
      "originalDuration": 2000,
      "priority": 5,
      "looping": true,
      "timeScale": 0.5,
      "weight": 2,
      "blendTime": 250,
      "blendOutTime": 500
    }
  ],
  "dryRun": false,
  "stage": false,
  "validate": true
}
```

The generated element is native XML:

```xml
<CCutsceneElementAnim guid="..." duration="4000" originalDuration="2000"
    anim="Walk" priority="5" looping="1" blendTime="250" blendOutTime="500"
    timeScale="0.500000" weight="2.000000"/>
```

The complete observed animation-element schema is available through:

```json
{ "objectType": "CCutsceneElementAnim" }
```

Current fields include `start`, `duration`, `lockedToEnd`, `anim`, EXE-confirmed `animId`, `priority`, `originalDuration`, `looping`, `blendTime`, `blendOutTime`, `startOffset`, `timeScale`, `weight`, EXE-confirmed `rightAligned`, `playOnce`, `playForever`, `fullMatchLegacy`, `movespeed`, `originalMoveSpeed`, and native link fields. Extra fields are accepted only after they appear in the loaded schema.

## Native Cutscene lights

`CCutsceneNodeLight` is a scene light object. It is separate from `CCutsceneNodeActiveLight`, which selects either a scene light or a Lighting catalog preset in the Director.

```json
{
  "op": "light.add",
  "as": "keyLight",
  "name": "Key Light",
  "duration": 15000,
  "lockedToEnd": true,
  "properties": {
    "position": "0.000000,-4.000000,3.000000",
    "rotation": "45.000000,0.000000,0.000000",
    "type": 2,
    "colorR": 1,
    "colorG": 0.5,
    "colorB": 0.25,
    "colorMultiplier": 2,
    "attenuationStart": 4,
    "range": 8,
    "hotspot": 0.1,
    "falloff": 0.5,
    "shadowCasting": true,
    "specular": true
  }
}
```

All 27 light attributes observed in the current corpus are schema-driven: `ambientOcclusion`, `attenuationStart`, `colorR/G/B`, `colorMultiplier`, `enabled`, `falloff`, `filter`, `guid`, `hotspot`, `lightTransparent`, `locked`, `name`, `position`, `range`, `rotation`, `scale`, `shadowCasting`, `sortIndex`, `specular`, `specularColorR/G/B`, `specularColorMultiplier`, `type`, and `visible`.

Director lighting is also fully exposed for the observed schema. `CCutsceneNodeActiveLight` supports `enabled`, `filter`, `locked`, `minimumLightLevel`, `maximumLightLevel`, `name`, and `sortIndex`. Each `CCutsceneElementActiveLight` supports `start`, `lightGUID`, `lightID`, `lightIndex`, `blendTime`, `startLinkGuid`, and `startLinkAttachToPoint`. Use `light.activate` to add an event; use ordinary `property.set` for uncommon track metadata.

`light.add` also accepts `nativeType: "CCutsceneNodeEnvironmentLight"`. The supplied Editor exposes 65 fields covering time-of-day, HDR/tone mapping, colorization, terrain/creep, SSAO and key/fill/back lighting. They remain schema-driven inside the same operation:

```json
{
  "op": "light.add",
  "as": "kaldirLight",
  "nativeType": "CCutsceneNodeEnvironmentLight",
  "name": "Kaldir Night",
  "properties": {
    "timeOfDay": 20,
    "hdrExposure": 0.8,
    "colorizationSaturation": 0.7,
    "ssaoOcclusionRadius": 3.5,
    "keyDirectionX": 0.2,
    "keyDirectionY": -0.8,
    "keyDirectionZ": 0.5
  }
}
```

This representation passes L1–L4 locally. Because no EnvironmentLight instance exists in the current corpus and the Windows Editor was not executed here, it is explicitly not labelled L5 PASS.

Any observed light property can be animated with native property curves:

```json
{
  "op": "property.animate",
  "object": "@keyLight",
  "property": "colorMultiplier",
  "keyframes": [
    { "start": 0, "value": 0, "curveInType": 3, "curveOutType": 3 },
    { "start": 1000, "value": 2, "curveInType": 3, "curveOutType": 3 }
  ]
}
```

The operation writes `CCutsceneNodePropertyValue` and `CCutsceneElementPropertyCurve`. Native curve tokens and tangent values are preserved; the MCP does not replace unknown interpolation modes.

The Editor confirms tangent tokens `Custom`, `Fast`, `Flat`, `Linear`, `Slow`, `Smooth`, `Step`, and `Auto`. Their integer IDs are deliberately not guessed from string order; numeric `curveInType/curveOutType` remains the exact low-level representation until a descriptor or differential save proves the mapping.

## Standard and custom assets

The workspace and every extracted dependency directory from `SC2_ASSET_ROOTS` are indexed. Search covers every observed `C*` catalog class, Cutscene references, `.m3/.m3a`, textures, sounds, movies and path manifests. `cutscene.assets.inspect` follows Unit/Actor/Model-style reference chains; search/inspect results contain a `cutsceneUse` placement hint.

`actor.add` accepts a catalog Model ID or a custom model path and native transform values. Many `actor.add`, light and animation operations still fit in one atomic `cutscene.apply` call.

See [the Russian asset/location guide](CUTSCENE_ASSETS_RU.md) for the token-efficient Zerus/Kaldir workflow and the exact meaning of complete versus partial animation results.
