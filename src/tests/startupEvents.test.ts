import test from 'node:test';
import assert from 'node:assert/strict';
import {observeStartupEvents} from '../modules/testing/startupEvents.js';
import {startupEventSchema,testManifestSchema} from '../modules/testing/schemas.js';
import {testBody} from '../modules/testing/workspace.js';
import type {GameResult} from '../integrations/game/transport.js';

const expected=startupEventSchema.parse({id:'death',timeout:1,match:{kind:'unit_died',source:'galaxy',unitType:'Marine',owner:1}});
const event={kind:'unit_died',source:'galaxy',unitType:'Marine',owner:1,sequence:3};
const page=(values:Record<string,unknown>={}):GameResult=>({content:[{type:'text',text:JSON.stringify({status:'ok',events:[],cursor:'returned-0',hasMore:false,dropped:false,session:'owned-session',runtimeEpoch:'owned-epoch',mapLoadSerial:1,...values})}]});
function reader(responses:GameResult[]){
 const calls:Record<string,unknown>[]=[],records:GameResult[]=[];let clock=0;
 const options={body:testBody,now:()=>clock,pollMs:200,pause:async(ms:number)=>{clock+=ms;},checkCancel:()=>{},record:async(_page:number,r:GameResult)=>{records.push(r);return 'page-'+records.length+'.json';},call:async(method:string,args:Record<string,unknown>)=>{assert.equal(method,'game.events');calls.push(args);return responses.shift()??page();}};
 return {options,calls,records};
}

test('startup observer finds a past event from the unfiltered retained first page',async()=>{
 const f=reader([page({events:[{...event,owner:2},event],dropped:true})]);
 const [r]=await observeStartupEvents([expected],f.options);
 assert.equal(r.status,'passed');assert.deepEqual(r.evidence?.matched,event);
 assert.equal(r.evidence?.retentionComplete,false);assert.equal(r.evidence?.dropped,true);
 assert.deepEqual(f.calls,[{}]);assert.equal(f.records.length,1);
});

test('startup observer drains every continuation instead of jumping to the latest cursor',async()=>{
 const f=reader([page({cursor:'page-one',latestCursor:'skip-this',hasMore:true}),page({cursor:'page-two',hasMore:true}),page({cursor:'page-three',events:[event]})]);
 const [r]=await observeStartupEvents([expected],f.options);
 assert.equal(r.status,'passed');assert.equal(r.evidence?.pagesRead,3);
 assert.deepEqual(f.calls,[{},{cursor:'page-one'},{cursor:'page-two'}]);
});

test('startup observer follows an exhausted history cursor for a future occurrence',async()=>{
 const f=reader([page({cursor:'first'}),page({cursor:'first'}),page({cursor:'after',events:[event]})]);
 const [r]=await observeStartupEvents([expected],f.options);
 assert.equal(r.status,'passed');assert.deepEqual(f.calls,[{},{cursor:'first'},{cursor:'first'}]);
});

test('unobserved events stay inconclusive at independent real-time deadlines even after retention loss',async()=>{
 const later=startupEventSchema.parse({...expected,id:'later',timeout:2,match:{...expected.match,owner:2}});
 const f=reader([page({dropped:true,events:[{...event,owner:'1'},{...event,source:'engine'}]})]);
 const r=await observeStartupEvents([expected,later],f.options);
 assert.ok(r.every(c=>c.status==='inconclusive'));assert.match(r[0].reason!,/absence is not proof/);
 assert.equal(r[0].evidence?.pagesRead,5);assert.equal(r[1].evidence?.pagesRead,10);
 assert.equal(r[0].evidence?.dropped,true);
});

test('session, runtime epoch and map replacement invalidate a combined startup observation',async()=>{
 const other=startupEventSchema.parse({...expected,id:'other',match:{...expected.match,owner:2}});
 for(const change of [{session:'other-session'},{runtimeEpoch:'other-epoch'},{mapLoadSerial:2}]){
  const f=reader([page({events:[event],hasMore:true,cursor:'first'}),page({...change,events:[{...event,owner:2}]})]);
  const result=await observeStartupEvents([expected,other],f.options);
  assert.ok(result.every(c=>c.status==='inconclusive'));assert.ok(result.every(c=>/identity changed/.test(c.reason!)));
 }
});

test('unreadable metadata, repeated continuation and bounded pagination cannot pass',async()=>{
 for(const malformed of [{session:null},{runtimeEpoch:null},{mapLoadSerial:null},{hasMore:null},{dropped:null},{cursor:null},{events:null}]){
  const f=reader([page({...malformed,events:'events' in malformed?null:[event]})]);
  assert.equal((await observeStartupEvents([expected],f.options))[0].status,'inconclusive');
 }
 const repeated=reader([page({cursor:'stuck',hasMore:true}),page({cursor:'stuck',hasMore:true})]);
 assert.match((await observeStartupEvents([expected],repeated.options))[0].reason!,/did not advance/);
 const bounded=reader(Array.from({length:256},(_,i)=>page({cursor:'page-'+i,hasMore:true})));
 assert.match((await observeStartupEvents([expected],bounded.options))[0].reason!,/256-page limit/);assert.equal(bounded.calls.length,256);
});

test('upstream unsupported, explicit failures, transport loss and cancellation remain visible',async()=>{
 for(const status of ['unsupported','failed','inconclusive']){
  const f=reader([page({status})]);assert.equal((await observeStartupEvents([expected],f.options))[0].status,status);
 }
 const failed=reader([]);failed.options.call=async()=>{throw Error('transport lost');};
 assert.equal((await observeStartupEvents([expected],failed.options))[0].status,'inconclusive');
 const cancelled=reader([page({events:[event]})]);let checks=0;cancelled.options.checkCancel=()=>{if(++checks===2)throw Error('TEST_CANCEL_REQUESTED');};
 await assert.rejects(observeStartupEvents([expected],cancelled.options),/TEST_CANCEL_REQUESTED/);
});

test('startup manifest requires exact bounded scalar filters and distinct shared check IDs',()=>{
 const base={version:1,map:'Map.SC2Map',game:{startupEvents:[expected]}};
 assert.equal(testManifestSchema.parse(base).game?.startupEvents.length,1);
 for(const match of [{kind:'unit_died'},{source:'galaxy'},{kind:'',source:'galaxy'},{...expected.match,owner:{min:1}}])assert.throws(()=>testManifestSchema.parse({...base,game:{startupEvents:[{...expected,match}]}}));
 assert.throws(()=>testManifestSchema.parse({...base,game:{startupEvents:[expected],scenarios:[{id:expected.id,steps:[{method:'game.status'}]}]}}));
 assert.throws(()=>testManifestSchema.parse({...base,game:{startupEvents:[expected,expected]}}));
});
