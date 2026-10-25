import test from 'node:test';
import assert from 'node:assert/strict';
import {formationSchema,testManifestSchema,type CheckState} from '../modules/testing/schemas.js';
import {runFormationCheck} from '../modules/testing/formationChecks.js';
import type {GameResult} from '../integrations/game/transport.js';

const from={x:16,y:20},to={x:16,y:32};
const spec=formationSchema.parse({id:'gate',from:'a',to:'b',type:'Marine',mobility:'ground',offsets:[{x:-1,y:0},{x:1,y:0}],timeout:1,maxDeviation:2});
const reply=(body:Record<string,unknown>):GameResult=>({structuredContent:{status:'ok',...body},content:[]});
function runtime(options:{instant?:boolean;sequential?:boolean;blocked?:boolean;detour?:boolean;damage?:boolean;displaced?:boolean;duplicate?:boolean;wrongOwner?:boolean;ambiguousOrder?:boolean;ambiguousCreate?:boolean;cleanupFails?:boolean;recordFails?:boolean;cancel?:boolean}={}){
 const calls:Array<{method:string;args:Record<string,any>}>=[],records=new Map<string,any>(),units=new Map<string,any>();let count=0,clock=0,orderCount=0;
 const body=(r:GameResult)=>r.structuredContent as Record<string,any>,state=(r:GameResult):CheckState=>r.isError?'failed':'passed';
 const hooks={body,state,pollMs:1,now:()=>clock,delay:async()=>{clock+=500;},checkCancel:()=>{if(options.cancel&&orderCount)throw Error('TEST_CANCEL_REQUESTED');},
  record:async(name:string,value:unknown)=>{if(options.recordFails&&name==='trajectory')throw Error('disk full');records.set(name,structuredClone(value));return name+'.json';},
  call:async(method:string,args:Record<string,unknown>)=>{
   calls.push({method,args});
   if(method==='game.fixture'&&args.action==='cleanup'){for(const unit of units.values())if(!options.cleanupFails)unit.valid=false;return reply({});}
   if(method==='game.fixture'){
    const id=options.duplicate?'1':String(++count),unit={id,type:args.type,owner:options.wrongOwner?2:args.owner,valid:true,alive:true,life:45,shields:0,position:{x:Number(args.x)+(options.displaced?4:0),y:args.y},step:0};units.set(id,unit);
    return reply(options.ambiguousCreate?{}:{unit});
   }
   const unit=units.get(String(args.unit));
   if(method==='game.order'){orderCount++;if(options.ambiguousOrder&&orderCount===2)throw Error('ambiguous response');unit.start={...unit.position};unit.target={x:args.x,y:args.y};return reply({accepted:true});}
   if(method==='game.units.inspect'){
    if(unit.valid&&unit.target&&!options.blocked&&(!options.sequential||unit.id==='1'||units.get('1').step>=3)){const progress=options.instant?1:Math.min(++unit.step/3,1);unit.position={x:unit.start.x+(unit.target.x-unit.start.x)*progress+(options.detour&&progress<1?8:0),y:unit.start.y+(unit.target.y-unit.start.y)*progress};if(options.damage)unit.life=44;}
    return reply({unit});
   }
   throw Error('Unexpected method '+method);
  }};
 return {hooks,calls,records,units};
}

test('formation submits every distinct member before observing movement and preserves individual trajectories and cleanup',async()=>{
 const f=runtime(),result=await runFormationCheck(spec,from,to,false,f.hooks),check=result.checks[0];
 assert.equal(check.status,'passed');assert.equal(result.continueSuite,true);assert.equal(check.evidence?.arrivedMembers,2);assert.ok(Number(check.evidence?.concurrentInTransitSamples)>0);
 assert.equal(check.evidence?.maxObservedDeviation,0);assert.equal(check.evidence?.ordersSubmitted,'complete');
 const orders=f.calls.map((c,i)=>({c,i})).filter(v=>v.c.method==='game.order'),post=f.calls.findIndex((c,i)=>c.method==='game.units.inspect'&&i>orders[0].i);
 assert.ok(orders[1].i<post);assert.deepEqual(orders.map(v=>v.c.args),[{unit:'1',action:'move',x:15,y:32},{unit:'2',action:'move',x:17,y:32}]);
 const samples=f.records.get('trajectory');assert.equal(samples.length,4);assert.equal(samples[0].members[0].observation.position.y,20);assert.equal(samples.at(-1).members[0].observation.position.y,32);assert.equal(samples[0].members[0].observation.valid,true,'Later cleanup must not mutate recorded samples');
 assert.equal(result.checks.at(-1)?.status,'passed');assert.ok([...f.units.values()].every(u=>u.valid===false));
});

test('arrival alone and non-arrival cannot certify a concurrent formation or a valid obstruction',async()=>{
 for(const options of [{instant:true},{blocked:true}]){const f=runtime(options),r=await runFormationCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'inconclusive');assert.equal(r.continueSuite,false);assert.equal(r.checks[0].evidence?.concurrentInTransitSamples,0);assert.equal(r.checks.at(-1)?.status,'passed');}
 assert.match((await runFormationCheck(spec,from,to,false,runtime({blocked:true}).hooks)).checks[0].reason??'',/does not prove an obstruction/);
 const sequential=await runFormationCheck({...spec,timeout:4},from,to,false,runtime({sequential:true}).hooks);assert.equal(sequential.checks[0].evidence?.arrivedMembers,2);assert.equal(sequential.checks[0].status,'inconclusive');assert.equal(sequential.checks[0].evidence?.concurrentInTransitSamples,0);
});
test('group samples retain same-response native clocks and detect a replaced runtime without new queries',async()=>{
 for(const replaced of [false,true]){
  const f=runtime(),original=f.hooks.call;let ticks=0,ordered=false;
  f.hooks.call=async(method,args)=>{const response=await original(method,args);if(method==='game.order')ordered=true;return reply({...f.hooks.body(response),session:'group',runtimeEpoch:replaced&&ordered&&method==='game.units.inspect'?'replacement':'original',mapLoadSerial:1,gameTime:++ticks*.0625});};
  const result=await runFormationCheck(spec,from,to,false,f.hooks),check=result.checks[0],clock=check.evidence?.movementClock as any;
  assert.equal(clock.quality,replaced?'invalid':'verified');assert.equal(check.status,replaced?'inconclusive':'passed');
  assert.equal(f.calls.filter(c=>c.method==='game.status').length,0);assert.equal(f.calls.filter(c=>c.method==='game.order').length,2);
  const samples=f.records.get('trajectory');assert.equal(samples[0].members[0].observationClock.native.session,'group');assert.equal(samples[0].members[0].observation.id,'1');
  if(replaced)assert.match(check.reason!,/identity or monotonicity/);else assert.ok(clock.gameElapsedSeconds>0);
 }
});

test('offset corridor departure fails while combat interference is retained as inconclusive with partial observations',async()=>{
 const detour=await runFormationCheck(spec,from,to,false,runtime({detour:true}).hooks);assert.equal(detour.checks[0].status,'failed');assert.ok(Number(detour.checks[0].evidence?.maxObservedDeviation)>2);
 const f=runtime({damage:true}),damage=await runFormationCheck(spec,from,to,false,f.hooks);assert.equal(damage.checks[0].status,'inconclusive');assert.match(damage.checks[0].reason??'',/COMBAT_INTERFERENCE/);assert.equal(f.records.get('trajectory').at(-1).members[0].observation.life,44);
});

test('displaced spawns, wrong ownership and duplicate identities reject before any movement orders',async()=>{
 for(const options of [{displaced:true},{wrongOwner:true},{duplicate:true}]){
  const f=runtime(options),r=await runFormationCheck(spec,from,to,false,f.hooks);assert.notEqual(r.checks[0].status,'passed');assert.equal(f.calls.some(c=>c.method==='game.order'),false);assert.equal(r.checks.at(-1)?.status,'passed');
 }
});

test('ambiguous creation/order is never retried and test-owned cleanup still runs',async()=>{
 for(const options of [{ambiguousCreate:true},{ambiguousOrder:true}]){
  const f=runtime(options),r=await runFormationCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'inconclusive');assert.equal(r.checks[0].evidence?.ordersSubmitted,'unknown');assert.equal(r.continueSuite,false);
  assert.equal(f.calls.filter(c=>c.method==='game.fixture'&&!c.args.action).length,options.ambiguousCreate?1:2);assert.equal(f.calls.filter(c=>c.method==='game.order').length,options.ambiguousCreate?0:2);assert.equal(f.calls.filter(c=>c.args.action==='cleanup').length,1);
 }
 const optional=await runFormationCheck({...spec,required:false},from,to,false,runtime({ambiguousOrder:true}).hooks);assert.equal(optional.continueSuite,false);assert.equal(optional.checks.find(c=>c.id.endsWith(':submission'))?.required,true);
});

test('cleanup failure and missing trajectory persistence cannot pass; cancellation also removes owned fixtures',async()=>{
 for(const options of [{cleanupFails:true},{recordFails:true}]){const f=runtime(options),r=await runFormationCheck(spec,from,to,false,f.hooks);assert.equal(r.continueSuite,false);assert.ok(r.checks.some(c=>c.status==='failed'));assert.equal(f.calls.filter(c=>c.args.action==='cleanup').length,1);}
 const f=runtime({cancel:true});await assert.rejects(runFormationCheck(spec,from,to,false,f.hooks),/TEST_CANCEL_REQUESTED/);assert.equal(f.calls.filter(c=>c.args.action==='cleanup').length,1);assert.ok([...f.units.values()].every(u=>!u.valid));
});

test('requested group frame is taken with all fixtures alive before cleanup and remains an independent verdict',async()=>{
 const f=runtime(),r=await runFormationCheck(spec,to,from,true,{...f.hooks,capture:async()=>{assert.ok([...f.units.values()].every(u=>u.valid));return {id:'frame',status:'inconclusive',required:true,reason:'camera unavailable'};}});
 assert.equal(r.checks[0].id,'formation:gate:reverse');assert.equal(r.checks[0].status,'passed');assert.equal(r.checks[1].status,'inconclusive');assert.equal(r.continueSuite,false);
 for(const required of [true,false]){const f=runtime(),r=await runFormationCheck(spec,from,to,false,{...f.hooks,captureRequired:required,capture:async()=>{throw Error('Native capture lost');}});assert.equal(r.checks[0].status,'passed');assert.equal(r.continueSuite,!required);assert.equal(r.checks.find(c=>c.id.endsWith(':frame'))?.required,required);assert.equal(r.checks.at(-1)?.status,'passed');}
});

test('strict formation manifests reject flight, duplicate/unsafe offsets, trivial movement and unresolved views',()=>{
 const base={version:1,map:'Test.SC2Map',game:{points:{a:from,b:to},formations:[spec]}};
 assert.equal(testManifestSchema.parse(base).game?.formations.length,1);
 for(const formation of [{...spec,mobility:'air'},{...spec,offsets:[{x:0,y:0}]},{...spec,offsets:[{x:0,y:0},{x:0,y:0}]},{...spec,offsets:[{x:0,y:0},{x:65,y:0}]},{...spec,viewId:'missing'},{...spec,to:'missing'}])assert.throws(()=>testManifestSchema.parse({...base,game:{...base.game,formations:[formation]}}));
 assert.throws(()=>testManifestSchema.parse({...base,game:{...base.game,points:{a:from,b:from}}}));
 assert.throws(()=>testManifestSchema.parse({...base,game:{...base.game,routes:[{id:'gate',from:'a',to:'b',type:'Marine',mobility:'ground'}],formations:[spec]}}),/Duplicate check ID/);
});

test('untrusted transport diagnostics remain private instead of entering public formation checks',async()=>{
 const f=runtime(),call=f.hooks.call;
 f.hooks.call=async(method,args)=>{if(method==='game.order')throw Error('PrivateSdkSecret();\nScript code: injected implementation');return call(method,args);};
 const r=await runFormationCheck(spec,from,to,false,f.hooks);
 assert.equal(r.checks[0].status,'inconclusive');assert.ok(!JSON.stringify(r.checks).includes('PrivateSdkSecret'));assert.match(f.records.get('failure').error,/PrivateSdkSecret/);assert.equal(r.checks.at(-1)?.status,'passed');
});
