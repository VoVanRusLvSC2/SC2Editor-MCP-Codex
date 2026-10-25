interface NativeClock {session:string;runtimeEpoch:string;mapLoadSerial:number;gameTime:number}
export interface MovementStamp {phase:'initial'|'order'|'sample';requestStartedMs:number;responseFinishedMs:number;roundTripMs:number;native?:NativeClock}
const clock=(body:Record<string,unknown>):NativeClock|undefined=>{
 const {session,runtimeEpoch,mapLoadSerial,gameTime}=body;
 return typeof session==='string'&&session.length>0&&session.length<=512&&typeof runtimeEpoch==='string'&&runtimeEpoch.length>0&&runtimeEpoch.length<=512&&Number.isSafeInteger(mapLoadSerial)&&Number(mapLoadSerial)>=0&&typeof gameTime==='number'&&Number.isFinite(gameTime)&&gameTime>=0
  ?{session,runtimeEpoch,mapLoadSerial:Number(mapLoadSerial),gameTime}:undefined;
};
const same=(a:NativeClock,b:NativeClock)=>a.session===b.session&&a.runtimeEpoch===b.runtimeEpoch&&a.mapLoadSerial===b.mapLoadSerial;

/** Same-response clocks are telemetry, never a replacement for the wall deadline. */
export class MovementClock {
 private previous?:MovementStamp;
 private order?:MovementStamp;
 private last?:MovementStamp;
 private identity?:NativeClock;
 private nativeTime?:number;
 private total=0;
 private observed=0;
 private issues=new Set<string>();
 observe(body:Record<string,unknown>,phase:MovementStamp['phase'],started:number,finished:number):MovementStamp{
  const native=clock(body),stamp={phase,requestStartedMs:started,responseFinishedMs:finished,roundTripMs:finished-started,...native?{native}:{}};
  this.total++;if(native)this.observed++;
  if(!native&&['session','runtimeEpoch','mapLoadSerial','gameTime'].some(key=>body[key]!==undefined))this.issues.add('native_clock_incomplete');
  if(!Number.isFinite(started)||!Number.isFinite(finished)||finished<started||this.previous&&started<this.previous.responseFinishedMs)this.issues.add('wall_clock_regressed');
  if(native){
   if(this.identity&&!same(this.identity,native))this.issues.add('native_identity_changed');
   if(this.nativeTime!==undefined&&native.gameTime<this.nativeTime)this.issues.add('native_game_time_regressed');
   this.identity??=native;this.nativeTime=native.gameTime;
  }
  if(phase==='order')this.order=stamp;if(phase==='sample')this.last=stamp;this.previous=stamp;
  return stamp;
 }
 get invalid(){return this.issues.size>0;}
 summary(){
  const quality=this.invalid?'invalid':this.observed===0?'unavailable':this.observed===this.total?'verified':'partial';
  const wallElapsedMs=this.order&&this.last?this.last.responseFinishedMs-this.order.responseFinishedMs:undefined;
  const gameElapsedSeconds=quality==='verified'&&this.order?.native&&this.last?.native?this.last.native.gameTime-this.order.native.gameTime:undefined;
  return {quality,clockSource:'response.gameTime',identitySource:'response.session/runtimeEpoch/mapLoadSerial',observations:this.total,nativeObservations:this.observed,issues:[...this.issues],...(wallElapsedMs===undefined?{}:{wallElapsedMs}),...(gameElapsedSeconds===undefined?{}:{gameElapsedSeconds,...wallElapsedMs!==undefined&&wallElapsedMs>0?{gameSecondsPerWallSecond:gameElapsedSeconds/(wallElapsedMs/1000)}:{}}),scope:'Read-only timestamps from the same returned operations. Complete monotonic same-session clocks are required for the ratio. This is observed simulation progress, not an FPS, configured game-speed, obstruction or load diagnosis; it never extends the wall deadline.'};
 }
}
