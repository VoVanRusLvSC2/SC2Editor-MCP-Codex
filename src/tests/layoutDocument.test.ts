import test from "node:test";
import assert from "node:assert/strict";
import { LayoutDocument } from "../core/layoutDocument.js";

const base = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n    <Frame type="Frame" name="RootPanel">\n        <Width val="500"/>\n        <Height val="300"/>\n    </Frame>\n</Desc>\n`;

test("inline layouts retain a single root when adding includes, frames and properties", () => {
  for (const source of ["<Desc></Desc>", '<Desc><Frame type="Frame" name="Existing"></Frame></Desc>']) {
    const doc = new LayoutDocument(source);
    doc.addInclude("New.SC2Layout");
    doc.createFrame({ type: "Frame", name: "Added" });
    doc.setSimpleProperty("Added", "Width", 120);
    assert.equal(doc.diagnostics.filter(item => item.severity === "error").length, 0);
    assert.equal(doc.getFrame("Added").properties.Width, "120");
    assert.ok(doc.source.indexOf("<Include") > doc.source.indexOf("<Desc>"));
    assert.ok(doc.source.indexOf("<Include") < doc.source.indexOf("<Frame"));
    if (source.includes("Existing")) assert.equal(doc.getFrame("Existing").name, "Existing");
  }
});

test("lists and reads frames", () => {
  const doc = new LayoutDocument(base);
  assert.equal(doc.listFrames()[0].path, "RootPanel");
  assert.equal(doc.getFrame("RootPanel").properties.Width, "500");
});

test("prepared frame paths and summaries follow every edit and cannot be changed by returned lists", () => {
  const doc = new LayoutDocument(base),
    list = doc.listFrames();
  list[0].name = "Poison";
  list.length = 0;
  assert.equal(doc.listFrames()[0].name, "RootPanel");
  doc.createFrame({ type: "Frame", name: "Child", parentPath: "RootPanel" });
  assert.deepEqual(
    doc.listFrames().map((frame) => frame.path),
    ["RootPanel", "RootPanel/Child"],
  );
  doc.setSimpleProperty("RootPanel/Child", "Handle", "ChildHandle");
  assert.equal(doc.listFrames()[1].handle, "ChildHandle");
  doc.deleteFrame("RootPanel/Child");
  assert.equal(doc.listFrames().length, 1);
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
