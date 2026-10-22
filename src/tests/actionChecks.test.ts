import test from 'node:test';
import assert from 'node:assert/strict';
import {actionCheckSchema,runActionCheck} from '../modules/testing/actionChecks.js';
import type {ActionEventsRequest,ActionEventsReport} from '../integrations/game/actionEvents.js';
import type {GameResult} from '../integrations/game/transport.js';
const ok=(body:Record<string,unknown>):GameResult=>({content:[{type:'text',text:JSON.stringify({status:'ok',...body})}]});
const request=()=>actionCheckSchema.parse({id:'pulse',before:[{id:'caster',method:'game.units.find',arguments:{type:'Caster'},expect:{'units.0.valid':true}},{id:'target',method:'game.units.find',arguments:{type:'Target'}}],action:{method:'game.order',arguments:{unit:{$from:'caster.units.0.id'},action:'ability',ability:'Pulse',command:0,target_unit:{$from:'target.units.0.id'}}},events:[{id:'hit',match:{kind:'damage',source:'galaxy',unit:{$from:'target.units.0.id'},amount:40}}],after:[{id:'health',method:'game.units.inspect',arguments:{unit:{$from:'target.units.0.id'}},expect:{'unit.life':460,'unit.id':{$from:'target.units.0.id'}}}]} );
function fixture(){
 const calls:Array<{method:string;args:unknown}>=[],records=new Map<string,unknown>(),actions:ActionEventsRequest[]=[];
 const options={checkCancel:()=>{},record:async(name:string,value:unknown)=>{records.set(name,value);},call:async(method:string,args:Record<string,unknown>)=>{calls.push({method,args});return method==='game.units.find'?ok({units:[{id:args.type==='Caster'?'c':'t',valid:true}]}):ok({unit:{id:args.unit,life:460}});},action:async(request:ActionEventsRequest):Promise<ActionEventsReport>=>{actions.push(request);return {status:'passed',actionSubmitted:true,events:request.events.map(e=>({...e,matched:{...e.match}})),baselinePages:1,observationPages:1,eventsRead:2,dropped:false,scope:'Synthetic primitive contract'};}};
 return {calls,records,actions,options};
}
test('action checks resolve local setup references, delegate once and verify authoritative readback without splitting upstream scenarios',async()=>{
 const f=fixture(),r=await runActionCheck(request(),f.options);assert.equal(r.status,'passed');assert.equal(r.actionSubmitted,true);assert.equal(f.actions.length,1);assert.equal(f.actions[0].action.arguments.unit,'c');assert.equal(f.actions[0].action.arguments.target_unit,'t');assert.equal(f.actions[0].events[0].match.unit,'t');assert.equal(f.calls.filter(c=>c.method==='game.test.run').length,0);assert.equal(r.queries.length,3);assert.ok(f.records.has('before_caster')&&f.records.has('observation')&&f.records.has('after_health')&&f.records.has('result'));
});
test('unsafe, forward, duplicate and foreign-reference protocols reject before invocation',()=>{
 for(const mutate of [(r:any)=>r.action.arguments.unit={$from:'later.unit'},(r:any)=>r.action.arguments.unit={$from:'caster.constructor'},(r:any)=>r.action.arguments.unit={$from:'caster.units.0.id',extra:true},(r:any)=>r.action.arguments.unit={$ref:'caster.units.0.id'},(r:any)=>r.before[1].id='caster',(r:any)=>r.before[1].id='observation']){const r=request();mutate(r);assert.throws(()=>actionCheckSchema.parse(r));}
});
test('deep reference graphs reject during planning rather than overflowing during execution',()=>{
 const r=request();let deep:unknown={value:1};for(let i=0;i<35;i++)deep={value:deep};r.before[0].arguments.extra=deep;assert.throws(()=>actionCheckSchema.parse(r),/depth\/node limit/);
});
test('missing setup values and resolved caster conflicts fail before submitting the action',async()=>{
 for(const mode of ['missing','conflict']){const f=fixture(),r=request();if(mode==='missing')r.action.arguments.unit={$from:'caster.units.5.id'};else r.events[0].match.sourceUnit='other';const report=await runActionCheck(r,f.options);assert.equal(report.status,'failed');assert.equal(report.actionSubmitted,false);assert.equal(f.actions.length,0);assert.ok(f.records.has('result'));}
});
test('ambiguous action errors never retry or run after checks and retain unknown submission',async()=>{
 const f=fixture();let attempts=0;f.options.action=async()=>{attempts++;throw Error('transport lost');};const r=await runActionCheck(request(),f.options);assert.equal(r.status,'inconclusive');assert.equal(r.actionSubmitted,'unknown');assert.equal(attempts,1);assert.equal(f.calls.length,2);assert.ok(f.records.has('result'));
});
test('missing primitive remains unsupported with a persisted report and no setup invocation',async()=>{
 const f=fixture(),r=await runActionCheck(request(),{...f.options,action:undefined});assert.equal(r.status,'unsupported');assert.equal(r.actionSubmitted,false);assert.equal(f.calls.length,0);assert.ok(f.records.has('result'));
});
test('readback mismatch cannot pass even after observed execution and is not retried',async()=>{
 const f=fixture(),r=request();r.after[0].expect['unit.life']=459;const report=await runActionCheck(r,f.options);assert.equal(report.status,'failed');assert.equal(report.actionSubmitted,true);assert.equal(f.actions.length,1);assert.equal(report.queries.at(-1)?.status,'failed');
});
test('cancellation crosses the action-check boundary for owning workflow cleanup',async()=>{
 const f=fixture();await assert.rejects(runActionCheck(request(),{...f.options,checkCancel:()=>{throw Error('TEST_CANCEL_REQUESTED');}}),/TEST_CANCEL_REQUESTED/);assert.equal(f.actions.length,0);
});
