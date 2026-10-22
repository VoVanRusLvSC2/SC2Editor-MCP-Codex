import * as z from 'zod/v4';
import type {GameResult} from './transport.js';

const scalar=z.union([z.string().max(512),z.number().finite(),z.boolean(),z.null()]);
const match=z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),scalar)
 .refine(m=>typeof m.kind==='string'&&m.kind.length>0&&typeof m.source==='string'&&m.source.length>0&&Object.keys(m).length<=16,'Match requires kind/source and at most 16 exact scalar fields');
export const actionEventsSchema=z.object({
 action:z.object({method:z.enum(['game.order','game.ui.activate']),arguments:z.record(z.string(),z.unknown())}).strict(),
 events:z.array(z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),match}).strict()).min(1).max(16),
 timeout:z.number().min(1).max(120).default(10),
 waitForComplete:z.boolean().optional(),
}).strict().superRefine((a,c)=>{
 const ids=new Set<string>();
 for(const e of a.events){if(ids.has(e.id))c.addIssue({code:'custom',message:'Duplicate event ID: '+e.id});ids.add(e.id);}
 const args=a.action.arguments,ability=a.action.method==='game.order'&&args.action==='ability';
 if(ability&&(typeof args.unit!=='string'||!args.unit||typeof args.ability!=='string'||!args.ability))c.addIssue({code:'custom',message:'Ability observation requires explicit unit and ability IDs'});
 if(a.waitForComplete===true&&!ability)c.addIssue({code:'custom',message:'Completion observation requires an ability order'});
 if(ability)for(const e of a.events){
  const owned=e.match.kind==='damage'?{sourceUnit:args.unit}:e.match.kind==='ability'?{unit:args.unit,ability:args.ability}:{};
  for(const [key,value]of Object.entries(owned))if(Object.hasOwn(e.match,key)&&e.match[key]!==value)c.addIssue({code:'custom',message:'Event '+e.id+' conflicts with ordered '+key});
 }
});
export type ActionEventsRequest=z.infer<typeof actionEventsSchema>;
export interface EventStreamIdentity {session:string;runtimeEpoch:string;mapLoadSerial:number}
export interface EventContinuation {cursor:string;stream:EventStreamIdentity}
interface Options {
 call:(method:string,args:Record<string,unknown>)=>Promise<GameResult>;
 record:(name:string,result:unknown)=>Promise<void>;
 continuation?:EventContinuation;
 now?:()=>number;
 pause?:(ms:number)=>Promise<void>;
}
type State='passed'|'failed'|'unsupported'|'inconclusive';
export interface ActionEventsReport {
 status:State;actionSubmitted:boolean|'unknown';reason?:string;
 action?:Record<string,unknown>;orderGameTime?:number;
 events:Array<{id:string;match:Record<string,unknown>;matched?:Record<string,unknown>}>;
 baselinePages:number;observationPages:number;eventsRead:number;dropped:boolean;
 continuation?:EventContinuation;
 scope:string;
}
export function gameBody(result:GameResult):Record<string,any> {
 if(result.structuredContent)return result.structuredContent;
 for(const item of result.content)if(item.type==='text')try{const value=JSON.parse(item.text);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{/* Unknown response stays unknown. */}
 return {};
}
const stream=(body:Record<string,any>):EventStreamIdentity|undefined=>
 typeof body.session==='string'&&!!body.session&&typeof body.runtimeEpoch==='string'&&!!body.runtimeEpoch&&Number.isSafeInteger(body.mapLoadSerial)&&body.mapLoadSerial>=0
 ?{session:body.session,runtimeEpoch:body.runtimeEpoch,mapLoadSerial:body.mapLoadSerial}:undefined;
const same=(a:EventStreamIdentity,b:EventStreamIdentity)=>a.session===b.session&&a.runtimeEpoch===b.runtimeEpoch&&a.mapLoadSerial===b.mapLoadSerial;

/** One ordered observation; a failed/ambiguous action is never resubmitted.
 * Exact matching, caster and time correlate events, not unique native cast IDs. */
export async function observeActionEvents(input:ActionEventsRequest,options:Options):Promise<ActionEventsReport> {
 const request=actionEventsSchema.parse(input),now=options.now??Date.now,pause=options.pause??(ms=>new Promise(r=>setTimeout(r,ms)));
 const args=request.action.arguments,ability=request.action.method==='game.order'&&args.action==='ability';
 const observations:ActionEventsReport['events']=request.events.map(e=>({id:e.id,match:{...e.match,...ability&&e.match.kind==='damage'?{sourceUnit:args.unit}:{},...ability&&e.match.kind==='ability'?{unit:args.unit,ability:args.ability}:{}}}));
 if(ability&&request.waitForComplete!==false)observations.push({id:'$complete',match:{kind:'ability',source:'galaxy',unit:args.unit,ability:args.ability,stageName:'complete'}});
 const report:ActionEventsReport={status:'inconclusive',actionSubmitted:false,events:observations,baselinePages:0,observationPages:0,eventsRead:0,dropped:false,scope:'Post-baseline event correlation by exact fields, stream identity and action time; no unique native cast identity, visual or absence certification'};
 let cursor=options.continuation?.cursor,identity=options.continuation?.stream;
 const stop=(status:State,reason:string,invalidate=false)=>{report.status=status;report.reason=reason;if(invalidate){delete report.continuation;for(const e of report.events)delete e.matched;}return report;};
 async function page(phase:'baseline'|'observation'){
  let result:GameResult;
  try{result=await options.call('game.events',cursor?{cursor}:{});}catch{stop('inconclusive','Event request failed before a response was received',true);return;}
  const number=phase==='baseline'?++report.baselinePages:++report.observationPages;
  try{await options.record(phase+'_'+number,result);}catch{stop('inconclusive','Private event evidence could not be persisted; the action was not retried');return;}
  const body=gameBody(result),current=stream(body);
  if(result.isError||body.status!=='ok'){stop(body.status==='unsupported'?'unsupported':body.status==='failed'?'failed':'inconclusive','Event stream did not return an accepted page',true);return;}
  if(!current||!Array.isArray(body.events)||typeof body.cursor!=='string'||!body.cursor||typeof body.hasMore!=='boolean'||typeof body.dropped!=='boolean'||typeof body.gameTime!=='number'||!Number.isFinite(body.gameTime)){
   stop('inconclusive','Event page lacks explicit stream identity, game time or continuation metadata',true);return;
  }
  if(identity&&!same(identity,current)){stop('inconclusive','Event stream identity changed during action observation',true);return;}
  if(body.hasMore&&body.cursor===cursor){stop('inconclusive','Event history continuation did not advance',true);return;}
  identity??=current;cursor=body.cursor;report.continuation={cursor:body.cursor,stream:current};
  report.eventsRead+=body.events.length;report.dropped||=body.dropped;
  return body;
 }
 const baselineDeadline=now()+10000;
 for(;;){
  if(report.baselinePages>=256||now()>=baselineDeadline)return stop('inconclusive','Pre-action baseline could not drain within its 256-page/10-second bound');
  const body=await page('baseline');if(!body)return report;
  if(!body.hasMore)break;
 }
 let result:GameResult;
 report.actionSubmitted='unknown';
 try{result=await options.call(request.action.method,args);}catch{return stop('inconclusive','Action response was lost; submission is unknown and was not retried');}
 report.actionSubmitted=true;
 try{await options.record('action',result);}catch{return stop('inconclusive','Action response was received but private evidence could not be persisted; the action was not retried');}
 const action=gameBody(result),current=stream(action);report.action=action;
 if(result.isError||action.status!=='ok')return stop(action.status==='unsupported'?'unsupported':action.status==='failed'?'failed':'inconclusive','Action did not return an accepted response; it was not retried');
 if(action.accepted===false)return stop('failed','The runtime explicitly refused the submitted action');
 if(!current||!identity||!same(identity,current)||typeof action.gameTime!=='number'||!Number.isFinite(action.gameTime))return stop('inconclusive','Action response lacks the unchanged stream identity and finite game time',true);
 report.orderGameTime=action.gameTime;
 const deadline=now()+request.timeout*1000;
 while(now()<deadline&&report.observationPages<256){
  const body=await page('observation');if(!body)return report;
  for(const observation of report.events){
   if(observation.matched)continue;
   const matched=body.events.find((event:unknown)=>!!event&&typeof event==='object'&&!Array.isArray(event)&&typeof (event as any).gameTime==='number'&&Number.isFinite((event as any).gameTime)&&(event as any).gameTime>=report.orderGameTime!&&Object.entries(observation.match).every(([key,value])=>Object.hasOwn(event,key)&&(event as any)[key]===value));
   if(matched)observation.matched=matched;
  }
  if(report.events.every(e=>e.matched)){report.status='passed';return report;}
  if(!body.hasMore)await pause(Math.max(0,Math.min(100,deadline-now())));
 }
 return stop('inconclusive','Expected events were not all observed within the time/page bound; absence is not proof of nonexecution');
}
