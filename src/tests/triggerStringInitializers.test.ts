import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {registry,resolveFunction,type GuiValue} from '../modules/trigger/authoring.js';
import {scanXml} from '../core/xmlScanner.js';
const literal=(value:string):GuiValue=>({kind:'literal',type:'string',value});
async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gui-string-initializer-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root);return {root,ws,tr:new TriggerWorkspace(ws)};
}
test('canonical scalar strings use stock GUI expressions without raw code or Native definitions',async t=>{
 const f=await fixture(t),r=registry(),concat=resolveFunction('native:CombineStrings',r,'Expression',{type:'string'});
 const p=await f.tr.plan({variables:['0','false','null'].map((value,i)=>({name:'Value'+i,type:'string',initial:literal(value)})),calls:[]});
 await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);
 const xml=(await f.ws.readRaw('Triggers')).text,tree=scanXml(xml);
 assert.equal(tree.nodes.filter(n=>n.tag==='FunctionDef'&&n.attrs.Library===concat.library&&n.attrs.Id===concat.id).length,3);
 assert(!/<ScriptCode\b|<ExpressionCode\b|<FlagNative\b|Type="CustomScript"/.test(xml));
 for(const value of ['0','false','null'])assert.ok(xml.includes('<Value>'+value+'</Value>'));
});
test('leading zeros, signed/decimal zero and whitespace keep direct typed literals',async t=>{
 const f=await fixture(t),values=['00','00000000000000000','-0','+0','0.0','0x0',' false ',' 0 ',' ','','true','some text'];
 const p=await f.tr.plan({variables:values.map((value,i)=>({name:'Direct'+i,type:'string',initial:literal(value)})),calls:[]});
 await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);
 const xml=(await f.ws.readRaw('Triggers')).text;assert(!xml.includes('Type="FunctionCall"'));
});
test('constant strings and ordinary scalar types retain their previous literal representation',async t=>{
 const f=await fixture(t),p=await f.tr.plan({variables:[
  {name:'ConstantZero',type:'string',constant:true,initial:literal('0')},
  {name:'NumberZero',type:'int',initial:{kind:'literal',type:'int',value:0}},
  {name:'BooleanFalse',type:'bool',initial:{kind:'literal',type:'bool',value:false}},
 ],calls:[]});await f.tr.applyPlan(p.planId,false);
 const xml=(await f.ws.readRaw('Triggers')).text;assert(!xml.includes('Type="FunctionCall"'));assert.equal((await f.tr.validate()).valid,true);
});
test('function return literals are not variable initializer carriers',async t=>{
 const f=await fixture(t),r=registry(),concat=resolveFunction('native:CombineStrings',r,'Expression',{type:'string'});
 const p=await f.tr.plan({functions:[{name:'ReturnZero',kind:'Function',returnType:{type:'string'},calls:[],returns:literal('0')}],calls:[]});
 await f.tr.applyPlan(p.planId,false);const xml=(await f.ws.readRaw('Triggers')).text;
 assert(!scanXml(xml).nodes.some(n=>n.tag==='FunctionDef'&&n.attrs.Library===concat.library&&n.attrs.Id===concat.id));assert.equal((await f.tr.validate()).valid,true);
});
