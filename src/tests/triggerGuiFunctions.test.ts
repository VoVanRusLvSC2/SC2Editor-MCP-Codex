import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {scanXml} from '../core/xmlScanner.js';
import {type GuiRequest,type GuiValue,type GuiFunction,type GuiCall} from '../modules/trigger/authoring.js';
import {triggerPlanSchema} from '../modules/trigger/schemas.js';
async function fixture(t:{after(fn:()=>Promise<unknown>):void},initial='<TriggerData><Root/></TriggerData>'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-functions-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),initial);const ws=new Workspace(root);return{root,ws,tr:new TriggerWorkspace(ws)};
}
const int=(value:number):GuiValue=>({kind:'literal',type:'int',value}),fixed=(value:number):GuiValue=>({kind:'literal',type:'fixed',value}),param=(name:string):GuiValue=>({kind:'parameter',name}),variable=(name:string):GuiValue=>({kind:'variable',name});
const identity:GuiFunction={name:'Identity',kind:'Function',parameters:[{name:'value',type:'int'}],returnType:{type:'int'},calls:[],returns:param('value')};
const delay:GuiFunction={name:'Delay',kind:'Action',parameters:[{name:'duration',type:'fixed'}],calls:[{kind:'Action',function:'Wait',args:{t:param('duration'),timeType:{kind:'preset',name:'game'}}}]};
const call=(name:string,args:Record<string,GuiValue>={}):GuiValue=>({kind:'call',function:'custom:'+name,args});

test('custom action, condition, event and value function form one linked root GUI plan without a resource library',async t=>{
 const f=await fixture(t),functions:GuiFunction[]=[delay,identity,{name:'BelowTen',kind:'Condition',parameters:[{name:'value',type:'int'}],calls:[],returns:{kind:'call',function:'Comparison',args:{val1:param('value'),op:{kind:'preset',name:'lt'},val2:int(10)}}},{name:'Every',kind:'Event',parameters:[{name:'seconds',type:'fixed'}],calls:[{kind:'Event',function:'TriggerAddEventTimePeriodic',args:{dur:param('seconds'),timeType:{kind:'preset',name:'game'}}}]}];
 const p=await f.tr.plan({create:{identifier:'Reusable'},variables:[{name:'Ticks',type:'int'}],functions,calls:[{kind:'Event',function:'custom:Every',args:{seconds:fixed(20)}},{kind:'Condition',function:'custom:BelowTen',args:{value:call('Identity',{value:int(5)})}},{kind:'Action',function:'custom:Delay',args:{duration:fixed(0.5)}},{kind:'Action',function:'SetVariable',args:{var:variable('Ticks'),val:call('Identity',{value:int(2)})}}]});
 assert.equal(p.functions.length,4);assert.equal(p.customEventEditorValidation,'NOT_EXECUTED');assert.deepEqual(f.ws.draftFiles(),[]);
 await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);await f.tr.save(false);
 const xml=await fs.readFile(path.join(f.root,'Triggers'),'utf8');assert.ok(!xml.includes('<Library')&&!xml.includes('Library=""')&&!xml.includes('<CustomScript'));
 const tree=scanXml(xml);for(const definition of p.functions){const node=tree.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='FunctionDef'&&n.attrs.Id===definition.id)!;assert.ok(node.childIds.some(i=>tree.nodes[i].tag==='Flag'+(definition.kind==='Function'?'Call':definition.kind)));for(const parameter of definition.parameters)assert.ok(tree.nodes.some(n=>n.tag==='Parameter'&&n.attrs.Type==='ParamDef'&&n.attrs.Id===parameter.id));}
 assert.equal((await f.tr.inspect()).functions?.length,4);
 assert.equal((await f.tr.searchAvailableFunctions('Identity')).items[0].source,'map');assert.equal((await f.tr.describeAvailableFunction('custom:Identity')).parameters[0].type,'int');
});

test('parameter scope, local initialization, shadowing and typed returns are enforced',async t=>{
 const f=await fixture(t),fn:GuiFunction={...identity,name:'Local',variables:[{name:'value',type:'int',scope:'local',initial:param('value')}],calls:[{kind:'Action',function:'SetVariable',args:{var:variable('value'),val:int(3)}}],returns:variable('value')};
 const p=await f.tr.plan({functions:[fn],calls:[]});await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);
 const bad:GuiFunction={...identity,name:'Bad',returns:fixed(2)};await assert.rejects(f.tr.plan({functions:[bad],calls:[]}),/TYPE_MISMATCH/);
 await assert.rejects(f.tr.plan({create:{identifier:'WrongScope'},calls:[{kind:'Action',function:'Wait',args:{t:param('duration'),timeType:{kind:'preset',name:'game'}}}]}),/PARAMETER_UNRESOLVED_OR_SCOPE/);
});

test('function-only plans support forward calls; later plans can call persisted definitions by name or ID',async t=>{
 const f=await fixture(t),p=await f.tr.plan({functions:[{...identity,name:'First',returns:call('Identity',{value:param('value')})},identity],calls:[]});await f.tr.applyPlan(p.planId,false);await f.tr.save(false);
 const id=p.functions[1].id,p2=await f.tr.plan({create:{identifier:'Reuse'},variables:[{name:'Result',type:'int'}],calls:[{kind:'Action',function:'SetVariable',args:{var:variable('Result'),val:{kind:'call',function:id,args:{value:int(42)}}}}]});await f.tr.applyPlan(p2.planId,false);assert.equal((await f.tr.validate()).valid,true);
});

test('direct, mutual and initializer recursion are rejected without staging',async t=>{
 const f=await fixture(t);
 for(const functions of [[{...identity,returns:call('Identity',{value:param('value')})}],[{...identity,returns:call('Other',{value:param('value')})},{...identity,name:'Other',returns:call('Identity',{value:param('value')})}],[{...identity,variables:[{name:'x',type:'int' as const,scope:'local' as const,initial:call('Identity',{value:param('value')})}]}]]){
  await assert.rejects(f.tr.plan({functions,calls:[]}),/RECURSION_UNSUPPORTED/);assert.deepEqual(f.ws.draftFiles(),[]);
 }
});

test('duplicate names, parameter aliases, missing arguments and role mismatches fail before mutations',async t=>{
 const f=await fixture(t);
 const requests:GuiRequest[]=[{functions:[identity,identity],calls:[]},{functions:[{...identity,parameters:[{name:'value',type:'int'},{name:'value',type:'int'}]}],calls:[]},{create:{identifier:'Bad'},functions:[delay],calls:[{kind:'Action',function:'custom:Delay',args:{}}]},{create:{identifier:'Bad'},functions:[identity],calls:[{kind:'Action',function:'custom:Identity',args:{value:int(1)}}]},{functions:[{...identity,returns:param('missing')}],calls:[]}];
 for(const request of requests){await assert.rejects(f.tr.plan(request));assert.deepEqual(f.ws.draftFiles(),[]);}
});

test('known return paths are mandatory and event bodies only register events',async t=>{
 const f=await fixture(t);
 for(const fn of [{...identity,returns:undefined},{...identity,kind:'Condition',returnType:{type:'int'}},{...delay,returns:int(1)},{...delay,kind:'Event'},{name:'Empty',kind:'Event',calls:[]} ] as GuiFunction[]){await assert.rejects(f.tr.plan({functions:[fn],calls:[]}));}
 await assert.rejects(f.tr.plan({create:{identifier:'BadReturn'},calls:[{kind:'Action',function:'Return',args:{val:int(1)}}]}),/RETURN_OUTSIDE/);
});

test('native/custom name collisions require an explicit namespace',async t=>{
 const f=await fixture(t),same={...delay,name:'Wait',calls:delay.calls.map(c=>({...c,function:'native:Wait'}))};
 await assert.rejects(f.tr.plan({create:{identifier:'Ambiguous'},functions:[same],calls:[{kind:'Action',function:'Wait',args:{duration:fixed(1)}}]}),/AMBIGUOUS/);
 const p=await f.tr.plan({create:{identifier:'Explicit'},functions:[same],calls:[{kind:'Action',function:'custom:Wait',args:{duration:fixed(1)}},{kind:'Action',function:'native:Wait',args:{t:fixed(1),timeType:{kind:'preset',name:'game'}}}]});await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);
});

test('function localization is coupled and source/string edits invalidate a saved plan',async t=>{
 const f=await fixture(t),p=await f.tr.plan({functions:[{...identity,translations:{ruRU:'Вернуть число'},parameters:[{name:'value',type:'int',translations:{ruRU:'Число'}}]}],calls:[]});
 await f.tr.applyPlan(p.planId,false);await f.tr.save(false);const table=await fs.readFile(path.join(f.root,'ruRU.SC2Data/LocalizedData/TriggerStrings.txt'),'utf8');assert.ok(table.includes('Вернуть число')&&table.includes('Число'));
 const p2=await f.tr.plan({functions:[{...identity,name:'Second'}],calls:[]});await fs.appendFile(path.join(f.root,'ruRU.SC2Data/LocalizedData/TriggerStrings.txt'),'\nChanged=1');await assert.rejects(f.tr.applyPlan(p2.planId,false),/STRINGS_STALE/);
});

test('map-local functions in an existing library have scoped ParamDef references and cannot cross into root',async t=>{
 const f=await fixture(t,'<TriggerData><Root/><Library Id="Existing"><Root/></Library></TriggerData>');
 const p=await f.tr.plan({create:{library:'Existing',identifier:'Use'},functions:[delay],calls:[{kind:'Action',function:'custom:Delay',args:{duration:fixed(1)}}]});await f.tr.applyPlan(p.planId,false);await f.tr.save(false);assert.equal((await f.tr.validate()).valid,true);
 const xml=await fs.readFile(path.join(f.root,'Triggers'),'utf8');assert.ok(xml.includes('ParameterDef Type="ParamDef" Library="Existing"'));
 await assert.rejects(f.tr.plan({create:{identifier:'Root'},calls:[{kind:'Action',function:'custom:Delay',args:{duration:fixed(1)}}]}),/UNSUPPORTED/);
});

test('schema rejects global function locals, unsafe identifiers and excessive declarations',()=>{
 assert.equal(triggerPlanSchema.safeParse({functions:[{...identity,name:'Bad Name'}]}).success,false);
 assert.equal(triggerPlanSchema.safeParse({functions:[{...identity,variables:[{name:'x',type:'int',scope:'global'}]}]}).success,false);
 assert.equal(triggerPlanSchema.safeParse({functions:Array.from({length:33},(_,i)=>({...identity,name:'Func'+i}))}).success,false);
});

test('a large call batch preserves kind ordering and graph integrity while rendering one symbol snapshot',async t=>{
 const f=await fixture(t),calls:GuiCall[]=Array.from({length:90},()=>({kind:'Action',function:'custom:Delay',args:{duration:fixed(0.01)}}));
 calls.push({kind:'Event',function:'TriggerAddEventMapInit',args:{}});
 const p=await f.tr.plan({create:{identifier:'Batch'},functions:[delay],calls});await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);
 const tree=scanXml((await f.ws.readRaw('Triggers')).text),owner=tree.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='Trigger')!,refs=owner.childIds.map(i=>tree.nodes[i]).filter(n=>['Event','Action'].includes(n.tag));assert.equal(refs[0].tag,'Event');assert.equal(refs.length,91);
});


test('a custom definition named Comparison uses its own signature rather than native operator rules',async t=>{
 const f=await fixture(t),p=await f.tr.plan({create:{identifier:'OwnCompare'},functions:[{name:'Comparison',kind:'Condition',parameters:[{name:'value',type:'bool'}],calls:[],returns:param('value')}],calls:[{kind:'Condition',function:'custom:Comparison',args:{value:{kind:'literal',type:'bool',value:true}}}]});await f.tr.applyPlan(p.planId,false);assert.equal((await f.tr.validate()).valid,true);
});


test('shipped reusable definitions example covers timer and named signals, without raw scripts or libraries',async t=>{
 const f=await fixture(t),plans=JSON.parse(await fs.readFile(path.resolve('examples/triggers/custom-gui-functions.json'),'utf8'));
 for(const request of plans){const plan=await f.tr.plan(request);await f.tr.applyPlan(plan.planId,false);await f.tr.save(false);assert.equal((await f.tr.validate()).valid,true);}
 const xml=await fs.readFile(path.join(f.root,'Triggers'),'utf8');assert.ok(!xml.includes('<CustomScript')&&!xml.includes('<Library'));
 assert.equal((await f.tr.inspect()).functions?.length,6);assert.equal((await f.tr.inspect()).triggers.length,2);
});

test('custom Event binds implicit t as the first argument of native registration',async t=>{
 const f=await fixture(t);const plan=await f.tr.plan({functions:[{name:'EverySecond',kind:'Event',parameters:[],calls:[{kind:'Event',function:'TriggerAddEventTimePeriodic',args:{dur:fixed(1),timeType:{kind:'preset',name:'game'}}}]}],create:{identifier:'Tick'},calls:[{kind:'Event',function:'custom:EverySecond',args:{}}]});await f.tr.applyPlan(plan.planId,false);await f.tr.save(false);
 const xml=await fs.readFile(path.join(f.root,'Triggers'),'utf8'),tree=scanXml(xml);const helper=tree.nodes.find(n=>n.attrs.Type==='FunctionDef'&&n.childIds.some(i=>tree.nodes[i].tag==='Section'))!;
 const signature=helper.childIds.map(i=>tree.nodes[i]).filter(n=>n.tag==='Parameter');assert.equal(signature.length,3);
 const bodyCall=tree.nodes.find(n=>n.attrs.Type==='FunctionCall'&&n.tag==='Element'&&n.childIds.some(i=>tree.nodes[i].tag==='FunctionDef'&&tree.nodes[i].attrs.Id===helper.attrs.Id))!;
 const argumentsXml=bodyCall.childIds.map(i=>tree.nodes[i]).filter(n=>n.tag==='Parameter');assert.equal(argumentsXml.length,3);
 const first=tree.nodes.find(n=>n.tag==='Element'&&n.attrs.Type==='Param'&&n.attrs.Id===argumentsXml[0].attrs.Id)!;assert.match(xml.slice(first.start,first.end),/<CustomType Type="trigger"\/>/);assert.match(xml.slice(first.start,first.end),/ScriptCode>\s*t\s*<\/ScriptCode/);
 assert.equal((await f.tr.validate()).valid,true);assert.equal((await f.tr.searchAvailableFunctions('EverySecond')).total,1);
});
