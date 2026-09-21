import test from "node:test";
import assert from "node:assert/strict";
import { LayoutDocument } from "../core/layoutDocument.js";
import { validateLayout } from "../core/validator.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

test("accepts ColorAdjustMode Colorize with an additive image blend", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const doc = new LayoutDocument(`<?xml version="1.0"?>
<Desc><Frame type="Image" name="Glow"><ColorAdjustMode val="Colorize"/><AdjustmentColor val="255,225,0"/><BlendMode val="Add"/></Frame></Desc>`);
  const report = validateLayout("Glow.SC2Layout", doc, schema);
  assert.equal(report.diagnostics.some((item) => item.code === "property.colorize_wrong_channel"), false);
  assert.equal(report.diagnostics.some((item) => item.code === "property.color_adjustment_misnamed"), false);
  assert.equal(report.diagnostics.some((item) => item.code === "property.colorize_adjustment_missing"), false);
});

test("warns when Colorize has no AdjustmentColor tint", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const doc = new LayoutDocument(`<?xml version="1.0"?>
<Desc><Frame type="Image" name="Glow"><ColorAdjustMode val="Colorize"/><Color val="255,225,0"/><BlendMode val="Add"/></Frame></Desc>`);
  const report = validateLayout("Glow.SC2Layout", doc, schema);
  assert.ok(report.diagnostics.some((item) => item.code === "property.colorize_adjustment_missing"));
});

test("explains the two common Colorize property mistakes", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const doc = new LayoutDocument(`<?xml version="1.0"?>
<Desc><Frame type="Image" name="Glow"><ColorAdjustment val="Colorize"/><BlendMode val="Colorize"/></Frame></Desc>`);
  const report = validateLayout("Glow.SC2Layout", doc, schema);
  assert.ok(report.diagnostics.some((item) => item.code === "property.colorize_wrong_channel"));
  assert.ok(report.diagnostics.some((item) => item.code === "property.color_adjustment_misnamed"));
});
