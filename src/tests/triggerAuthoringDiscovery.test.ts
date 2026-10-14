import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';

test('NativeLib discovery separates 3196 definitions from serializer support',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-registry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const trigger=new TriggerWorkspace(new Workspace(root));
 const result=trigger.searchFunctions('',0,1);
 assert.ok(result.total>3000);
 assert.equal(result.items.length,1);
 assert.equal(typeof result.items[0].serializerSupported,'boolean');
});
test('generic verified zero-arg native expression serializes by return type',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-expression-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Root/></Library></TriggerData>');
 const ws=new Workspace(root),trigger=new TriggerWorkspace(ws);
 const request={create:{library:'Local',identifier:'WaitForTime'},calls:[{kind:'Action',function:'Wait',args:{'00000419':{kind:'nativeCall',function:'GameGetMissionTime'},'00000420':{kind:'preset',id:'00000013'}}}]} as const;
 const plan=await trigger.plan(request as never);
 await trigger.applyPlan(plan.planId,false);
 const result=await trigger.validate();
 assert.equal(result.valid,true);
 assert.match((await ws.readRaw('Triggers')).text,/FunctionDef Type="FunctionDef" Library="Ntve" Id="5A832F2D"/);
});
test('nested NativeLib return call validates parameter types and graph closure',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-nested-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Root/></Library></TriggerData>');
 const ws=new Workspace(root),trigger=new TriggerWorkspace(ws);
 const args={'00000419':{kind:'call',function:'00000001',args:{'00000001':{kind:'literal',type:'int',value:2}}},'00000420':{kind:'preset',id:'00000013'}};
 const plan=await trigger.plan({create:{library:'Local',identifier:'NestedWait'},calls:[{kind:'Action',function:'Wait',args}] as never});
 await trigger.applyPlan(plan.planId,false);
 assert.equal((await trigger.validate()).valid,true);
 assert.match((await ws.readRaw('Triggers')).text,/FunctionDef Type="FunctionDef" Library="Ntve" Id="00000001"/);
 await assert.rejects(trigger.plan({create:{library:'Local',identifier:'BadNestedWait'},calls:[{kind:'Action',function:'Wait',args:{...args,'00000419':{kind:'call',function:'00000001',args:{'00000001':{kind:'literal',type:'string',value:'bad'}}}}}] as never}),/GUI_TYPE_MISMATCH/);
});
test('GUI IfThenElse retains native condition/then/else SubFuncType closure',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-if-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Root/></Library></TriggerData>');
 const ws=new Workspace(root),trigger=new TriggerWorkspace(ws);
 const condition={kind:'Condition',function:'WithinBounds',args:{'6342B1C3':{kind:'literal',type:'int',value:5},'89A1388B':{kind:'literal',type:'int',value:0},'0C271B21':{kind:'literal',type:'int',value:10}}};
 const block={kind:'Action',function:'IfThenElse',args:{},children:[{role:'if',call:condition},{role:'then',call:{kind:'Action',function:'Wait',args:{'00000419':{kind:'literal',type:'fixed',value:0.5},'00000420':{kind:'preset',id:'00000013'}}}},{role:'else',call:{kind:'Action',function:'DialogDestroyAll',args:{}}}]};
 const plan=await trigger.plan({create:{library:'Local',identifier:'Branch'},calls:[block] as never});
 await trigger.applyPlan(plan.planId,false);
 assert.equal((await trigger.validate()).valid,true);
 const source=(await ws.readRaw('Triggers')).text;
 for(const role of ['00000003','00000004','00000005'])assert.match(source,new RegExp(`SubFunctionType Type="SubFuncType" Library="Ntve" Id="${role}"`));
 await assert.rejects(trigger.plan({create:{library:'Local',identifier:'BadBranch'},calls:[{...block,children:[{role:'else',call:condition}]}] as never}),/GUI_CONDITION_REQUIRED|GUI_SUBFUNCTION_ROLE_MISMATCH/);
});


test('map-root GUI authoring uses native local refs and unprefixed localization keys without creating a library', async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-root-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'ruRU.SC2Data/LocalizedData'),{recursive:true});
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root),triggers=new TriggerWorkspace(ws);
 const plan=await triggers.plan({create:{identifier:'Начало игры',category:'Правила карты'},calls:[{kind:'Event',function:'TriggerAddEventMapInit',args:{}},{kind:'Action',function:'Wait',args:{'00000419':{kind:'literal',type:'fixed',value:1},'00000420':{kind:'preset',id:'00000013'}}}]});
 await triggers.applyPlan(plan.planId,false);await triggers.save(false);
 const source=(await ws.readRaw('Triggers')).text;
 assert.ok(!source.includes('<Library')&&!source.includes('Library=""'));
 assert.ok(source.includes('Library="Ntve"'));
 assert.equal((await triggers.validate()).valid,true);
 const strings=await fs.readFile(path.join(root,'ruRU.SC2Data/LocalizedData/TriggerStrings.txt'),'utf8');
 assert.match(strings,new RegExp(`Trigger/Name/${plan.triggerId}=Начало игры`));assert.ok(!strings.includes('lib_'));
 const second=await triggers.plan({targetTrigger:plan.triggerId,calls:[{kind:'Action',function:'DialogDestroyAll',args:{}}]});await triggers.applyPlan(second.planId,false);assert.equal((await triggers.validate()).valid,true);
});

test('map-root GUI authoring expands self-closing TriggerData and preserves unrelated libraries', async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-root-empty-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const ws=new Workspace(root),triggers=new TriggerWorkspace(ws);
 for(const source of ['<TriggerData/>','<TriggerData><Library Id="Local"><Root/></Library><Root/></TriggerData>']){
  await fs.writeFile(path.join(root,'Triggers'),source);
  const p=await triggers.plan({create:{library:'',identifier:'RootInit'},calls:[{kind:'Event',function:'TriggerAddEventMapInit',args:{}}]});
  await triggers.applyPlan(p.planId,false);await triggers.save(false);assert.equal((await triggers.validate()).valid,true);
  const text=(await ws.readRaw('Triggers')).text;assert.equal(text.includes('<Library'),source.includes('<Library'));
 }
});
