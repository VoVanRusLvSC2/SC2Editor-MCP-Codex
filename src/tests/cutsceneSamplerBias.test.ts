import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {PreviewTexture,PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';
const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
const standard=():StandardMaterial=>({materialClass:0,sourceFlags:16,layers:{diffuse:{slot:'diffuse',texturePath:'native.dds',uvSource:0,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:false}},blendMode:0,priority:0,specularity:4,specMult:0,emisMult:0,specMode:0,clampOutput:false,doubleLambert:false,alphaTestThreshold:0,twoSided:false,unshaded:true,usesVertexAlpha:false,usesVertexColor:false});
const image=():PreviewTexture=>({sha256:'fixture',width:1,height:1,png:'legacy',native2D:{sourceWidth:1,sourceHeight:1,firstMip:0,width:1,height:1,format:'rgba8',levels:[{width:1,height:1,data:'/////w=='}]}});
function pass(m:StandardMaterial){return vendor.createStandardMaterialPrograms({renderModel:{version:1,standard:m}},{budget:{maxDepth:64,maxNodes:500000,maxBytes:16000000}}).sample({time:0,sequenceTime:0,sequenceIndex:0},{ambient:[1,1,1,0],teamColor:[1,0,0],sceneLighting:true})[0];}

test('native sampler bias is scoped to source-qualified static DDS and cube bindings',()=>{
 const a=createMaterialTextureAdapter(),m=standard(),p=pass(m),resources={'native.dds':image()};
 assert.deepEqual(a.nativeSamplerBindings(m,p.textures,{},resources),{u_diffuseMap:2});
 for(const candidate of [undefined,{...m,sourceFlags:undefined},{...m,sourceFlags:NaN},{...m,sourceFlags:-1},{...m,materialClass:1},{...m,lightingModel:'pbr-metallic-roughness' as const}])assert.deepEqual(a.nativeSamplerBindings(candidate,p.textures,{},resources),{});
 assert.deepEqual(a.nativeSamplerBindings(m,p.textures,{}, {'native.dds':{...image(),native2D:undefined}}),{});
 assert.deepEqual(a.nativeSamplerBindings(m,[{...p.textures[0],resourceId:'rtt://0'}],{},resources),{});
 assert.deepEqual(a.nativeSamplerBindings(m,[{...p.textures[0],resourceId:'NATIVE.DDS'}],{},resources),{u_diffuseMap:2});
 const cube={...image(),native2D:undefined,cube:{size:1,format:'rgba8' as const,levels:[{size:1,faces:Array(6).fill('/////w==')}]}};
 assert.deepEqual(a.nativeSamplerBindings(m,p.textures,{u_diffuseMap:cube}),{u_diffuseMap:3});
});

test('vendor UV transforms precede biased sampling; legacy PNG and RTT retain their own routes',()=>{
 const a=createMaterialTextureAdapter(),m=standard(),p=pass(m),resources={'native.dds':image()},source=a.fragment(p.fragmentSource,p.textures,m,{},resources);
 assert.ok(source.includes('return previewSampler_texture_u_diffuseMap( previewNativeUv_diffuse());'));
 assert.ok(source.includes('return texture(u_diffuseMap, p, -0.75);'));
 assert.ok(source.includes('u_previewUv_diffuse*vec4(v_uv0,0.,1.)'));
 const legacy=a.fragment(p.fragmentSource,p.textures,m);
 assert.ok(!legacy.includes('previewSampler_'));assert.ok(legacy.includes('texture(u_diffuseMap, previewNativeUv_diffuse())'));
 m.layers.diffuse.texturePath='rtt://0';const rtt=pass(m),sourceRtt=a.fragment(rtt.fragmentSource,rtt.textures,m,{},resources);
 assert.ok(sourceRtt.includes('previewRtt_texture_u_diffuseMap'));assert.ok(!sourceRtt.includes('previewSampler_'));
 const browser=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()') as typeof a;
 assert.equal(browser.fragment(p.fragmentSource,p.textures,standard(),{},resources),source);
});

test('D3D sampler bias composes with authored bias, explicit LOD and gradients without touching unrelated samplers',()=>{
 const a=createMaterialTextureAdapter(),m={...standard(),layers:{}},textures=[{uniform:'u_test',resourceId:'native.dds'}] as ReturnType<typeof pass>['textures'];
 const input='uniform highp sampler2D u_test;\nuniform sampler2D u_other;\nvoid main(){vec2 p=vec2(.5);vec4 c=texture(u_test,p)+texture(u_test,p,1.5)+textureLod(u_test,p,2.)+textureGrad(u_test,p,dFdx(p),dFdy(p))+texture(u_other,p);}';
 const source=a.fragment(input,textures,m,{}, {'native.dds':image()});
 for(const call of ['previewSampler_texture_u_test(p)','previewSampler_texture_u_test(p,1.5)','previewSampler_textureLod_u_test(p,2.)','previewSampler_textureGrad_u_test(p,dFdx(p),dFdy(p))','texture(u_other,p)'])assert.ok(source.includes(call));
 assert.ok(source.includes('bias + (-0.75)'));assert.ok(source.includes('lod + (-0.75)'));
 // Independent footprint/coloured-mip oracle: a 4-texel footprint selects LOD2.
 // Native bias moves it to 1.25, hence 75% green mip1 and 25% blue mip2.
 const scales=[...source.matchAll(/d[xy] \* ([0-9.]+)/g)].map(v=>Number(v[1]));assert.equal(scales.length,2);
 for(const scale of scales){const lod=Math.log2(4*scale);assert.ok(Math.abs(lod-1.25)<1e-12);assert.deepEqual([0,1-(lod%1),lod%1],[0,.75,.25]);}
 assert.throws(()=>a.fragment(input.replace('sampler2D u_test','samplerCube u_test'),textures,m,{}, {'native.dds':image()}),/NATIVE_SAMPLER_DECLARATION/);
});

test('cube gradients use vec3 and the same sampler bias, including explicit SampleLevel equivalent',()=>{
 const a=createMaterialTextureAdapter(),m=standard();m.layers={envi:{...m.layers.diffuse,slot:'envi',texturePath:'cube.dds',uvSource:2}};
 const cube:PreviewTexture={...image(),native2D:undefined,cube:{size:1,format:'rgba8',levels:[{size:1,faces:Array(6).fill('/////w==')}]}};
 const p=pass(m),input=p.fragmentSource.replace('  vec3 color = vec3(0.0);','  vec3 p=vec3(1.,0.,0.); vec4 probe=textureLod(u_enviMap,p,2.)+textureGrad(u_enviMap,p,dFdx(p),dFdy(p));\n  vec3 color = vec3(0.0);');
 const source=a.fragment(input,p.textures,m,{u_enviMap:cube});
 assert.ok(source.includes('uniform highp samplerCube u_enviMap;'));
 assert.ok(source.includes('(vec3 p,float lod){return textureLod(u_enviMap, p, lod + (-0.75));}'));
 assert.ok(source.includes('(vec3 p,vec3 dx,vec3 dy)'));assert.ok(source.includes('previewSampler_textureGrad_u_enviMap(p,dFdx(p),dFdy(p))'));
});

test('GPU program cache distinguishes native DDS and PNG routes sharing the vendor shader key',async()=>{
 const effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),native=standard(),legacy=standard();legacy.layers.diffuse.texturePath='legacy.png';
 assert.equal(pass(native).key,pass(legacy).key);
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2,0,1,2],weights:[],joints:[],bones:[],inverseBind:[],clips:[],bounds:{min:[0,0,0],max:[1,1,0]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'native',standard:native},{name:'legacy',standard:legacy}],batches:[{start:0,count:3,material:0},{start:3,count:3,material:1}]};
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" modelPath="base.m3"/><CCutsceneNodeTargetCamera guid="99" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','sampler cache');scene.models['base.m3']=mesh;
 scene.textures={'native.dds':image(),'legacy.png':{...image(),native2D:undefined}};
 const sources:string[]=[],constants=new Map<string,number>();let id=0;
 const values:Record<string,unknown>={getParameter:(p:number)=>p===gl.MAX_FRAGMENT_UNIFORM_VECTORS?1024:32,getExtension:()=>null,getShaderParameter:()=>true,getProgramParameter:()=>true,shaderSource:(_shader:unknown,source:string)=>sources.push(source)};
 const gl=new Proxy(values,{get:(o,key:string)=>key in o?o[key]:/^[A-Z0-9_]+$/.test(key)?(constants.has(key)?constants.get(key):(constants.set(key,++id),id)):()=>({})}) as unknown as WebGL2RenderingContext;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'Image');Object.defineProperty(globalThis,'Image',{configurable:true,value:class{onload?:()=>void;set src(_v:string){queueMicrotask(()=>this.onload?.());}}});
 try{const k=createPreviewKernel(),renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,vendor);await renderer.ready;renderer.draw(k.sample(scene,0,'director',undefined,false),320,200,'solid',undefined,false);
  const fragments=sources.filter(s=>s.includes('uniform sampler2D u_diffuseMap;'));
  assert.ok(fragments.some(s=>s.includes('return texture(u_diffuseMap, p, -0.75);')));
  assert.ok(fragments.some(s=>!s.includes('previewSampler_')&&s.includes('texture(u_diffuseMap, previewNativeUv_diffuse())')));
 }finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});
