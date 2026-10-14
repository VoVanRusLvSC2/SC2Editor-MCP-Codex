import type {SceneCamera} from './types.js';
/** Preview camera navigation starts at the last resolved rendered camera, including M3 CAM_. */
export function createCameraNavigation(initial:SceneCamera){
 let base=initial,azimuth=0,elevation=0,distance=1;
 function seed(camera:SceneCamera){base={...camera,eye:[...camera.eye],target:[...camera.target],curves:[],rigObject:undefined};const d=camera.eye.map((v,i)=>v-camera.target[i]);distance=Math.max(1e-6,Math.hypot(...d));azimuth=Math.atan2(d[1],d[0]);elevation=Math.atan2(d[2],Math.hypot(d[0],d[1]));}
 function camera(){return {...base,id:'orbit',name:'Свободный обзор',eye:[base.target[0]+Math.cos(azimuth)*Math.cos(elevation)*distance,base.target[1]+Math.sin(azimuth)*Math.cos(elevation)*distance,base.target[2]+Math.sin(elevation)*distance],far:Math.max(base.far,distance*4),clipRangeApproximate:base.clipRangeApproximate};}
 function rotate(dx:number,dy:number){azimuth-=dx*.008;elevation=Math.max(-Math.PI/2+.001,Math.min(Math.PI/2-.001,elevation+dy*.008));}
 function dolly(delta:number){distance=Math.max(1e-5,Math.min(1e7,distance*Math.exp(Math.max(-4,Math.min(4,delta*.001)))));}
 seed(initial);return {seed,camera,rotate,dolly};
}
