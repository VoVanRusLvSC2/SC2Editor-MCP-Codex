import type {GameResult} from '../../integrations/game/transport.js';
import type {TestCheck,CheckState} from './schemas.js';
import {decodePadChannel,decodePathingChannel,type PadChannel} from './padQueries.js';
interface Host{call:(method:string,args:Record<string,unknown>)=>Promise<GameResult>;body:(result:GameResult)=>Record<string,any>;state:(result:GameResult)=>CheckState;record:(name:string,value:unknown)=>Promise<string>;checkCancel:()=>void;pollMs?:number}
/** The Game host is a separate query-only pass; no carriers survive into routes. */
export async function observePadQueries(channel:PadChannel,h:Host){
 const start=Date.now(),deadline=start+channel.probe.timeout*1000;let page=0,reason='PAD_CHANNEL_NOT_OBSERVED',state:CheckState='inconclusive';
 const reports:string[]=[];
 try{
  do{
   h.checkCancel();const result=await h.call('game.units.find',{type:channel.unitType,owner:0,limit:128});reports.push(await h.record('page_'+page++,result));
   if(Date.now()>deadline){reason='PAD_OBSERVATION_DEADLINE_EXCEEDED';break;}
   const responseState=h.state(result),body=h.body(result);
   if(responseState!=='passed'){state=responseState==='unsupported'?'unsupported':'inconclusive';reason='PAD_NATIVE_READ_UNCONFIRMED';break;}
   if(body.truncated!==false){reason='PAD_CHANNEL_PAGE_INCOMPLETE';break;}
   if(Array.isArray(body.units)&&body.units.length===channel.slots){
    const values=decodePadChannel(channel,body);
    return {complete:true,checks:[...values.map((value,i):TestCheck=>({id:'pad:'+value.id,status:!value.catalogValid?'unsupported':value.matched?'passed':'failed',required:channel.pads[i].required,
     reason:!value.catalogValid?'PAD_NATIVE_CATALOG_UNAVAILABLE':value.matched?undefined:'PAD_NATIVE_PREDICATE_EXPECTATION_MISMATCH',
     evidence:{...value,type:channel.pads[i].type,owner:channel.pads[i].owner,channelVersion:channel.version,probeUnitType:channel.unitType,requestedAfterGameSeconds:channel.probe.afterGameSeconds,observedGameTime:typeof body.gameTime==='number'?body.gameTime:null,observationMs:Date.now()-start,reports}})),
     ...decodePathingChannel(channel,body).map((value,i):TestCheck=>({id:'pathing:'+value.id,status:value.matched?'passed':'failed',required:channel.pathing![i].required,
      reason:value.matched?undefined:'PATHING_NATIVE_PREDICATE_EXPECTATION_MISMATCH',evidence:{...value,channelVersion:channel.version,probeUnitType:channel.unitType,requestedAfterGameSeconds:channel.probe.afterGameSeconds,observedGameTime:typeof body.gameTime==='number'?body.gameTime:null,observationMs:Date.now()-start,reports}}))]};
   }
   if(!Array.isArray(body.units)||body.units.length>channel.slots){reason='PAD_CHANNEL_COUNT_INVALID';break;}
   await new Promise(r=>setTimeout(r,h.pollMs??250));
  }while(Date.now()<deadline);
 }catch(error){if(String(error).includes('TEST_CANCEL_REQUESTED'))throw error;reason=String(error).slice(0,640);}
 return {complete:false,checks:[...channel.pads.map(p=>({id:'pad:'+p.id,required:p.required})),...(channel.pathing??[]).map(p=>({id:'pathing:'+p.id,required:p.required}))].map(p=>({...p,status:state,reason,evidence:{reports,channelVersion:channel.version,probeUnitType:channel.unitType,observedSlotsExpected:channel.slots,observationMs:Date.now()-start}} as TestCheck))};
}
