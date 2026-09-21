import assert from "node:assert/strict";
import test from "node:test";
import {scanXml} from "../core/xmlScanner.js";
import {DataDocument} from "../modules/data/document.js";
import {parseRichText,serializeRichText} from "../modules/text/richText.js";
import {parseCutsceneTime} from "../modules/cutscene/time.js";
import {LightingCatalog} from "../modules/terrain/lighting.js";
import {APP_VERSION} from "../app/version.js";
import {bridgeCapabilities} from "../core/capabilities.js";
test("strict scanner rejects malformed attributes, roots, close tags and entity values",()=>{
 for(const source of ['<Catalog><CLight id="A" id="B"/></Catalog>','<Catalog><CLight id=A/></Catalog>','<Catalog><CLight id="A"parent="B"/></Catalog>','<Catalog','<A/><B/>','<A></A extra>','<A x="&unknown;"/>','<A x="&#0;"/>','text<A/>']) assert.ok(scanXml(source).diagnostics.some(d=>d.severity==="error"),source);
});
test("decoded entity identities resolve and rename without rewriting unknown spans or losing quote offsets",()=>{
 const source="<Catalog><!--retain--><CUnit id='A&amp;B'><Unknown value='&#x41;'/></CUnit><CUnit id='Child' parent='A&amp;B'/></Catalog>";
 const doc=new DataDocument(source);assert.equal(doc.resolve("CUnit:A&B").attrs.id,"A&B");assert.equal(doc.source,source);
 doc.renameObject("CUnit:A&B","Night's & Fog");assert.equal(doc.resolve("CUnit:Night's & Fog").attrs.id,"Night's & Fog");assert.ok(!doc.diagnostics.some(d=>d.severity==="error"));assert.match(doc.source,/<!--retain-->/);assert.match(doc.source,/value='&#x41;'/);
});
test("rich text quoted delimiters and incomplete tags retain exact source and correct diagnostics",()=>{
 for(const source of ['<a href="a>b">text</a>',"<a href='a>b'>text</a>",'<s val="A&amp;B">x</s>']){const p=parseRichText(source);assert.equal(serializeRichText(p),source);assert.equal(p.diagnostics.length,0);assert.ok(p.nodes[0].kind==="tag");}
 assert.ok(parseRichText('<a href="a>b').diagnostics.some(d=>d.severity==="error"));
});
test("lighting inspect normalizes child fields, directional lights and tileset attribute binding",()=>{
 const light=new LightingCatalog('<Catalog><CLight id="A"><ToDInfoArray><AmbientColor value="0.1,0.2,0.3"/><DirectionalLight index="Key"><Color value="1,1,1"/></DirectionalLight></ToDInfoArray></CLight></Catalog>',"CLight").list()[0];assert.equal(light.states[0].AmbientColor,"0.1,0.2,0.3");assert.equal(light.states[0].directional[0].Color,"1,1,1");
 assert.equal(new LightingCatalog('<Catalog><CTerrain id="A" Lighting="B"/></Catalog>',"CTerrain").list()[0].lighting,"B");
});
test("timecode bounds and runtime version are explicit",()=>{assert.throws(()=>parseCutsceneTime("00:99:99"),/Invalid timecode/);assert.equal(parseCutsceneTime("01:59:59").decimalSeconds,"7199");assert.equal(bridgeCapabilities(process.cwd()).version,APP_VERSION);});
test("native lighting cycle fields/events retain unknown fields and reject ambiguous event IDs",()=>{
 const source='<Catalog><CLight id="A"><TimeStart value="06:00:00"/><Unknown value="retain"/><TimeEventArray index="Dawn" Time="06:00:00" Name="old"/></CLight></Catalog>';
 const next=new LightingCatalog(source,"CLight").patch({id:"A",timeStart:"20:00:00",timePerDay:"24:00:00",timePerLoop:"05",timeEvents:[{index:"Dawn",time:"05:00:00",name:"dawn"}]});
 const read=new LightingCatalog(next,"CLight").list()[0];assert.equal(read.cycle.timeStart,"20:00:00");assert.equal(read.cycle.timePerDay,"24:00:00");assert.equal(read.cycle.events[0].Time,"05:00:00");assert.match(next,/<Unknown value="retain"\/>/);
});
