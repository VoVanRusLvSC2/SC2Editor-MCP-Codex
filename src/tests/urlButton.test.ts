import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { LayoutDocument } from "../core/layoutDocument.js";
import { CrossFileResolver } from "../core/resolver.js";
import { validateLayout } from "../core/validator.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

const fixture = fileURLToPath(new URL("../../src/tests/fixtures/URLButton.SC2Layout", import.meta.url));

test("reads and validates the LaunchURLButton/template pattern without rewriting it", async () => {
  const source = await fs.readFile(fixture, "utf8");
  const doc = new LayoutDocument(source);
  assert.equal(doc.source, source);
  assert.equal(doc.getFrame("GameUI~1UIContainer/TopBar/DiscordButton/WebsiteButton").type, "LaunchURLButton");
  assert.equal(doc.getProperty("GameUI~1UIContainer/TopBar/DiscordButton/WebsiteButton", "URL")[0].attrs.val, "{$TextSource/@Text}");

  const resolver = await CrossFileResolver.build(
    ["URLButton.SC2Layout"],
    [],
    async () => source,
  );
  const report = validateLayout("URLButton.SC2Layout", doc, await SchemaRegistry.loadBundled(), resolver);
  assert.equal(report.errors, 0);
  assert.equal(report.diagnostics.some((item) => item.code === "reference.binding_missing"), false);

  const before = doc.sha256;
  doc.setProperty("GameUI~1UIContainer/TopBar/DiscordButton/WebsiteButton", "Text", { value: "Open" });
  assert.notEqual(doc.sha256, before);
  assert.match(doc.source, /<URL val="\{\$TextSource\/@Text\}"\/>/);
  assert.match(doc.source, /name="GameUI\/UIContainer" file="GameUI"/);
});
