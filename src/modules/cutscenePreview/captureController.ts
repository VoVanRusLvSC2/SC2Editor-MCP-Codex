/** Serialized into the player. Uses its existing renderer, never the CPU rasterizer. */
export function createCaptureController(host:{
 ready:Promise<void>;duration:number;prepare:(time:number,width:number,height:number)=>void;
 draw:()=>{camera:{id:string;name:string};triangles:number;calls:number;localLights:number;eligibleLights?:number;omittedLights?:number;lightLimit?:number;textureAnisotropy?:number;rttPasses:number;effectClamped:boolean};
 media:()=>{failures:string[];items:Array<{ready:number;seeking:boolean;desired:number;frame:number}>};
 image:()=>string;error:()=>number;renderer:()=>string;release:()=>void;
}){
 let busy=false;
 return async(time:number,width:number,height:number)=>{
  if(busy)throw Error('CUTSCENE_CAPTURE_BUSY');
  if(!Number.isInteger(time)||time<0||time>host.duration||!Number.isInteger(width)||!Number.isInteger(height)||width<160||height<120||width>1920||height>1080)throw Error('CUTSCENE_CAPTURE_BOUNDS');
  busy=true;
  try{
   await host.ready;host.prepare(time,width,height);
   // Two same-time draws populate the existing previous-frame RTT targets.
   // This is a bounded preview warmup, not native feedback/history simulation.
   let stats=host.draw();const deadline=Date.now()+10000;
   for(;;){
    const media=host.media();if(media.failures.length)throw Error('CUTSCENE_CAPTURE_VIDEO_FAILED: '+media.failures.join(', ').slice(0,400));
    if(!media.items.some(v=>v.ready<2||v.seeking||Math.abs(v.desired-v.frame)>.04))break;
    if(Date.now()>deadline)throw Error('CUTSCENE_CAPTURE_VIDEO_TIMEOUT');
    await new Promise<void>(resolve=>setTimeout(resolve,30));stats=host.draw();
   }
   stats=host.draw();const error=host.error();if(error!==0)throw Error('CUTSCENE_CAPTURE_GL_ERROR: '+error);
   const png=host.image();if(!png.startsWith('data:image/png;base64,'))throw Error('CUTSCENE_CAPTURE_PNG_MISSING');
   return {png,time,width,height,camera:{id:stats.camera.id,name:stats.camera.name},renderer:host.renderer(),triangles:stats.triangles,drawCalls:stats.calls,localLights:stats.localLights,eligibleLights:stats.eligibleLights,omittedLights:stats.omittedLights,lightLimit:stats.lightLimit,textureAnisotropy:stats.textureAnisotropy,rttPasses:stats.rttPasses,effectClamped:stats.effectClamped,engineValidated:false,allSupported:false};
  }finally{busy=false;host.release();}
 };
}
