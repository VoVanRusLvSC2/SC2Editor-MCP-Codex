import type {GlobalLighting,ColorVariation} from './types.js';
/** Base98310 141e6b490/141e6bf30, HSL helpers141e6c580/141e6c3c0.
 * Native math,16-cube grid and byte quantization; activation and linear/clamp
 * interpolation remain explicit preview policies, not full engine parity. */
export function createGlobalColorizationMath(){
 const f=Math.fround,clamp=(v:number)=>Math.max(0,Math.min(1,v)),add=(a:number,b:number)=>f(a+b),sub=(a:number,b:number)=>f(a-b),mul=(a:number,b:number)=>f(a*b),div=(a:number,b:number)=>f(a/b),pow=(a:number,b:number)=>f(Math.pow(a,b));
 const defaults={inputLow:0,inputGamma:1,inputHigh:1,outputLow:0,outputHigh:1,brightness:1,contrast:1,hue:0,blend:0,saturation:0,lightness:0};
 type Controls=typeof defaults&{known:boolean;colorize:boolean;variations:ColorVariation[];compatibilityFallback:boolean};
 type Lut={size:number;data:Uint8Array;key:string};
 function controls(light:Pick<GlobalLighting,'parameters'|'colorization'>):Controls{
  const p=light.parameters??{},c={...defaults,known:light.colorization!==undefined,colorize:light.colorization?.colorize??false,variations:light.colorization?.variations??[],compatibilityFallback:false};
  // Missing zero-valued fields match the native Param ctor; neutral1 defaults
  // require an effective catalog value or this labelled compatibility fallback.
  for(const key of Object.keys(defaults) as Array<keyof typeof defaults>){const name='Colorization'+key[0].toUpperCase()+key.slice(1),raw=p[name]??p[name[0].toLowerCase()+name.slice(1)];if(raw===undefined&&defaults[key]!==0)c.compatibilityFallback=true;else if(raw!==undefined)c[key]=f(raw);}
  return c;
 }
 function rgbToHsl(rgb:number[]){
  const [r,g,b]=rgb.map(f),min=Math.min(r,g,b),max=Math.max(r,g,b),delta=sub(max,min),l=mul(add(max,min),.5);if(delta===0)return [0,0,l];
  const s=div(delta,l<.5?add(max,min):sub(sub(2,max),min));let h=r===max?div(sub(g,b),delta):g===max?add(div(sub(b,r),delta),2):add(div(sub(r,g),delta),4);h=mul(h,f(1/6));if(h<0)h=add(h,1);if(h>1)h=sub(h,1);return [h,s,l];
 }
 function hueChannel(p:number,q:number,raw:number){
  // Native leaf repeatedly wraps. Modulo bounds very large finite preview inputs.
  let t=raw;if(t<0||t>1){t=f(t%1);if(t<0)t=add(t,1);}
  if(mul(t,6)<1)return add(p,mul(mul(sub(q,p),6),t));if(mul(t,2)<1)return q;if(mul(t,3)<2)return add(p,mul(mul(sub(q,p),sub(f(2/3),t)),6));return p;
 }
 function hslToRgb(h:number,s:number,l:number){if(s===0)return [l,l,l];const q=l<.5?mul(add(s,1),l):sub(add(s,l),mul(s,l)),p=sub(mul(l,2),q);return [hueChannel(p,q,add(h,f(1/3))),hueChannel(p,q,h),hueChannel(p,q,sub(h,f(1/3)))];}
 function regionWeight(lightness:number,region:number){
  const l=f(lightness);if(region===0)return l<f(.3)?1:l<.5?sub(1,pow(mul(sub(l,f(.3)),5),2)):0;
  // The discontinuity at.35 is source-proven; do not replace it with smoothstep.
  if(region===1)return l<f(.15)||l>=f(.85)?0:l<f(.35)?pow(mul(sub(l,f(.35)),5),2):l<f(.65)?1:sub(1,pow(mul(sub(l,f(.65)),5),2));
  return region===2?(l<=.5?0:l<=f(.7)?pow(mul(sub(l,.5),5),2):1):0;
 }
 function transform(rgb:number[],c:Controls):number[]|undefined{
  let [h,s,l]=rgbToHsl(rgb);l=clamp(div(sub(l,c.inputLow),sub(c.inputHigh,c.inputLow)));
  const gamma=c.inputGamma<1?add(mul(sub(1,c.inputGamma),9),1):sub(1,mul(sub(c.inputGamma,1),f(1/9)));
  l=pow(mul(add(mul(pow(l,gamma),sub(c.outputHigh,c.outputLow)),c.outputLow),c.brightness),c.contrast);
  if(!Number.isFinite(l))return undefined;
  if(!c.colorize){h=add(h,c.hue);s=add(s,c.saturation);l=add(l,c.lightness);}h=f(Math.abs(h)%1);s=clamp(s);l=clamp(l);const baseLightness=l;let result=hslToRgb(h,s,l);
  if(c.colorize){const tint=hslToRgb(c.hue,c.saturation,clamp(add(l,c.lightness)));result=result.map((v,i)=>add(mul(tint[i],c.blend),mul(sub(1,c.blend),v)));}
  const palette=[f(1/3),f(1/6),.5,0,f(2/3),f(5/6)],step=f(.05),rest=sub(1,step);
  for(const v of c.variations){if(v.command<0||v.command>9)continue;for(let repeat=0;repeat<v.sensitivity;repeat++){
   const [ch,,cl]=rgbToHsl(result),target=v.command<6?hslToRgb(palette[v.command],.5,cl):v.command===6?[1,1,1]:v.command===7?[0,0,0]:v.command===8?[cl,cl,cl]:hslToRgb(ch,1,cl),weight=v.command>=8?1:regionWeight(baseLightness,v.region);
   result=result.map((value,i)=>add(mul(weight,add(mul(target[i],step),mul(rest,value))),mul(sub(1,weight),value)));
  }}
  return result.every(Number.isFinite)?result.map(clamp):undefined;
 }
 function quantize(value:number){return Math.floor(mul(clamp(value),255)+.5);}
 function build(c:Controls,key=''):Lut|undefined{
  const data=new Uint8Array(16*16*16*4);for(let b=0;b<16;b++)for(let g=0;g<16;g++)for(let r=0;r<16;r++){
   const color=transform([r,g,b].map(i=>mul(i*16,f(1/255))),c);if(!color)return undefined;const offset=((b*16+g)*16+r)*4;for(let channel=0;channel<3;channel++)data[offset+channel]=quantize(color[channel]);data[offset+3]=255;
  }return {size:16,data,key};
 }
 const cache=new Map<string,Lut>();
 function prepare(light:Pick<GlobalLighting,'parameters'|'colorization'>){
  const c=controls(light);if(!c.known)return {enabled:false,diagnostic:'COLORIZATION_SOURCE_UNKNOWN',controls:c};
  const entries=c.variations,total=entries.reduce((sum,v)=>sum+v.sensitivity,0),finite=Object.keys(defaults).every(key=>Number.isFinite(c[key as keyof typeof defaults]));
  // Resource/finite guards are bounded preview policies, not native singular behavior.
  if(!finite||c.inputLow===c.inputHigh||entries.some(v=>![v.command,v.sensitivity,v.region].every(Number.isInteger)||v.sensitivity<0))return {enabled:false,diagnostic:'COLORIZATION_UNSUPPORTED_CONTROLS',controls:c};
  if(total*4096>1_000_000||entries.length>256)return {enabled:false,diagnostic:'COLORIZATION_PREVIEW_WORK_BUDGET',controls:c};
  const key=JSON.stringify([Object.keys(defaults).map(k=>c[k as keyof typeof defaults]),c.colorize,entries.map(v=>[v.command,v.sensitivity,v.region])]);let lut=cache.get(key);
  if(!lut){lut=build(c,key);if(!lut)return {enabled:false,diagnostic:'COLORIZATION_NONFINITE_RESULT',controls:c};if(cache.size>=16)cache.delete(cache.keys().next().value!);cache.set(key,lut);}
  return {enabled:true,lut,controls:c,diagnostic:c.compatibilityFallback?'COLORIZATION_COMPATIBILITY_DEFAULTS':undefined};
 }
 /** hdr.fx coordinates saturate(rgb+.5/16). Linear/clamp filtering is preview policy. */
 function sample(lut:Lut,rgb:number[]){
  const coordinates=rgb.map(v=>Math.max(0,Math.min(15,clamp(v+.5/16)*16-.5))),lo=coordinates.map(Math.floor),t=coordinates.map((v,i)=>v-lo[i]),result=[0,0,0];
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){const offset=((Math.min(15,lo[2]+z)*16+Math.min(15,lo[1]+y))*16+Math.min(15,lo[0]+x))*4,weight=(x?t[0]:1-t[0])*(y?t[1]:1-t[1])*(z?t[2]:1-t[2]);for(let channel=0;channel<3;channel++)result[channel]+=lut.data[offset+channel]/255*weight;}
  return result;
 }
 function shader(){return 'uniform highp sampler3D colorMap;uniform bool colorMapEnabled;vec3 previewColorMap(vec3 c){return colorMapEnabled?texture(colorMap,clamp(c+vec3(.5/16.),0.,1.)).rgb:c;}';}
 return {controls,rgbToHsl,hslToRgb,regionWeight,transform,quantize,build,prepare,sample,shader};
}
