import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Workspace } from "../core/workspace.js";
import { StyleDocument } from "../core/styleDocument.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { parseRichText, serializeRichText } from "../modules/text/richText.js";
import { StringTableDocument } from "../modules/text/stringTable.js";
import { TextSchemaRegistry } from "../modules/text/schemaRegistry.js";
import { TextWorkspace } from "../modules/text/workspace.js";
import { LayoutDocument } from "../core/layoutDocument.js";
import { applyLayoutOperations } from "../core/layoutOperations.js";
import { CutsceneDocument } from "../modules/cutscene/document.js";
import { applyCutsceneOperations } from "../modules/cutscene/operations.js";
import { CutsceneSchemaRegistry } from "../modules/cutscene/schemaRegistry.js";

test("SC2Style constants, font groups, rename and unknown XML are lossless", () => {
  const source = `<StyleFile>\r\n    <!-- keep -->\r\n    <Unknown future="yes"/>\r\n    <Constant name="Size" val="#FontSizeSmall"/>\r\n    <Style name="Base" height="#Size" future="keep"/>\r\n    <Style name="Child" template="Base"/>\r\n</StyleFile>\r\n`;
  const document = new StyleDocument(source);
  document.upsertConstant("Size", 28);
  document.renameStyle("Base", "BaseRenamed");
  document.upsertFontGroup("CustomFonts", [{ font: "Assets\\Fonts\\Custom.otf" }]);
  assert.match(document.source, /<!-- keep -->/);
  assert.match(document.source, /<Unknown future="yes"\/>/);
  assert.match(document.source, /<Constant name="Size" val="28"\/>/);
  assert.match(document.source, /name="BaseRenamed" height="#Size" future="keep"/);
  assert.match(document.source, /template="BaseRenamed"/);
  assert.match(document.source, /<FontGroup name="CustomFonts">\r\n\s+<CodepointRange font="Assets\\Fonts\\Custom.otf"\/>/);
});

test("string table patches only one value and preserves BOM/comments/CRLF", () => {
  const source = `\uFEFF// keep\r\nA=old\r\nB = untouched\r\n`;
  const document = new StringTableDocument(source);
  document.set("A", "new<n/>line");
  assert.equal(document.source, `\uFEFF// keep\r\nA=new<n/>line\r\nB = untouched\r\n`);
});

test("rich text AST preserves unknown tags and exact native spelling", () => {
  const source = `WARNING <s val ='WarningDisplay'><c val="#ColorAttackInfo">Attack</c><future x='1'>!</future></s><n/>`;
  const parsed = parseRichText(source);
  assert.equal(serializeRichText(parsed), source);
  const unknown = JSON.stringify(parsed.nodes).includes('"nativeName":"future"');
  assert.equal(unknown, true);
});

test("text.apply stages style and two locales atomically with minimal patches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-text-"));
  await fs.mkdir(path.join(root, "Base.SC2Data/UI"), { recursive: true });
  await fs.mkdir(path.join(root, "enUS.SC2Data/LocalizedData"), { recursive: true });
  await fs.mkdir(path.join(root, "ruRU.SC2Data/LocalizedData"), { recursive: true });
  await fs.writeFile(path.join(root, "Base.SC2Data/UI/FontStyles.SC2Style"), `<StyleFile>\n    <!-- keep -->\n</StyleFile>\n`);
  await fs.writeFile(path.join(root, "enUS.SC2Data/LocalizedData/GameStrings.txt"), `Existing=Keep\n`);
  await fs.writeFile(path.join(root, "ruRU.SC2Data/LocalizedData/GameStrings.txt"), `Existing=Оставить\n`);
  const coreSchema = await SchemaRegistry.loadBundled();
  const schema = await TextSchemaRegistry.load();
  const workspace = new Workspace(root, coreSchema);
  const text = new TextWorkspace(workspace, schema);
  const result = await text.apply({
    styleFile: "Base.SC2Data/UI/FontStyles.SC2Style",
    stringFiles: {
      enUS: "enUS.SC2Data/LocalizedData/GameStrings.txt",
      ruRU: "ruRU.SC2Data/LocalizedData/GameStrings.txt",
    },
    operations: [
      { op: "style.add", id: "KaldirSubtitle", template: "StandardExtendedTemplate", values: { font: "#FontStandardExtended", height: 28, hjustify: "Center", vjustify: "Middle", textColor: "9fdcff", shadow: true, outline: true, outlineWidth: 2 } },
      { op: "text.setLocalized", key: "Cutscene/Kaldir/Storm", values: { enUS: "The storm is coming.", ruRU: "Приближается буря." } },
      { op: "richText.style", key: "Cutscene/Kaldir/Storm", locale: "enUS", start: 0, end: 20, style: "KaldirSubtitle" },
    ],
    dryRun: false,
    stage: true,
  });
  assert.equal(result.accepted, true);
  assert.equal("files" in result && result.files.filter((entry) => entry.changed).length, 3);
  const style = (await workspace.readRaw("Base.SC2Data/UI/FontStyles.SC2Style")).text;
  assert.match(style, /styleflags="Shadow\|Outline"/);
  assert.match(style, /outlinewidth="2"/);
  assert.match(style, /<!-- keep -->/);
  const en = (await workspace.readRaw("enUS.SC2Data/LocalizedData/GameStrings.txt")).text;
  assert.match(en, /Cutscene\/Kaldir\/Storm=<s val="KaldirSubtitle">The storm is coming\.<\/s>/);
  assert.match(en, /Existing=Keep/);
});

test("text.apply rolls back every draft when validation fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-text-rollback-"));
  const file = "FontStyles.SC2Style";
  const original = `<StyleFile>\n</StyleFile>\n`;
  await fs.writeFile(path.join(root, file), original);
  const workspace = new Workspace(root, await SchemaRegistry.loadBundled());
  const text = new TextWorkspace(workspace, await TextSchemaRegistry.load());
  await assert.rejects(text.apply({ styleFile: file, operations: [{ op: "style.add", id: "Broken", template: "MissingTemplate", values: { height: 28 } }], dryRun: false, stage: true }), /validation failed/);
  assert.equal((await workspace.readRaw(file)).text, original);
  assert.equal(workspace.hasDraft(file), false);
});

test("font.import defaults to dry-run and never copies implicitly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-font-import-"));
  const source = path.join(root, "Source.ttf");
  await fs.writeFile(source, "font fixture");
  const workspace = new Workspace(root, await SchemaRegistry.loadBundled());
  const text = new TextWorkspace(workspace, await TextSchemaRegistry.load());
  const result = await text.apply({ operations: [{ op: "font.import", source, target: "Assets/Fonts/Imported.ttf" }] });
  assert.equal("import" in result, true);
  if (!("import" in result)) throw new Error("Expected font import result");
  assert.equal(result.import.dryRun, true);
  assert.equal(result.import.saved, false);
  await assert.rejects(fs.stat(path.join(root, "Assets/Fonts/Imported.ttf")));
});

test("ui.apply binds a shared Font Style through the native Style property", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const document = new LayoutDocument(`<Desc>\n<Frame type="Label" name="Title"><Text val="KALDIR"/></Frame>\n</Desc>\n`);
  applyLayoutOperations(document, schema, [{ op: "text.bindStyle", framePath: "Title", style: "KaldirTitle" }]);
  assert.match(document.source, /<Style val="KaldirTitle"\/>/);
  assert.match(document.source, /<Text val="KALDIR"\/>/);
});

test("cutscene text.add emits only corpus-confirmed CCutsceneNodeText fields", async () => {
  const schema = await CutsceneSchemaRegistry.load();
  const document = CutsceneDocument.create({ name: "TextDemo" });
  applyCutsceneOperations(document, schema, [
    { op: "text.add", as: "title", name: "Title", text: "KALDIR", position: [0, 0, 2], enabled: true, sortIndex: 0, duration: 5000, lockedToEnd: true },
    { op: "text.animate", object: "@title", keyframes: [{ value: "" }, { start: 1000, value: "KALDIR" }] },
  ]);
  assert.match(document.source, /<CCutsceneNodeText guid="\d+" name="Title" text="KALDIR" position="0\.000000,0\.000000,2\.000000" enabled="1" sortIndex="0">/);
  assert.match(document.source, /<CCutsceneElementObject guid="\d+" duration="5000" lockedToEnd="1"\/>/);
  assert.match(document.source, /<CCutsceneNodePropertyValue guid="\d+" name="Property - Text" propertyName="text">/);
  assert.match(document.source, /<CCutsceneElementPropertyValue guid="\d+" start="1000" value="KALDIR"\/>/);
  assert.doesNotMatch(document.source, /font|style/i);
});

test("checked-in Kaldir Font Style and locales are exactly generated by text.apply", async () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const exampleRoot = path.join(projectRoot, "examples/text");
  const request = JSON.parse(await fs.readFile(path.join(exampleRoot, "KaldirTextApply.json"), "utf8"));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-text-example-"));
  for (const file of [request.styleFile, ...Object.values(request.stringFiles) as string[]]) await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, request.styleFile), `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<StyleFile>\n</StyleFile>\n`);
  for (const file of Object.values(request.stringFiles) as string[]) await fs.writeFile(path.join(root, file), "");
  const workspace = new Workspace(root, await SchemaRegistry.loadBundled());
  const text = new TextWorkspace(workspace, await TextSchemaRegistry.load());
  await text.apply({ ...request, stage: false });
  assert.equal(await fs.readFile(path.join(root, request.styleFile), "utf8"), await fs.readFile(path.join(exampleRoot, request.styleFile), "utf8"));
  for (const file of Object.values(request.stringFiles) as string[]) assert.equal(await fs.readFile(path.join(root, file), "utf8"), await fs.readFile(path.join(exampleRoot, file), "utf8"));
});
