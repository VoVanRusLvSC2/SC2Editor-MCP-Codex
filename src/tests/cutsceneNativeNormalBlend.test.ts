import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMaterialPreviewAdapter} from '../modules/cutscenePreview/materialPreview.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {MaterialLayer,StandardMaterial,PreviewMesh} from '../modules/cutscenePreview/types.js';
const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
const layer=(slot:string):MaterialLayer=>({slot,texturePath:slot+'.dds',uvSource:0,channels:1,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true});
const standard=(flags=4):StandardMaterial=>({materialClass:0,sourceFlags:flags,specularEnergyConservation:false,layers:Object.fromEntries(['normal','normalBlend1','normalBlend2','normalBlend1Mask'].map(slot=>[slot,layer(slot)])),normalBlendFactors:[.5,0,0,0,1,0,0,0].map(value=>({value})),blendMode:0,priority:0,specularity:16,specMult:1,emisMult:0,specMode:0,clampOutput:false,doubleLambert:false,alphaTestThreshold:0,twoSided:false,unshaded:false,usesVertexAlpha:false,usesVertexColor:false});
const texels={normal:[0,.5,0,.5],normalBlend1:[0,.5,0,.2],normalBlend2:[0,.8,0,.5],normalBlend1Mask:[1,0,0,1],normalBlend2Mask:[.6,0,0,1]};
function pass(material:StandardMaterial,propertyValues?:Record<string,number|number[]>){
 return vendor.createStandardMaterialPrograms({renderModel:{version:1,standard:material}},{budget:{maxDepth:64,maxNodes:500000,maxBytes:16000000}}).sample({time:0,sequenceTime:0,sequenceIndex:0},{ambient:[1,1,1,0],teamColor:[1,0,0],sceneLighting:true},{propertyValues})[0];
}
const near=(a:number[],b:number[])=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-7,`${i}: ${v} != ${b[i]}`));
// Independent numeric interpretation of psmaterial.fx NormalBlending, using
// known already-decoded unit normals rather than the adapter/vendor helpers.
function native(maskSum:number){const f=Math.min(1,Math.max(-1,maskSum)),detail=f<0?[-.6,0,.8]:[0,.6,.8],v=detail.map((d,i)=>(i===2?1:0)*(1-f*f)+d*f*f),length=Math.hypot(...v);return v.map(c=>c/length);}

test('native signed mask selects one detail normal with squared weight instead of sequential full replacement',()=>{
 const source=standard(),before=JSON.stringify(source),adapter=createMaterialPreviewAdapter(),material=adapter.material(source,'Armor');
 assert.deepEqual(material.normalBlendPolicy,{mode:'signed-two-detail',secondMask:false});
 near(pass(material).sampleNormal({texels}),native(.5));
 assert.ok(Math.hypot(...pass(source).sampleNormal({texels}).map((v:number,i:number)=>v-native(.5)[i]))>.3,'pre-fix sequential normals produce a different final normal');
 assert.equal(JSON.stringify(source),before);assert.equal(material.layers,source.layers);assert.equal(material.normalBlendFactors,source.normalBlendFactors);
 assert.equal(adapter.material(source,'Armor'),material,'corrected source is cached');
});

test('native signed factor clamps both signs and preserves independently sampled factor properties',()=>{
 const material=createMaterialPreviewAdapter().material(standard(),'Armor');
 for(const factor of [-3,-1,-.5,0,.5,1,3]){
  const p=pass(material,{'normalBlendFactors.0':factor});
  assert.equal(p.uniforms.u_normalBlend1Factors[0],factor);
  near(p.sampleNormal({texels}),native(factor));
 }
});

test('raw second-mask bit controls its contribution even when a texture and stale policy are present',()=>{
 const adapter=createMaterialPreviewAdapter(),source=standard();source.layers.normalBlend2Mask=layer('normalBlend2Mask');
 source.normalBlendPolicy={mode:'signed-two-detail',secondMask:true};
 source.normalBlendFactors![0]={value:-.9};source.normalBlendFactors![4]={value:.8};
 const t={...texels,normalBlend1Mask:[.7,0,0,1]};
 const one=adapter.material(source,'Armor'),two=adapter.material({...source,sourceFlags:0x08000004},'Armor');
 assert.equal(one.normalBlendPolicy!.secondMask,false);assert.equal(two.normalBlendPolicy!.secondMask,true);
 near(pass(one).sampleNormal({texels:t}),native(-.63));near(pass(two).sampleNormal({texels:t}),native(-.15));
 assert.ok(!pass(one).fragmentSource.includes('vec4 computeLayer_normalBlend2Mask()'));
 assert.ok(pass(two).fragmentSource.includes('vec4 computeLayer_normalBlend2Mask()'));
});

test('native disabled blending ignores retained detail layers without mutating source data',()=>{
 const adapter=createMaterialPreviewAdapter(),source=standard(0x800);source.normalBlendPolicy={mode:'signed-two-detail',secondMask:true};
 const before=JSON.stringify(source),material=adapter.material(source,'Armor');
 assert.equal(material.normalBlendPolicy,undefined);assert.deepEqual(Object.keys(material.layers),['normal']);
 assert.equal(material.specularEnergyConservation,true);near(pass(material).sampleNormal({texels}),[0,0,1]);
 assert.ok(!pass(material).fragmentSource.includes('normalBlend1Factor'));
 assert.equal(JSON.stringify(source),before);assert.equal(material.layers.normal,source.layers.normal);
});

test('unknown and specialized material families keep their source normal policy',()=>{
 const adapter=createMaterialPreviewAdapter();
 for(const source of [{...standard(),sourceFlags:undefined},{...standard(),sourceFlags:-1},{...standard(),sourceFlags:2**32},{...standard(),materialClass:undefined},{...standard(),materialClass:1},{...standard(),lightingModel:'pbr-metallic-roughness' as const}])assert.equal(adapter.material(source,'Armor'),source);
 for(const missing of ['normalBlend1','normalBlend2','normalBlend1Mask']){
  const source=standard();delete source.layers[missing];assert.equal(adapter.material(source,'Armor').normalBlendPolicy,undefined);
 }
 const source=standard(0x08000004);assert.equal(adapter.material(source,'Armor').normalBlendPolicy,undefined,'native disabled mask/default handling remains unqualified');
});

test('serialized browser adapter applies the same raw flags and policy as the module adapter',()=>{
 const module=createMaterialPreviewAdapter(),browser=vm.runInNewContext('('+createMaterialPreviewAdapter.toString()+')()') as ReturnType<typeof createMaterialPreviewAdapter>;
 for(const flags of [0,4,0x800,0x804,0x08000004,0x80000004,0xffffffff]){
  const source=standard(flags);source.layers.normalBlend2Mask=layer('normalBlend2Mask');
  assert.equal(JSON.stringify(browser.material(source,'Armor')),JSON.stringify(module.material(source,'Armor')));
 }
});

test('GPU signed normals retain the lower-priority M3A factor while Face owns the pose, without new programs on seek',async()=>{
 const effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),m=standard();
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a" modelPath="test.m3"><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="Body" duration="1000" priority="5"/><CCutsceneElementAnim anim="Face" duration="1000" priority="9"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor><CCutsceneNodeTargetCamera guid="c" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','signed normals');
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],bounds:{min:[0,0,0],max:[1,1,0]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'Armor',standard:m}],batches:[{start:0,count:3,material:0}],clips:[{name:'Body',start:0,end:1000,sequenceIndex:0,tracks:{101:{times:[0,1000],values:[[-.5],[.5]],quaternion:false}}},{name:'Face',start:0,end:1000,sequenceIndex:1,tracks:{}}],materialBindings:[{material:0,path:['normalBlendFactors','0'],ref:{id:101,value:[.5],interpolation:1}}]};
 scene.models['test.m3']=mesh;
 let id=0,programs=0;const constants=new Map(),uniforms=new Map<string,number[]>(),sources:string[]=[];
 const values:Record<string,unknown>={getExtension:()=>null,getParameter:(p:number)=>p===gl.MAX_FRAGMENT_UNIFORM_VECTORS?1024:32,getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_p:unknown,name:string)=>name,createProgram:()=>{programs++;return {};},shaderSource:(_s:unknown,source:string)=>sources.push(source),uniform4fv:(name:string,v:Float32Array)=>uniforms.set(name,Array.from(v))};
 const gl=new Proxy(values,{get:(o,key:string)=>key in o?o[key]:/^[A-Z0-9_]+$/.test(key)?(constants.has(key)?constants.get(key):(constants.set(key,++id),id)):(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;
 const k=createPreviewKernel(),renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,vendor);await renderer.ready;
 const prepared=programs;
 for(const [time,factor]of [[250,-.25],[750,.25]]){
  renderer.draw(k.sample(scene,time,'director',undefined,false),320,200,'solid',undefined,false);
  assert.ok(Math.abs(uniforms.get('u_normalBlend1Factors')![0]-factor)<1e-7);assert.equal(programs,prepared);
 }
 assert.ok(sources.some(source=>source.includes('sceneFactor<0.0?sceneFirst:sceneSecond')&&source.includes('sceneFactor*sceneFactor')));
 assert.equal(m.normalBlendPolicy,undefined,'native source remains untouched');
});
