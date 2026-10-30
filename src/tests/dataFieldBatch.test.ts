import test from "node:test";
import assert from "node:assert/strict";
import { DataDocument } from "../modules/data/document.js";
import type { DataNativeFieldSpec } from "../modules/data/types.js";

const fields: DataNativeFieldSpec[] = [
  { name: "Model", value: "Marine" },
  {
    name: "On",
    index: 0,
    attrs: { Terms: "WeaponStart.Test.AttackStart", Send: "AnimBracketStart Attack Attack" },
  },
  { name: "On", attrs: { Terms: "UnitDeath.Test", Send: "Destroy" } },
  {
    name: "Cost",
    index: 0,
    children: [
      { name: "Vital", index: "Energy", value: 20 },
      { name: "Cooldown", link: "Test", attrs: { TimeUse: 5 } },
    ],
  },
];
test("native field group append and clear retain sequential bytes across inline, mixed, duplicate and token-bearing sources", () => {
  for (const nl of ["\n", "\r\n"])
    for (const body of [
      "",
      '<Old value="1"/><Old value="2"/>',
      `${nl}    <Old value='1'/>${nl}    <!-- manual -->${nl}    <Old value='2'/>${nl}  `,
      `<?token id="Type" value="Marine"?><Old value="1"/>text<!-- keep --><Future><Nested/></Future>`,
      `<Old value="1"/>${nl}  <Future value="x"/>`,
    ])
      for (const selfClosing of [false, true]) {
        if (selfClosing && body) continue;
        const source = `<Catalog>${nl}  <CActorUnit id='Target' parent='GenericUnitBase' unitName='Test'${selfClosing ? "/>" + nl : ">" + body + "</CActorUnit>" + nl}</Catalog>`;
        const sequential = new DataDocument(source),
          batched = new DataDocument(source),
          selector = { domain: "Actor", id: "Target" };
        while (sequential.objects()[0].fields.length)
          sequential.removeField(selector, sequential.objects()[0].fields.at(-1)!.path);
        batched.clearFields(selector);
        assert.equal(batched.source, sequential.source, source);
        for (const field of fields) sequential.addNative(selector, undefined, field);
        batched.addNativeMany(selector, undefined, fields);
        assert.equal(batched.source, sequential.source, source);
        assert.deepEqual(batched.objects(), sequential.objects());
      }
});

test("batch additions fail before any field is appended and nested parent selection remains scoped", () => {
  const source =
      '<Catalog><CAbilEffectTarget id="Test"><Cost index="0"/></CAbilEffectTarget></Catalog>',
    document = new DataDocument(source);
  assert.throws(
    () =>
      document.addNativeMany("Test", "Cost[0]", [
        { name: "Vital", index: "Energy", value: 20 },
        { name: "invalid tag", value: 1 },
      ]),
    /Invalid GameData field name/,
  );
  assert.equal(document.source, source);
  const sequential = new DataDocument(source);
  for (const field of fields) sequential.addNative("Test", "Cost[0]", field);
  document.addNativeMany("Test", "Cost[0]", fields);
  assert.equal(document.source, sequential.source);
});
