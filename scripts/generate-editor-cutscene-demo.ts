import { promises as fs } from "node:fs";
import path from "node:path";
import { CutsceneDocument } from "../src/modules/cutscene/document.js";
import { applyCutsceneOperations } from "../src/modules/cutscene/operations.js";
import { CutsceneSchemaRegistry } from "../src/modules/cutscene/schemaRegistry.js";
import type { CutsceneOperation } from "../src/modules/cutscene/types.js";
import { validateCutscene } from "../src/modules/cutscene/validator.js";

const outputDirectory = path.resolve("examples/cutscene/editor_discovery");
const schema = await CutsceneSchemaRegistry.load();
const document = CutsceneDocument.create({ name: "EditorDiscoveryDemo", version: "1.300000" });
const operations: CutsceneOperation[] = [
  { op: "object.add", as: "director", object: { nativeType: "CCutsceneNodeDirector", attrs: { name: "Director", interactive: false, autoDestroyOnEnd: true, waitForResources: true } } },
  { op: "timeline.add", as: "cameraTrack", parent: "@director", node: { nativeType: "CCutsceneNodeActiveCamera", attrs: { name: "Active Camera", sortIndex: 0 } } },
  {
    op: "camera.create", as: "wide", id: "Wide Camera", nativeType: "CCutsceneNodeCamera", duration: 6000, lockedToEnd: true,
    properties: {
      position: "8.000000,-12.000000,2.000000", fov: 45, nearClip: 0.1, farClip: 600,
      shadowClip: 75, depthOfField: 1, focalDepth: 12, falloffStart: 1, falloffEnd: 8,
      distance: 15, pitch: 18, yaw: 135, roll: 0, heightOffset: 1.5,
    },
  },
  { op: "shot.add", as: "openingShot", camera: "@wide", start: "0" },
  { op: "actor.add", as: "marine", name: "Marine", modelLink: "Marine", position: [0, 0, 0], duration: 6000, lockedToEnd: true },
  { op: "animation.layer.add", as: "baseAnim", object: "@marine", name: "Base Animation", enabled: true, sortIndex: 0 },
  {
    op: "animation.add", as: "walk", layer: "@baseAnim", anim: "Walk", animId: 0,
    duration: 6000, originalDuration: 3000, looping: true, timeScale: 0.5, weight: 2,
    blendTime: 250, blendOutTime: 250, rightAligned: false, lockedToEnd: true,
  },
  {
    op: "light.add", as: "environment", nativeType: "CCutsceneNodeEnvironmentLight", name: "Kaldir Night",
    properties: {
      timeOfDay: 20, hdrExposure: 0.8, hdrBloomThreshold: 1.2, hdrAmbientMultiplier: 0.35,
      colorizationSaturation: 0.7, ssaoOcclusionRadius: 3.5, ssaoOcclusionPower: 1.4,
      keyDirectionX: 0.2, keyDirectionY: -0.8, keyDirectionZ: 0.5,
    },
  },
  {
    op: "object.add", as: "fog", object: {
      nativeType: "CCutsceneNodeFog",
      attrs: { name: "Cold Fog", fogColorX: 0.3, fogColorY: 0.45, fogColorZ: 0.65, fogDensity: 0.08, fogFalloff: 0.5, fogStartHeight: 0 },
      children: [{ nativeType: "CCutsceneElementObject", attrs: { duration: 6000, lockedToEnd: true } }],
    },
  },
];

const result = applyCutsceneOperations(document, schema, operations);
const validation = validateCutscene(document, schema);
if (!validation.valid) throw new Error(JSON.stringify(validation.diagnostics, null, 2));
await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, "Request.json"), `${JSON.stringify({ file: "Cutscenes/EditorDiscoveryDemo.SC2Cutscene", operations, validate: true, dryRun: false, stage: false }, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(outputDirectory, "EditorDiscoveryDemo.SC2Cutscene"), document.source, "utf8");
console.log(JSON.stringify({ outputDirectory, aliases: result.aliases, validation: validation.levels }, null, 2));
