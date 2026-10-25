import test from 'node:test';
import assert from 'node:assert/strict';
import {runRouteCheck} from '../modules/testing/routeChecks.js';
import {testManifestSchema,type CheckState} from '../modules/testing/schemas.js';
import type {GameResult} from '../integrations/game/transport.js';

const from={x:16,y:20},to={x:16,y:28},spec=testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{points:{a:from,b:to},routes:[{id:'gate',from:'a',to:'b',type:'Marine',mobility:'ground',bidirectional:false,timeout:1,maxDeviation:1.5}]}}).game!.routes[0];
const reply=(body:Record<string,unknown>):GameResult=>({content:[],structuredContent:{status:'ok',...body}});
const timeout=()=>reply({status:'inconclusive',session:'one',error:'Galaxy acknowledgement timed out',sequence:84,executionMayHaveOccurred:true});
function runtime(mode='ok'){
 const calls:Array<{method:string;args:Record<string,any>}>=[],records=new Map<string,any>();let clock=0,unit:any,ordered=false,cleaned=false,step=0;
 const body=(r:GameResult)=>r.structuredContent as Record<string,any>,state=(r:GameResult):CheckState=>({ok:'passed',failed:'failed',unsupported:'unsupported',inconclusive:'inconclusive',timeout:'inconclusive'} as const)[body(r).status as 'ok']??'inconclusive';
 const hooks={body,state,now:()=>clock,delay:async(ms:number)=>{clock+=ms;},pollMs:100,checkCancel:()=>{if(mode==='cancel'&&ordered)throw Error('TEST_CANCEL_REQUESTED');},
  record:async(name:string,value:unknown)=>{if(mode==='persistence'&&name==='trajectory')throw Error('disk full');records.set(name,structuredClone(value));return name+'.json';},
  capture:async()=>{assert.equal(unit.valid,true);calls.push({method:'capture',args:{}});},
  call:async(method:string,args:Record<string,unknown>)=>{
   calls.push({method,args});clock+=10;const stamp=()=>({session:'one',runtimeEpoch:'epoch',mapLoadSerial:1,gameTime:clock/1000});
   if(method==='game.fixture'&&args.action==='cleanup'){cleaned=true;if(mode!=='cleanup_alive')unit.valid=false;return mode==='cleanup_unknown'?timeout():reply({removed:1,...stamp()});}
   if(method==='game.fixture'){
    unit={id:'one:u:1',type:mode==='wrong_type'?'Marauder':args.type,owner:mode==='wrong_owner'?2:args.owner,valid:mode!=='invalid',alive:true,life:45,shields:0,position:{x:Number(args.x)+(mode==='displaced'?4:0),y:args.y}};
    if(mode==='create_throw')throw Error('response lost after creation');if(mode==='create_unknown')return timeout();if(mode==='create_failed')return reply({status:'failed',error:'invalid catalog'});return reply({unit:structuredClone(unit),...stamp()});
   }
   if(method==='game.order'){
    ordered=true;if(mode==='order_throw')throw Error('response lost after order');if(mode==='order_unknown')return timeout();if(mode==='order_rejected')return reply({accepted:false,...stamp()});return reply({accepted:true,...stamp()});
   }
   if(method==='game.units.inspect'){
    if(!cleaned&&!ordered&&mode==='initial_unknown')return timeout();if(!cleaned&&!ordered&&mode==='initial_unsupported')return reply({status:'unsupported'});if(!cleaned&&!ordered&&mode==='initial_missing')return reply({});if(!cleaned&&!ordered&&mode==='initial_partial')return reply({unit:{id:unit.id,valid:true,alive:true}});
    if(cleaned&&mode==='cleanup_read_unknown')return timeout();
    if(ordered&&!cleaned){if(mode==='sample_unknown')return timeout();clock+=mode==='late'?1100:100;step++;const progress=mode==='blocked'?0:mode==='late'?1:Math.min(step/3,1);unit.position={x:16+(mode==='detour'&&progress<1?4:0),y:20+8*progress};if(mode==='damage')unit.life=44;}
    return reply({unit:structuredClone(unit),...stamp(),...(mode==='identity_change'&&ordered&&!cleaned?{runtimeEpoch:'replacement'}:{})});
   }
   throw Error('Unexpected call '+method);
  }};return{hooks,calls,records,getUnit:()=>unit};
}
test('route arrival preserves identity, response clocks and immutable samples before verified cleanup',async()=>{
 const f=runtime(),r=await runRouteCheck(spec,from,to,false,f.hooks),c=r.checks[0];assert.equal(c.status,'passed');assert.equal(c.evidence?.orderSubmitted,true);assert.equal(c.evidence?.arrived,true);assert.equal(r.continueSuite,true);assert.equal((c.evidence?.movementClock as any).quality,'verified');assert.equal(r.checks.find(c=>c.id.endsWith(':cleanup'))?.status,'passed');
 assert.equal(f.calls.filter(c=>c.method==='game.order').length,1);assert.equal(f.calls.filter(c=>c.method==='game.fixture'&&!c.args.action).length,1);assert.equal(f.records.get('trajectory').at(-1).valid,true);assert.equal(f.getUnit().valid,false);assert.equal(f.calls.findIndex(c=>c.method==='capture')<f.calls.findIndex(c=>c.args.action==='cleanup'),true);
});
test('the retained native acknowledgement timeout is an unconfirmed initial inspection, never an invalid unit assertion',async()=>{
 const f=runtime('initial_unknown'),r=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'inconclusive');assert.equal(r.checks[0].reason,'ROUTE_INITIAL_INSPECTION_UNCONFIRMED');assert.equal(r.continueSuite,false);assert.equal(f.calls.some(c=>c.method==='game.order'),false);assert.equal(f.calls.filter(c=>c.args.action==='cleanup').length,1);assert.equal(r.checks.find(c=>c.id.endsWith(':cleanup'))?.status,'passed');assert.equal(f.records.get('initial').structuredContent.executionMayHaveOccurred,true);assert.equal(f.records.get('trajectory')[0].valid,undefined);
});
test('ambiguous fixture creation or move is never retried, also when the route is optional',async()=>{
 for(const mode of ['create_unknown','create_throw','order_unknown','order_throw']){const f=runtime(mode),r=await runRouteCheck({...spec,required:false},from,to,false,f.hooks);assert.equal(r.checks[0].status,'inconclusive',mode);assert.equal(r.continueSuite,false);assert.equal(f.calls.filter(c=>c.method==='game.fixture'&&!c.args.action).length,1);assert.equal(f.calls.filter(c=>c.method==='game.order').length,mode.startsWith('create')?0:1);assert.equal(f.calls.filter(c=>c.args.action==='cleanup').length,1);assert.equal(r.checks.find(c=>c.id.endsWith(':submission'))?.required,true);}
});
test('an ok envelope without complete unit data does not establish an invalid fixture',async()=>{
 for(const mode of ['initial_missing','initial_partial']){const f=runtime(mode),r=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'inconclusive');assert.equal(r.checks[0].reason,'ROUTE_INITIAL_INSPECTION_UNCONFIRMED');assert.equal(r.continueSuite,false);assert.equal(f.calls.some(c=>c.method==='game.order'),false);}
});
test('confirmed invalid identity, owner, type and displaced spawn remain genuine failures',async()=>{
 for(const mode of ['invalid','wrong_owner','wrong_type','displaced']){const f=runtime(mode),r=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'failed',mode);assert.match(r.checks[0].reason!,/ROUTE_FIXTURE_INVALID/);assert.equal(f.calls.some(c=>c.method==='game.order'),false);assert.equal(r.continueSuite,false);assert.equal(f.getUnit().valid,false);}
});
test('explicit unsupported reads and rejected fixture/order responses are preserved',async()=>{
 for(const[mode,expected]of [['initial_unsupported','unsupported'],['create_failed','failed'],['order_rejected','failed']] as const){const f=runtime(mode),r=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,expected);assert.equal(r.continueSuite,false);}
});
test('unconfirmed movement reads, replacement identities and combat interference stop later submissions',async()=>{
 for(const mode of ['sample_unknown','identity_change','damage']){const f=runtime(mode),r=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'inconclusive',mode);assert.equal(r.checks[0].evidence?.arrived,false);assert.equal(r.continueSuite,false);assert.equal(f.calls.filter(c=>c.method==='game.order').length,1);}
});
test('cleanup acknowledgement/readback uncertainty cannot pass through an invalid-ID observation',async()=>{
 for(const mode of ['cleanup_unknown','cleanup_read_unknown','cleanup_alive']){const f=runtime(mode),r=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'passed');assert.equal(r.checks.find(c=>c.id.endsWith(':cleanup'))?.status,mode==='cleanup_alive'?'failed':'inconclusive');assert.equal(r.continueSuite,false);assert.equal(r.checks.at(-1)?.required,true);}
});
test('a confirmed detour is still a failure even after timely arrival; a stable timed-out route is not an obstruction proof',async()=>{
 const f=runtime('detour'),bad=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(bad.checks[0].status,'failed');assert.equal(bad.checks[0].evidence?.arrived,true);assert.equal(bad.continueSuite,true);assert.ok(Number(bad.checks[0].evidence?.maxObservedDeviation)>spec.maxDeviation!);
 const b=runtime('blocked'),blocked=await runRouteCheck({...spec,expected:'blocked'},from,to,false,b.hooks);assert.equal(blocked.checks[0].status,'inconclusive');assert.equal(blocked.checks[0].evidence?.arrived,false);assert.equal(blocked.continueSuite,true);
 const l=runtime('late'),late=await runRouteCheck(spec,from,to,false,l.hooks);assert.equal(late.checks[0].status,'inconclusive');assert.equal(late.checks[0].evidence?.lateArrival,true);assert.equal(late.checks[0].evidence?.deadlineSeconds,1);
});
test('trajectory persistence failure and caller cancellation still clean test-owned fixtures',async()=>{
 const f=runtime('persistence'),r=await runRouteCheck(spec,from,to,false,f.hooks);assert.equal(r.checks[0].status,'failed');assert.equal(r.continueSuite,false);assert.equal(f.getUnit().valid,false);
 const cancelled=runtime('cancel');await assert.rejects(runRouteCheck(spec,from,to,false,cancelled.hooks),/TEST_CANCEL_REQUESTED/);assert.equal(cancelled.getUnit().valid,false);assert.equal(cancelled.calls.filter(c=>c.args.action==='cleanup').length,1);
});
