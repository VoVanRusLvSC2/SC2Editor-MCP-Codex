import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { discoverCutsceneSchema } from "../modules/cutscene/discovery.js";
import { compareDecimalTime, parseCutsceneTime } from "../modules/cutscene/time.js";
import { scanEditorArtifacts } from "../modules/cutscene/editorDiscovery.js";
import { promises as fs } from "node:fs";
import os from "node:os";

test("discovery learns native nodes, properties and parent-child constraints from corpus", async () => {
  const schema = await discoverCutsceneSchema([path.resolve("src/tests/fixtures/cutscene")]);
  assert.equal(schema.corpus.parsedFiles, 2);
  assert.equal(schema.corpus.failedFiles, 0);
  assert.equal(schema.nodes.some((entry) => entry.nativeType === "CCutsceneElementActiveCamera"), true);
  assert.equal(schema.properties.some((entry) => entry.objectType === "CCutsceneNodeActor" && entry.xmlName === "futureAttribute"), true);
  assert.equal(schema.nodes.find((entry) => entry.nativeType === "CCutsceneNodeDirector")?.childTypes.includes("CCutsceneNodeBookmark"), true);
  assert.equal(schema.properties.some((entry) => entry.objectType === "CCutsceneElementAnim" && entry.xmlName === "timeScale"), true);
  assert.equal(schema.properties.some((entry) => entry.objectType === "CCutsceneElementAnim" && entry.xmlName === "weight"), true);
  assert.equal(schema.properties.find((entry) => entry.objectType === "CCutsceneNodePropertyValue" && entry.xmlName === "propertyName")?.enumValues?.includes("colorMultiplier"), true);
});

test("time parser keeps decimal text and large native ticks without IEEE-754 conversion", () => {
  assert.deepEqual(parseCutsceneTime("00:00:12.500"), { input: "00:00:12.500", unit: "timecode", decimalSeconds: "12.5" });
  assert.equal(parseCutsceneTime("18446744073709551615").nativeValue, "18446744073709551615");
  assert.equal(parseCutsceneTime("125ms").decimalSeconds, "0.125");
  assert.equal(compareDecimalTime("1.000000000000000001", "1.000000000000000002"), -1);
});

test("Editor/decompilation scan records candidates as research-needed rather than confirmed XML", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-editor-discovery-"));
  const file = path.join(root, "cutscene_symbols.txt");
  await fs.writeFile(file, "CCutsceneNodeCamera CCutsceneNodeCamera c_cameraValueFieldOfView Timeline Keyframe", "utf8");
  const result = await scanEditorArtifacts([root]);
  const candidate = result.nodeCandidates.find((entry) => entry.nativeType === "CCutsceneNodeCamera")!;
  assert.equal(candidate.category, "camera");
  assert.equal(candidate.coverage, "UNKNOWN_NEEDS_RESEARCH");
  assert.equal(candidate.confidence, "unknown");
  assert.equal(result.evidence.identifiers.find((entry) => entry.name === "CCutsceneNodeCamera")?.count, 2);
});
