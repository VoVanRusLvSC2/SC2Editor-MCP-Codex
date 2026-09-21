import test from "node:test";
import assert from "node:assert/strict";
import { LayoutDocument } from "../core/layoutDocument.js";

const source = `<?xml version="1.0"?>
<Desc>
    <!-- keep comment -->
    <Frame type="Image" name="Layered" future="yes">
        <Texture val='A' layer="0" unknown="keep"/>
        <Texture val="B" layer="1"/>
        <FutureNode foo="bar"><Nested/></FutureNode>
    </Frame>
</Desc>
`;

test("round trip without mutation is byte identical", () => {
  const doc = new LayoutDocument(source);
  assert.equal(doc.source, source);
  assert.equal(doc.diagnostics.length, 0);
});

test("patches only a selected attribute and preserves quotes/unknown data", () => {
  const doc = new LayoutDocument(source);
  doc.setProperty("Layered", "Texture", { value: "Changed", selector: { layer: 0 } });
  assert.match(doc.source, /<Texture val='Changed' layer="0" unknown="keep"\/>/);
  assert.match(doc.source, /<!-- keep comment -->/);
  assert.match(doc.source, /<FutureNode foo="bar"><Nested\/><\/FutureNode>/);
  assert.equal(doc.getProperty("Layered", "Texture", { layer: 1 })[0].attrs.val, "B");
});

test("creates arbitrary forward-compatible frame types", () => {
  const doc = new LayoutDocument(source);
  doc.createFrame({
    parentPath: "Layered",
    type: "FutureFrameType",
    name: "Child",
    properties: [{ tag: "FutureProperty", attrs: { val: "x", index: 2 } }],
  });
  assert.equal(doc.getFrame("Layered/Child").type, "FutureFrameType");
  assert.equal(doc.getProperty("Layered/Child", "FutureProperty")[0].attrs.index, "2");
});

test("upserts StateGroup and animation structures", () => {
  const doc = new LayoutDocument(source);
  doc.upsertStateGroup("Layered", {
    name: "Availability",
    defaultState: "Enabled",
    states: [
      { name: "Enabled", actions: [{ type: "SetProperty", attrs: { Enabled: true } }] },
      { name: "Disabled", actions: [{ type: "SetProperty", attrs: { Enabled: false } }] },
    ],
  });
  doc.upsertAnimation("Layered", {
    name: "Open",
    controllers: [{
      type: "Fade",
      frame: "$this",
      keys: [
        { type: "Curve", time: 0, attrs: { value: 0 } },
        { type: "Curve", time: 0.2, attrs: { value: 1 } },
      ],
    }],
  });
  assert.equal(doc.getStateGroup("Layered", "Availability")?.children.filter((item) => item.tag === "State").length, 2);
  assert.equal(doc.getAnimation("Layered", "Open")?.children[0].attrs.type, "Fade");
  assert.match(doc.source, /<Action type="SetProperty" Enabled="false"\/>/);
});

test("clones a subtree and applies a template by minimal opening-tag patch", () => {
  const doc = new LayoutDocument(source);
  doc.cloneFrame("Layered", { name: "LayeredCopy" });
  doc.applyTemplate("LayeredCopy", "StandardTemplates/Image");
  assert.equal(doc.listFrames().length, 2);
  assert.equal(doc.getFrame("LayeredCopy").template, "StandardTemplates/Image");
  assert.match(doc.getFrame("LayeredCopy").source, /future="yes"/);
});

test("creates an oversized child image clipped by a viewport", () => {
  const doc = new LayoutDocument(source);
  doc.createClippedImage({
    name: "PortraitViewport",
    texture: "Assets/Portrait.dds",
    viewportWidth: 200,
    viewportHeight: 100,
    imageWidth: 640,
    imageHeight: 360,
    offsetX: -120,
    offsetY: -40,
    textureType: "Normal",
    textureCoords: { top: 0.1, left: 0.2, bottom: 0.9, right: 0.8 },
  });
  const image = doc.getFrame("PortraitViewport/Image");
  assert.equal(image.type, "Image");
  assert.equal(image.properties.Unclipped, "false");
  assert.deepEqual(doc.getProperty("PortraitViewport/Image", "TextureType")[0].attrs, { val: "Normal", layer: "0" });
  assert.deepEqual(doc.getProperty("PortraitViewport/Image", "TextureCoords")[0].attrs, {
    top: "0.1", left: "0.2", bottom: "0.9", right: "0.8", layer: "0",
  });
  assert.match(doc.source, /<FutureNode foo="bar"><Nested\/><\/FutureNode>/);
});

test("adds and removes Include with minimal patches and duplicate protection", () => {
  const doc = new LayoutDocument(source);
  doc.addInclude("UI/Layout/NewPanel.SC2Layout");
  const once = doc.source;
  assert.match(once, /<!-- keep comment -->\n[ ]{4}<Include path="UI\/Layout\/NewPanel\.SC2Layout"\/>/);
  doc.addInclude("ui\\layout\\newpanel.sc2layout");
  assert.equal(doc.source, once);
  doc.removeInclude("UI/Layout/NewPanel.SC2Layout");
  assert.equal(doc.source, source);
});

test("supports escaped semantic paths for SC2 cross-file descriptor overrides", () => {
  const doc = new LayoutDocument(source);
  doc.createFrame({ type: "Frame", name: "GameUI/UIContainer", frameFile: "GameUI" });
  const frame = doc.getFrame("GameUI~1UIContainer");
  assert.equal(frame.name, "GameUI/UIContainer");
  assert.equal(frame.file, "GameUI");
  assert.equal(doc.getFrame("GameUI/UIContainer").path, "GameUI~1UIContainer");
});
