import test from "node:test";
import assert from "node:assert/strict";
import { StyleDocument } from "../core/styleDocument.js";

test("patches SC2Style attributes without losing unknown attributes", () => {
  const source = `<StyleFile>
    <!-- preserve -->
    <Style name="Title" height='24' future="yes"/>
</StyleFile>
`;
  const doc = new StyleDocument(source);
  doc.upsertStyle("Title", { height: 30, textcolor: "FFFFFFFF" });
  assert.match(doc.source, /height='30'/);
  assert.match(doc.source, /future="yes"/);
  assert.match(doc.source, /textcolor="FFFFFFFF"/);
  assert.match(doc.source, /<!-- preserve -->/);
});

test("creates a new style under StyleFile", () => {
  const doc = new StyleDocument("<StyleFile>\n</StyleFile>\n");
  doc.upsertStyle("Body", { height: 18, hjustify: "Left" });
  assert.equal(doc.getStyle("Body")?.attrs.hjustify, "Left");
});

test("refuses to delete referenced style templates", () => {
  const doc = new StyleDocument(`<StyleFile>\n<Style name="Base"/><Style name="Child" template="Base"/>\n</StyleFile>\n`);
  assert.throws(() => doc.deleteStyle("Base"), /used as template/);
});
