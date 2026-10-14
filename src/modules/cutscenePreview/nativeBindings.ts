import type {AnimRef,NativeMaterialBinding,SurfaceMaterial,PreviewMesh,NativeAnimationHeader,NativeAnimatedValue} from './types.js';
type Raw=Record<string,unknown>;
export interface NativeBindingSections {getSectionByReference:(ref:unknown)=>{content:unknown[]}|null|undefined}
/** Preserve raw animation reference evidence. Runtime meaning is decided by the shared sampler. */
export function nativeAnimationReference(value:unknown):AnimRef|undefined{
 if(!value||typeof value!=='object')return undefined;const r=value as Raw,h=r.header as Raw|undefined;
 if(!h||typeof h.id!=='number'||!Number.isInteger(h.id)||h.id<0||h.id>0xffffffff)return undefined;
 let components:number[];
 if(typeof r.default==='number')components=[r.default];
 else if(r.default&&typeof r.default==='object'){
  const v=r.default as Raw;
  if(typeof v.x==='number')components=['x','y','z','w'].filter(k=>typeof v[k]==='number').map(k=>Number(v[k]));
  else if(typeof v.r==='number')components=['r','g','b','a'].map(k=>Number(v[k]??(k==='a'?255:0))/255);
  else return undefined;
 }else return undefined;
 if(components.some(v=>!Number.isFinite(v)))throw new Error('CUTSCENE_NATIVE_REFERENCE_VALUE');
 const word=Number(h.interpolation??0),flags=Number(h.flags??0);
 const effectiveFlags=flags|(word===0?0x10:0);
 return {id:h.id,interpolation:word,rawHeaderU16:word,flags,effectiveFlags,effectiveInterpolation:(effectiveFlags&0x10)?0:1,value:components};
}

/** Scene-local references; upgrading an M3A header must not mutate cached base models. */
export function cloneModelAnimationReferences(mesh:PreviewMesh):PreviewMesh{
 const copies=new Map<AnimRef,AnimRef>(),copy=(ref:AnimRef)=>{let result=copies.get(ref);if(!result){result={...ref,value:[...ref.value],...(ref.headerMergeSources?{headerMergeSources:ref.headerMergeSources.map(source=>({...source}))}:{})};copies.set(ref,result);}return result;};
 const animated=(values:Record<string,NativeAnimatedValue>|undefined)=>values?Object.fromEntries(Object.entries(values).map(([name,value])=>[name,{...value,...(value.ref?{ref:copy(value.ref)}:{})}])):undefined;
 return {...mesh,bones:mesh.bones.map(b=>({...b,position:copy(b.position),rotation:copy(b.rotation),scale:copy(b.scale),...(b.batching?{batching:copy(b.batching)}:{})})),
  ...(mesh.materialBindings?{materialBindings:mesh.materialBindings.map(binding=>({...binding,path:[...binding.path],ref:copy(binding.ref)}))}:{}),
  ...(mesh.modelCameras?{modelCameras:mesh.modelCameras.map(camera=>({...camera,animated:animated(camera.animated)}))}:{}),
  ...(mesh.modelLights?{modelLights:mesh.modelLights.map(light=>({...light,animated:animated(light.animated)}))}:{})};
}

/** Native 141519000: only a STEP target and an incoming mapped row can alter bit 0x10. */
export function mergeNativeAnimationHeaders(mesh:PreviewMesh,headers:NativeAnimationHeader[],source:{sourceBundle?:string;sourceSha256?:string}={}){
 const incoming=new Map<number,NativeAnimationHeader[]>();for(const header of headers){if(!header.mapped||header.id===0xffffffff||header.id===0x65bd3215)continue;const list=incoming.get(header.id)??[];list.push(header);incoming.set(header.id,list);}
 const references=[...mesh.bones.flatMap(b=>[b.position,b.rotation,b.scale,...(b.batching?[b.batching]:[])]),...(mesh.materialBindings??[]).map(b=>b.ref),...[...mesh.modelCameras??[],...mesh.modelLights??[]].flatMap(item=>Object.values(item.animated??{}).flatMap(value=>value.ref?[value.ref]:[]))],visited=new Set<AnimRef>();let matched=0,upgraded=0;
 for(const ref of references){if(visited.has(ref))continue;visited.add(ref);const word=ref.rawHeaderU16??ref.interpolation;let flags=ref.effectiveFlags??((ref.flags??0)|(word===0?0x10:0));ref.effectiveFlags=flags;ref.effectiveInterpolation=(flags&0x10)?0:1;
  for(const header of incoming.get(ref.id)??[]){if(!(flags&0x10))break;matched++;const incomingFlags=header.flags|(header.rawHeaderU16===0?0x10:0),next=(flags&~0x10)|(incomingFlags&0x10);if(next!==flags)upgraded++;flags=next;ref.effectiveFlags=flags;ref.effectiveInterpolation=(flags&0x10)?0:1;
   const provenance={...source,rawHeaderU16:header.rawHeaderU16,flags:header.flags};ref.headerMergeSources??=[];if(!ref.headerMergeSources.some(old=>old.sourceSha256===provenance.sourceSha256&&old.sourceBundle===provenance.sourceBundle&&old.rawHeaderU16===provenance.rawHeaderU16&&old.flags===provenance.flags))ref.headerMergeSources.push(provenance);
  }
 }
 return {references:visited.size,matched,upgraded};
}
/** Keep all target paths per ID; the renderer's strict vendor material snapshot stays unchanged. */
export function collectNativeMaterialBindings(model:Raw,sections:NativeBindingSections,materials:SurfaceMaterial[]):NativeMaterialBinding[]{
 const list=(ref:unknown)=>sections.getSectionByReference(ref)?.content as Raw[]??[];
 const refs=list(model.material_references),standards=list(model.materials_standard),composites=list(model.materials_composite);
 const result:NativeMaterialBinding[]=[];
 const slots:Record<string,string>={layer_diff:'diffuse',layer_decal:'decal',layer_spec:'specular',layer_gloss:'gloss',layer_emis1:'emissive1',layer_emis2:'emissive2',layer_envi:'envi',layer_envi_mask:'enviMask',layer_alpha1:'alpha1',layer_alpha2:'alpha2',layer_norm:'normal',layer_height:'height',layer_light:'lightMap',layer_ao:'ao',layer_norm_blend1:'normalBlend1',layer_norm_blend2:'normalBlend2',layer_norm_blend1_mask:'normalBlend1Mask',layer_norm_blend2_mask:'normalBlend2Mask'};
 function bind(material:number,pass:number|undefined,path:string[],raw:unknown,target:'standard'|'passAlpha'='standard'){
  const ref=nativeAnimationReference(raw);if(ref)result.push({material,...(pass===undefined?{}:{pass}),path,ref,...(target==='standard'?{}:{target})});
 }
 function standard(material:number,pass:number|undefined,converted:NonNullable<SurfaceMaterial['standard']>,raw:Raw){
  bind(material,pass,['parallaxHeight'],raw.parallax_height);
  const factors=list(raw.normal_blend_mask_factor);factors.forEach((f,i)=>bind(material,pass,['normalBlendFactors',String(i)],f.value));
  for(const [field,slot]of Object.entries(slots)){
   if(!converted.layers[slot])continue;const layer=list(raw[field])[0];if(!layer)continue;
   const flags=Number(layer.flags??0),prefix=['layers',slot];
   if(flags&0x400)bind(material,pass,[...prefix,'constantColor'],layer.color_value);
   if(flags&0x80)bind(material,pass,[...prefix,'colorMultiply'],layer.color_multiply);
   if(flags&0x40)bind(material,pass,[...prefix,'colorAdd'],layer.color_add);
   bind(material,pass,[...prefix,'alphaFactor'],layer.color_brightness);
   for(const [native,property]of [['uv_offset','uvOffset'],['uv_angle','uvAngle'],['uv_tiling','uvTiling'],['uv_triplanar_offset','uvTriplanarOffset'],['uv_triplanar_scale','uvTriplanarScale']] as const)
    bind(material,pass,[...prefix,property],layer[native]);
   if(converted.layers[slot].flipbook)bind(material,pass,[...prefix,'flipbook','frame'],layer.uv_flipbook_frame);
  }
 }
 materials.forEach((m,index)=>{
  const ref=refs[index];if(!ref)return;
  if(Number(ref.type)===1&&m.standard){const raw=standards[Number(ref.material_index)];if(raw)standard(index,undefined,m.standard,raw);}
  if(Number(ref.type)===3&&m.composite){const composite=composites[Number(ref.material_index)],passes=composite?list(composite.sections):[];
   if(passes.length!==m.composite.passes.length)return;
   passes.forEach((p,i)=>{bind(index,i,['alphaFactor'],p.alpha_factor,'passAlpha');const child=refs[Number(p.material_reference_index)];
    if(Number(child?.type)===1){const raw=standards[Number(child.material_index)];if(raw)standard(index,i,m.composite!.passes[i].material,raw);}});
  }
 });
 return result;
}
