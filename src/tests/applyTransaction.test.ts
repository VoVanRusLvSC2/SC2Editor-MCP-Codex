import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

const source = `<?xml version="1.0"?>
<Desc>
    <!-- transaction must preserve me -->
</Desc>
`;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ui-apply-"));
  const file = "UI/Layout/Apply.SC2Layout";
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), source, "utf8");
  const schema = await SchemaRegistry.loadBundled();
  return { root, file, schema, workspace: new Workspace(root, schema) };
}

test("ui.apply stages an alias-aware frame, state and animation transaction in one result", async () => {
  const { root, file, workspace } = await fixture();
  const result = await workspace.apply(file, [
    { op: "create_frame", as: "panel", type: "Frame", name: "Panel" },
    { op: "create_frame", as: "button", parentPath: "@panel", type: "Button", name: "Accept" },
    { op: "set_property", framePath: "@button", property: "Text", value: "Accept" },
    { op: "set_anchor", framePath: "@button", anchor: { side: "Top", relative: "$parent", pos: "Mid", offset: 12 } },
    {
      op: "upsert_state_group",
      framePath: "@button",
      stateGroup: {
        name: "EnabledState",
        defaultState: "Enabled",
        states: [{ name: "Enabled", actions: [{ type: "SetProperty", attrs: { Enabled: true } }] }],
      },
    },
    {
      op: "upsert_animation",
      framePath: "@button",
      animation: {
        name: "Show",
        controllers: [{
          type: "Fade",
          frame: "$this",
          keys: [{ type: "Curve", time: 0, attrs: { value: 0 } }, { type: "Curve", time: 0.2, attrs: { value: 1 } }],
        }],
      },
    },
  ], { dryRun: false, stage: true });

  assert.equal(result.accepted, true);
  assert.equal(result.efficiency.toolCalls, 1);
  assert.equal(result.efficiency.operations, 6);
  assert.equal(result.validation?.valid, true);
  assert.deepEqual(result.aliases, { panel: "Panel", button: "Panel/Accept" });
  assert.equal(workspace.hasDraft(file), true);
  assert.equal(await fs.readFile(path.join(root, file), "utf8"), source);
  const draft = (await workspace.read(file)).text;
  assert.match(draft, /transaction must preserve me/);
  assert.match(draft, /<StateGroup name="EnabledState">/);
  assert.match(draft, /<Controller type="Fade" frame="\$this">/);
});

test("ui.apply is rollback-safe when a later operation fails", async () => {
  const { file, workspace } = await fixture();
  await assert.rejects(() => workspace.apply(file, [
    { op: "create_frame", as: "new", type: "Frame", name: "Temporary" },
    { op: "set_property", framePath: "@missing", property: "Width", value: 42 },
  ], { dryRun: false, stage: true }), /Unknown operation alias/);
  assert.equal(workspace.hasDraft(file), false);
  assert.equal((await workspace.read(file)).text, source);
});

test("dry-run ui.apply returns the complete diff but does not stage it", async () => {
  const { file, workspace } = await fixture();
  const result = await workspace.apply(file, [
    { op: "create_frame", type: "Frame", name: "Preview" },
  ], { dryRun: true });
  assert.equal(result.mutation.changed, true);
  assert.equal(result.mutation.dryRun, true);
  assert.match(result.mutation.preview ?? "", /Preview/);
  assert.equal(workspace.hasDraft(file), false);
});

test("compound property validation uses effective complex attribute types", async () => {
  const { file, schema, workspace } = await fixture();
  const description = schema.describeProperty("Image", "TextureCoords");
  assert.equal(description?.tableKey, "layer");
  assert.equal(description?.complexType?.attributes.find((item) => item.name === "top")?.type, "Real32");

  await assert.rejects(() => workspace.apply(file, [
    { op: "create_frame", as: "image", type: "Image", name: "Portrait" },
    {
      op: "set_property",
      framePath: "@image",
      property: "TextureCoords",
      attrs: { top: "not-a-number", left: 0, bottom: 1, right: 1, layer: 0 },
    },
  ]), /Expected real Real32/);
});
