import test from "node:test";
import assert from "node:assert/strict";
import { LayoutDocument } from "../core/layoutDocument.js";

const base = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n    <Frame type="Frame" name="RootPanel">\n        <Width val="500"/>\n        <Height val="300"/>\n    </Frame>\n</Desc>\n`;

test("lists and reads frames", () => {
  const doc = new LayoutDocument(base);
  assert.equal(doc.listFrames()[0].path, "RootPanel");
  assert.equal(doc.getFrame("RootPanel").properties.Width, "500");
});

test("creates button without rewriting unrelated XML", () => {
  const doc = new LayoutDocument(base);
  doc.createButton({
    parentPath: "RootPanel",
    name: "StartButton",
    text: "START",
    width: 220,
    height: 60,
    anchors: [
      { side: "Right", relative: "$parent", pos: "Max", offset: -40 },
      { side: "Bottom", relative: "$parent", pos: "Max", offset: -40 },
    ],
  });
  const frame = doc.getFrame("RootPanel/StartButton");
  assert.equal(frame.type, "Button");
  assert.equal(frame.properties.Text, "START");
  assert.equal(frame.anchors.length, 2);
  assert.match(doc.source, /<Width val="500"\/>/);
});

test("sets property and anchor", () => {
  const doc = new LayoutDocument(base);
  doc.setSimpleProperty("RootPanel", "Width", 640);
  doc.setAnchor("RootPanel", { side: "Top", relative: "$parent", pos: "Min", offset: 10 });
  assert.equal(doc.getFrame("RootPanel").properties.Width, "640");
  assert.equal(doc.getFrame("RootPanel").anchors[0].side, "Top");
});

test("deletes frame subtree", () => {
  const doc = new LayoutDocument(base);
  doc.deleteFrame("RootPanel");
  assert.equal(doc.listFrames().length, 0);
});
