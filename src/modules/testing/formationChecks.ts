import type {GameResult} from '../../integrations/game/transport.js';
import type {FormationSpec,TestCheck,CheckState} from './schemas.js';
import {routeDeviation} from './routeGeometry.js';
import {MovementClock} from './movementClock.js';

type Point={x:number;y:number};
interface Hooks {
 call:(method:string,args:Record<string,unknown>)=>Promise<GameResult>;
 body:(result:GameResult)=>Record<string,any>;
 state:(result:GameResult)=>CheckState;
 checkCancel:()=>void;
 record:(name:string,value:unknown)=>Promise<string>;
 capture?:()=>Promise<TestCheck>;
 captureRequired?:boolean;
 pollMs?:number;
 now?:()=>number;
 delay?:(ms:number)=>Promise<void>;
}
interface Member {index:number;unit?:string;from:Point;to:Point;initial?:Record<string,any>;last?:Record<string,any>;arrived:boolean;maxDeviation:number}
class FormationObservationError extends Error {}
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const validPoint=(p:any):p is Point=>typeof p?.x==='number'&&Number.isFinite(p.x)&&typeof p?.y==='number'&&Number.isFinite(p.y);
const identity=(v:any,m:Member,f:FormationSpec)=>v?.valid===true&&v.alive===true&&String(v.id)===m.unit&&v.type===f.type&&v.owner===f.owner&&validPoint(v.position)&&Number.isFinite(v.life)&&Number.isFinite(v.shields);

/** Concurrent ordinary move orders, not a rigid-formation/pathfinding oracle. */
export async function runFormationCheck(f:FormationSpec,from:Point,to:Point,reverse:boolean,h:Hooks):Promise<{checks:TestCheck[];continueSuite:boolean}>{
 const id='formation:'+f.id+(reverse?':reverse':':forward'),corridor=f.maxDeviation,now=h.now??Date.now,delay=h.delay??(ms=>new Promise<void>(r=>setTimeout(r,ms)));
 const clock=new MovementClock(),members:Member[]=f.offsets.map((o,index)=>({index,from:{x:from.x+o.x,y:from.y+o.y},to:{x:to.x+o.x,y:to.y+o.y},arrived:false,maxDeviation:0}));
 const checks:TestCheck[]=[],samples:Array<{startedAt:string;finishedAt:string;members:unknown[]}>=[];
 let attemptedFixture=false,status:CheckState='inconclusive',reason:string|undefined,submission:'not_submitted'|'partial'|'complete'|'unknown'='not_submitted',concurrentSamples=0,dispatchMs=0,minSeparation:number|null=null,cancelled:unknown,cancelSignalled=false;
 const checkCancel=()=>{try{h.checkCancel();}catch(error){cancelled=error;cancelSignalled=true;throw error;}};
 const inspect=async()=>{
  const start=new Date().toISOString(),values=[];let moving=0;
  try{for(const m of members){
   checkCancel();const started=now(),response=await h.call('game.units.inspect',{unit:m.unit!}),finished=now(),body=h.body(response),v=body.unit;
   values.push({index:m.index,unitId:m.unit,observation:v?structuredClone(v):null,status:h.state(response),observationClock:clock.observe(body,m.initial?'sample':'initial',started,finished)});
   if(h.state(response)!=='passed'||!identity(v,m,f))throw new FormationObservationError('FORMATION_OBSERVATION_UNCONFIRMED: member '+m.index);
   if(m.initial&&['life','shields'].some(k=>v[k]<m.initial![k]-.001))throw new FormationObservationError('FORMATION_COMBAT_INTERFERENCE: member '+m.index);
   const previous=m.last?.position;m.last=structuredClone(v);m.maxDeviation=Math.max(m.maxDeviation,routeDeviation(v.position,m.from,m.to));m.arrived=distance(v.position,m.to)<=f.tolerance;
   if(m.initial&&previous&&distance(v.position,previous)>.01&&!m.arrived)moving++;
  }}finally{samples.push({startedAt:start,finishedAt:new Date().toISOString(),members:values});}
  for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++){const value=distance(members[a].last!.position,members[b].last!.position);minSeparation=minSeparation===null?value:Math.min(minSeparation,value);}
  if(moving>=2)concurrentSamples++;
 };
 try{
  for(const m of members){
   checkCancel();attemptedFixture=true;
   let response:GameResult;
   try{response=await h.call('game.fixture',{type:f.type,owner:f.owner,...m.from});}catch(error){submission='unknown';throw error;}
   await h.record('fixture_'+m.index,response);const unit=h.body(response).unit?.id;
   if(h.state(response)!=='passed'||!(typeof unit==='string'&&unit.length>0||typeof unit==='number'&&Number.isSafeInteger(unit))){submission='unknown';throw new FormationObservationError('FORMATION_FIXTURE_UNCONFIRMED: member '+m.index);}
   m.unit=String(unit);if(members.some(other=>other!==m&&other.unit===m.unit))throw new FormationObservationError('FORMATION_DUPLICATE_UNIT_ID');
  }
  await inspect();
  for(const m of members){if(distance(m.last!.position,m.from)>f.tolerance)throw new FormationObservationError('FORMATION_SPAWN_DISPLACED: member '+m.index);m.initial=structuredClone(m.last);}
  const started=now();
  for(const m of members){
   checkCancel();submission='partial';let response:GameResult;
   try{const started=now();response=await h.call('game.order',{unit:m.unit!,action:'move',...m.to});clock.observe(h.body(response),'order',started,now());}catch(error){submission='unknown';throw error;}
   await h.record('order_'+m.index,response);
   if(h.state(response)!=='passed'||h.body(response).accepted!==true){submission=h.body(response).accepted===false?'partial':'unknown';throw new FormationObservationError('FORMATION_MOVE_UNCONFIRMED: member '+m.index);}
  }
  submission='complete';dispatchMs=now()-started;const deadline=now()+f.timeout*1000;
  do{
   await inspect();
   if(corridor!==undefined&&members.some(m=>m.maxDeviation>corridor)){status='failed';reason='Observed member trajectory left its declared offset corridor';break;}
   if(clock.invalid){reason='Group movement clock identity or monotonicity changed; arrival correlation is unconfirmed';break;}
   if(now()>deadline){reason='Group observation completed after the deadline; arrival timing was not confirmed';break;}
   if(members.every(m=>m.arrived)){status=concurrentSamples?'passed':'inconclusive';reason=concurrentSamples?undefined:'All members arrived, but concurrent in-transit movement was not observed';break;}
   if(now()>=deadline){reason='Not all members arrived before the deadline; non-arrival does not prove an obstruction';break;}
   await delay(h.pollMs??250);
  }while(now()<=deadline);
  if(status==='inconclusive'&&!reason)reason='Not all members arrived before the deadline; non-arrival does not prove an obstruction';
  if(h.capture)try{checks.push(await h.capture());}catch(error){
   try{await h.record('frame_failure',{error:String(error)});}catch{/* Preserve the explicit missing-frame verdict even without a file. */}
   checks.push({id:id+':frame',status:'inconclusive',required:h.captureRequired??true,reason:'Native group-frame capture was not confirmed; inspect the private failure report'});
  }
 }catch(error){
  if(cancelSignalled&&error===cancelled){/* Propagate only cancellation originating from the caller's cancellation check. */}
  else{
   const message=error instanceof Error?error.message:String(error);try{await h.record('failure',{error:message});}catch{/* Cleanup still runs when evidence storage fails. */}
   reason=error instanceof FormationObservationError?message.replace(/\p{Cc}/gu,' ').slice(0,640):'FORMATION_OPERATION_UNCONFIRMED: inspect the private failure report';
   status=/SPAWN_DISPLACED|DUPLICATE_UNIT_ID/.test(reason)?'failed':'inconclusive';
  }
 }finally{
  let trajectoryFile:string|undefined;
  try{trajectoryFile=await h.record('trajectory',samples);}catch(error){status='failed';reason='FORMATION_TRAJECTORY_PERSISTENCE_FAILED: '+String(error);}
  checks.unshift({id,status,required:f.required,reason,evidence:{type:f.type,owner:f.owner,mobility:f.mobility,mobilitySource:'manifest_declaration',memberCount:members.length,ordersSubmitted:submission,orderDispatchMs:dispatchMs,concurrentInTransitSamples:concurrentSamples,arrivedMembers:members.filter(m=>m.arrived).length,minimumSampledCenterSeparation:minSeparation,
   maxObservedDeviation:Math.max(...members.map(m=>m.maxDeviation)),...(f.maxDeviation===undefined?{}:{maxDeviation:f.maxDeviation}),tolerance:f.tolerance,movementClock:clock.summary(),trajectoryFile,sampleCount:samples.length,
   members:members.map(m=>({index:m.index,unitId:m.unit,from:m.from,to:m.to,observedStart:m.initial?.position??null,observedEnd:m.last?.position??null,arrived:m.arrived,maxObservedDeviation:m.maxDeviation})),
   scope:'Ordinary orders are submitted to all distinct members before waiting. At least two member centers must change between observation batches while still in transit, and every member must arrive. Reads are sequential with timestamps, not an atomic snapshot. No rigid-shape, footprint, engine path, collision or buildability guarantee.'}});
  if(submission==='unknown')checks.push({id:id+':submission',status:'inconclusive',required:true,reason:'A fixture or move mutation had an ambiguous result; later groups and scenarios were not submitted'});
  if(attemptedFixture){
   let removed:boolean,cleanupReason:string|undefined;
   try{const response=await h.call('game.fixture',{action:'cleanup'});await h.record('cleanup',response);removed=h.state(response)==='passed';
    for(const m of members.filter(m=>m.unit)){const readback=await h.call('game.units.inspect',{unit:m.unit!});await h.record('cleanup_'+m.index,readback);removed=removed&&h.state(readback)==='passed'&&h.body(readback).unit?.valid===false;}
   }catch(error){removed=false;cleanupReason='FORMATION_CLEANUP_UNCONFIRMED: inspect the private failure report';try{await h.record('cleanup_failure',{error:String(error)});}catch{/* Final suite detach remains mandatory. */}}
   checks.push({id:id+':cleanup',status:removed?'passed':'failed',required:true,reason:removed?undefined:cleanupReason??'Test-owned fixture removal was not confirmed',evidence:{knownMembers:members.filter(m=>m.unit).length,scope:'SDK cleanup removes only test-owned fixtures in this leased private game; known IDs are read back invalid.'}});
  }
 }
 if(cancelSignalled)throw cancelled;
 return {checks,continueSuite:checks.every(c=>c.status==='passed'||!c.required&&c.status!=='failed')};
}
