import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {scanXml} from '../core/xmlScanner.js';
import {registry,functionSupport,type GuiRequest,type GuiCall,type GuiValue} from '../modules/trigger/authoring.js';
import {triggerPlanSchema} from '../modules/trigger/schemas.js';
async function fixture(t:{after(fn:()=>Promise<unknown>):void}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-expanded-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'ruRU.SC2Data/LocalizedData'),{recursive:true});await fs.mkdir(path.join(root,'enUS.SC2Data/LocalizedData'),{recursive:true});
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root),data=new DataWorkspace(ws),trigger=new TriggerWorkspace(ws,undefined,data);return{root,ws,data,trigger};
}
const int=(value:number):GuiValue=>({kind:'literal',type:'int',value}),fixed=(value:number):GuiValue=>({kind:'literal',type:'fixed',value}),bool=(value:boolean):GuiValue=>({kind:'literal',type:'bool',value}),variable=(name:string):GuiValue=>({kind:'variable',name}),preset=(name:string):GuiValue=>({kind:'preset',name});
const wait:GuiCall={kind:'Action',function:'Wait',args:{t:fixed(0.5),timeType:preset('game')}};
const comparison=(name:string):GuiCall=>({kind:'Condition',function:'Comparison',args:{val1:variable(name),op:preset('lt'),val2:int(10)}});

test('expanded eligibility exposes native actions/events and explains unsupported shapes',()=>{
 const r=registry();assert.ok(r.definitions!.filter(f=>f.flags.includes('FlagEvent')&&functionSupport(f).supported).length>90);
 assert.ok(r.definitions!.filter(f=>f.flags.includes('FlagAction')&&functionSupport(f).supported).length>900);
 const multiple=r.definitions!.find(f=>f.parameters.some(p=>p.flags?.includes('ParamFlagMultiple')))!;assert.ok(functionSupport(multiple).supported);const bad=r.definitions!.find(f=>f.flags.includes('FlagRestricted'))!;assert.ok(!functionSupport(bad).supported);
});

test('root GUI trigger creates global/local variables, typed assignment, condition, branches and localized message',async t=>{
 const f=await fixture(t);
 const request:GuiRequest={create:{identifier:'Income',translations:{ruRU:'Доход'}},variables:[{name:'Ticks',type:'int',initial:int(0),translations:{ruRU:'Прошедшие такты'}},{name:'Delay',type:'fixed',scope:'local',initial:fixed(0.5)}],calls:[{kind:'Event',function:'TriggerAddEventTimePeriodic',args:{dur:fixed(20),timeType:preset('game')}},comparison('Ticks'),{kind:'Action',function:'SetVariable',args:{var:variable('Ticks'),val:{kind:'call',function:'ArithmeticInt',args:{val1:variable('Ticks'),op:preset('plus'),val2:int(1)}}}},{kind:'Action',function:'IfThenElse',args:{},children:[{role:'if',call:comparison('Ticks')},{role:'then',call:wait},{role:'else',call:{kind:'Action',function:'DialogDestroyAll',args:{}}}]},{kind:'Action',function:'UIDisplayMessage',args:{players:{kind:'call',function:'PlayerGroupSingle',args:{p:int(1)}},messageArea:preset('Chat'),message:{kind:'text',value:'Income received',translations:{ruRU:'Доход получен'}}}}]};
 const p=await f.trigger.plan(request);assert.equal(p.variables.length,2);assert.equal(p.conditions,1);assert.equal(p.customResourceLibraryCreated,false);assert.equal(p.localizedTextValues,1);
 assert.deepEqual(f.ws.draftFiles(),[]);await f.trigger.applyPlan(p.planId);assert.deepEqual(f.ws.draftFiles(),[]);
 await f.trigger.applyPlan(p.planId,false);await f.trigger.save(false);
 const xml=await fs.readFile(path.join(f.root,'Triggers'),'utf8');assert.ok(!xml.includes('<Library')&&!xml.includes('Library=""')&&!xml.includes('ScriptCode'));
 const tree=scanXml(xml),trigger=tree.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='Trigger'&&n.attrs.Id===p.triggerId)!;
 assert.equal(trigger.childIds.filter(i=>tree.nodes[i].tag==='Condition').length,1);assert.equal(trigger.childIds.filter(i=>tree.nodes[i].tag==='Variable').length,1);
 assert.ok(tree.nodes.some(n=>n.tag==='Item'&&n.attrs.Type==='Variable'&&n.attrs.Id===p.variables[0].id));assert.equal((await f.trigger.validate()).valid,true);
 assert.equal((await f.trigger.inspect()).variables!.length,2);
 const strings=await fs.readFile(path.join(f.root,'ruRU.SC2Data/LocalizedData/TriggerStrings.txt'),'utf8');assert.ok(strings.includes('Доход получен')&&strings.includes('Прошедшие такты'));
 assert.ok((await fs.readFile(path.join(f.root,'ruRU.SC2Data/LocalizedData/GameStrings.txt'),'utf8')).includes('Доход получен'));
});

test('variable-only plans support primitive types and initialized handles without creating a trigger/library',async t=>{
 const f=await fixture(t),p=await f.trigger.plan({variables:[{name:'Count',type:'int',initial:int(2)},{name:'Enabled',type:'bool',initial:bool(true)},{name:'Title',type:'string',initial:{kind:'literal',type:'string',value:'A < B & C'}},{name:'Location',type:'point',initial:{kind:'call',function:'Point',args:{x:fixed(16),y:fixed(16)}}},{name:'Unit',type:'unit'}],calls:[]});
 assert.equal(p.triggerId,undefined);await f.trigger.applyPlan(p.planId,false);assert.equal((await f.trigger.validate()).valid,true);assert.ok((await f.ws.readRaw('Triggers')).text.includes('A &lt; B &amp; C'));
});

test('local scope resolves shadowing and rejects use from a different trigger or event registration',async t=>{
 const f=await fixture(t);const p=await f.trigger.plan({create:{identifier:'First'},variables:[{name:'Number',type:'int',initial:int(1)},{name:'Number',type:'int',scope:'local',initial:int(2)}],calls:[{kind:'Action',function:'SetVariable',args:{var:variable('Number'),val:int(3)}}]});await f.trigger.applyPlan(p.planId,false);await f.trigger.save(false);
 const local=p.variables.find(v=>v.scope==='local')!;
 await assert.rejects(f.trigger.plan({create:{identifier:'Second'},calls:[{kind:'Action',function:'SetVariable',args:{var:{kind:'variable',id:local.id},val:int(4)}}]}),/SCOPE|UNRESOLVED/);
 await assert.rejects(f.trigger.plan({targetTrigger:p.triggerId,variables:[{name:'LocalTime',type:'fixed',scope:'local'}],calls:[{kind:'Event',function:'TriggerAddEventTimePeriodic',args:{dur:variable('LocalTime'),timeType:preset('game')}}]}),/SCOPE|UNRESOLVED/);
});

test('initializers and assignments reject duplicate names, self/forward references and type mismatches before staging',async t=>{
 const f=await fixture(t);
 for(const request of [
  {variables:[{name:'A',type:'int',initial:bool(true)}],calls:[]},
  {variables:[{name:'A',type:'int'},{name:'A',type:'int'}],calls:[]},
  {variables:[{name:'A',type:'int',initial:variable('A')}],calls:[]},
  {variables:[{name:'A',type:'int',initial:variable('B')},{name:'B',type:'int'}],calls:[]},
  {create:{identifier:'Bad'},variables:[{name:'A',type:'int'}],calls:[{kind:'Action',function:'SetVariable',args:{var:variable('A'),val:bool(false)}}]},
  {variables:[{name:'A',type:'int',scope:'local'}],calls:[]}
 ] as GuiRequest[]){await assert.rejects(f.trigger.plan(request));assert.deepEqual(f.ws.draftFiles(),[]);}
});

test('nested limit checks, preset choices, alias collisions and ordered bool comparisons are rejected',async t=>{
 const f=await fixture(t);
 const calls:GuiCall[]=[
  {kind:'Action',function:'UIDisplayMessage',args:{players:{kind:'call',function:'PlayerGroupSingle',args:{p:int(-1)}},messageArea:preset('Chat'),message:{kind:'text',value:'x'}}},
  {...wait,args:{t:fixed(1),'00000419':fixed(1),timeType:preset('game')}},
  {...wait,args:{t:fixed(1),timeType:preset('not-a-preset')}},
  {kind:'Condition',function:'Comparison',args:{val1:bool(true),op:preset('lt'),val2:bool(false)}}
 ];
 for(const call of calls){await assert.rejects(f.trigger.plan({create:{identifier:'Bad'},calls:[call]}));assert.deepEqual(f.ws.draftFiles(),[]);}
});

test('boolean native return expressions can be GUI conditions and placed unit refs pin Objects',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'Objects'),'<PlacedObjects Version="27"><ObjectUnit Id="100" UnitType="CommandCenter" Player="1" Position="16,16,0"/></PlacedObjects>');
 const p=await f.trigger.plan({create:{identifier:'UnitWatch'},calls:[{kind:'Event',function:'TriggerAddEventUnitDied',args:{u:{kind:'unit',objectId:100}}},{kind:'Condition',function:'UnitIsAlive',args:{u:{kind:'unit',objectId:100}}},wait]});
 await f.trigger.applyPlan(p.planId,false);assert.ok((await f.ws.readRaw('Triggers')).text.includes('<ValueId Id="100"/>'));await f.trigger.discard();
 await fs.writeFile(path.join(f.root,'Objects'),'<PlacedObjects Version="27"/>');await assert.rejects(f.trigger.applyPlan(p.planId,false),/GUI_PLAN_OBJECTS_STALE/);assert.deepEqual(f.ws.draftFiles(),[]);
 await assert.rejects(f.trigger.plan({create:{identifier:'Missing'},calls:[{kind:'Condition',function:'UnitIsAlive',args:{u:{kind:'unit',objectId:100}}}]}),/PLACED_UNIT_UNRESOLVED/);
});

test('nested gamelinks and initializers validate against the shared catalog and detect source changes',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.root,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(f.root,'Base.SC2Data/GameData/UnitData.xml'),'<Catalog><CUnit id="Marine"/></Catalog>');
 const p=await f.trigger.plan({create:{identifier:'Spawn'},variables:[{name:'Type',type:'gamelink',gameType:'Unit',initial:{kind:'gamelink',domain:'Unit',id:'Marine'}}],calls:[{kind:'Action',function:'IfThenElse',args:{},children:[{role:'if',call:{kind:'Condition',function:'Comparison',args:{val1:int(1),op:preset('eq'),val2:int(1)}}},{role:'then',call:{kind:'Action',function:'UnitCreate',args:{count:int(1),type:{kind:'gamelink',domain:'Unit',id:'Marine'},flags:preset('Birth'),player:int(1),pos:{kind:'call',function:'Point',args:{x:fixed(16),y:fixed(16)}},angle:fixed(0)}}}]}]});
 await fs.writeFile(path.join(f.root,'Base.SC2Data/GameData/UnitData.xml'),'<Catalog><CUnit id="Other"/></Catalog>');await assert.rejects(f.trigger.applyPlan(p.planId,false),/DEPENDENCY_STALE/);assert.deepEqual(f.ws.draftFiles(),[]);
});

test('localized text and new declarations are guarded by string revisions and save as a single group',async t=>{
 const f=await fixture(t),p=await f.trigger.plan({create:{identifier:'Hello'},variables:[{name:'Message',type:'text',initial:{kind:'text',value:'Hello',translations:{ruRU:'Привет'}}}],calls:[]});
 await fs.writeFile(path.join(f.root,'ruRU.SC2Data/LocalizedData/GameStrings.txt'),'External=change');await assert.rejects(f.trigger.applyPlan(p.planId,false),/STRINGS_STALE/);assert.deepEqual(f.ws.draftFiles(),[]);
});

test('loops have typed integer iterators, child roles and no out-of-loop Continue',async t=>{
 const f=await fixture(t),p=await f.trigger.plan({create:{identifier:'Loop'},variables:[{name:'i',type:'int',scope:'local'}],calls:[{kind:'Action',function:'ForEachInteger',args:{var:variable('i'),s:int(0),e:int(2),increment:int(1)},children:[{role:'actions',call:wait}]}]});await f.trigger.applyPlan(p.planId,false);assert.equal((await f.trigger.validate()).valid,true);await f.trigger.discard();
 await assert.rejects(f.trigger.plan({create:{identifier:'Bad'},calls:[{kind:'Action',function:'Continue',args:{}}]}),/OUTSIDE_LOOP/);
});

test('request schema rejects unsupported variable types, bad localization and unbounded/cyclic input',async t=>{
 const f=await fixture(t);assert.equal(triggerPlanSchema.safeParse({variables:[{name:'x',type:'unsafeType'}]}).success,false);
 assert.equal(triggerPlanSchema.safeParse({create:{identifier:'x',translations:{bad:'text'}}}).success,false);
 const call:GuiCall={...wait};call.children=[{role:'x',call}];await assert.rejects(f.trigger.plan({create:{identifier:'Cycle'},calls:[call]}),/CYCLE/);
});


test('declared catalog identities remain usable when supplemental Includes exclude standard files; undeclared roots are rejected',async t=>{
 const f=await fixture(t),mod=path.join(f.root,'dependency','Declared.SC2Mod'),other=path.join(f.root,'dependency','Other.SC2Mod');
 for(const dir of [mod,other]){await fs.mkdir(path.join(dir,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(dir,'Base.SC2Data/GameData.xml'),'<Includes/>');}
 await fs.writeFile(path.join(mod,'Base.SC2Data/GameData/UnitData.xml'),'<Catalog><CUnit id="Marine"/></Catalog>');
 await fs.writeFile(path.join(other,'Base.SC2Data/GameData/UnitData.xml'),'<Catalog><CUnit id="Undeclared"/></Catalog>');
 // Keep the mounted views outside the map tree, just as the app CASC cache does.
 const mapRoot=path.join(f.root,'map');await fs.mkdir(mapRoot);await fs.writeFile(path.join(mapRoot,'Triggers'),'<TriggerData><Root/></TriggerData>');await fs.writeFile(path.join(mapRoot,'DocumentInfo'),'<DocInfo><Dependencies><Value>file:Mods/Declared.SC2Mod</Value></Dependencies></DocInfo>');
 const ws=new Workspace(mapRoot),data=new DataWorkspace(ws);data.addDependencyRoot(mod);data.addDependencyRoot(other);const triggers=new TriggerWorkspace(ws,undefined,data);
 const make=(id:string):GuiRequest=>({variables:[{name:'Type',type:'gamelink',gameType:'Unit',initial:{kind:'gamelink',domain:'Unit',id}}],calls:[]});
 const plan=await triggers.plan(make('Marine'));assert.equal(plan.variables.length,1);assert.ok(plan.catalogValidation.includes('not certified'));
 await assert.rejects(triggers.plan(make('Undeclared')),/GAMELINK_UNRESOLVED/);assert.deepEqual(ws.draftFiles(),[]);
});


test('native VariableType/Constant is readable but cannot be assigned or used as a writable loop iterator',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.root,'Triggers'),'<TriggerData><Root><Item Type="Variable" Id="B5215932"/></Root><Element Type="Variable" Id="B5215932"><Identifier>ReadOnlyCount</Identifier><VariableType><Type Value="int"/><Constant/></VariableType><Value Type="Param" Id="C89CE4DE"/></Element><Element Type="Param" Id="C89CE4DE"><ValueType Type="int"/><Value>32</Value></Element></TriggerData>');
 assert.equal((await f.trigger.inspect()).variables?.[0].constant,true);
 const read=await f.trigger.plan({variables:[{name:'Copy',type:'int',initial:variable('ReadOnlyCount')}],calls:[]});assert.equal(read.variables.length,1);assert.deepEqual(f.ws.draftFiles(),[]);
 await assert.rejects(f.trigger.plan({create:{identifier:'WriteConst'},calls:[{kind:'Action',function:'SetVariable',args:{var:variable('ReadOnlyCount'),val:int(1)}}]}),/CONSTANT_WRITE/);
 await assert.rejects(f.trigger.plan({create:{identifier:'LoopConst'},calls:[{kind:'Action',function:'ForEachInteger',args:{var:variable('ReadOnlyCount'),s:int(0),e:int(3),increment:int(1)}}]}),/CONSTANT_WRITE/);
 assert.deepEqual(f.ws.draftFiles(),[]);
});
