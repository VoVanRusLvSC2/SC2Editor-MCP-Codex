import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CutsceneDocument } from "../modules/cutscene/document.js";
import { CutsceneSchemaRegistry } from "../modules/cutscene/schemaRegistry.js";
import { applyCutsceneOperations } from "../modules/cutscene/operations.js";
import { validateCutscene } from "../modules/cutscene/validator.js";

const fixturePath = path.resolve("src/tests/fixtures/cutscene/VerifiedNativeExcerpt.SC2Cutscene");

test("Cutscene parser preserves exact native source and unknown extensions", async () => {
  const source = await fs.readFile(fixturePath, "utf8");
  const schema = await CutsceneSchemaRegistry.load(path.resolve("does-not-exist.json"));
  const doc = new CutsceneDocument(source, fixturePath);
  assert.equal(doc.source, source);
  assert.equal(doc.root().tag, "CutsceneState");
  const ir = doc.toIR(schema, true);
  const actor = ir.objects.find((entry) => entry.nativeType === "CCutsceneNodeActor")!;
  assert.equal(actor.extensions.unknownAttributes.some((entry) => entry.name === "futureAttribute"), true);
  assert.equal(actor.extensions.unknownChildren.length, 1);
  assert.match(actor.rawSource, /CCutsceneUnknownExtension/);
});

test("property.set patches one native attribute without rewriting comments or unknown children", async () => {
  const source = await fs.readFile(fixturePath, "utf8");
  const schema = await CutsceneSchemaRegistry.load(path.resolve("does-not-exist.json"));
  const doc = new CutsceneDocument(source);
  applyCutsceneOperations(doc, schema, [{ op: "property.set", object: "guid:10640950140912785768", path: "@modelLink", value: "MainMenuDefault2" }]);
  assert.equal(doc.resolve("guid:10640950140912785768").attrs.modelLink, "MainMenuDefault2");
  assert.match(doc.source, /futureAttribute="keep"/);
  assert.match(doc.source, /payload="keep-too"/);
  assert.match(doc.source, /This compact fixture uses native names/);
  const expected = source.replace('modelLink="MainMenuDefault"', 'modelLink="MainMenuDefault2"');
  assert.equal(doc.source, expected);
});

test("one apply supports aliases and native object creation", async () => {
  const schema = await CutsceneSchemaRegistry.load(path.resolve("does-not-exist.json"));
  const doc = CutsceneDocument.create({ name: "Alias test" });
  const result = applyCutsceneOperations(doc, schema, [
    { op: "object.add", as: "marine", object: { nativeType: "CCutsceneNodeActor", attrs: { name: "Marine", modelLink: "Marine" } } },
    { op: "property.set", object: "@marine", path: "@shadowBox", value: false },
  ]);
  assert.match(result.aliases.marine, /^guid:\d+$/);
  const actor = doc.resolve(result.aliases.marine);
  assert.equal(actor.attrs.shadowBox, "0");
  assert.equal(validateCutscene(doc, schema).valid, true);
});

test("raw.patch rejects malformed XML and rolls the in-memory document back", () => {
  const doc = CutsceneDocument.create();
  const before = doc.source;
  assert.throws(() => doc.rawPatch(doc.root().endTagStart, doc.root().endTagStart, "<Broken>"), /patch/);
  assert.equal(doc.source, before);
});

test("one apply creates native animation speed/weight, a light and an animated light property", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const doc = CutsceneDocument.create({ name: "Animation and light" });
  const result = applyCutsceneOperations(doc, schema, [
    { op: "object.add", as: "actor", object: { nativeType: "CCutsceneNodeActor", attrs: { name: "Marine", modelLink: "Marine" } } },
    { op: "animation.layer.add", as: "base", object: "@actor" },
    {
      op: "animation.add", as: "walk", layer: "@base", anim: "Walk", duration: 4000,
      animId: 7, originalDuration: 2000, priority: 5, looping: true, timeScale: 0.5, weight: 2, rightAligned: true,
      blendTime: 250, blendOutTime: 500,
    },
    {
      op: "light.add", as: "keyLight", name: "Key Light", duration: 4000, lockedToEnd: true,
      properties: {
        position: "0.000000,-4.000000,3.000000", rotation: "45.000000,0.000000,0.000000",
        type: 2, colorR: 1, colorG: 0.5, colorB: 0.25, colorMultiplier: 2,
        attenuationStart: 4, range: 8, hotspot: 0.1, falloff: 0.5,
      },
    },
    {
      op: "property.animate", as: "lightIntensity", object: "@keyLight", property: "colorMultiplier",
      keyframes: [
        { start: 0, time: 0, value: 0, curveInType: 3, curveOutType: 3 },
        { start: 1000, time: 1000, value: 2, curveInType: 3, curveOutType: 3 },
      ],
    },
  ]);
  assert.match(result.aliases.walk, /^guid:\d+$/);
  assert.match(result.aliases.keyLight, /^guid:\d+$/);
  assert.match(doc.source, /<CCutsceneElementAnim[^>]*timeScale="0\.500000"[^>]*weight="2\.000000"/);
  assert.match(doc.source, /<CCutsceneElementAnim[^>]*animId="7"[^>]*rightAligned="1"/);
  assert.match(doc.source, /<CCutsceneNodeLight[^>]*colorMultiplier="2\.000000"[^>]*attenuationStart="4\.000000"[^>]*range="8\.000000"/);
  assert.match(doc.source, /<CCutsceneNodePropertyValue[^>]*propertyName="colorMultiplier"/);
  assert.equal(doc.nodes.filter((node) => node.tag === "CCutsceneElementPropertyCurve").length, 2);
});

test("light.add exposes all EXE-discovered EnvironmentLight properties through one operation", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const doc = CutsceneDocument.create({ name: "Environment light" });
  applyCutsceneOperations(doc, schema, [{
    op: "light.add",
    nativeType: "CCutsceneNodeEnvironmentLight",
    name: "Kaldir Night",
    properties: {
      timeOfDay: 18.5,
      hdrExposure: 1.25,
      colorizationSaturation: 0.8,
      ssaoOcclusionRadius: 3.5,
      keyDirectionX: 0.2,
      keyDirectionY: -0.8,
      keyDirectionZ: 0.5,
    },
  }]);
  assert.match(doc.source, /<CCutsceneNodeEnvironmentLight[^>]*timeOfDay="18\.500000"/);
  assert.match(doc.source, /hdrExposure="1\.250000"/);
  assert.match(doc.source, /ssaoOcclusionRadius="3\.500000"/);
});

test("adding the first timeline child minimally expands a self-closing native object", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const doc = new CutsceneDocument(`<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="1.300000">\n    <!--preserve-->\n    <CCutsceneNodeActor guid="1" name="Marine" modelLink="Marine"/>\n</CutsceneState>\n`);
  applyCutsceneOperations(doc, schema, [{ op: "animation.layer.add", object: "guid:1" }]);
  assert.match(doc.source, /<!--preserve-->/);
  assert.match(doc.source, /<CCutsceneNodeActor[^>]*>\n {8}<CCutsceneNodeAnimLayer/);
  assert.match(doc.source, /<\/CCutsceneNodeActor>/);
});

test("adding another child reuses the closing-tag line indentation without accumulating spaces", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const doc = new CutsceneDocument(`<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="1.300000">\n    <CCutsceneNodeActor guid="1" name="Marine" modelLink="Marine">\n        <CCutsceneElementObject guid="2" duration="1000"/>\n    </CCutsceneNodeActor>\n</CutsceneState>\n`);
  applyCutsceneOperations(doc, schema, [{ op: "animation.layer.add", object: "guid:1" }]);
  assert.match(doc.source, /\n {8}<CCutsceneNodeAnimLayer[^\n]+\n {4}<\/CCutsceneNodeActor>/);
  assert.doesNotMatch(doc.source, /\n {12}<CCutsceneNodeAnimLayer/);
});

test("actor.add places catalog and custom model assets with native transforms", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const doc = CutsceneDocument.create({ name: "Zerus set" });
  const result = applyCutsceneOperations(doc, schema, [
    { op: "actor.add", as: "tree", name: "Zerus Tree", asset: { catalog: "Model", id: "ZerusTree" }, position: [10, 20, 0], rotation: [0, 0, 45], scale: [2, 2, 2] },
    { op: "actor.add", as: "custom", name: "Custom prop", asset: { catalog: "Model", path: "Assets/Custom/Prop.m3" }, position: "0.000000,2.000000,0.000000" },
  ]);
  assert.match(result.aliases.tree, /^guid:\d+$/);
  assert.match(doc.source, /name="Zerus Tree" modelLink="ZerusTree" position="10\.000000,20\.000000,0\.000000" rotation="0\.000000,0\.000000,45\.000000" scale="2\.000000,2\.000000,2\.000000"/);
  assert.match(doc.source, /name="Custom prop" modelPath="Assets\/Custom\/Prop\.m3"/);
});

test("fog.upsert and actor.face edit a formation in one compact apply", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const doc = CutsceneDocument.create({ name: "Role intro" });
  const result = applyCutsceneOperations(doc, schema, [
    { op: "actor.add", as: "left", modelLink: "Marine", position: [-2, 1, 0], rotation: [0, 0, 0] },
    { op: "actor.add", as: "right", modelLink: "Marine", position: [2, 1, 0], rotation: [0, 0, 0] },
    { op: "actor.face", actors: ["@left", "@right"], target: [0, -10, 1] },
    { op: "fog.upsert", as: "fog", name: "Peaceful fog", color: [0.04, 0.52, 0.62], falloff: 0.6, density: 0.02, startHeight: -1, duration: 8000, lockedToEnd: true },
  ]);
  assert.match(result.aliases.fog, /^guid:\d+$/);
  assert.match(doc.source, /<CCutsceneNodeFog[^>]*fogColor="0\.040000,0\.520000,0\.620000"[^>]*fogDensity="0\.020000"/);
  assert.match(doc.source, /<CCutsceneElementObject[^>]*duration="8000"[^>]*lockedToEnd="1"/);
  assert.match(doc.resolve(result.aliases.left).attrs.rotation, /^0\.000000,0\.000000,28[0-9]\./);
  assert.match(doc.resolve(result.aliases.right).attrs.rotation, /^0\.000000,0\.000000,25[0-9]\./);
});
