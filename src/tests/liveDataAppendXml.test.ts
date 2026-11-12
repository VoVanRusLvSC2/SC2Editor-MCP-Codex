import test from "node:test";import assert from "node:assert/strict";
import {appendDataXml} from "../modules/editorLive/dataXml.js";
test("add-only live XML preserves existing declarations and checks domain identities",()=>{
 const original='<Catalog><CUnit id="Hero"><LifeMax value="1200"/></CUnit></Catalog>';
 const result=appendDataXml(original,'<Catalog><CUnit id="Probe" parent="Marine"/><CEffectDamage id="Hero"/></Catalog>');
 assert.ok(result.candidate.includes('<CUnit id="Hero"><LifeMax value="1200"/></CUnit>'));
 assert.equal(result.entries.length,2);
 assert.throws(()=>appendDataXml(original,'<Catalog><CUnit id="Hero"/></Catalog>'),/DUPLICATE_ID/);
 assert.throws(()=>appendDataXml(original,'<Catalog><CUnit id="Probe"/><CUnit id="Probe"/></Catalog>'),/DUPLICATE_ID/);
 assert.throws(()=>appendDataXml(original,'<Catalog><Unknown id="Bad"/></Catalog>'),/ENTRY_INVALID/);
});
