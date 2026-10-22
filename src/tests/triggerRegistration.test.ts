import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {emitGuiGalaxy} from '../modules/trigger/runtime.js';
import {registry,type GuiCall,type GuiValue} from '../modules/trigger/authoring.js';
import {guiCallSchema} from '../modules/trigger/schemas.js';
import {inspectRevisedGui} from '../modules/trigger/revisedImport.js';
import {checkRegistrationSignature} from '../modules/trigger/registration.js';
const variable=(name:string):GuiValue=>({kind:'variable',name}),param=(name:string):GuiValue=>({kind:'parameter',name});
const int=(value:number):GuiValue=>({kind:'literal',type:'int',value});
const registration=(trigger:GuiValue= {kind:'trigger',name:'Receiver'}):GuiCall=>({kind:'Registration',function:'TriggerAddEventTimer',trigger,args:{t:variable('Clock')}});
async function fixture(t:{after(fn:()=>Promise<unknown>):void}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-registration-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');const workspace=new Workspace(root),triggers=new TriggerWorkspace(workspace);
 const receiver=await triggers.plan({create:{identifier:'Receiver'},variables:[{name:'Clock',type:'timer',initial:{kind:'nativeCall',function:'TimerCreate'}},{name:'Order',type:'int',initial:int(0)}],calls:[]});await triggers.applyPlan(receiver.planId,false);return {workspace,triggers,root,receiver};
}
test('runtime registration remains an Action at the original position with an explicit distinct trigger and typed timer',async t=>{
 const f=await fixture(t),plan=await f.triggers.plan({create:{identifier:'Registrar'},calls:[{kind:'Action',function:'SetVariable',args:{var:variable('Order'),val:int(1)}},registration(),{kind:'Action',function:'SetVariable',args:{var:variable('Order'),val:int(2)}}]});assert.equal(plan.registrations,1);assert.equal(plan.actions,3);assert.equal(plan.events,0);await f.triggers.applyPlan(plan.planId,false);
 const xml=(await f.workspace.readRaw('Triggers')).text,code=emitGuiGalaxy(xml,registry()).source;
 assert.equal(inspectRevisedGui(xml).customScripts,0);assert.doesNotMatch(xml,/ScriptCode|CustomScript|\[object Object\]/);assert.match(xml,/<ParameterType><Type Value="trigger"\/><\/ParameterType>/);assert.match(code,/TriggerAddEventTimer\(gt_Receiver, gv_Clock\)/);
 assert.ok(code.indexOf('gv_Order = 1;')<code.indexOf('TriggerAddEventTimer(gt_Receiver, gv_Clock)'));assert.ok(code.indexOf('TriggerAddEventTimer(gt_Receiver, gv_Clock)')<code.indexOf('gv_Order = 2;'));
 const js=code.replace(/^include .*$/gm,'').replace(/^(?:void|int|bool|timer|trigger) \w+ \([^\n]*\);$/gm,'').replace(/^(?:void|int|bool|timer|trigger) (\w+) \(([^\n]*)\) \{/gm,(_m,name,args)=>'function '+name+' ('+args.replace(/\b(?:bool|int|timer|trigger)\s+/g,'')+') {').replace(/^(?:int|timer|trigger) (\w+);$/gm,'var $1;');
 const seen:unknown[]=[],ctx=vm.createContext({libNtve_InitLib:()=>{},TimerCreate:()=>({timer:true}),TriggerCreate:(name:string)=>({name}),TriggerAddEventTimer:(target:unknown,clock:unknown)=>seen.push({target,clock,order:ctx.gv_Order})});vm.runInContext(js+'\nInitMap();',ctx);assert.deepEqual(seen,[]);vm.runInContext('gt_Registrar_Func(false, true);',ctx);assert.deepEqual(seen,[{target:ctx.gt_Receiver,clock:ctx.gv_Clock,order:1}]);assert.equal(ctx.gv_Order,2);
});
test('registration accepts scoped function parameters and local timer references without event-initialization restrictions',async t=>{
 const f=await fixture(t),p=await f.triggers.plan({functions:[{name:'Install',kind:'Action',parameters:[{name:'destination',type:'trigger'},{name:'clock',type:'timer',reference:true}],variables:[{name:'LocalClock',type:'timer',scope:'local',initial:param('clock')}],calls:[{kind:'Registration',function:'TriggerAddEventTimer',trigger:param('destination'),args:{t:variable('LocalClock')}}]}],calls:[]});await f.triggers.applyPlan(p.planId,false);const xml=(await f.workspace.readRaw('Triggers')).text,code=emitGuiGalaxy(xml,registry()).source;assert.match(code,/TriggerAddEventTimer\(lp_destination, lv_LocalClock\)/);assert.doesNotMatch(xml,/ScriptCode|CustomScript/);
});
test('events remain distinct from ordinary Actions; missing/wrong targets reject before staging',async t=>{
 const f=await fixture(t);assert.throws(()=>guiCallSchema.parse({kind:'Registration',function:'TriggerAddEventTimer',args:{}}));
 const before=(await f.workspace.readRaw('Triggers')).text;
 for(const call of [{kind:'Action',function:'TriggerAddEventTimer',args:{t:variable('Clock')}} as GuiCall,registration(int(1)),registration({kind:'trigger',name:'Missing'})])await assert.rejects(f.triggers.plan({create:{identifier:'Invalid'},calls:[call]}),/GUI_FUNCTION_ROLE_OR_TYPE|GUI_TYPE_MISMATCH|GUI_TRIGGER_REFERENCE/);
 assert.equal((await f.workspace.readRaw('Triggers')).text,before);
});
test('native registration checks the exact GUI binding and keeps an explicit null target unquoted',async t=>{
 const native=(registry().definitions??registry().functions).find(f=>f.name==='TriggerAddEventTimer')!;
 assert.doesNotThrow(()=>checkRegistrationSignature(native));assert.throws(()=>checkRegistrationSignature({...native,id:'FFFFFFFF'}),/NATIVE_GUI_BINDING/);assert.throws(()=>checkRegistrationSignature({...native,origin:'map'}),/NATIVE_EVENT_REQUIRED/);
 const f=await fixture(t),p=await f.triggers.plan({create:{identifier:'ExplicitNull'},calls:[registration({kind:'literal',type:'trigger',value:null})]});await f.triggers.applyPlan(p.planId,false);assert.match(emitGuiGalaxy((await f.workspace.readRaw('Triggers')).text,registry()).source,/TriggerAddEventTimer\(null, gv_Clock\)/);
});
