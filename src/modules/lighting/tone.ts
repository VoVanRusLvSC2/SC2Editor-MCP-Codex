import type {GlobalLighting} from './types.js';
/** Numerical contracts transcribed from Base98310 hdr.fx/pstonemap.fx/psdof.fx.
 * Runtime selection and CPU control-to-uniform conversion have independent provenance. */
export function createGlobalToneMath(){
 const saturate=(v:number)=>Math.max(0,Math.min(1,v));
 /** Native tuple/uniform transport is identity. Missing effective scalar1 is a
  * preview compatibility policy, not a claim about native Param ctor defaults.
  * ColorizationContrast selects p_fContrast; synthetic HDRContrast does not.
  * Normal HDR141d9d580 passes literal1 for b_useWhiteShift independently of
  * catalog controls/operator. Synthetic HDRWhiteShift is not its binding. */
 function controls(light:Pick<GlobalLighting,'operatorHDR'|'parameters'>){
  const p=light.parameters??{},exposure=p.HDRExposure??p.hdrExposure,contrast=p.ColorizationContrast??p.colorizationContrast,whitePoint=p.HDRWhitePoint??p.hdrWhitePoint;
  return {operator:Math.max(0,Math.min(4,Math.round(light.operatorHDR??p.OperatorHDR??p.operatorHDR??0))),exposure:exposure??1,contrast:contrast??1,whitePoint:whitePoint??1,whiteShift:true,compatibilityFallback:exposure===undefined||contrast===undefined||whitePoint===undefined};
 }
 function luminance(rgb:number[]){return rgb[0]*.35+rgb[1]*.5+rgb[2]*.125;}
 function tonemap(luminance:number,operator:number,exposure=1,contrast=1,whitePoint=1){
  const l=Math.max(0,luminance),power=Math.pow(l,contrast);
  switch(operator){
   case 1:return 1-Math.exp(-exposure*power);
   case 2:return Math.log(power+1)/Math.log(exposure+1);
   case 3:return power;
   case 4:{const x=Math.pow(l,2.2)*exposure;return x*(12.3*x+.5)/(x*(12.3*x+4)+.02);}
   default:{const x=power*exposure;return x*(1+x/(whitePoint*whitePoint))/(1+x);}
  }
 }
 function color(rgb:number[],operator:number,exposure=1,contrast=1,whitePoint=1,whiteShift=false){
  const l=luminance(rgb);if(!(l>0))return [0,0,0];let c=rgb;
  if(whiteShift&&operator!==0){const t=saturate((l-1.5)/l);c=c.map(v=>v+(l-v)*t);}
  const mapped=tonemap(l,operator,exposure,contrast,whitePoint);return c.map(v=>mapped*v/l);
 }
 function legacyCoC(depth:number,focus:number,window:number[]){return Math.max(0,(depth-focus)*window[0]+window[1],(focus-depth)*window[2]+window[3]);}
 function cameraCoC(depth:number,equation:number[]){return saturate(Math.abs(equation[0]/depth+equation[1]));}
 /** Scalar operator only: callers own their frame graph and control bindings. */
 function shader(){return `float globalTone(float l,int op,float exposure,float contrast,float whitePoint){float base=pow(max(l,0.),contrast);if(op==1)return 1.-exp(-exposure*base);if(op==2)return log(base+1.)/log(exposure+1.);if(op==3)return base;if(op==4){float x=pow(max(l,0.),2.2)*exposure;return x*(12.3*x+.5)/(x*(12.3*x+4.)+.02);}float x=base*exposure;return x*(1.+x/(whitePoint*whitePoint))/(1.+x);}`;}
 return {controls,luminance,tonemap,color,legacyCoC,cameraCoC,shader};
}
