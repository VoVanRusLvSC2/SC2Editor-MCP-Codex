import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {MaterialLayer,StandardMaterial,PreviewTexture,PreviewMesh} from '../modules/cutscenePreview/types.js';
const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
const layer=(slot:string,uvSource=0):MaterialLayer=>({slot,texturePath:slot+'.dds',uvSource,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true});
const standard=():StandardMaterial=>({materialClass:0,sourceFlags:0x800,layers:{normal:layer('normal'),gloss:layer('gloss'),envi:layer('envi',2)},blendMode:0,priority:0,specularity:16,specMult:1,emisMult:0,specMode:0,clampOutput:false,doubleLambert:false,alphaTestThreshold:0,twoSided:false,unshaded:false,usesVertexAlpha:false,usesVertexColor:false});
const image=(size=1024):PreviewTexture=>({png:'atlas-unused',width:4,height:3,sha256:'native-cube',cube:{size,format:'rgba8',levels:[{size,faces:Array(6).fill(Buffer.alloc(size*size*4).toString('base64'))}]}});
function pass(m:StandardMaterial,propertyValues?:Record<string,number|number[]>){return vendor.createStandardMaterialPrograms({renderModel:{version:1,standard:m}},{budget:{maxDepth:64,maxNodes:500000,maxBytes:16000000}}).sample({time:0,sequenceTime:0,sequenceIndex:0},{ambient:[1,1,1,0],teamColor:[1,0,0],sceneLighting:true},{propertyValues})[0];}
const near=(actual:number[],expected:number[])=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-6,`${i}: ${v} != ${expected[i]}`));

test('ordinary normal/gloss UVs match the native type4 matrix including the XYZ pivot and negative offset',()=>{
 const a=createMaterialTextureAdapter(),m=standard(),p=pass(m,{'layers.normal.uvOffset':[.2,-.3],'layers.normal.uvTiling':[2,.5],'layers.normal.uvAngle':[.7,.4,.3]});
 // Recorded native helper + type4 binder result, not a value computed by this adapter.
 const expected=[1.7598463296890259,.1360960751771927,-.3894183337688446,0,.02727818489074707,.40240946412086487,.5933637619018555,0,.9498403668403625,-.26371294260025024,.7044663429260254,0,-1.2122681140899658,.45610734820365906,.30168694257736206,1];
 near(a.nativeUvMatrix(p,m,'normal')!,expected);near(a.nativeUvMatrix(p,m,'gloss')!,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 const browser=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()') as typeof a;near(Array.from(browser.nativeUvMatrix(p,m,'normal')!),expected);
 const invalid={...p,uniforms:{...p.uniforms,u_normalUvOffset:[NaN,0]}};assert.throws(()=>a.nativeUvMatrix(invalid,m,'normal'),/NATIVE_UV_VALUE/);
 invalid.uniforms.u_normalUvOffset=[3e38,3e38];invalid.uniforms.u_normalUvTiling=[3e38,3e38];assert.throws(()=>a.nativeUvMatrix(invalid,m,'normal'),/NATIVE_UV_RANGE/);
});

test('source dimensions determine the native LOD bias even for a single available mip',()=>{
 const a=createMaterialTextureAdapter(),m=standard(),cube={'u_enviMap':image(8)};
 assert.equal(a.environmentLodRoute(m,cube),'normal');assert.deepEqual(a.environmentLodParameters(m,cube),[8,8,3,0]);
 assert.equal(a.environmentLod([1024,1024,10,0],[1/512,0,0],[0,1/1024,0],.25),8.5);
 assert.equal(a.environmentLod([8,8,3,0],[0,0,0],[0,0,0],.5),1.5);
 assert.ok(Math.abs(a.environmentLod([64,64,6,0],[.125,0,0],[0,0,0],1.2)-1.8)<1e-12,'gloss is not clamped or squared before the bias');
 assert.equal(a.environmentLod([64,64,6,0],[1e-20,0,0],[0,0,0],1),0);
 assert.throws(()=>a.environmentLod([0,1,1,0],[0,0,0],[0,0,0],1),/ENVIRONMENT_LOD_VALUE/);
});

test('native shader uses normal UV derivatives and one raw processed gloss-alpha sample',()=>{
 const a=createMaterialTextureAdapter(),m=standard(),p=pass(m),cubes=a.cubeBindings(m,p.textures,{'envi.dds':image(8)}),source=a.fragment(p.fragmentSource,p.textures,m,cubes);
 assert.match(source,/previewSampler_textureLod_u_enviMap\(\s*previewEnvironmentReflection\(\), previewEnvironmentLod\(\)\)/);
 assert.ok(source.includes('return textureLod(u_enviMap, p, lod + (-0.75));'));
 assert.ok(source.includes('vec3 uv=vec3(previewNativeUv_normal(),0.);'));
 assert.ok(source.includes('dFdx(uv*u_previewEnvironmentSize.x)'));assert.ok(source.includes('1.-g_previewEnvironmentGloss'));
 assert.equal(source.match(/computeLayer_gloss\(\)\.a/g)?.length,1,'specular power reuses the same sampled alpha');
 assert.ok(source.includes('return texture(u_normalMap, previewNativeUv_normal());'));
 assert.ok(source.includes('return texture(u_glossMap, previewNativeUv_gloss());'));
 assert.ok(source.indexOf('in vec2 v_uv0;')<source.indexOf('vec2 previewNativeUv_normal(){'),'coordinate definition follows its input declaration');
 const browser=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()') as typeof a;assert.equal(browser.fragment(p.fragmentSource,p.textures,m,cubes),source);
});

test('native no-normal route differentiates the interpolated incident before environment matrix and fragment normalization',()=>{
 const a=createMaterialTextureAdapter(),m=standard();delete m.layers.normal;delete m.layers.gloss;
 const p=pass(m),cubes=a.cubeBindings(m,p.textures,{'envi.dds':image(8)}),source=a.fragment(p.fragmentSource,p.textures,m,cubes);
 assert.equal(a.environmentLodRoute(m,cubes),'eye');assert.ok(source.includes('vec3 uv=v_previewEnvironmentIncident*.25;'));
 assert.ok(source.includes('*(1.-1.)'));assert.ok(!source.includes('g_previewEnvironmentGloss'));
 assert.ok(!source.includes('vec3 uv=normalize('));
});

test('raw blur flag, mask ownership and unsupported UV/parallax families keep their explicit routes',()=>{
 const a=createMaterialTextureAdapter(),m=standard(),cube={'u_enviMap':image(8)};
 for(const source of [{...m,sourceFlags:0},{...m,sourceFlags:undefined},{...m,materialClass:undefined},{...m,lightingModel:'pbr-metallic-roughness' as const},{...m,layers:{...m.layers,height:layer('height')}},{...m,layers:{...m.layers,normal:{...m.layers.normal,uvSource:4}}},{...m,layers:{...m.layers,normal:{...m.layers.normal,flipbook:{rows:2,cols:2,frame:{value:0}}}}}])assert.equal(a.environmentLodRoute(source,cube),undefined);
 const mask={...m,layers:{normal:m.layers.normal,enviMask:{...m.layers.envi,slot:'enviMask'}}};assert.equal(a.environmentLodRoute(mask,{'u_enviMaskMap':image(8)}),undefined);
 const clear={...m,sourceFlags:0},p=pass(clear),source=a.fragment(p.fragmentSource,p.textures,clear,a.cubeBindings(clear,p.textures,{'envi.dds':image(8)}));
 assert.ok(!source.includes('float previewEnvironmentLod()'));assert.ok(source.includes('return previewSampler_texture_u_enviMap( previewEnvironmentReflection());'));
});

test('all four explicit UV sets and independently sampled normal/gloss transforms retain their native coordinates',()=>{
 const a=createMaterialTextureAdapter();
 for(const [uv,set]of [[0,0],[1,1],[9,2],[10,3]]){
  const m=standard();m.layers.normal.uvSource=uv;m.layers.gloss.uvSource=uv;
  const p=pass(m,{'layers.normal.uvOffset':[.2,-.3],'layers.normal.uvTiling':[2,.5],'layers.gloss.uvOffset':[-.1,.1]});
  const source=a.fragment(p.fragmentSource,p.textures,m,a.cubeBindings(m,p.textures,{'envi.dds':image(8)}));
  assert.ok(source.includes('u_previewUv_normal*vec4(v_uv'+set+',0.,1.)'));
  near(a.nativeUvMatrix(p,m,'normal')!.slice(12,14),[-.9,.4]);near(a.nativeUvMatrix(p,m,'gloss')!.slice(12,14),[.1,-.1]);
 }
});

test('GPU uploads native source-size and UV parameters before drawing the qualified cube material',async()=>{
 const effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),m=standard();
 for(const slot of ['normal','gloss'])m.layers[slot]={...m.layers[slot],texturePath:null,constantColor:{value:slot==='normal'?[.5,.5,1,1]:[1,1,1,.25]}};
 m.layers.normal.uvOffset={value:[.2,-.3]};m.layers.normal.uvTiling={value:[2,.5]};
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],clips:[],bounds:{min:[0,0,0],max:[1,1,0]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'LOD',standard:m}],batches:[{start:0,count:3,material:0}]};
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" modelPath="base.m3"/><CCutsceneNodeTargetCamera guid="99" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','native LOD');scene.models['base.m3']=mesh;scene.textures={'envi.dds':image(8)};
 const uniforms=new Map<string,number[]>(),sources:string[]=[],constants=new Map();let id=0;
 const values:Record<string,unknown>={getParameter:(p:number)=>p===gl.MAX_FRAGMENT_UNIFORM_VECTORS?1024:32,getExtension:()=>null,getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_p:unknown,name:string)=>name,shaderSource:(_s:unknown,source:string)=>sources.push(source),uniform4fv:(name:string,v:Float32Array)=>uniforms.set(name,Array.from(v)),uniformMatrix4x2fv:(name:string,_transpose:boolean,v:Float32Array)=>uniforms.set(name,Array.from(v))};
 const gl=new Proxy(values,{get:(o,key:string)=>key in o?o[key]:/^[A-Z0-9_]+$/.test(key)?(constants.has(key)?constants.get(key):(constants.set(key,++id),id)):(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;
 const k=createPreviewKernel(),renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,vendor);await renderer.ready;renderer.draw(k.sample(scene,0,'director',undefined,false),320,200,'solid',undefined,false);
 assert.deepEqual(uniforms.get('u_previewEnvironmentSize'),[8,8,3,0]);near(uniforms.get('u_previewUv_normal')!.slice(6,8),[-.9,.4]);
 assert.ok(sources.some(s=>s.includes('uniform highp samplerCube u_enviMap;')&&s.includes('float previewEnvironmentLod(){')));
 const fragment=sources.find(s=>s.includes('float previewEnvironmentLod(){'))!;
 assert.equal(fragment.match(/computeLayer_gloss\(\)\.a/g)?.length,1,'local light injection reuses the same gloss sample too');
});

test('ordinary color/alpha UVs share the native type4 transform and RTT flips after it; detail-normal ownership stays separate',()=>{
 const a=createMaterialTextureAdapter(),m=standard();m.layers.diffuse=layer('diffuse');m.layers.diffuse.texturePath='rtt://0';m.layers.emissive1=layer('emissive1',1);m.layers.alpha1=layer('alpha1');m.layers.normalBlend1=layer('normalBlend1');m.layers.normalBlend1Mask=layer('normalBlend1Mask');
 const p=pass(m,{'layers.diffuse.uvOffset':[.2,-.3],'layers.diffuse.uvTiling':[2,.5]}),source=a.fragment(p.fragmentSource,p.textures,m,a.cubeBindings(m,p.textures,{'envi.dds':image(8)}));
 assert.ok(source.includes('uniform mat4x2 u_previewUv_diffuse;'));assert.ok(source.includes('previewRtt_texture_u_diffuseMap( previewNativeUv_diffuse())'));
 assert.ok(source.includes('texture(u_emissive1Map, previewNativeUv_emissive1())'));
 assert.ok(source.includes('texture(u_alpha1Map, previewNativeUv_alpha1())'));
 assert.ok(!a.nativeUvSlots(m).includes('normalBlend1')&&!a.nativeUvSlots(m).includes('normalBlend1Mask'));
 near(a.nativeUvMatrix(p,m,'diffuse')!.slice(12,14),[-.9,.4]);
});
