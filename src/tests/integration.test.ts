import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { LayoutDocument } from "../core/layoutDocument.js";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

test("validates the advanced SC2 layout fixture through the cross-file VFS", async () => {
  const root = fileURLToPath(new URL("../../examples/", import.meta.url));
  const schema = await SchemaRegistry.loadBundled();
  const workspace = new Workspace(root, schema);
  const report = await workspace.validate("UI/Layout/Advanced.SC2Layout");
  assert.equal(report.errors, 0);
  assert.equal(report.valid, true);
  const resolver = await workspace.resolver();
  assert.equal(resolver.resolveTemplate("StandardTemplates/MCPButtonTemplate", "UI/Layout/Advanced.SC2Layout").found, true);
});

test("no-op reads do not alter a real-format fixture hash", async () => {
  const root = fileURLToPath(new URL("../../examples/", import.meta.url));
  const workspace = new Workspace(root);
  const first = await workspace.read("UI/Layout/Advanced.SC2Layout");
  const second = await workspace.read("UI/Layout/Advanced.SC2Layout");
  assert.equal(first.text, second.text);
  assert.equal(first.doc.sha256, second.doc.sha256);
});

test("round-trips an actual Blizzard Core layout fixture and preserves its bindings", async () => {
  const fixture = fileURLToPath(new URL("../../src/tests/fixtures/Core_IdleButton.SC2Layout", import.meta.url));
  const source = await fs.readFile(fixture, "utf8");
  const doc = new LayoutDocument(source);
  assert.equal(doc.source, source);
  assert.equal(doc.getAnimation("IdleButtonTemplate/GlowButton", "Glow")?.attrs.speed, "1");
  assert.ok(doc.getStateGroup("IdleButtonTemplate", "EnabledState"));
  doc.setProperty("IdleButtonTemplate/GlowButton", "Alpha", { value: 32 });
  assert.match(doc.source, /<Texture val="\{\$parent\/NormalImage\/@Texture\[0\]\}"\/>/);
  assert.match(doc.source, /<Alpha val="32"\/>/);
});
