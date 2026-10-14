import type {PreviewMesh} from './types.js';
/** Conservative bounds contain every convex weighted skin vertex, including animated joints. */
export function createFrustumCulling(){
 type Box={min:number[];max:number[]};
 const cache=new WeakMap<PreviewMesh,{joints:Map<number,Box>;fixed?:Box}>();
 const box=():Box=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
 function point(b:Box,p:number[]){for(let c=0;c<3;c++){b.min[c]=Math.min(b.min[c],p[c]);b.max[c]=Math.max(b.max[c],p[c]);}}
 function influences(mesh:PreviewMesh){let value=cache.get(mesh);if(value)return value;const joints=new Map<number,Box>();let fixed:Box|undefined;
  for(let v=0;v<mesh.positions.length/3;v++){let used=false;const p=Array.from(mesh.positions.slice(v*3,v*3+3));for(let c=0;c<4;c++){const w=mesh.weights[v*4+c],joint=mesh.joints[v*4+c];if(w>0&&joint>=0){let b=joints.get(joint);if(!b){b=box();joints.set(joint,b);}point(b,p);used=true;}}if(!used){fixed??=box();point(fixed,p);point(fixed,[0,0,0]);}}
  value={joints,fixed};cache.set(mesh,value);return value;
 }
 function transformed(b:Box,m:ArrayLike<number>,out:Box){const center=b.min.map((v,i)=>(v+b.max[i])/2),radius=b.max.map((v,i)=>(v-b.min[i])/2);for(let i=0;i<3;i++){const c=m[i]*center[0]+m[i+4]*center[1]+m[i+8]*center[2]+m[i+12],r=Math.abs(m[i])*radius[0]+Math.abs(m[i+4])*radius[1]+Math.abs(m[i+8])*radius[2];out.min[i]=Math.min(out.min[i],c-r);out.max[i]=Math.max(out.max[i],c+r);}}
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 function bounds(mesh:PreviewMesh,matrices:number[][]|undefined,world:ArrayLike<number>):Box|undefined{const local=box();if(!matrices?.length)transformed(mesh.bounds,identity,local);else{const data=influences(mesh);if(data.fixed)transformed(data.fixed,identity,local);for(const [joint,b]of data.joints){const m=matrices[joint];if(!m)return undefined;transformed(b,m,local);}}const out=box();transformed(local,world,out);return [...out.min,...out.max].every(Number.isFinite)?out:undefined;}
 function visible(b:Box|undefined,vp:ArrayLike<number>){if(!b)return true;for(const axis of [0,1,2])for(const sign of [-1,1]){const p=[0,1,2,3].map(c=>vp[c*4+3]+sign*vp[c*4+axis]),max=p[3]+p.slice(0,3).reduce((sum,n,i)=>sum+n*(n>=0?b.max[i]:b.min[i]),0);if(max<-.001)return false;}return true;}
 return {bounds,visible};
}
