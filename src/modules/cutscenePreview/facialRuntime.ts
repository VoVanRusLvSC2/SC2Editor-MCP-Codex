import type {FacialController,PreviewMesh} from './types.js';
/** Pure FACE/1731 evaluator. Only validated compiled linear links are accepted.
 * SC2 FaceFX uses centimetres, Y-up and WXYZ quaternions; M3 uses metres, Z-up. */
export function createFacialKernel(){
 const q=(raw:number[])=>[-raw[1],-raw[3],-raw[2],raw[0]],p=(raw:number[])=>[raw[0]/100,raw[2]/100,raw[1]/100],s=(raw:number[])=>[raw[0],raw[2],raw[1]];
 const normalize=(a:number[])=>{const n=Math.hypot(...a);return n>1e-9?a.map(v=>v/n):[0,0,0,1];};
 const mul=(a:number[],b:number[])=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
 function value(keys:number[][],time:number){if(!keys.length)return 0;if(time<=keys[0][0])return keys[0][1];if(time>=keys.at(-1)![0])return keys.at(-1)![1];let lo=0,hi=keys.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(keys[m][0]<=time)lo=m;else hi=m;}const a=keys[lo],b=keys[hi],span=b[0]-a[0],t=(time-a[0])/span,t2=t*t,t3=t2*t;return (2*t3-3*t2+1)*a[1]+(t3-2*t2+t)*span*a[3]+(-2*t3+3*t2)*b[1]+(t3-t2)*span*b[2];}
 function sample(controller:FacialController,anim:string,group:string,time:number,mesh:PreviewMesh,weight=1){
  const clip=controller.clips.find(c=>c.name===anim&&(!group||c.group===group));if(!clip||controller.unsupported.length)return undefined;
  const inputs=new Map(clip.curves.map(c=>[c.name,value(c.keys,time)])),values=new Map<number,number>(),visiting=new Set<number>();
  const evaluate=(id:number):number=>{if(values.has(id))return values.get(id)!;if(visiting.has(id))throw new Error('FXA_GRAPH_CYCLE');visiting.add(id);const n=controller.nodes[id];let linked=n.operation===1&&n.links.length?1:0;for(const l of n.links){if(l.function!==1)throw new Error('FXA_LINK_UNSUPPORTED');const v=evaluate(l.node)*(l.parameters[0]??1)+(l.parameters[1]??0);linked=n.operation===1?linked*v:linked+v;}let v=(inputs.get(n.name)??0)+linked;v=Math.max(n.min,Math.min(n.max,v));visiting.delete(id);values.set(id,v);return v;};
  const changes:Record<string,{position:number[];rotation:number[];scale:number[]}>={};let driven=0;
  for(const bone of controller.bones){const index=mesh.bones.findIndex(b=>b.name===bone.name);if(index<0)continue;const position=[0,0,0],scale=[0,0,0],rotation=[0,0,0,1],rest=normalize(q(bone.rotation)),inverse=[-rest[0],-rest[1],-rest[2],rest[3]];
   for(const pose of bone.poses){const w=Math.max(0,evaluate(pose.node))*weight*bone.weight;if(!w)continue;const deltaPosition=p(pose.position),deltaScale=s(pose.scale),delta=normalize(mul(inverse,normalize(q(pose.rotation)))),sign=delta[3]<0?-1:1;for(let i=0;i<3;i++){position[i]+=deltaPosition[i]*w;scale[i]+=deltaScale[i]*w;rotation[i]+=delta[i]*sign*w;}rotation[3]+=(delta[3]*sign-1)*w;}
   if(position.some(v=>Math.abs(v)>1e-10)||scale.some(v=>Math.abs(v)>1e-10)||rotation.slice(0,3).some(v=>Math.abs(v)>1e-10))driven++;
   changes[bone.name]={position,rotation:normalize(rotation),scale};
  }return {changes,driven,clip:clip.name};
 }
 function compatibility(controller:FacialController,mesh:PreviewMesh){const missing:string[]=[],mismatch:string[]=[];for(const bone of controller.bones){const target=mesh.bones.find(b=>b.name===bone.name);if(!target){missing.push(bone.name);continue;}const position=p(bone.position),rotation=normalize(q(bone.rotation)),ref=normalize(target.rotation.value);if(Math.hypot(...position.map((v,i)=>v-target.position.value[i]))>.001||1-Math.abs(rotation.reduce((n,v,i)=>n+v*ref[i],0))>.001)mismatch.push(bone.name);}return {missing,mismatch,compatible:!missing.length,referencePoseExact:!mismatch.length};}
 return {sample,value,compatibility,mul};
}
