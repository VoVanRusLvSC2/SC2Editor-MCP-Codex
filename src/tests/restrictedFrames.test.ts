import test from "node:test";
import assert from "node:assert/strict";
import { LayoutDocument } from "../core/layoutDocument.js";
import { validateLayout } from "../core/validator.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

const source = `<?xml version="1.0"?>
<Desc>
    <!-- retained -->
</Desc>
`;

test("materializes a SceneBrowser override inside its verified Core container template", () => {
  const doc = new LayoutDocument(source);
  doc.createFrame({
    type: "SceneBrowserDialog",
    name: "MyBrowser",
    template: "StandardDialog/BrowserDialogTemplate",
  });
  doc.createFrame({
    parentPath: "MyBrowser",
    type: "SceneBrowser",
    name: "SceneBrowser",
    properties: [
      { tag: "Address", value: "https://example.invalid" },
      { tag: "BlocksShortcuts", value: true },
    ],
  });
  assert.equal(doc.getFrame("MyBrowser").template, "StandardDialog/BrowserDialogTemplate");
  assert.equal(doc.getProperty("MyBrowser/SceneBrowser", "Address")[0].attrs.val, "https://example.invalid");
  assert.match(doc.source, /<!-- retained -->/);
  assert.match(doc.source, /<Frame type="SceneBrowser" name="SceneBrowser">/);
});

test("rejects a naked SceneBrowser with missing hookups but accepts the verified container route", async () => {
  const schema = await SchemaRegistry.loadBundled();
  const naked = new LayoutDocument(`<?xml version="1.0"?><Desc><Frame type="SceneBrowser" name="Browser"/></Desc>`);
  const nakedReport = validateLayout("Naked.SC2Layout", naked, schema);
  assert.equal(nakedReport.diagnostics.filter((item) => item.code === "hookup.required_missing").length, 6);
  assert.match(
    nakedReport.diagnostics.find((item) => item.code === "schema.blizzard_only_runtime_uncertain")?.message ?? "",
    /may not work at SC2 runtime/i,
  );
  assert.equal(nakedReport.valid, false);

  const routed = new LayoutDocument(source);
  routed.createFrame({
    type: "SceneBrowserDialog",
    name: "MyBrowser",
    template: "StandardDialog/BrowserDialogTemplate",
  });
  routed.createFrame({ parentPath: "MyBrowser", type: "SceneBrowser", name: "SceneBrowser" });
  const routedReport = validateLayout("Routed.SC2Layout", routed, schema);
  assert.equal(routedReport.diagnostics.some((item) => item.code === "hookup.required_missing"), false);
  assert.equal(routedReport.valid, true);
});
