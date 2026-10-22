import test from 'node:test';
import assert from 'node:assert/strict';
import {actionEventsSchema,observeActionEvents,type ActionEventsRequest} from '../integrations/game/actionEvents.js';
import type {GameResult} from '../integrations/game/transport.js';

const identity={session:'session',runtimeEpoch:'epoch',mapLoadSerial:1};
const response=(body:Record<string,unknown>):GameResult=>({content:[{type:'text',text:JSON.stringify({status:'ok',...identity,gameTime:10,...body})}]});
const page=(body:Record<string,unknown>={})=>response({events:[],cursor:'tail',hasMore:false,dropped:false,...body});
const request=actionEventsSchema.parse({action:{method:'game.order',arguments:{unit:'caster',action:'ability',ability:'Pulse',command:0,x:20,y:30}},events:[{id:'damage',match:{kind:'damage',source:'galaxy',unit:'victim',amount:40}}],timeout:1});
const hit={kind:'damage',source:'galaxy',sourceUnit:'caster',unit:'victim',amount:40,gameTime:11};
const complete={kind:'ability',source:'galaxy',unit:'caster',ability:'Pulse',stageName:'complete',gameTime:12};
function reader(pages:GameResult[],action=response({accepted:true})){
 const calls:Array<{method:string;args:Record<string,unknown>}>=[],records:Array<{name:string;result:unknown}>=[];let clock=0;
 const options={now:()=>clock,pause:async(ms:number)=>{clock+=ms;},record:async(name:string,result:unknown)=>{records.push({name,result});},call:async(method:string,args:Record<string,unknown>)=>{calls.push({method,args});return method==='game.events'?pages.shift()??page():action;}};
 return {calls,records,options};
}
test('an action drains all returned history pages, rejects stale/other-caster hits and awaits native completion',async()=>{
 const f=reader([page({cursor:'one',hasMore:true,latestCursor:'unsafe-skip',events:[hit]}),page({cursor:'two',hasMore:true}),page({cursor:'three'}),page({cursor:'four',events:[{...hit,sourceUnit:'other'},{...hit,gameTime:9}]}),page({cursor:'five',events:[hit]}),page({cursor:'six',events:[complete]})]);
 const r=await observeActionEvents(request,f.options);
 assert.equal(r.status,'passed');assert.equal(r.actionSubmitted,true);assert.equal(r.baselinePages,3);assert.equal(r.observationPages,3);assert.equal(r.orderGameTime,10);
 assert.deepEqual(r.events.map(e=>e.matched),[hit,complete]);assert.deepEqual(f.calls.slice(0,4),[{method:'game.events',args:{}},{method:'game.events',args:{cursor:'one'}},{method:'game.events',args:{cursor:'two'}},{method:'game.order',args:request.action.arguments}]);
 assert.equal(f.calls.filter(c=>c.method==='game.order').length,1);assert.deepEqual(r.continuation,{cursor:'six',stream:identity});assert.equal(f.records.length,7);
});
test('a damage match alone does not pass default ability completion; explicit interruption checks can opt out',async()=>{
 for(const waitForComplete of [undefined,false]){
  const f=reader([page(),page({events:[hit],dropped:true})]),r=await observeActionEvents({...request,waitForComplete},f.options);
  assert.equal(r.status,waitForComplete===false?'passed':'inconclusive');assert.equal(r.dropped,true);
  assert.equal(f.calls.filter(c=>c.method==='game.order').length,1);assert.equal(r.events[0].match.sourceUnit,'caster');
 }
});
test('unchanged queued history does not create a baseline and malformed/failed pages cannot submit an action',async()=>{
 for(const pages of [[page({cursor:'stuck',hasMore:true}),page({cursor:'stuck',hasMore:true})],[page({gameTime:null})],[page({status:'unsupported'})],[page({session:null})],Array.from({length:256},(_,i)=>page({hasMore:true,cursor:String(i)}))]){
  const f=reader(pages),r=await observeActionEvents(request,f.options);assert.notEqual(r.status,'passed');assert.equal(r.actionSubmitted,false);assert.ok(f.calls.every(c=>c.method==='game.events'));
 }
 const f=reader([]);f.options.call=async()=>{throw Error('lost');};const r=await observeActionEvents(request,f.options);assert.equal(r.actionSubmitted,false);assert.equal(r.status,'inconclusive');
});
test('ambiguous submission and explicit refusal are preserved without another action or event poll',async()=>{
 const f=reader([page()]);let orders=0;const call=f.options.call;
 f.options.call=async(method,args)=>{if(method==='game.order'){orders++;throw Error('lost after submission');}return call(method,args);};
 const r=await observeActionEvents(request,f.options);assert.equal(r.actionSubmitted,'unknown');assert.equal(r.status,'inconclusive');assert.equal(orders,1);assert.equal(f.calls.length,1);
 for(const body of [{accepted:false},{status:'failed'},{status:'unsupported'},{runtimeEpoch:'changed'},{gameTime:null}]){
  const g=reader([page()],response(body)),result=await observeActionEvents(request,g.options);assert.notEqual(result.status,'passed');assert.equal(result.actionSubmitted,true);assert.equal(g.calls.length,2);
 }
});
test('session replacement invalidates matches already seen and a cached continuation never crosses maps',async()=>{
 const f=reader([page(),page({events:[hit],hasMore:true,cursor:'hit'}),page({runtimeEpoch:'other',events:[complete]})]),r=await observeActionEvents(request,f.options);
 assert.equal(r.status,'inconclusive');assert.ok(r.events.every(e=>!e.matched));assert.equal(r.continuation,undefined);
 const g=reader([page({mapLoadSerial:2})]),result=await observeActionEvents(request,{...g.options,continuation:{cursor:'previous-tail',stream:identity}});
 assert.equal(result.actionSubmitted,false);assert.equal(result.status,'inconclusive');assert.deepEqual(g.calls,[{method:'game.events',args:{cursor:'previous-tail'}}]);
});
test('a retained cursor drains unread continuation before the next action rather than starting at latestCursor',async()=>{
 const f=reader([page({cursor:'remaining',hasMore:true}),page({cursor:'drained'}),page({events:[hit,complete],cursor:'after'})]);
 const r=await observeActionEvents(request,{...f.options,continuation:{cursor:'previous-tail',stream:identity}});
 assert.equal(r.status,'passed');assert.deepEqual(f.calls.slice(0,3).map(c=>c.args),[{cursor:'previous-tail'},{cursor:'remaining'},request.action.arguments]);
});
test('UI activation uses the same time/identity observation without inventing an ability completion',async()=>{
 const r=actionEventsSchema.parse({action:{method:'game.ui.activate',arguments:{control:'actual-control'}},events:[{id:'click',match:{kind:'dialog_control',source:'galaxy',control:'actual-control'}}]});
 const event={kind:'dialog_control',source:'galaxy',control:'actual-control',gameTime:11},f=reader([page(),page({events:[event]})]);
 const result=await observeActionEvents(r,f.options);assert.equal(result.status,'passed');assert.equal(result.events.length,1);assert.equal(f.calls[1].method,'game.ui.activate');
});
const uiRequest=actionEventsSchema.parse({action:{method:'game.ui.activate',arguments:{control:'session:nui:1'}},events:[{id:'click',match:{kind:'ui',source:'galaxy',controlId:1,player:1,eventType:0}}],timeout:1});
const uiEvent={kind:'ui',source:'galaxy',controlId:1,player:1,eventType:0,gameTime:11};
const uiReply=(changes:Record<string,unknown>={},clickChanges:Record<string,unknown>={}):GameResult=>({content:[{type:'text',text:JSON.stringify({status:'ok',session:'session',normalUIHandlerConfirmed:true,clickEvent:{kind:'native_ui_click',accepted:true,originalHandlerReturned:true,gameTimeExact:true,gameTimeSource:'native_TimerGetElapsed_counter',gameTime:11,...clickChanges},...changes})}]});
test('native UI response uses its exact click clock and requires post-action full stream identity',async()=>{
 const f=reader([page(),page({events:[uiEvent]})],uiReply()),r=await observeActionEvents(uiRequest,f.options);assert.equal(r.status,'passed');assert.equal(r.orderGameTime,11);assert.equal(r.actionClock,'native_ui_click.gameTime');assert.equal(r.actionIdentity,'ui_session_then_event_pages');assert.equal(r.action?.runtimeEpoch,undefined);assert.equal(r.action?.gameTime,undefined);assert.equal(r.events.length,1);assert.equal(f.calls.filter(c=>c.method==='game.ui.activate').length,1);
 const changed=reader([page(),page({runtimeEpoch:'changed',events:[uiEvent]})],uiReply()),invalid=await observeActionEvents(uiRequest,changed.options);assert.equal(invalid.status,'inconclusive');assert.equal(invalid.events[0].matched,undefined);assert.equal(invalid.continuation,undefined);
});
test('UI fallback rejects uncertain handler clocks, conflicting identity and pre-baseline time without retries',async()=>{
 for(const [body,click]of [[{session:'other'},{}],[{runtimeEpoch:'other'},{}],[{mapLoadSerial:2},{}],[{}, {gameTimeExact:false}],[{}, {originalHandlerReturned:false}],[{}, {gameTimeSource:'wall_clock'}],[{}, {gameTime:9}]]){
  const f=reader([page(),page({events:[uiEvent]})],uiReply(body,click)),r=await observeActionEvents(uiRequest,f.options);assert.equal(r.status,'inconclusive');assert.equal(r.actionSubmitted,true);assert.equal(r.events[0].matched,undefined);assert.equal(f.calls.length,2);
 }
});
test('evidence-write failures stop before submission or retain a known submitted state without retries',async()=>{
 for(const failing of ['baseline_1','action','observation_1']){
  const f=reader([page(),page({events:[hit,complete]})]);f.options.record=async(name)=>{if(name===failing)throw Error('disk full');};
  const r=await observeActionEvents(request,f.options);assert.equal(r.status,'inconclusive');assert.equal(r.actionSubmitted,failing!=='baseline_1');assert.equal(f.calls.filter(c=>c.method==='game.order').length,failing==='baseline_1'?0:1);
 }
});
test('action schemas reject method escapes, duplicate IDs, contradictory casters and missing ability identity',()=>{
 for(const input of [{...request,action:{method:'game.attach',arguments:{}}},{...request,events:[request.events[0],request.events[0]]},{...request,events:[{id:'wrong',match:{...request.events[0].match,sourceUnit:'other'}}]},{...request,events:[{id:'wrong',match:{kind:'ability',source:'galaxy',ability:'different'}}]},{...request,action:{...request.action,arguments:{action:'ability'}}},{...request,waitForComplete:true,action:{method:'game.ui.activate',arguments:{}}}])assert.throws(()=>actionEventsSchema.parse(input));
 const invalid={...request,action:{method:'native.memory',arguments:{}}} as unknown as ActionEventsRequest;const f=reader([]);
 return assert.rejects(observeActionEvents(invalid,f.options)).then(()=>assert.equal(f.calls.length,0));
});
