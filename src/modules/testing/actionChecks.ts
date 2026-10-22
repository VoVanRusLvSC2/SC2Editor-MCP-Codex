import * as z from 'zod/v4';
import {isDeepStrictEqual} from 'node:util';
import {resolveBatchReferences} from '../../app/mcpBatch.js';
import {actionEventsSchema,gameBody,type ActionEventsRequest,type ActionEventsReport} from '../../integrations/game/actionEvents.js';
import type {GameResult} from '../../integrations/game/transport.js';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
const scalar=z.union([z.string().max(512),z.number().finite(),z.boolean(),z.null()]);
const reference=z.object({$from:z.string().max(512)}).strict();
const query=z.object({id,method:z.enum(['game.status','game.units.find','game.units.inspect','game.selection.set','game.camera.set','game.ui.inspect']),arguments:z.record(z.string(),z.unknown()).default({}),expect:z.record(z.string().max(256),z.unknown()).default({})}).strict();
export const actionCheckSchema=z.object({
 id:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),required:z.boolean().default(true),
 before:z.array(query).max(16).default([]),after:z.array(query).max(16).default([]),
 action:actionEventsSchema.shape.action,
 events:z.array(z.object({id,match:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),z.union([scalar,reference])).refine(m=>typeof m.kind==='string'&&!!m.kind&&typeof m.source==='string'&&!!m.source&&Object.keys(m).length<=16,'Literal kind/source and at most16 exact fields required')}).strict()).min(1).max(16),
 timeout:actionEventsSchema.shape.timeout,waitForComplete:actionEventsSchema.shape.waitForComplete,
}).strict().superRefine((request,context)=>{
 const seen=new Set<string>();let nodes=0,limited=false;
 const inspect=(value:unknown,depth=0)=>{if(limited)return;if(depth>30||++nodes>16384){limited=true;context.addIssue({code:'custom',message:'Action-check reference graph exceeds its depth/node limit'});return;}if(Array.isArray(value)){value.forEach(v=>inspect(v,depth+1));return;}if(!value||typeof value!=='object')return;const v=value as Record<string,unknown>;
  if('$ref' in v)context.addIssue({code:'custom',message:'Action checks use $from; upstream $ref belongs to unchanged game.scenarios'});
  if('$from' in v&&(Object.keys(v).length!==1||typeof v.$from!=='string'))context.addIssue({code:'custom',message:'An action-check $from link must be its only field'});
  if(Object.keys(v).length===1&&typeof v.$from==='string'){
   const [root,...parts]=v.$from.split('.');if(!seen.has(root)||parts.length>11||[root,...parts].some(p=>!/^\w+$/.test(p)||['__proto__','prototype','constructor'].includes(p)))context.addIssue({code:'custom',message:'Unsafe, forward or missing action-check reference: '+v.$from});return;
  }
  Object.values(v).forEach(v=>inspect(v,depth+1));
 };
 const step=(q:z.infer<typeof query>)=>{inspect(q.arguments);inspect(q.expect);if(seen.has(q.id)||q.id==='observation')context.addIssue({code:'custom',message:'Duplicate/reserved query ID: '+q.id});seen.add(q.id);};
 request.before.forEach(step);inspect(request.action);inspect(request.events);seen.add('observation');request.after.forEach(step);
 if(new Set(request.events.map(e=>e.id)).size!==request.events.length)context.addIssue({code:'custom',message:'Duplicate action event ID'});
});
export type ActionCheck=z.infer<typeof actionCheckSchema>;
interface Options {
 call:(method:string,args:Record<string,unknown>)=>Promise<GameResult>;
 action?: (request:ActionEventsRequest)=>Promise<ActionEventsReport&{report?:string}>;
 checkCancel:()=>void;
 record:(name:string,value:unknown)=>Promise<void>;
}
type State='passed'|'failed'|'unsupported'|'inconclusive';
export interface ActionCheckReport {id:string;status:State;actionSubmitted:boolean|'unknown';reason?:string;queries:Array<{id:string;phase:'before'|'after';status:State;reason?:string}>;observation?:ActionEventsReport&{report?:string};scope:string}
class InputError extends Error {}
/** New local $from scope. Legacy upstream $ref scenarios are never split,
 * reinterpreted or routed through this executor. */
export async function runActionCheck(input:ActionCheck,options:Options):Promise<ActionCheckReport>{
 const request=actionCheckSchema.parse(input),results=new Map<string,unknown>(),report:ActionCheckReport={id:request.id,status:'inconclusive',actionSubmitted:false,queries:[],scope:'Setup/readback assertions and one bridge-owned action/event observation; no unique cast or visual certification'};
 if(!options.action){report.status='unsupported';report.reason='The retained game bridge does not expose action observation; no setup or action was invoked';await options.record('result',report);return report;}
 const record=async(name:string,value:unknown)=>options.record(name,value);
 const resolve=(value:unknown)=>{try{return resolveBatchReferences(value,results);}catch(error){throw new InputError(String(error));}};
 const queryStep=async(q:z.infer<typeof query>,phase:'before'|'after')=>{
  options.checkCancel();const args=resolve(q.arguments) as Record<string,unknown>,expected=resolve(q.expect) as Record<string,unknown>,reply=await options.call(q.method,args);
  await record(phase+'_'+q.id,reply);const body=gameBody(reply);
  const status:State=body.status==='unsupported'?'unsupported':reply.isError||body.status==='failed'?'failed':body.status==='ok'||body.status==='passed'?'passed':'inconclusive';
  const check:{id:string;phase:'before'|'after';status:State;reason?:string}={id:q.id,phase,status};report.queries.push(check);
  if(status!=='passed'){report.status=status;report.reason='Query '+q.id+' did not return a confirmed result';return false;}
  for(const [key,value]of Object.entries(expected)){
   let actual:unknown;try{actual=resolveBatchReferences({$from:'reply.'+key},new Map([['reply',body]]));}catch{check.status='failed';check.reason='Missing/unsafe expected path: '+key;}
   if(check.status!=='failed'&&!isDeepStrictEqual(actual,value)){check.status='failed';check.reason='Expected value did not match: '+key;}
   if(check.status==='failed'){report.status='failed';report.reason=check.reason;return false;}
  }
  results.set(q.id,body);return true;
 };
 try{
  for(const q of request.before)if(!await queryStep(q,'before'))return report;
  options.checkCancel();const parsed=actionEventsSchema.safeParse(resolve({action:request.action,events:request.events,timeout:request.timeout,waitForComplete:request.waitForComplete}));if(!parsed.success)throw new InputError(parsed.error.message);const action=parsed.data;
  await record('request',action);
  report.actionSubmitted='unknown';report.observation=await options.action(action);report.actionSubmitted=report.observation.actionSubmitted;await record('observation',report.observation);results.set('observation',report.observation);
  if(report.observation.status!=='passed'){report.status=report.observation.status;report.reason=report.observation.reason;return report;}
  for(const q of request.after)if(!await queryStep(q,'after'))return report;
  report.status='passed';return report;
 }catch(error){if(error instanceof Error&&error.message==='TEST_CANCEL_REQUESTED')throw error;
  report.status=error instanceof InputError?'failed':'inconclusive';report.reason=('Action check stopped without retry: '+String(error)).slice(0,640);return report;
 }finally{await record('result',report);}
}
