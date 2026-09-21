import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

const layout = `<?xml version="1.0"?>
<Desc>
    <Frame type="Frame" name="Root">
        <Width val="100"/>
    </Frame>
</Desc>
`;

async function fixture(): Promise<{ root: string; file: string; workspace: Workspace }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ui-mcp-"));
  const directory = path.join(root, "UI", "Layout");
  await fs.mkdir(directory, { recursive: true });
  const file = "UI/Layout/Test.SC2Layout";
  await fs.writeFile(path.join(root, file), layout, "utf8");
  const schema = await SchemaRegistry.loadBundled();
  return { root, file, workspace: new Workspace(root, schema) };
}

test("dry-run does not stage or write", async () => {
  const { root, file, workspace } = await fixture();
  const result = await workspace.mutate(file, { dryRun: true, stage: true, summary: "preview" }, (doc) => {
    doc.setSimpleProperty("Root", "Width", 200);
  });
  assert.equal(result.changed, true);
  assert.equal(workspace.hasDraft(file), false);
  assert.equal(await fs.readFile(path.join(root, file), "utf8"), layout);
});

test("stages, diffs and atomically saves with backup", async () => {
  const { root, file, workspace } = await fixture();
  await workspace.mutate(file, { dryRun: false, stage: true, summary: "stage" }, (doc) => {
    doc.setSimpleProperty("Root", "Width", 240);
  });
  assert.equal(workspace.hasDraft(file), true);
  assert.equal((await workspace.diff(file)).changed, true);
  const saved = await workspace.save(file);
  assert.equal(saved.saved, true);
  assert.match(await fs.readFile(path.join(root, file), "utf8"), /val="240"/);
  assert.equal(await fs.readFile(path.join(root, `${file}.sc2uimcp.bak`), "utf8"), layout);
  assert.equal((await fs.readdir(path.dirname(path.join(root, file)))).some((name) => name.endsWith(".tmp")), false);
});

test("resolves cross-file templates and style names", async () => {
  const { root, workspace } = await fixture();
  await fs.writeFile(path.join(root, "UI/Layout/Templates.SC2Layout"), `<Desc><Frame type="Button" name="Basic"/></Desc>`, "utf8");
  await fs.writeFile(path.join(root, "UI/FontStyles.SC2Style"), `<StyleFile><Style name="Title" height="24"/></StyleFile>`, "utf8");
  const resolver = await workspace.resolver();
  assert.equal(resolver.resolveTemplate("Templates/Basic", "UI/Layout/Test.SC2Layout").found, true);
  assert.equal(resolver.hasStyle("Title"), true);
});

test("rejects workspace path escapes", async () => {
  const { workspace } = await fixture();
  assert.throws(() => workspace.resolveUserPath("../outside.SC2Layout"), /escapes/);
});

test("creates new layout/style files as drafts and registers a minimal Include", async () => {
  const { root, workspace } = await fixture();
  const indexFile = "UI/Layout/DescIndex.SC2Layout";
  const indexSource = `<?xml version="1.0"?>\n<Desc>\n    <!-- keep -->\n</Desc>\n`;
  await fs.writeFile(path.join(root, indexFile), indexSource, "utf8");

  const layoutFile = "UI/Layout/Generated/Panel.SC2Layout";
  const created = await workspace.createFile(layoutFile, "layout", { dryRun: false, stage: true });
  assert.equal(created.staged, true);
  assert.equal(workspace.hasDraft(layoutFile), true);
  assert.ok((await workspace.listLayoutFiles()).includes(layoutFile));
  assert.match((await workspace.read(layoutFile)).text, /<Desc>/);
  assert.equal((await workspace.diff(layoutFile)).changed, true);

  await workspace.mutate(indexFile, { dryRun: false, stage: true, summary: "include" }, (doc) => {
    doc.addInclude(layoutFile);
  });
  await workspace.save(layoutFile);
  await workspace.save(indexFile);
  assert.match(await fs.readFile(path.join(root, indexFile), "utf8"), /<Include path="UI\/Layout\/Generated\/Panel\.SC2Layout"\/>/);
  assert.equal(await fs.readFile(path.join(root, `${indexFile}.sc2uimcp.bak`), "utf8"), indexSource);
  await assert.rejects(fs.access(path.join(root, `${layoutFile}.sc2uimcp.bak`)));

  const styleFile = "UI/Generated.SC2Style";
  await workspace.createFile(styleFile, "style", { dryRun: false, stage: true });
  await workspace.mutateStyle(styleFile, { dryRun: false, stage: true, summary: "style" }, (doc) => {
    doc.upsertStyle("GeneratedTitle", { height: 24 });
  });
  await workspace.save(styleFile);
  assert.match(await fs.readFile(path.join(root, styleFile), "utf8"), /<Style name="GeneratedTitle" height="24"\/>/);
});
