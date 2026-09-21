import { LayoutDocument } from "../src/core/layoutDocument.js";
import { validateLayout } from "../src/core/validator.js";
import { SchemaRegistry } from "../src/schema/schemaRegistry.js";

const doc = new LayoutDocument(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n</Desc>\n`);

doc.createFrame({
  type: "Button",
  name: "PrimaryToggleButtonTemplate",
  template: "StandardTemplates/StandardButtonTemplate",
  properties: [
    { tag: "Width", value: 220 },
    { tag: "Height", value: 56 },
    { tag: "Text", value: "Отключить кнопку 2" },
    { tag: "Toggleable", value: true },
    { tag: "Toggled", value: false },
  ],
});
doc.upsertAnimation("PrimaryToggleButtonTemplate", {
  name: "ShowFade",
  events: [{ event: "OnShown", action: "Reset,Play", frame: "$this" }],
  controllers: [{
    type: "Fade",
    frame: "$this",
    end: "Pause",
    keys: [
      { type: "Curve", time: 0, attrs: { value: 0, out: "Fast" } },
      { type: "Curve", time: 0.3, attrs: { value: 255, in: "Slow" } },
    ],
  }],
});

doc.createFrame({
  type: "Button",
  name: "SecondaryButtonTemplate",
  template: "StandardTemplates/StandardButtonTemplate",
  properties: [
    { tag: "Width", value: 220 },
    { tag: "Height", value: 56 },
    { tag: "Text", value: "Кнопка 2" },
    { tag: "Enabled", value: true },
  ],
});

doc.createFrame({ type: "Frame", name: "GameUI/UIContainer", frameFile: "GameUI" });
doc.createFrame({
  parentPath: "GameUI~1UIContainer",
  type: "Frame",
  name: "MCPButtonDemo",
  properties: [{ tag: "Width", value: 500 }, { tag: "Height", value: 160 }],
  anchors: [
    { side: "Top", relative: "$parent", pos: "Mid", offset: -80 },
    { side: "Left", relative: "$parent", pos: "Mid", offset: -250 },
  ],
});
doc.createFrame({
  parentPath: "GameUI~1UIContainer/MCPButtonDemo",
  type: "Button",
  name: "Button1",
  template: "MCPButtonDemo/PrimaryToggleButtonTemplate",
  anchors: [
    { side: "Top", relative: "$parent", pos: "Min", offset: 16 },
    { side: "Left", relative: "$parent", pos: "Min", offset: 16 },
  ],
});
doc.createFrame({
  parentPath: "GameUI~1UIContainer/MCPButtonDemo",
  type: "Button",
  name: "Button2",
  template: "MCPButtonDemo/SecondaryButtonTemplate",
  anchors: [
    { side: "Top", relative: "$parent", pos: "Min", offset: 16 },
    { side: "Left", relative: "$parent/Button1", pos: "Max", offset: 16 },
  ],
});
doc.upsertStateGroup("GameUI~1UIContainer/MCPButtonDemo", {
  name: "ButtonLinkState",
  defaultState: "SecondEnabled",
  states: [
    {
      name: "SecondDisabled",
      when: [{ type: "Property", frame: "$this/Button1", attrs: { toggled: "True" } }],
      actions: [{ type: "SetProperty", frame: "$this/Button2", attrs: { enabled: "False" } }],
    },
    {
      name: "SecondEnabled",
      when: [{ type: "Property", frame: "$this/Button1", attrs: { toggled: "False" } }],
      actions: [{ type: "SetProperty", frame: "$this/Button2", attrs: { enabled: "True" } }],
    },
  ],
});

const schema = await SchemaRegistry.loadBundled();
const report = validateLayout("UI/Layout/MCPButtonDemo.SC2Layout", doc, schema);
console.error(JSON.stringify({ valid: report.valid, errors: report.errors, warnings: report.warnings }));
console.log(doc.source);
