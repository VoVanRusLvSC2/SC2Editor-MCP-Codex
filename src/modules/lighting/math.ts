import type {GlobalLighting} from './types.js';
/** Serializable helpers shared by WebGL and PNG. Light stays in world space as camera rotates. */
export function createGlobalLightingKernel(){
 const fallback:GlobalLighting={preset:'studio-fallback',ambient:[.22,.24,.28],directional:[{name:'Key',direction:[-.3,.4,.866],color:[1,.97,.9],specular:[1,1,1]},{name:'Fill',direction:[.8,-.5,.3],color:[.2,.25,.32],specular:[.1,.1,.1]},{name:'Back',direction:[-.7,-.5,.4],color:[.12,.18,.26],specular:[.1,.1,.1]}],fogDensity:0};
 const direction=(m:number[],v:number[])=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2],m[1]*v[0]+m[5]*v[1]+m[9]*v[2],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]];
 function normalMatrix(m:number[]){const [a,b,c,d,e,f,g,h,i]=[m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]],det=a*(e*i-f*h)-d*(b*i-c*h)+g*(b*f-c*e);return Math.abs(det)<1e-12?[1,0,0,0,1,0,0,0,1]:[(e*i-f*h)/det,(f*g-d*i)/det,(d*h-e*g)/det,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det];}
 function irradiance(sh:number[][]|undefined,raw:number[]){if(!sh)return [0,0,0];const length=Math.hypot(...raw)||1,[x,y,z]=raw.map(v=>v/length),basis=[.282095,.488603*y,.488603*z,.488603*x,1.092548*x*y,1.092548*y*z,.315392*(3*z*z-1),1.092548*x*z,.546274*(x*x-y*y)];return [0,1,2].map(c=>Math.max(0,basis.reduce((n,b,i)=>n+b*(sh[i]?.[c]??0),0)));}const saturate=(x:number)=>Math.max(0,Math.min(1,x));
 function pointAttenuation(distance:number,recipRange:number,multiplier:number){const ramp=saturate((1-saturate(distance*recipRange))*multiplier);return ramp*ramp;}
 // Base98310 141d96b20: node and M3 LITE angles are full radians; .95 is an authored float32 constant.
 function spotParameters(hotspot:number,falloff:number){
  const outer=Math.cos(falloff*.5),inner=Math.cos(Math.min(hotspot,falloff*.949999988079071)*.5),bias=-outer,scale=1/(1-outer),hotspotMultiplier=1/(1-(1-inner)*scale);
  // Native zero-angle division is singular. Skipping nonfinite cones is a bounded preview guard.
  return [hotspot,falloff,bias,scale,hotspotMultiplier].every(Number.isFinite)?{bias,scale,hotspotMultiplier}:undefined;
 }
 function spotAttenuation(dotToLight:number,bias:number,scale:number,hotspotMultiplier:number){const ramp=saturate(saturate((saturate(dotToLight)+bias)*scale)*hotspotMultiplier);return ramp*ramp;}
 function blinn(ndotl:number,ndoth:number,power:number,doubleLambert=false){const raw=doubleLambert?2*ndotl-1:ndotl;return {diffuse:saturate(raw),specular:saturate(Math.pow(Math.max(.0001,saturate(ndoth)),Math.max(0,power))*Math.sign(raw))};}

 // Base98310 140fb6cd0 ->141d4fb00: a resolved environment uses the independent scalar,
 // while absent/failed maps use RGB with the native white fallback cube. Schema default scalar is1.
 function ambientUniform(light:GlobalLighting){const scalar=light.ambientEnvironmentMultiplier??1;return light.environmentCube?[scalar,scalar,scalar]:[...light.ambient];}
 // Base98310 141dfc5a0 ->141d4fb00 ordinary native MAT_ standard route only.
 // Missing effective scene parameters keep compatibility factor1; native SLightInfo Param ctor default is0.
 function materialHDR(light:GlobalLighting,material:{unshaded:boolean;sourceFlags?:number;materialClass?:number;lightingModel?:string},special=false){
  const route=special?'effect':material.unshaded?'unshaded':material.sourceFlags===undefined||material.materialClass===undefined?'source-metadata-missing':material.sourceFlags&0x200?'alternate-terrain-hdr':material.materialClass!==0||(material.lightingModel??'m3')!=='m3'?'unsupported-family':'ordinary',ordinary=route==='ordinary',spec=light.parameters?.HDRSpecMultiplier??light.parameters?.hdrSpecMultiplier,emis=light.parameters?.HDREmisMultiplier??light.parameters?.hdrEmisMultiplier;
  return {route,ordinary,localSpecular:ordinary?spec??1:1,emissive:ordinary?emis??1:1,compatibilityFallback:ordinary&&(spec===undefined||emis===undefined)};
 }
 // Base98310 lighting.fx: the cube modulates the selected uniform; secondary lights have no specular.
 function diffuse(light:GlobalLighting,normal:number[],albedo:number[],ao=1,cubeColor=[1,1,1],doubleLambert=false){
  const n=normal.map(v=>v/(Math.hypot(...normal)||1)),ambient=ambientUniform(light);
  const amount=(d:number[])=>blinn(n.reduce((s,v,i)=>s+v*d[i],0),0,0,doubleLambert).diffuse;
  return albedo.map((v,c)=>v*(ambient[c]*cubeColor[c]*ao+light.directional.reduce((sum,l,i)=>sum+l.color[c]*amount(l.direction)*(i?ao:1),0)));
 }
 function cubeFace(raw:number[]){
  const [x,y,z]=raw,ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);let face:number,u:number,v:number;
  if(ax>=ay&&ax>=az){face=x>=0?0:1;u=(x>=0?-z:z)/(ax||1);v=-y/(ax||1);}
  else if(ay>=az){face=y>=0?2:3;u=x/ay;v=(y>=0?z:-z)/ay;}
  else{face=z>=0?4:5;u=(z>=0?x:-x)/az;v=-y/az;}
  return {face,u:(u+1)/2,v:(v+1)/2};
 }
 const decoded=new WeakMap<NonNullable<GlobalLighting['environmentCube']>,Uint8Array[]>();
 function cube(light:GlobalLighting,normal:number[]){
  const image=light.environmentCube;if(!image)return [1,1,1];let faces=decoded.get(image);
  if(!faces){faces=image.faces.map(s=>{const text=atob(s),a=new Uint8Array(text.length);for(let i=0;i<a.length;i++)a[i]=text.charCodeAt(i);return a;});decoded.set(image,faces);}
  const c=cubeFace(normal),x=Math.min(image.size-1,Math.max(0,Math.floor(c.u*image.size))),y=Math.min(image.size-1,Math.max(0,Math.floor(c.v*image.size))),offset=(y*image.size+x)*4;
  return [0,1,2].map(i=>faces![c.face][offset+i]/255);
 }
 function shader(worldNormal:boolean){return `uniform samplerCube u_previewAmbientCube;uniform float u_previewAmbientCubeEnabled;
 vec3 previewGlobalNormal(vec3 n){return ${worldNormal?'normalize(n)':'normalize(mat3(v_previewWorldTangent,v_previewWorldBitangent,v_previewWorldNormal)*n)'};}
 vec3 previewAmbient(vec3 n){vec3 environment=u_previewAmbientCubeEnabled>.5?texture(u_previewAmbientCube,previewGlobalNormal(n)).rgb:vec3(1.);return u_sceneAmbientColor*environment;}`;}
 return {fallback,direction,normalMatrix,irradiance,pointAttenuation,spotParameters,spotAttenuation,blinn,ambientUniform,materialHDR,diffuse,cube,cubeFace,shader};
}
