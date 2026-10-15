import type {PreviewScene} from './types.js';
/** Preview transport; emits local records, never substitutes for per-player Galaxy events. */
export function createPlaybackKernel(){
 function advance(scene:PreviewScene,from:number,delta:number,range?:{start:number;end:number},policy:{loop?:boolean}={}){
  const filters=[...(scene.previewFilters??[])],eligible=(g:import('./types.js').SceneGate)=>g.scopeEnabled!==false&&(!g.guide||scene.showGuides!==false)&&(!filters.length||!g.filters?.some(clause=>clause.length&&!clause.some(t=>filters.includes(t))));const duration=scene.duration,low=range?Math.max(0,Math.min(duration,range.start)):0,high=range?Math.max(low,Math.min(duration,range.end)):duration;
  if(!Number.isFinite(from)||!Number.isFinite(delta)||delta<0||high<=low)return {time:Math.max(0,Math.min(duration,from)),pause:false,events:[] as Array<{type:string;name?:string;time:number}>,limited:false,filters};
  let cursor=Math.max(low,Math.min(high,from)),remaining=delta,pause=false,limited=false;const events:Array<{type:string;name?:string;time:number}>=[];const cross=(start:number,end:number)=>{for(const d of scene.drivers??[])if(d.start>start&&d.start<=end&&eligible(d))events.push({type:'conversation-line',name:d.conversation+':'+d.line,time:d.start});};
  for(let steps=0;remaining>0;steps++){
   if(steps>=64){limited=true;pause=true;break;}
   const end=(scene.endMarkers??[]).find(t=>t>cursor&&t<=high&&(!scene.endEvents||scene.endEvents.some(e=>e.time===t&&eligible(e)))),bookmark=scene.bookmarks?.find(b=>eligible(b)&&b.time>cursor&&b.time<=high),boundary=Math.min(high,end??Infinity,bookmark?.time??Infinity);
   if(cursor+remaining<boundary){cross(cursor,cursor+remaining);cursor+=remaining;break;}
   cross(cursor,boundary);remaining-=boundary-cursor;cursor=boundary;
   if(bookmark?.time===boundary){for(const f of bookmark.removeFilters??[]){const at=filters.indexOf(f);if(at>=0)filters.splice(at,1);}for(const f of bookmark.addFilters??[])if(!filters.includes(f))filters.push(f);events.push({type:'bookmark',name:bookmark.name,time:cursor});if(bookmark.jump){const target=scene.bookmarks?.find(b=>b.name===bookmark.jump);if(target&&target.time>=low&&target.time<high)cursor=target.time;else events.push({type:'unresolved-jump',name:bookmark.jump,time:cursor});}if(bookmark.pause){pause=true;break;}}
   if(cursor===boundary&&(end===boundary||boundary===high)){events.push({type:'end',time:boundary});if(policy.loop===false){pause=true;break;}cursor=low;}
  }
  return {time:cursor,pause,events,limited,filters};
 }
 return {advance};
}
