import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { dispatchGuiApi } from "../gui/api.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

const source = `<?xml version="1.0"?>
<Desc>
    <!-- GUI must retain this comment -->
    <Frame type="Frame" name="Root">
        <Width val="100"/>
    </Frame>
</Desc>
`;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ui-gui-"));
  const file = "UI/Layout/Test.SC2Layout";
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), source, "utf8");
  const schema = await SchemaRegistry.loadBundled();
  return { root, file, schema, workspace: new Workspace(root, schema) };
}

test("GUI API reads schema-aware frames and stages minimal property edits", async () => {
  const { root, file, schema, workspace } = await fixture();
  const health = await dispatchGuiApi(workspace, schema, { method: "GET", pathname: "/api/health" });
  assert.equal(health.status, 200);
  assert.equal((health.body as { frameTypes: number }).frameTypes, 892);

  const frame = await dispatchGuiApi(workspace, schema, {
    method: "GET",
    pathname: "/api/frame",
    query: new URLSearchParams({ file, path: "Root" }),
  });
  assert.equal(frame.status, 200);
  assert.equal((frame.body as any).type.classType, "CFrame");

  const mutation = await dispatchGuiApi(workspace, schema, {
    method: "POST",
    pathname: "/api/property/set",
    body: { file, framePath: "Root", property: "Width", value: 240, dryRun: false, stage: true },
  });
  assert.equal(mutation.status, 200);
  assert.equal(workspace.hasDraft(file), true);
  assert.equal(await fs.readFile(path.join(root, file), "utf8"), source);
  const draft = (await workspace.read(file)).text;
  assert.match(draft, /<Width val="240"\/>/);
  assert.match(draft, /GUI must retain this comment/);

  const validation = await dispatchGuiApi(workspace, schema, {
    method: "GET",
    pathname: "/api/validate",
    query: new URLSearchParams({ file }),
  });
  assert.equal((validation.body as { valid: boolean }).valid, true);

  const saved = await dispatchGuiApi(workspace, schema, {
    method: "POST",
    pathname: "/api/save",
    body: { file, backup: true },
  });
  assert.equal(saved.status, 200);
  assert.match(await fs.readFile(path.join(root, `${file}.sc2uimcp.bak`), "utf8"), /Width val="100"/);
});

test("GUI API blocks locked frames by default and supports typed staged child creation", async () => {
  const { file, schema, workspace } = await fixture();
  const locked = await dispatchGuiApi(workspace, schema, {
    method: "POST",
    pathname: "/api/frame/create",
    body: { file, parentPath: "Root", type: "LaunchURLButton", name: "Unsafe", dryRun: false, stage: true },
  });
  assert.equal(locked.status, 400);
  assert.match((locked.body as { error: string }).error, /Blizzard-only\/locked/);

  const created = await dispatchGuiApi(workspace, schema, {
    method: "POST",
    pathname: "/api/frame/create",
    body: {
      file,
      parentPath: "Root",
      type: "Button",
      name: "Accept",
      template: "StandardTemplates/StandardButtonTemplate",
      properties: [{ tag: "Text", value: "Accept" }],
      dryRun: false,
      stage: true,
    },
  });
  assert.equal(created.status, 200);
  assert.equal((created.body as any).templateUsage.kind, "ordinary-template");
  assert.match((await workspace.read(file)).text, /<Frame type="Button" name="Accept"/);
});

test("GUI offers Blizzard container presets without restricting custom container overrides", async () => {
  const { file, schema, workspace } = await fixture();
  const presets = await dispatchGuiApi(workspace, schema, { method: "GET", pathname: "/api/containers" });
  assert.equal(presets.status, 200);
  assert.equal((presets.body as any).customAllowed, true);
  assert.ok((presets.body as any).presets.some(
    (item: any) => item.name === "GameUI/UIContainer/FullscreenUpperContainer",
  ));

  const created = await dispatchGuiApi(workspace, schema, {
    method: "POST",
    pathname: "/api/frame/create",
    body: {
      file,
      type: "Frame",
      name: "GameUI/UIContainer/FullscreenUpperContainer",
      frameFile: "GameUI",
      dryRun: false,
      stage: true,
    },
  });
  assert.equal(created.status, 200);
  assert.match(
    (await workspace.read(file)).text,
    /name="GameUI\/UIContainer\/FullscreenUpperContainer" file="GameUI"/,
  );
});

test("GUI static workbench contains the frame inspector and safe staged controls", async () => {
  const publicRoot = path.resolve(process.cwd(), "src/gui/public");
  const [page, script, styles] = await Promise.all([
    fs.readFile(path.join(publicRoot, "index.html"), "utf8"),
    fs.readFile(path.join(publicRoot, "app.js"), "utf8"),
    fs.readFile(path.join(publicRoot, "styles.css"), "utf8"),
  ]);
  assert.match(page, /SC2 UI Workbench/);
  assert.match(page, /Save \+ backup/);
  assert.match(script, /\/api\/property\/set/);
  assert.match(script, /\/api\/apply/);
  assert.match(page, /StateGroup builder/);
  assert.match(page, /Animation builder/);
  assert.match(page, /Attach UI container/);
  assert.match(page, /Reset \+ play on OnShown/);
  assert.match(page, /compound\/table property/);
  assert.match(script, /Save blocked by validation errors/);
  assert.match(script, /\/api\/containers/);
  assert.match(styles, /--blue:/);
});

test("GUI exposes schema-driven compound metadata and atomic apply", async () => {
  const { file, schema, workspace } = await fixture();
  const property = await dispatchGuiApi(workspace, schema, {
    method: "GET",
    pathname: "/api/property/schema",
    query: new URLSearchParams({ type: "Image", property: "TextureCoords" }),
  });
  assert.equal(property.status, 200);
  assert.equal((property.body as any).complexType.attributes.find((item: any) => item.name === "top").type, "Real32");

  const templates = await dispatchGuiApi(workspace, schema, {
    method: "GET",
    pathname: "/api/templates",
    query: new URLSearchParams({ type: "Button" }),
  });
  assert.equal(templates.status, 200);
  assert.equal((templates.body as any).recommended.reference, "StandardTemplates/StandardButtonTemplate");
  assert.ok((templates.body as any).templates.length > 1);

  const applied = await dispatchGuiApi(workspace, schema, {
    method: "POST",
    pathname: "/api/apply",
    body: {
      file,
      dryRun: false,
      stage: true,
      operations: [
        { op: "create_frame", as: "child", parentPath: "Root", type: "Button", name: "ApplyButton" },
        { op: "set_property", framePath: "@child", property: "Text", value: "One call" },
      ],
    },
  });
  assert.equal(applied.status, 200);
  assert.equal((applied.body as any).efficiency.toolCalls, 1);
  assert.match((await workspace.read(file)).text, /One call/);
});

test("GUI file creation rolls back its staged draft when Include registration fails", async () => {
  const { schema, workspace } = await fixture();
  const file = "UI/Layout/RolledBack.SC2Layout";
  const response = await dispatchGuiApi(workspace, schema, {
    method: "POST",
    pathname: "/api/file/create",
    body: {
      file,
      kind: "layout",
      includeIn: "UI/Layout/MissingDescIndex.SC2Layout",
      dryRun: false,
      stage: true,
    },
  });
  assert.equal(response.status, 404);
  assert.equal(workspace.hasDraft(file), false);
});
