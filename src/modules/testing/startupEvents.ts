import type {GameResult} from '../../integrations/game/transport.js';
import type {TestManifest,TestCheck} from './schemas.js';

type Observation=NonNullable<TestManifest['game']>['startupEvents'][number];
interface StreamIdentity {session:string;runtimeEpoch:string;mapLoadSerial:number}
interface Options {
 call:(method:string,args:Record<string,unknown>)=>Promise<GameResult>;
 body:(result:GameResult)=>Record<string,any>;
 record:(page:number,result:GameResult)=>Promise<string>;
 checkCancel:()=>void;
 pollMs?:number;
 now?:()=>number;
 pause?:(ms:number)=>Promise<void>;
}
const identity=(b:Record<string,any>):StreamIdentity|undefined=>
 typeof b.session==='string'&&b.session.length>0&&typeof b.runtimeEpoch==='string'&&b.runtimeEpoch.length>0&&Number.isSafeInteger(b.mapLoadSerial)&&b.mapLoadSerial>=0
 ?{session:b.session,runtimeEpoch:b.runtimeEpoch,mapLoadSerial:b.mapLoadSerial}:undefined;
const matches=(event:unknown,match:Observation['match']):event is Record<string,unknown>=>
 !!event&&typeof event==='object'&&!Array.isArray(event)&&Object.entries(match).every(([key,value])=>Object.hasOwn(event,key)&&(event as Record<string,unknown>)[key]===value);

/** Read public retained event pages, then follow only their actual continuation
 * cursors. No opaque cursor decoding, fresh wait baseline or SDK implementation. */
export async function observeStartupEvents(observations:Observation[],options:Options):Promise<TestCheck[]> {
 if(!observations.length)return [];
 const now=options.now??Date.now,pause=options.pause??(ms=>new Promise(r=>setTimeout(r,ms))),started=now();
 const pending=new Set(observations),checks=new Map<Observation,TestCheck>();
 let cursor:string|undefined,stream:StreamIdentity|undefined,pages=0,dropped=false,eventsRead=0;
 const finish=(o:Observation,status:TestCheck['status'],reason?:string,evidence:Record<string,unknown>={})=>{
  checks.set(o,{id:'startup_event:'+o.id,status,required:o.required,reason,evidence:{match:o.match,observation:'retained_history_then_cursor_poll',pagesRead:pages,eventsRead,dropped,retentionComplete:!dropped,...(stream?{stream}:{}),...evidence}});pending.delete(o);
 };
 const stop=(status:TestCheck['status'],reason:string,invalidate=false)=>{for(const o of invalidate?observations:pending)finish(o,status,reason);};
 while(pending.size){
  options.checkCancel();
  for(const o of pending)if(now()-started>=o.timeout*1000)finish(o,'inconclusive','Matching startup event was not observed before the real-time deadline; absence is not proof that it did not occur');
  if(!pending.size)break;
  if(pages>=256){stop('inconclusive','Startup event observation reached the bounded 256-page limit');break;}
  let result:GameResult;
  try{result=await options.call('game.events',cursor?{cursor}:{});}catch{stop('inconclusive','Retained event stream request failed before a response was received');break;}
  options.checkCancel();
  const report=await options.record(++pages,result),b=options.body(result);
  if(result.isError||b.status!=='ok'){
   stop(b.status==='unsupported'?'unsupported':b.status==='failed'?'failed':'inconclusive','Retained event stream did not return an accepted page; inspect '+report);break;
  }
  const current=identity(b);
  if(!current||!Array.isArray(b.events)||typeof b.cursor!=='string'||!b.cursor||typeof b.hasMore!=='boolean'||typeof b.dropped!=='boolean'){
   stop('inconclusive','Event page lacks explicit stream identity, events, continuation or retention metadata');break;
  }
  if(stream&&(current.session!==stream.session||current.runtimeEpoch!==stream.runtimeEpoch||current.mapLoadSerial!==stream.mapLoadSerial)){
   stop('inconclusive','Event stream identity changed during startup observation',true);break;
  }
  stream??=current;dropped||=b.dropped;eventsRead+=b.events.length;
  for(const o of pending){const matched=b.events.find((event:unknown)=>matches(event,o.match));if(matched)finish(o,'passed',undefined,{matched,report});}
  if(!pending.size)break;
  if(b.hasMore&&b.cursor===cursor){stop('inconclusive','Event history continuation did not advance');break;}
  cursor=b.cursor;
  if(pending.size&&!b.hasMore){const remaining=Math.min(...[...pending].map(o=>o.timeout*1000-(now()-started)));await pause(Math.max(0,Math.min(options.pollMs??250,remaining)));}
 }
 return observations.map(o=>checks.get(o)!);
}
