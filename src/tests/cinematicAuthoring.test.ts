import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {scanXml} from '../core/xmlScanner.js';
import type {GuiCall} from '../modules/trigger/authoring.js';

test('NativeLib cinematic and global setting produce distinct, linked GUI call graphs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-cinematic-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const initial='<TriggerData><Library Id="Local"><Root/></Library></TriggerData>';
 await fs.writeFile(path.join(root,'Triggers'),initial);
 const ws=new Workspace(root),tr=new TriggerWorkspace(ws);
 const on={kind:'preset' as const,id:'00000538'},off={kind:'preset' as const,id:'00000545'};
 const all={kind:'nativeCall' as const,function:'PlayerGroupAll' as const};
 assert.equal(tr.describeFunction('CinematicMode').id,'E92E544E');
 assert.equal(tr.describeFunction('GlobalCinematicSetting').id,'4A703103');
 const calls:GuiCall[]=[
  {kind:'Event' as const,function:'TriggerAddEventMapInit',args:{}},
  {kind:'Action' as const,function:'CinematicMode',args:{C016C6E2:on,'8F9FC828':all,'5755FC77':{kind:'literal' as const,type:'fixed' as const,value:0}}},
  {kind:'Action' as const,function:'Wait',args:{'00000419':{kind:'literal' as const,type:'fixed' as const,value:0.5},'00000420':{kind:'preset' as const,id:'00000013'}}},
  {kind:'Action' as const,function:'CinematicMode',args:{C016C6E2:off,'8F9FC828':all,'5755FC77':{kind:'literal' as const,type:'fixed' as const,value:0}}},
  {kind:'Action' as const,function:'GlobalCinematicSetting',args:{E095DC31:on}},
  {kind:'Action' as const,function:'GlobalCinematicSetting',args:{E095DC31:off}},
 ];
 const plan=await tr.plan({create:{library:'Local',identifier:'CinematicSequence'},calls});
 assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),initial);
 await tr.applyPlan(plan.planId,false);assert.equal((await tr.validate()).valid,true);
 const staged=(await ws.readRaw('Triggers')).text;
 assert.equal(scanXml(staged).diagnostics.length,0);
 assert.equal((staged.match(/Id="E92E544E"/g)??[]).length,2);
 assert.equal((staged.match(/Id="4A703103"/g)??[]).length,2);
 assert.equal((staged.match(/Id="00000192"/g)??[]).length,2);
 assert.equal((await tr.get('CinematicSequence')).references.length,6);
 await tr.save(false);
 assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),staged);
 assert.equal((await new TriggerWorkspace(new Workspace(root)).validate()).valid,true);
});

test('cinematic authoring rejects unsupported playergroup expression before staging',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-cinematic-negative-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Root/></Library></TriggerData>');
 const ws=new Workspace(root),tr=new TriggerWorkspace(ws);
 await assert.rejects(tr.plan({create:{library:'Local',identifier:'Invalid'},calls:[{kind:'Action',function:'CinematicMode',args:{C016C6E2:{kind:'preset',id:'00000538'},'8F9FC828':{kind:'customScript',source:'Players()'},'5755FC77':{kind:'literal',type:'fixed',value:0}}}]}),/GUI_EXPRESSION_UNSUPPORTED/);
 assert.deepEqual(ws.draftFiles(),[]);
});

test('Native and custom labels are listed by Library/Type/Id; FunctionCall inheritance is read-only',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-labels-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const xml='<TriggerData><Library Id="A"><Element Type="Label" Id="L"/><Element Type="FunctionCall" Id="C"><FunctionDef Type="FunctionDef" Library="Ntve" Id="E92E544E"/></Element><Element Type="FunctionCall" Id="D"><FunctionDef Type="FunctionDef" Library="Ntve" Id="E92E544E"/><Label Type="Label" Library="A" Id="L"/></Element></Library><Library Id="B"><Element Type="Label" Id="L"><Color>1,2,3,4</Color></Element></Library></TriggerData>';
 await fs.writeFile(path.join(root,'Triggers'),xml);await fs.mkdir(path.join(root,'enUS.SC2Data/LocalizedData'),{recursive:true});
 await fs.writeFile(path.join(root,'enUS.SC2Data/LocalizedData/TriggerStrings.txt'),'Label/Name/lib_A_L=Shared\nLabel/Name/lib_B_L=Shared\n');
 await fs.mkdir(path.join(root,'ruRU.SC2Data/LocalizedData'),{recursive:true});await fs.writeFile(path.join(root,'ruRU.SC2Data/LocalizedData/TriggerStrings.txt'),'Label/Name/lib_A_L=Общая\\nLabel/Name/lib_B_L=Общая\\n'.replaceAll('\\n','\n'));
 const tr=new TriggerWorkspace(new Workspace(root));
 const debug=await tr.labels('Debug');assert.ok(debug.labels.some(x=>x.library==='Ntve'&&x.id==='04C6B670'));
 const local=await tr.labels('Shared');assert.equal(local.total,2);assert.deepEqual(local.labels.map(x=>x.library),['A','B']);
 assert.equal(local.labels[0]?.icon,null);assert.equal(local.labels[0]?.names.ruRU,'Общая');assert.equal(local.labels[1]?.color,'1,2,3,4');
 assert.deepEqual((await tr.labelOf({library:'A',type:'FunctionCall',id:'C'})).inherited,{library:'Ntve',type:'Label',id:'00000033'});
 assert.deepEqual((await tr.labelOf({library:'A',type:'FunctionCall',id:'D'})).own,{library:'A',type:'Label',id:'L'});
 assert.equal((await tr.labels('',0,1)).truncated,true);
 assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),xml);
});
