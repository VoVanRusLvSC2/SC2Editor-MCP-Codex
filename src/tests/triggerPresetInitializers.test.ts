import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {registry,type GuiValue} from '../modules/trigger/authoring.js';
import {scanXml} from '../core/xmlScanner.js';
async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gui-preset-initializer-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root);return {ws,tr:new TriggerWorkspace(ws)};
}
function noControl():Extract<GuiValue,{kind:'preset'}>{
 const definitions=registry().typeDefinitions!,owners=definitions.presets.filter(p=>p.name==='NoControl'&&p.library==='Ntve');
 assert.equal(owners.length,1);assert.equal(owners[0].baseType,'control');
 const ref=owners[0].values[0];assert.equal(owners[0].values.length,1);
 return {kind:'preset',id:ref.id,library:ref.library??owners[0].library,preset:owners[0].id};
}
test('stock scalar presets initialize globals, trigger locals and structure fields with exact ownership',async t=>{
 const f=await fixture(t),initial=noControl();
 const p=await f.tr.plan({create:{identifier:'Probe',folder:'RESEARCH'},structures:[{name:'State',fields:[{name:'panel',type:'control',initial}]}],
  variables:[{name:'GlobalPanel',type:'control',initial},{name:'LocalPanel',type:'control',scope:'local',initial}],calls:[]});
 await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);
 const xml=(await f.ws.readRaw('Triggers')).text,tree=scanXml(xml);
 assert.equal(tree.nodes.filter(n=>n.tag==='Preset'&&n.attrs.Type==='PresetValue'&&n.attrs.Id===('id'in initial?initial.id:'')).length,3);
 assert(!/<ScriptCode\b|<ExpressionCode\b|<FlagNative\b|Type="CustomScript"/.test(xml));
});
test('a scalar initializer cannot borrow a preset with another GUI base type',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.tr.plan({variables:[{name:'WrongType',type:'unit',initial:noControl()}],calls:[]}),/GUI_PRESET_MISMATCH/);
});
test('a scalar initializer cannot borrow another library owner by ID coincidence',async t=>{
 const f=await fixture(t),initial=noControl();
 await assert.rejects(f.tr.plan({variables:[{name:'WrongLibrary',type:'control',initial:{...initial,library:'Foreign'}}],calls:[]}),/GUI_PRESET_MISMATCH/);
});
test('initializer permission does not widen nested function argument selectors',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.tr.plan({functions:[{name:'EchoControl',kind:'Function',parameters:[{name:'input',type:'control'}],returnType:{type:'control'},calls:[],returns:{kind:'parameter',name:'input'}}],
  variables:[{name:'Nested',type:'control',initial:{kind:'call',function:'custom:EchoControl',args:{input:noControl()}}}],calls:[]}),/GUI_PRESET_MISMATCH/);
});
