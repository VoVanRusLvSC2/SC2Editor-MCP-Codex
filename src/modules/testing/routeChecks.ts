import type {GameResult} from '../../integrations/game/transport.js';
import type {TestManifest,TestCheck,CheckState} from './schemas.js';
import {routeDeviation} from './routeGeometry.js';
import {MovementClock} from './movementClock.js';

type Point={x:number;y:number};
type Route=NonNullable<TestManifest['game']>['routes'][number];
interface Hooks {
 call:(method:string,args:Record<string,unknown>)=>Promise<GameResult>;
 body:(result:GameResult)=>Record<string,any>;
 state:(result:GameResult)=>CheckState;
 checkCancel:()=>void;
 record:(name:string,value:unknown)=>Promise<string>;
 focus?:(unit:string)=>Promise<void>;
 capture?:()=>Promise<void>;
 pollMs?:number;
 now?:()=>number;
 delay?:(ms:number)=>Promise<void>;
}
const validPoint=(p:any):p is Point=>typeof p?.x==='number'&&Number.isFinite(p.x)&&typeof p?.y==='number'&&Number.isFinite(p.y);
const unitId=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=512||typeof v==='number'&&Number.isSafeInteger(v);
const completeUnit=(u:any)=>unitId(u?.id)&&typeof u.valid==='boolean'&&typeof u.alive==='boolean'&&typeof u.type==='string'&&u.type.length>0&&Number.isSafeInteger(u.owner)&&u.owner>=0&&u.owner<=15&&validPoint(u.position)&&Number.isFinite(u.life)&&Number.isFinite(u.shields);
const identity=(u:any,id:string,r:Route)=>u?.valid===true&&u.alive===true&&String(u.id)===id&&u.type===r.type&&u.owner===r.owner&&validPoint(u.position)&&Number.isFinite(u.life)&&Number.isFinite(u.shields);

/** One ordinary route leg. Ambiguous operations are never retried or promoted to unit assertions. */
export async function runRouteCheck(r:Route,from:Point,to:Point,reverse:boolean,h:Hooks):Promise<{checks:TestCheck[];continueSuite:boolean}>{
 const id='route:'+r.id+(reverse?':reverse':':forward'),now=h.now??(()=>performance.now()),delay=h.delay??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms))),clock=new MovementClock(),checks:TestCheck[]=[],trajectory:Array<Record<string,any>>=[];
 let attemptedFixture=false,unit:string|undefined,phase='fixture',status:CheckState='inconclusive',reason:string|undefined,halt=false,submissionUnknown=false,orderSubmitted:boolean|'unknown'=false,arrived=false,lateArrival=false,maxObservedDeviation=0,initial:Record<string,any>|undefined,cancelled:unknown,cancelSignalled=false,trajectoryFile:string|undefined;
 const checkCancel=()=>{try{h.checkCancel();}catch(error){cancelled=error;cancelSignalled=true;throw error;}};
 const observe=async(kind:'initial'|'sample')=>{
  const started=now(),response=await h.call('game.units.inspect',{unit:unit!}),finished=now(),body=h.body(response),u=body.unit;
  if(kind==='initial')await h.record('initial',response);
  trajectory.push({at:new Date().toISOString(),...(u?structuredClone(u):{}),observationState:h.state(response),observationClock:clock.observe(body,kind,started,finished)});
  return{response,body,u,finished};
 };
 try{
  checkCancel();attemptedFixture=true;submissionUnknown=true;
  const created=await h.call('game.fixture',{type:r.type,owner:r.owner,...from}),createdBody=h.body(created);if(unitId(createdBody.unit?.id))unit=String(createdBody.unit.id);
  await h.record('fixture',created);
  if(h.state(created)!=='passed'||!unit){status=h.state(created)==='passed'?'inconclusive':h.state(created);reason='ROUTE_FIXTURE_UNCONFIRMED';halt=true;}
  else{
   submissionUnknown=false;phase='initial';const observed=await observe('initial');
   if(h.state(observed.response)!=='passed'){status=h.state(observed.response);reason='ROUTE_INITIAL_INSPECTION_UNCONFIRMED';halt=true;}
   else if(observed.u?.valid===false||observed.u?.alive===false){status='failed';reason='ROUTE_FIXTURE_INVALID: the initial fixture is confirmed invalid or dead';halt=true;}
   else if(!completeUnit(observed.u)){reason='ROUTE_INITIAL_INSPECTION_UNCONFIRMED';halt=true;}
   else if(!identity(observed.u,unit,r)||Math.hypot(observed.u.position.x-from.x,observed.u.position.y-from.y)>r.tolerance){status='failed';reason='ROUTE_FIXTURE_INVALID: confirmed identity, vitals or spawn position does not match the declared fixture';halt=true;}
   else if(clock.invalid){reason='Movement clock identity or monotonicity changed; arrival correlation is unconfirmed';halt=true;}
   else{
    initial=structuredClone(observed.u);maxObservedDeviation=routeDeviation(initial!.position,from,to);if(h.focus){phase='focus';await h.focus(unit);}
    phase='order';checkCancel();orderSubmitted='unknown';submissionUnknown=true;
    const started=now(),issued=await h.call('game.order',{unit,action:'move',...to}),finished=now(),body=h.body(issued);clock.observe(body,'order',started,finished);await h.record('order',issued);
    if(h.state(issued)!=='passed'||body.accepted!==true){status=h.state(issued)==='passed'?(body.accepted===false?'failed':'inconclusive'):h.state(issued);reason=body.accepted===false?'ROUTE_MOVE_REJECTED':'ROUTE_MOVE_UNCONFIRMED';orderSubmitted=body.accepted===false?false:'unknown';submissionUnknown=body.accepted!==false;halt=true;}
    else{
     orderSubmitted=true;submissionUnknown=false;phase='sample';const end=finished+r.timeout*1000;
     do{
      checkCancel();const sample=await observe('sample'),u=sample.u;
      if(h.state(sample.response)!=='passed'){status=h.state(sample.response);reason='ROUTE_INSPECTION_UNCONFIRMED';halt=true;break;}
      if(!identity(u,unit,r)){reason='Unit identity, validity or position was not confirmed during movement';halt=true;break;}
      if(clock.invalid){reason='Movement clock identity or monotonicity changed; arrival correlation is unconfirmed';halt=true;break;}
      if(u.life<initial!.life-.001||u.shields<initial!.shields-.001){reason='ROUTE_COMBAT_INTERFERENCE: fixture vitals decreased during isolated movement';halt=true;break;}
      maxObservedDeviation=Math.max(maxObservedDeviation,routeDeviation(u.position,from,to));
      if(Math.hypot(u.position.x-to.x,u.position.y-to.y)<=r.tolerance){if(sample.finished<=end)arrived=true;else lateArrival=true;break;}
      if(sample.finished>=end)break;await delay(h.pollMs??250);
     }while(now()<end);
     const outside=r.maxDeviation!==undefined&&maxObservedDeviation>r.maxDeviation;
     // Only confirmed samples contribute to the corridor assertion. Unknown
     // later reads do not erase an already observed deviation.
     if(outside){status='failed';reason='Observed trajectory left the declared route corridor';}
     else if(!halt){status=r.expected==='blocked'?(arrived?'failed':'inconclusive'):arrived?'passed':'inconclusive';reason=lateArrival?'Arrival observed only after the unchanged wall deadline; timing is unconfirmed':arrived?(r.expected==='blocked'?'Observed arrival across an expected blocked crossing':undefined):'Arrival not observed; timeout does not prove an obstruction';}
    }
   }
  }
  if(h.capture&&initial)try{await h.capture();}catch(error){await h.record('frame_failure',{error:String(error)});checks.push({id:id+':frame',status:'inconclusive',required:false,reason:'Native route frame was not confirmed; inspect the private failure report'});}
 }catch(error){
  if(!(cancelSignalled&&error===cancelled)){halt=true;status='inconclusive';reason='ROUTE_OPERATION_UNCONFIRMED: '+phase;try{await h.record('failure',{phase,error:String(error)});}catch{/* Cleanup still runs when evidence storage fails. */}}
 }finally{
  try{trajectoryFile=await h.record('trajectory',trajectory);}catch(error){status='failed';reason='ROUTE_TRAJECTORY_PERSISTENCE_FAILED';halt=true;try{await h.record('trajectory_failure',{error:String(error)});}catch{/* Final detach remains mandatory. */}}
  if(attemptedFixture){
   let cleanupStatus:CheckState,cleanupReason:string|undefined;
   try{
    const cleaned=await h.call('game.fixture',{action:'cleanup'});await h.record('cleanup',cleaned);cleanupStatus=h.state(cleaned);
    if(unit){const readback=await h.call('game.units.inspect',{unit});await h.record('cleanup_readback',readback);const state=h.state(readback),u=h.body(readback).unit;
     if(cleanupStatus==='passed')cleanupStatus=state==='passed'?(u?.valid===false?'passed':u?.valid===true?'failed':'inconclusive'):state;
     if(state==='passed'&&u?.valid===true){cleanupStatus='failed';cleanupReason='Test-owned fixture remains valid after cleanup';}
    }
    if(cleanupStatus==='not_checked')cleanupStatus='inconclusive';
   }catch(error){cleanupStatus='inconclusive';try{await h.record('cleanup_failure',{error:String(error)});}catch{/* Final detach remains mandatory. */}}
   checks.push({id:id+':cleanup',status:cleanupStatus,required:true,reason:cleanupStatus==='passed'?undefined:cleanupReason??'ROUTE_CLEANUP_UNCONFIRMED: inspect the private cleanup/readback reports',evidence:{knownUnit:unit??null,scope:'SDK test-owned fixture cleanup acknowledgement and known-ID invalid readback. An ambiguous creation still blocks later submissions.'}});
   if(cleanupStatus!=='passed')halt=true;
  }
  checks.unshift({id,status,required:r.required,reason,evidence:{type:r.type,owner:r.owner,mobility:r.mobility,mobilitySource:'manifest_declaration',expected:r.expected,phase,fixtureUnit:unit??null,orderSubmitted,arrived,lateArrival,deadlineSeconds:r.timeout,movementClock:clock.summary(),trajectorySamples:trajectory.length,maxObservedDeviation,...(r.maxDeviation===undefined?{}:{maxDeviation:r.maxDeviation,corridorScope:'sampled_unit_centers'}),trajectoryFile}});
  if(halt)checks.push({id:id+(submissionUnknown?':submission':':continuation'),status:'inconclusive',required:true,reason:submissionUnknown?'A fixture or move mutation had an ambiguous result; no retry or later route/group/scenario/action was submitted':'Route state or cleanup was not confirmed; later routes, groups, scenarios and actions were not submitted'});
 }
 if(cancelSignalled)throw cancelled;
 return{checks,continueSuite:!halt};
}
