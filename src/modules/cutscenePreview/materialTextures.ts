import type {MaterialPass} from './materialRuntime.js';
import type {StandardMaterial,PreviewTexture,PreviewCubeTexture,PreviewTexture2D} from './types.js';
/** DDS/DOM sources use the native top row at v=0. WebGL framebuffers store
 * their bottom row there. Convert RTT sampler coordinates after layer UV math. */
export function createMaterialTextureAdapter(){
 /* Static-texture filtering below adapts ModKit's texture-filtering.ts at
  * 72253b49adff4f572c4763cd1ca5c980264afe41. RTT coordinate handling is original code.
  * MIT License
  * Copyright (c) 2026 Modkit contributors
  * Permission is hereby granted, free of charge, to any person obtaining a copy
  * of this software and associated documentation files (the "Software"), to deal
  * in the Software without restriction, including without limitation the rights
  * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  * copies of the Software, and to permit persons to whom the Software is
  * furnished to do so, subject to the following conditions:
  * The above copyright notice and this permission notice shall be included in all
  * copies or substantial portions of the Software.
  * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  * SOFTWARE.
  */
 const anisotropyByContext=new WeakMap<WebGL2RenderingContext,{parameter:number;value:number}|null>();
 /** Only complete static 2D images: RTT/video/palettes/LUTs keep their own sampling. */
 function filterStaticTexture(gl:WebGL2RenderingContext){
  let anisotropy=anisotropyByContext.get(gl);
  if(anisotropy===undefined){
   const extension=gl.getExtension('EXT_texture_filter_anisotropic');anisotropy=null;
   if(extension&&Number.isInteger(extension.TEXTURE_MAX_ANISOTROPY_EXT)&&Number.isInteger(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT)){
    const maximum=Number(gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
    if(Number.isFinite(maximum)&&maximum>1)anisotropy={parameter:extension.TEXTURE_MAX_ANISOTROPY_EXT,value:Math.min(8,maximum)};
   }
   anisotropyByContext.set(gl,anisotropy);
  }
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  if(anisotropy)gl.texParameterf(gl.TEXTURE_2D,anisotropy.parameter,anisotropy.value);
  return anisotropy?.value??1;
 }
 function environmentEnabled(material:StandardMaterial|undefined){
  return material?.materialClass===0&&material.lightingModel!=='pbr-metallic-roughness'&&
   typeof material.sourceFlags==='number'&&Number.isInteger(material.sourceFlags)&&material.sourceFlags>=0&&material.sourceFlags<=0xffffffff&&
   ['envi','enviMask'].some(slot=>{const layer=material.layers[slot];return layer?.texturePath&&!layer.texturePath.startsWith('rtt://')&&[2,3,7,8].includes(layer.uvSource);});
 }
 /** Native descriptor5 binds one shared environment matrix. Only a single
  * enabled environment layer is unambiguous in the current imported contract.
  * Multiple owners/flipbooks retain the previous preview route. Ordinary mesh
  * draws use the default matrix mode; special/FX draws do not call this path. */
 function environmentMatrixOwner(material:StandardMaterial|undefined){
  if(!environmentEnabled(material))return undefined;
  const candidates=Object.entries(material!.layers).filter(([,layer])=>
   (layer.texturePath||layer.constantColor)&&[2,3,7,8].includes(layer.uvSource));
  if(candidates.length!==1)return undefined;
  const [slot,layer]=candidates[0];
  return ['envi','enviMask'].includes(slot)&&!layer.flipbook?slot:undefined;
 }
 /** Replayed native141df8e60, environment=true/alternate=false:
  * column-vector Sxy*Rz*Ry*Rx*T(-offset.x,-offset.y,0).
  * Consume the existing per-property sampler, including external M3A tracks. */
 function environmentMatrix(pass:MaterialPass,material:StandardMaterial|undefined){
  const owner=environmentMatrixOwner(material);if(!owner)return null;
  const read=(name:string,length:number,fallback:number[])=>{
   const value=pass.uniforms['u_'+owner+name]??fallback;
   if(!Array.isArray(value)||value.length!==length||value.some(v=>!Number.isFinite(v)))throw new Error('CUTSCENE_ENVIRONMENT_MATRIX_VALUE');
   return value.map(Math.fround);
  };
  const offset=read('UvOffset',2,[0,0]),angle=read('UvAngle',3,[0,0,0]),scale=read('UvTiling',2,[1,1]);
  const [sx,sy,sz]=angle.map(Math.sin),[cx,cy,cz]=angle.map(Math.cos);
  const a=scale[0]*cz*cy,b=scale[0]*(cz*sy*sx-sz*cx),c=scale[0]*(cz*sy*cx+sz*sx);
  const d=scale[1]*sz*cy,e=scale[1]*(sz*sy*sx+cz*cx),f=scale[1]*(sz*sy*cx-cz*sx);
  const g=-sy,h=cy*sx,i=cy*cx;
  const matrix=[a,d,g,0,b,e,h,0,c,f,i,0,-a*offset[0]-b*offset[1],-d*offset[0]-e*offset[1],-g*offset[0]-h*offset[1],1].map(Math.fround);
  if(matrix.some(v=>!Number.isFinite(v)))throw new Error('CUTSCENE_ENVIRONMENT_MATRIX_RANGE');
  return matrix;
 }
 function ordinaryNative(material:StandardMaterial|undefined):material is StandardMaterial{
  return material?.materialClass===0&&material.lightingModel!=='pbr-metallic-roughness'&&
   typeof material.sourceFlags==='number'&&Number.isInteger(material.sourceFlags)&&material.sourceFlags>=0&&material.sourceFlags<=0xffffffff&&
   !material.layers.height?.texturePath&&!material.layers.height?.constantColor;
 }
 type DetailRoute={normal:number;mask1:number;mask2:number;mask2Matrix:boolean};
 const detailRoutes=new WeakMap<StandardMaterial,DetailRoute|undefined>();
 /** Native141f98cc0 walks this order. Related-layer references choose an
  * emitter, while the sampled layer retains its own pixel UV matrix. */
 function detailNormalRoute(material:StandardMaterial|undefined):DetailRoute|undefined{
  if(!ordinaryNative(material)||!(material.sourceFlags!&4)||material.normalBlendPolicy?.mode!=='signed-two-detail')return undefined;
  if(detailRoutes.has(material))return detailRoutes.get(material);
  const order=['diffuse','decal','specular','gloss','emissive1','emissive2','envi','enviMask','alpha1','alpha2','normal','height','lightMap','ao','normalBlend1Mask','normalBlend2Mask','normalBlend1','normalBlend2'];
  const explicit=(v:number)=>[0,1,9,10].includes(v),present=(slot:string)=>{const l=material.layers[slot];return !!(l&&(l.texturePath||l.constantColor));};
  const provenance=(slot:string)=>{const l=material.layers[slot];return l&&Number.isInteger(l.sourceFlags)&&l.sourceFlags!>=0&&l.sourceFlags!<=0xffffffff&&Number.isInteger(l.sourceUvRelated)&&l.sourceUvRelated!>=-1&&l.sourceUvRelated!<18;};
  const first=order.find(slot=>!!material.layers[slot]?.texturePath&&!material.layers[slot].constantColor);
  const firstUv=first&&provenance(first)&&material.layers[first].sourceUvRelated===-1&&!material.layers[first].flipbook&&explicit(material.layers[first].uvSource)?material.layers[first].uvSource:undefined;
  const basis=(slot:string):number|undefined=>{
   const l=material.layers[slot];if(!present(slot))return firstUv;
   if(!provenance(slot)||l.flipbook)return undefined;
   if(l.constantColor)return firstUv;
   if(!explicit(l.uvSource))return undefined;
   const related=l.sourceUvRelated!;
   if(related===-1||!present(order[related]))return l.uvSource;
   // Forward references can observe prior descriptor state and need their
   // own runtime contract. The verified Davis references are all backward.
   if(related>=order.indexOf(slot))return undefined;
   return basis(order[related]);
  };
  const normal=material.layers.normalBlend1,other=material.layers.normalBlend2,mask=material.layers.normalBlend1Mask;
  let result:DetailRoute|undefined;
  if(normal?.texturePath&&!normal.texturePath.startsWith('rtt://')&&other?.texturePath&&!other.texturePath.startsWith('rtt://')&&mask?.texturePath){
   const n=basis('normalBlend1'),a=basis('normalBlend1Mask'),b=basis('normalBlend2Mask');
   if(n!==undefined&&a!==undefined&&b!==undefined)result={normal:n,mask1:a,mask2:b,mask2Matrix:present('normalBlend2Mask')};
  }
  detailRoutes.set(material,result);return result;
 }
 /** Ordinary native type4 UV mode. Height/parallax, flipbooks and other UV
  * emitters still require their own input/selection contracts. */
 function nativeUvSlots(material:StandardMaterial|undefined){
  if(!ordinaryNative(material))return [] as string[];
  const slots=['diffuse','decal','specular','gloss','emissive1','emissive2','emissiveMask','envi','enviMask','normal','lightMap','ao','teamColorMask','alpha1','alpha2'].filter(slot=>{const l=material.layers[slot];return l&&(l.texturePath||l.constantColor)&&!l.flipbook&&[0,1,9,10].includes(l.uvSource);});
  const route=detailNormalRoute(material);
  if(route)slots.push('normalBlend1','normalBlend1Mask',...(route.mask2Matrix?['normalBlend2Mask']:[]));
  return slots;
 }
 /** Native141df8e60 env=false,alternate=false and type4 binder141df7b95:
  * T(.5)*Sxy*Rz*Ry*Rx*T(-offset.x-.5,-offset.y-.5,-.5).
  * PSCommon consumes the first two rows times [uv.x,uv.y,0,1]. */
 function nativeUvMatrix(pass:MaterialPass,material:StandardMaterial|undefined,slot:string,properties:Record<string,number|number[]>={}){
  if(!nativeUvSlots(material).includes(slot))return null;
  const read=(name:string,length:number,fallback:number[])=>{
   const field=name==='UvOffset'?'uvOffset':name==='UvAngle'?'uvAngle':'uvTiling',layerValue=material?.layers[slot]?.[field];
   const supplied=properties['layers.'+slot+'.'+field],uniform=pass.uniforms['u_'+slot+name];
   // Mask2 can be absent from the vendor pass when only its factor is
   // disabled. Native gradients still need its independently sampled UVs.
   if(uniform===undefined&&supplied===undefined&&layerValue&&(layerValue.sequenceTracks?.length||'track'in layerValue))throw new Error('CUTSCENE_DETAIL_UV_SAMPLE_REQUIRED');
   const value=uniform??supplied??layerValue?.value??fallback;
   if(!Array.isArray(value)||value.length!==length||value.some(v=>!Number.isFinite(v)))throw new Error('CUTSCENE_NATIVE_UV_VALUE');return value.map(Math.fround);
  };
  const offset=read('UvOffset',2,[0,0]),angle=read('UvAngle',3,[0,0,0]),scale=read('UvTiling',2,[1,1]);
  const [sx,sy,sz]=angle.map(Math.sin),[cx,cy,cz]=angle.map(Math.cos);
  const a=scale[0]*cz*cy,b=scale[0]*(cz*sy*sx-sz*cx),c=scale[0]*(cz*sy*cx+sz*sx);
  const d=scale[1]*sz*cy,e=scale[1]*(sz*sy*sx+cz*cx),f=scale[1]*(sz*sy*cx-cz*sx),g=-sy,h=cy*sx,i=cy*cx;
  const x=offset[0]+.5,y=offset[1]+.5;
  const matrix=[a,d,g,0,b,e,h,0,c,f,i,0,.5-a*x-b*y-c*.5,.5-d*x-e*y-f*.5,.5-g*x-h*y-i*.5,1].map(Math.fround);
  if(matrix.some(v=>!Number.isFinite(v)))throw new Error('CUTSCENE_NATIVE_UV_RANGE');return matrix;
 }
 function environmentLodRoute(material:StandardMaterial|undefined,cubes:Record<string,PreviewTexture>){
  if(!environmentEnabled(material)||environmentMatrixOwner(material)!=='envi'||!((material!.sourceFlags??0)&0x800)||!cubes.u_enviMap?.cube)return undefined;
  const slots=nativeUvSlots(material),normal=material!.layers.normal,gloss=material!.layers.gloss;
  if(material!.layers.height?.texturePath||material!.layers.height?.constantColor)return undefined;
  if(gloss?.texturePath&&!slots.includes('gloss'))return undefined;
  return normal&&(normal.texturePath||normal.constantColor)?slots.includes('normal')?'normal':undefined:'eye';
 }
 /** Native141dfca81 uploader uses source dimensions, not available mip count. */
 function environmentLodParameters(material:StandardMaterial|undefined,cubes:Record<string,PreviewTexture>){
  if(!environmentLodRoute(material,cubes))return null;
  const size=cubes.u_enviMap.cube!.size;
  if(!Number.isInteger(size)||size<1||size>2048)throw new Error('CUTSCENE_ENVIRONMENT_SIZE');
  return [size,size,Math.floor(Math.log2(size)),0];
 }
 /** Analytic counterpart of the native fragment equation, for source/data
  * checks. Callers supply derivatives of the native UV or incident*.25. */
 function environmentLod(size:number[],dx:number[],dy:number[],gloss:number){
  if(size.length!==4||dx.length!==3||dy.length!==3||[...size,...dx,...dy,gloss].some(v=>!Number.isFinite(v))||size[0]<=0||size[1]<=0)throw new Error('CUTSCENE_ENVIRONMENT_LOD_VALUE');
  const rho=Math.max(dx.reduce((n,v)=>n+(v*size[0])**2,0),dy.reduce((n,v)=>n+(v*size[1])**2,0));
  if(!Number.isFinite(rho))throw new Error('CUTSCENE_ENVIRONMENT_LOD_RANGE');
  return (rho>0?Math.max(0,.5*Math.log2(rho)):0)+size[2]*(1-gloss);
 }
 function nativeUv(source:string,material:StandardMaterial|undefined){
  const declarations:string[]=[],definitions:string[]=[],route=detailNormalRoute(material);
  const uvSet=(v:number)=>v===9?2:v===10?3:v;
  const input=(set:number)=>{if(!source.includes('in vec2 v_uv'+set+';')&&!declarations.includes('in vec2 v_uv'+set+';'))declarations.push('in vec2 v_uv'+set+';');};
  for(const slot of nativeUvSlots(material)){
   const layer=material!.layers[slot],set=uvSet(route&&slot==='normalBlend1'?route.normal:route&&slot==='normalBlend1Mask'?route.mask1:route&&slot==='normalBlend2Mask'?route.mask2:layer.uvSource);
   input(set);
   declarations.push(`uniform mat4x2 u_previewUv_${slot};\nvec2 previewNativeUv_${slot}();`);
   definitions.push(`vec2 previewNativeUv_${slot}(){return u_previewUv_${slot}*vec4(v_uv${set},0.,1.);}`);
   if(layer.texturePath){
    const pattern=new RegExp('vec4 sampleLayerTexel_'+slot+'\\(\\) \\{[^}]*\\}');
    if(!pattern.test(source)){if(slot==='normalBlend2Mask'&&route&&!material!.normalBlendPolicy!.secondMask)continue;throw new Error('CUTSCENE_NATIVE_UV_SAMPLE_STAGE');}
    source=source.replace(pattern,`vec4 sampleLayerTexel_${slot}() { return texture(u_${slot}Map, previewNativeUv_${slot}()); }`);
   }
  }
  if(route&&!route.mask2Matrix){input(uvSet(route.mask2));declarations.push('vec2 previewNativeUv_normalBlend2Mask();');definitions.push(`vec2 previewNativeUv_normalBlend2Mask(){return v_uv${uvSet(route.mask2)};}`);}
  if(!declarations.length)return source;
  return source.replace('precision highp float;','precision highp float;\n'+declarations.join('\n')).replace(/void main\s*\(\)/,definitions.join('\n')+'\nvoid main()');
 }
 /** Windows NormalBlending passes config1 to BOTH detail samplers. Only the
  * derivative owner differs; neither mask UV is the texture sample center. */
 function detailNormal(source:string,material:StandardMaterial|undefined){
  if(!detailNormalRoute(material))return source;
  for(const [slot,mask]of [['normalBlend1','normalBlend1Mask'],['normalBlend2','normalBlend2Mask']]){
   const pattern=new RegExp('vec4 sampleLayerTexel_'+slot+'\\(\\) \\{[^}]*\\}');
   if(!pattern.test(source))throw new Error('CUTSCENE_DETAIL_NORMAL_SAMPLE_STAGE');
   source=source.replace(pattern,`vec4 sampleLayerTexel_${slot}() { return textureGrad(u_${slot}Map, previewNativeUv_normalBlend1(), dFdx(previewNativeUv_${mask}()), dFdy(previewNativeUv_${mask}())); }`);
  }
  return source;
 }
 function vertex(source:string,material:StandardMaterial|undefined){
  const route=detailNormalRoute(material);if(!route)return source;
  const sets=[...new Set([route.normal,route.mask1,route.mask2].map(v=>v===9?2:v===10?3:v))];
  const declarations:string[]=[],assignments:string[]=[];
  for(const set of sets){
   if(!source.includes('in vec2 a_uv'+set+';'))declarations.push('in vec2 a_uv'+set+';');
   if(!source.includes('out vec2 v_uv'+set+';')){declarations.push('out vec2 v_uv'+set+';');assignments.push('v_uv'+set+'=a_uv'+set+';');}
  }
  return source.replace('precision highp float;','precision highp float;\n'+declarations.join('\n')).replace(/void main\s*\(\)\s*\{/,match=>match+assignments.join(''));
 }
 function environmentLodShader(source:string,material:StandardMaterial|undefined,cubes:Record<string,PreviewTexture>){
  const route=environmentLodRoute(material,cubes);if(!route)return source;
  const pattern=/vec4 sampleLayerTexel_envi\(\) \{ return texture\(u_enviMap, (previewEnvironmentReflection\(\)|g_previewEnvironmentNormal)\); \}/;
  if(!pattern.test(source))throw new Error('CUTSCENE_ENVIRONMENT_LOD_SAMPLE_STAGE');
  source=source.replace(pattern,(_body,direction)=>`vec4 sampleLayerTexel_envi() { return textureLod(u_enviMap, ${direction}, previewEnvironmentLod()); }`);
  const gloss=material!.layers.gloss,hasGloss=!!(gloss&&(gloss.texturePath||gloss.constantColor)),marker='  vec3 color = vec3(0.0);';
  source=source.replace('precision highp float;',`precision highp float;\nuniform vec4 u_previewEnvironmentSize;\nfloat previewEnvironmentLod();\n${hasGloss?'float g_previewEnvironmentGloss=1.;':''}`);
  const main=source.search(/void main\s*\(\)\s*\{/);if(main<0||!source.includes(marker))throw new Error('CUTSCENE_ENVIRONMENT_LOD_MAIN_STAGE');
  let body=source.slice(main);
  if(hasGloss){if(!source.includes('vec4 computeLayer_gloss()'))throw new Error('CUTSCENE_ENVIRONMENT_LOD_GLOSS_STAGE');body=body.replaceAll('computeLayer_gloss().a','g_previewEnvironmentGloss').replace(marker,'  g_previewEnvironmentGloss=computeLayer_gloss().a;\n'+marker);}
  const definition=`float previewEnvironmentLod(){
 vec3 uv=${route==='normal'?'vec3(previewNativeUv_normal(),0.)':'v_previewEnvironmentIncident*.25'};
 vec3 dx=dFdx(uv*u_previewEnvironmentSize.x),dy=dFdy(uv*u_previewEnvironmentSize.y);
 float rho=max(dot(dx,dx),dot(dy,dy));
 float mip=rho>0.?max(0.,.5*log2(rho)):0.;
 return mip+u_previewEnvironmentSize.z*(1.-${hasGloss?'g_previewEnvironmentGloss':'1.'});
}
`;
  return source.slice(0,main)+definition+body;
 }
 /** A native cube replaces the atlas only on the qualified ordinary matrix
  * route. Unqualified ownership and special draws retain their atlas view. */
 function cubeBindings(material:StandardMaterial|undefined,textures:MaterialPass['textures'],resources:Record<string,PreviewTexture>|undefined){
  const owner=environmentMatrixOwner(material),result:Record<string,PreviewTexture>={};
  if(!owner||![2,7].includes(material!.layers[owner].uvSource))return result;
  for(const t of textures){
   if(t.uniform!=='u_'+owner+'Map')continue;
   const image=resources?.[t.resourceId.toLowerCase().replaceAll('\\','/')];
   if(image?.cube)result[t.uniform]=image;
  }
  return result;
 }
 const compressionByContext=new WeakMap<WebGL2RenderingContext,WEBGL_compressed_texture_s3tc|null>();
 function decodeBlocks(format:PreviewCubeTexture['format'],width:number,height:number,data:Uint8Array){
  if(format==='rgba8')return data;
  const out=new Uint8Array(width*height*4),view=new DataView(data.buffer,data.byteOffset,data.byteLength),stride=format==='bc1'?8:16,blocksX=Math.ceil(width/4),blocksY=Math.ceil(height/4);
  const rgb=(n:number)=>[Math.round(((n>>11)&31)*255/31),Math.round(((n>>5)&63)*255/63),Math.round((n&31)*255/31)];
  for(let by=0;by<blocksY;by++)for(let bx=0;bx<blocksX;bx++){
   const at=(by*blocksX+bx)*stride,colorAt=at+(stride===8?0:8),c0=view.getUint16(colorAt,true),c1=view.getUint16(colorAt+2,true),a=rgb(c0),b=rgb(c1),opaque=c0>c1||stride!==8;
   const colors=[a,b,opaque?a.map((v,i)=>Math.floor((2*v+b[i])/3)):a.map((v,i)=>Math.floor((v+b[i])/2)),opaque?a.map((v,i)=>Math.floor((v+2*b[i])/3)):[0,0,0]],codes=view.getUint32(colorAt+4,true);
   const alphas=[data[at],data[at+1]];let alphaCodes=0;
   if(format==='bc3'){
    const steps=alphas[0]>alphas[1]?7:5;
    for(let k=1;k<steps;k++)alphas.push(Math.floor((steps-k)*alphas[0]/steps+k*alphas[1]/steps));
    if(steps===5)alphas.push(0,255);
    for(let j=0;j<6;j++)alphaCodes+=data[at+2+j]*2**(8*j);
   }
   for(let k=0;k<16;k++){
    const x=bx*4+k%4,y=by*4+Math.floor(k/4);if(x>=width||y>=height)continue;
    const color=(codes>>>(k*2))&3,o=(y*width+x)*4;
    out.set(colors[color],o);out[o+3]=format==='bc2'?((data[at+Math.floor(k/2)]>>((k%2)*4))&15)*17:format==='bc3'?alphas[Math.floor(alphaCodes/2**(k*3))%8]:!opaque&&color===3?0:255;
   }
  }
  return out;
 }
 /** Original rectangular 2D subresources, including partial mip chains.
  * This is a data/upload contract. Native quality selection and sampler LOD
  * bias require their own binding; this helper does not synthesize either. */
 function upload2D(gl:WebGL2RenderingContext,image:PreviewTexture2D,wrapX=false,wrapY=false){
  const dimensions=[image.sourceWidth,image.sourceHeight,image.width,image.height];
  if(dimensions.some(v=>!Number.isInteger(v)||v<1||v>8192)||image.sourceWidth*image.sourceHeight>16777216||!Number.isInteger(image.firstMip)||image.firstMip<0||image.firstMip>Math.floor(Math.log2(Math.max(image.sourceWidth,image.sourceHeight)))||image.width!==Math.max(1,image.sourceWidth>>image.firstMip)||image.height!==Math.max(1,image.sourceHeight>>image.firstMip)||!['bc1','bc2','bc3','rgba8'].includes(image.format)||!Array.isArray(image.levels)||!image.levels.length||image.levels.length>1+Math.floor(Math.log2(Math.max(image.width,image.height))))throw new Error('CUTSCENE_2D_LAYOUT');
  let bytes=0,pixels=0;
  const levels=image.levels.map((level,mip)=>{
   const width=Math.max(1,image.width>>mip),height=Math.max(1,image.height>>mip);
   if(level.width!==width||level.height!==height)throw new Error('CUTSCENE_2D_LEVEL');
   pixels+=width*height;if(pixels*4>128*1024*1024)throw new Error('CUTSCENE_2D_PIXEL_BUDGET');
   const length=image.format==='rgba8'?width*height*4:Math.ceil(width/4)*Math.ceil(height/4)*(image.format==='bc1'?8:16);
   if(typeof level.data!=='string'||level.data.length!==4*Math.ceil(length/3)||!(/^[A-Za-z0-9+/]*={0,2}$/).test(level.data))throw new Error('CUTSCENE_2D_DATA');
   const raw=atob(level.data);if(raw.length!==length)throw new Error('CUTSCENE_2D_DATA');
   bytes+=raw.length;if(bytes>128*1024*1024)throw new Error('CUTSCENE_2D_BYTE_BUDGET');
   return {width,height,data:Uint8Array.from(raw,c=>c.charCodeAt(0))};
  });
  let extension:WEBGL_compressed_texture_s3tc|null=null;
  if(image.format!=='rgba8'&&levels.every((l,i)=>(l.width*2**i)%4===0&&(l.height*2**i)%4===0)){
   extension=compressionByContext.get(gl)??null;
   if(!compressionByContext.has(gl)){extension=gl.getExtension('WEBGL_compressed_texture_s3tc');compressionByContext.set(gl,extension);}
  }
  const compressed=extension&&(image.format==='bc1'?extension.COMPRESSED_RGBA_S3TC_DXT1_EXT:image.format==='bc2'?extension.COMPRESSED_RGBA_S3TC_DXT3_EXT:extension.COMPRESSED_RGBA_S3TC_DXT5_EXT);
  const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  for(let mip=0;mip<levels.length;mip++){
   const level=levels[mip];
   if(compressed)gl.compressedTexImage2D(gl.TEXTURE_2D,mip,compressed,level.width,level.height,0,level.data);
   else gl.texImage2D(gl.TEXTURE_2D,mip,gl.RGBA,level.width,level.height,0,gl.RGBA,gl.UNSIGNED_BYTE,decodeBlocks(image.format,level.width,level.height,level.data));
  }
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,levels.length-1);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,levels.length>1?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrapX?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrapY?gl.REPEAT:gl.CLAMP_TO_EDGE);
  return {texture,bytes:compressed?bytes:pixels*4,nativeLevels:levels.length,compressed:!!compressed};
 }
 /** Upload original native mip levels. No atlas, generated mip chain or row
  * flip is involved. BC fallback uses the same integer palette rules as DDS. */
 function uploadCube(gl:WebGL2RenderingContext,cube:PreviewCubeTexture){
  if(!Number.isInteger(cube.size)||cube.size<1||cube.size>2048||!['bc1','bc2','bc3','rgba8'].includes(cube.format)||!Array.isArray(cube.levels)||!cube.levels.length||cube.levels.length>1+Math.floor(Math.log2(cube.size)))throw new Error('CUTSCENE_CUBE_LAYOUT');
  let bytes=0,pixels=0;
  const levels=cube.levels.map((level,mip)=>{
   const size=Math.max(1,cube.size>>mip);if(level.size!==size||!Array.isArray(level.faces)||level.faces.length!==6)throw new Error('CUTSCENE_CUBE_LEVEL');
   pixels+=6*size*size;if(pixels*4>128*1024*1024)throw new Error('CUTSCENE_CUBE_PIXEL_BUDGET');
   const length=cube.format==='rgba8'?size*size*4:Math.ceil(size/4)**2*(cube.format==='bc1'?8:16);
   return {size,faces:level.faces.map(face=>{
    if(typeof face!=='string'||face.length!==4*Math.ceil(length/3)||!(/^[A-Za-z0-9+/]*={0,2}$/).test(face))throw new Error('CUTSCENE_CUBE_FACE');
    const raw=atob(face);if(raw.length!==length)throw new Error('CUTSCENE_CUBE_FACE');bytes+=raw.length;
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
   })};
  });
  let extension:WEBGL_compressed_texture_s3tc|null=null;
  // S3TC requires width<<level to be a multiple of four. A 1/2px base
  // image or an incompatible NPOT chain must use the RGBA fallback.
  if(cube.format!=='rgba8'&&cube.levels.every((l,i)=>(l.size*2**i)%4===0)){
   extension=compressionByContext.get(gl)??null;
   if(!compressionByContext.has(gl)){extension=gl.getExtension('WEBGL_compressed_texture_s3tc');compressionByContext.set(gl,extension);}
  }
  const compressed=extension&&(cube.format==='bc1'?extension.COMPRESSED_RGBA_S3TC_DXT1_EXT:cube.format==='bc2'?extension.COMPRESSED_RGBA_S3TC_DXT3_EXT:extension.COMPRESSED_RGBA_S3TC_DXT5_EXT);
  const decode=(data:Uint8Array,size:number)=>decodeBlocks(cube.format,size,size,data);
  const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_CUBE_MAP,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  for(let mip=0;mip<levels.length;mip++)for(let face=0;face<6;face++){
   const level=levels[mip],target=gl.TEXTURE_CUBE_MAP_POSITIVE_X+face;
   if(compressed)gl.compressedTexImage2D(target,mip,compressed,level.size,level.size,0,level.faces[face]);
   else gl.texImage2D(target,mip,gl.RGBA,level.size,level.size,0,gl.RGBA,gl.UNSIGNED_BYTE,decode(level.faces[face],level.size));
  }
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAX_LEVEL,levels.length-1);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,levels.length>1?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_CUBE_MAP,p,gl.CLAMP_TO_EDGE);
  return {texture,bytes:compressed?bytes:pixels*4,nativeLevels:levels.length,compressed:!!compressed};
 }
 /** Native standard shaders use the decoded world normal and world incident
  * vector for environment lookups (model.fx/PSMainShading/PSMaterial/PSUVMapping).
  * Single-owner ordinary meshes use the verified pre-projection matrix. The
  * multi-owner/special-mode and full native LOD routes remain unqualified. */
 function environment(source:string,material:StandardMaterial|undefined){
  if(!environmentEnabled(material))return source;
  const matrixOwner=environmentMatrixOwner(material);let changed=false;
  for(const slot of ['envi','enviMask']){
   const layer=material!.layers[slot];
   if(!layer?.texturePath||layer.texturePath.startsWith('rtt://')||![2,3,7,8].includes(layer.uvSource))continue;
   const pattern=new RegExp('vec4 sampleLayerTexel_'+slot+'\\(\\) \\{[^}]*\\}');
   if(!pattern.test(source))throw new Error('CUTSCENE_ENVIRONMENT_SAMPLE_STAGE');
   source=source.replace(pattern,body=>{
    if(matrixOwner){
     const cube=new RegExp('uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?samplerCube\\s+u_'+slot+'Map\\s*;').test(source);
     const reflected=layer.uvSource===2||layer.uvSource===3,direction=reflected?'previewEnvironmentReflection()':'g_previewEnvironmentNormal';
     const uv=cube?direction:layer.uvSource===2||layer.uvSource===7?'cubeUv('+direction+')':reflected?'sphereUvDirection('+direction+')':'(g_previewEnvironmentNormal.xz*vec2(0.5,-0.5)+0.5)';
     changed=true;return `vec4 sampleLayerTexel_${slot}() { return texture(u_${slot}Map, ${uv}); }`;
    }
    const output=body.replaceAll('reflectionDirection()','previewEnvironmentReflection()').replaceAll('normalize(v_viewNormal)','g_previewEnvironmentNormal');
    if(output===body)throw new Error('CUTSCENE_ENVIRONMENT_UV_STAGE');changed=true;return output;});
  }
  if(!changed)return source;
  const worldNormal=source.includes('dot(normal, u_sceneLightDirection)'),marker='  vec3 color = vec3(0.0);';
  if(!source.includes(marker))throw new Error('CUTSCENE_ENVIRONMENT_NORMAL_STAGE');
  source=source.replace('precision highp float;',`precision highp float;
in vec3 v_previewEnvironmentIncident;
${matrixOwner?'uniform mat4 u_previewEnvironmentTransform;':''}
vec3 g_previewEnvironmentNormal=vec3(0.,0.,1.);
vec3 previewEnvironmentReflection(){return normalize(reflect(${matrixOwner?'(u_previewEnvironmentTransform*vec4(v_previewEnvironmentIncident,1.)).xyz':'v_previewEnvironmentIncident'},g_previewEnvironmentNormal));}
`);
  const normal=worldNormal?'normalize(normal)':'normalize(mat3(v_previewWorldTangent,v_previewWorldBitangent,v_previewWorldNormal)*normal)';
  source=source.replace(marker,`  g_previewEnvironmentNormal=${matrixOwner?'(u_previewEnvironmentTransform*vec4('+normal+',1.)).xyz':normal};
${marker}`);
  return source;
 }
 /** Ordinary native layer sampler indices2/7/8/9 use the same -0.75 bias.
  * Require original 2D mip metadata or an already qualified native cube;
  * generated/legacy PNG, video, RTT and effect routes keep their own policy. */
 function nativeSamplerBindings(material:StandardMaterial|undefined,textures:MaterialPass['textures'],cubes:Record<string,PreviewTexture>={},resources?:Record<string,PreviewTexture>){
  const result:Record<string,2|3>={};
  if(material?.materialClass!==0||(material.lightingModel??'m3')!=='m3'||!Number.isInteger(material.sourceFlags)||material.sourceFlags!<0||material.sourceFlags!>0xffffffff)return result;
  for(const texture of textures){
   if(texture.resourceId.startsWith('rtt://'))continue;
   const dimension=cubes[texture.uniform]?.cube?3:resources?.[texture.resourceId.toLowerCase().replaceAll('\\','/')]?.native2D?2:undefined;
   if(dimension===undefined)continue;
   if(!/^[A-Za-z_]\w*$/.test(texture.uniform))throw new Error('CUTSCENE_NATIVE_SAMPLER_NAME');
   result[texture.uniform]=dimension;
  }
  return result;
 }
 /** D3D11.3 sections7.18.11/22.4.17/22.4.18: sampler bias is applied
  * to implicit, gradient and explicit LOD sampling. GLSL ES has no sampler
  * LOD-bias state: add it in texture/textureLod, scale gradients by2^bias.
  * https://microsoft.github.io/DirectX-Specs/d3d/archive/D3D11_3_FunctionalSpec.htm */
 function samplerBias(source:string,bindings:Record<string,2|3>){
  for(const [name,dimension]of Object.entries(bindings)){
   const type=dimension===3?'samplerCube':'sampler2D',coordinate=dimension===3?'vec3':'vec2';
   const declaration=new RegExp('\\buniform\\s+(?:(?:lowp|mediump|highp)\\s+)?'+type+'\\s+'+name+'\\s*;');
   if(!declaration.test(source))throw new Error('CUTSCENE_NATIVE_SAMPLER_DECLARATION');
   const functions:string[]=[];
   for(const operation of ['texture','textureLod','textureGrad']){
    const call=new RegExp('\\b'+operation+'\\s*\\(\\s*'+name+'\\s*,','g');if(!call.test(source))continue;
    const wrapper='previewSampler_'+operation+'_'+name;source=source.replace(call,wrapper+'(');
    if(operation==='texture')functions.push(`vec4 ${wrapper}(${coordinate} p){return texture(${name}, p, -0.75);}`,`vec4 ${wrapper}(${coordinate} p,float bias){return texture(${name}, p, bias + (-0.75));}`);
    else if(operation==='textureLod')functions.push(`vec4 ${wrapper}(${coordinate} p,float lod){return textureLod(${name}, p, lod + (-0.75));}`);
    else functions.push(`vec4 ${wrapper}(${coordinate} p,${coordinate} dx,${coordinate} dy){return textureGrad(${name}, p, dx * 0.5946035575013605, dy * 0.5946035575013605);}`);
   }
   if(functions.length)source=source.replace(declaration,match=>match+'\n'+functions.join('\n'));
  }
  return source;
 }
 function fragment(source:string,textures:MaterialPass['textures'],material?:StandardMaterial,cubes:Record<string,PreviewTexture>={},resources?:Record<string,PreviewTexture>){
  for(const uniform of Object.keys(cubes)){
   const owner=environmentMatrixOwner(material);
   if(!owner||uniform!=='u_'+owner+'Map'||![2,7].includes(material!.layers[owner].uvSource)||!cubes[uniform].cube)throw new Error('CUTSCENE_CUBE_SAMPLER_ROUTE');
   const declaration='uniform sampler2D '+uniform+';';if(!source.includes(declaration))throw new Error('CUTSCENE_CUBE_SAMPLER_STAGE');
   source=source.replace(declaration,'uniform highp samplerCube '+uniform+';');
  }
  source=nativeUv(source,material);
  source=detailNormal(source,material);
  source=environment(source,material);
  source=environmentLodShader(source,material,cubes);
  source=samplerBias(source,nativeSamplerBindings(material,textures,cubes,resources));
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
 return {fragment,vertex,filterStaticTexture,environmentEnabled,environmentMatrixOwner,environmentMatrix,cubeBindings,uploadCube,upload2D,nativeUvSlots,nativeUvMatrix,detailNormalRoute,environmentLodRoute,environmentLodParameters,environmentLod,nativeSamplerBindings};
}
