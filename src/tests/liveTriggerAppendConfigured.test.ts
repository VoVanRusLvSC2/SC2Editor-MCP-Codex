import test from "node:test";
import assert from "node:assert/strict";
import { appendConfiguredTrigger } from "../modules/editorLive/triggerAppendConfigured.js";
import { compileAuthorScript } from "../app/authoringScript.js";

const request = { archive:"Current.SC2Map",windowId:"123",path:"MAIN/Start",kind:"action" as const,
  name:"Create Units With Default Facing",edits:"integer:Count=6;unit:Type=Murloc Marine;point:Point=Spawn" };
function fixture(options: { insertionUnknown?: boolean; missing?: boolean; lost?: boolean } = {}) {
 const calls: string[] = []; let step=0;
 const set=async()=>{calls.push('set');if(options.lost&&step===1)return{status:'unknown',parameterVerified:false};step++;return{status:'applied',parameterVerified:true,detailFingerprint:String(10+step),parameterFingerprint:String(20+step)}};
 const triggers={
  appendAction:async()=>{calls.push('append');return options.insertionUnknown?{status:'unknown'}:{status:'needs_parameters',itemIndex:2,detailFingerprint:'10'}},
  appendEvent:async()=>{calls.push('event');return{status:'needs_parameters',itemIndex:2,detailFingerprint:'10'}},
  parameters:async()=>{calls.push('parameters');const parameters=[{index:1,text:'Count: 1'},{index:2,text:'Type: Marine'},...(options.missing?[]:[{index:3,text:'Point: (No Value)'}]),{index:4,text:'Flags: Default'}];return{parameterRoot:request.name,parameterFingerprint:'20',totalParameters:parameters.length,nextOffset:null,parameters}},
  setInteger:set,setReal:set,setUnit:set,setPoint:set,
 } as unknown as Parameters<typeof appendConfiguredTrigger>[0];return{triggers,calls};
}
test('appends once, configures each supplied parameter, and leaves defaults explicit',async()=>{
 const f=fixture(),result=await appendConfiguredTrigger(f.triggers,request);
 assert.equal(result.status,'needs_parameters');assert.equal('createdAction' in result&&result.createdAction,true);
 assert.deepEqual(f.calls,['append','parameters','set','set','set']);
 const steps=compileAuthorScript('live trigger.append_configured archive=Current.SC2Map windowId=123 path="MAIN/Start" kind=action name="Create Units With Default Facing" edits="integer:Count=6;unit:Type=Murloc Marine;point:Point=Spawn"','stage');
 assert.equal(steps[0].tool,'live.trigger.append_configured');
});
test('bad values are rejected before insertion',async()=>{
 const f=fixture();await assert.rejects(appendConfiguredTrigger(f.triggers,{...request,edits:'integer:Count=1.5'}));assert.deepEqual(f.calls,[]);
});
test('ambiguous, missing or lost work never causes another insertion',async()=>{
 for(const [options,status,calls] of [
  [{insertionUnknown:true},'unknown',['append']],
  [{missing:true},'partial',['append','parameters']],
  [{lost:true},'unknown',['append','parameters','set','set']],
 ] as const){const f=fixture(options),result=await appendConfiguredTrigger(f.triggers,request);assert.equal(result.status,status);assert.deepEqual(f.calls,calls);}
});
test('event path uses the original event insertion',async()=>{
 const f=fixture(),result=await appendConfiguredTrigger(f.triggers,{...request,kind:'event'});
 assert.equal(result.status,'needs_parameters');assert.equal(f.calls[0],'event');
});
