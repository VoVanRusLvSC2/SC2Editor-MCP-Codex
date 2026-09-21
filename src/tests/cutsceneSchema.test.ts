import test from "node:test";
import assert from "node:assert/strict";
import { CutsceneSchemaRegistry } from "../modules/cutscene/schemaRegistry.js";

test("Camera schema exposes every indexed runtime value without pretending it is XML-supported", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const camera = schema.describe("Camera");
  const properties = camera.properties.filter((entry) => entry.objectType === "Camera");
  assert.equal(properties.length, 15);
  assert.equal(properties.every((entry) => entry.coverage === "RUNTIME_ONLY" && entry.observedInCorpus === 0), true);
  assert.equal(properties.some((entry) => entry.property === "FalloffStartNear"), true);
  assert.deepEqual(schema.data.enums.find((entry) => entry.name === "CameraPositionMode")?.values, ["Eye", "Target", "Both"]);
});

