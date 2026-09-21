import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CutsceneSchemaRegistry } from "../modules/cutscene/schemaRegistry.js";

test("checked-in editor evidence is pinned to the supplied read-only SC2Editor build", async () => {
  const build = JSON.parse(await fs.readFile(path.resolve("generated/editor-build.json"), "utf8")) as Record<string, unknown>;
  assert.equal(build.fileVersion, "5.0.16.97563");
  assert.equal(build.sha256, "9cab25db2b7dcfaaad207978b4eac07ec694f1f7cdbee4257d0db0845e14a164");
  assert.equal(build.architecture, "x64");
  assert.equal(build.readOnlyAnalysis, true);
});

test("editor discovery records native types, complete camera cluster and honest tangent uncertainty", async () => {
  const types = JSON.parse(await fs.readFile(path.resolve("generated/cutscene-object-types.json"), "utf8")) as { types: Array<{ nativeId: string }> };
  const camera = JSON.parse(await fs.readFile(path.resolve("generated/camera-property-matrix.json"), "utf8")) as { editorPropertyCluster: Array<{ property: string }>; properties: Array<{ property: string; status: string }> };
  const tangent = JSON.parse(await fs.readFile(path.resolve("generated/cutscene-tangent-modes.json"), "utf8")) as { enum: { values: Array<{ token: string; nativeId: number | null }> }; nativeIntegerIds: string };
  for (const type of ["CCutsceneNodeCamera", "CCutsceneNodeTargetCamera", "CCutsceneNodeFog", "CCutsceneNodeRTTChannel", "CCutsceneNodeText", "CCutsceneNodeEnvironmentLight"]) {
    assert.equal(types.types.some((entry) => entry.nativeId === type), true, type);
  }
  assert.equal(camera.editorPropertyCluster.length, 24);
  assert.equal(camera.editorPropertyCluster.every((entry) => camera.properties.some((property) => property.property === entry.property)), true);
  assert.equal(camera.properties.length >= 43, true);
  assert.equal(camera.properties.find((entry) => entry.property === "pitch")?.status, "SUPPORTED_TYPED");
  assert.deepEqual(tangent.enum.values.map((entry) => entry.token), ["Custom", "Fast", "Flat", "Linear", "Slow", "Smooth", "Step", "Auto"]);
  assert.equal(tangent.enum.values.every((entry) => entry.nativeId === null), true);
  assert.equal(tangent.nativeIntegerIds, "UNKNOWN_NEEDS_RESEARCH");
});

test("schema inspection returns inherited EXE properties for cameras, curves and environment lighting", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  assert.equal(schema.getNode("CCutsceneFrame"), undefined, "RTTI-only UI classes must not become XML nodes");
  const camera = schema.describe("CCutsceneNodeTargetCamera").properties;
  assert.equal(camera.some((entry) => entry.xmlName === "targetPositionZ"), true);
  assert.equal(camera.some((entry) => entry.xmlName === "falloffStartNear"), true);
  const environment = schema.describe("CCutsceneNodeEnvironmentLight").properties;
  assert.equal(environment.some((entry) => entry.xmlName === "ssaoOcclusionRadius"), true);
  assert.equal(environment.some((entry) => entry.xmlName === "colorizationSaturation"), true);
  const curve = schema.getProperty("CCutsceneElementPropertyCurve", "curveInType");
  assert.deepEqual(curve?.enumValues, ["Custom", "Fast", "Flat", "Linear", "Slow", "Smooth", "Step", "Auto"]);
});
