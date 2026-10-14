import type {MaterialPass} from './materialRuntime.js';
/** DDS/DOM sources use the native top row at v=0. WebGL framebuffers store
 * their bottom row there. Convert RTT sampler coordinates after layer UV math. */
export function createMaterialTextureAdapter(){
 function fragment(source:string,textures:MaterialPass['textures']){
  for(const texture of textures){
   if(!/^rtt:\/\/[0-6]$/.test(texture.resourceId))continue;
   const name=texture.uniform;if(!/^[A-Za-z_]\w*$/.test(name))throw new Error('CUTSCENE_RTT_SAMPLER_NAME');
   const declaration=new RegExp('\\buniform\\s+(?:(?:lowp|mediump|highp)\\s+)?sampler2D\\s+'+name+'\\s*;');
   if(!declaration.test(source))throw new Error('CUTSCENE_RTT_SAMPLER_DECLARATION');
   const functions:string[]=[];
   for(const operation of ['texture','textureLod','textureGrad']){
    const call=new RegExp('\\b'+operation+'\\s*\\(\\s*'+name+'\\s*,','g');if(!call.test(source))continue;
    const wrapper='previewRtt_'+operation+'_'+name;source=source.replace(call,wrapper+'(');
    if(operation==='texture')functions.push(`vec4 ${wrapper}(vec2 p){return texture(${name},vec2(p.x,1.-p.y));}`,`vec4 ${wrapper}(vec2 p,float bias){return texture(${name},vec2(p.x,1.-p.y),bias);}`);
    else if(operation==='textureLod')functions.push(`vec4 ${wrapper}(vec2 p,float lod){return textureLod(${name},vec2(p.x,1.-p.y),lod);}`);
    else functions.push(`vec4 ${wrapper}(vec2 p,vec2 dx,vec2 dy){return textureGrad(${name},vec2(p.x,1.-p.y),vec2(dx.x,-dx.y),vec2(dy.x,-dy.y));}`);
   }
   if(functions.length)source=source.replace(declaration,match=>match+'\n'+functions.join('\n'));
  }
  return source;
 }
 return {fragment};
}
