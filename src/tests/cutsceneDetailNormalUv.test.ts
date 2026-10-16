import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
import {createMaterialPreviewAdapter} from '../modules/cutscenePreview/materialPreview.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {StandardMaterial,MaterialLayer,PreviewMesh} from '../modules/cutscenePreview/types.js';
const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
const builder=await import(new URL('../../vendor/blizzard-models/dist/m3/native/builder/standard-material.js',import.meta.url).href);
const layer=(slot:string,uvSource=0,related=-1):MaterialLayer=>({slot,texturePath:slot+'.dds',sourceFlags:236,sourceUvRelated:related,uvSource,channels:1,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true});
function standard():StandardMaterial{return{materialClass:0,sourceFlags:4,specularEnergyConservation:false,layers:{diffuse:layer('diffuse'),specular:layer('specular',1),normal:layer('normal',0,0),normalBlend1Mask:layer('normalBlend1Mask',1,2),normalBlend1:layer('normalBlend1',1,2),normalBlend2:layer('normalBlend2',1,2)},normalBlendFactors:[.5,0,0,0,1,0,0,0].map(value=>({value})),blendMode:0,priority:0,specularity:16,specMult:1,emisMult:0,specMode:0,clampOutput:false,doubleLambert:false,alphaTestThreshold:0,twoSided:false,unshaded:false,usesVertexAlpha:false,usesVertexColor:false};}
const effective=(m=standard())=>createMaterialPreviewAdapter().material(m,'Armor');
function pass(m:StandardMaterial,propertyValues?:Record<string,number|number[]>){return vendor.createStandardMaterialPrograms({renderModel:{version:1,standard:m}},{budget:{maxDepth:64,maxNodes:500000,maxBytes:16000000}}).sample({time:0,sequenceTime:0,sequenceIndex:0},{ambient:[1,1,1,0],teamColor:[1,0,0],sceneLighting:true},{propertyValues})[0];}
const near=(a:number[],b:number[])=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-6,`${i}: ${v} != ${b[i]}`));

test('disabled detail property filtering preserves source samples and ordinary missing-branch validation',()=>{
 const adapter=createMaterialPreviewAdapter(),m=standard();m.sourceFlags=0;
 const values={'layers.normalBlend1.uvOffset':[.2,.3],'layers.normalBlend2Mask.uvAngle':[.1,.2,.3],'layers.diffuse.uvOffset':[.4,.5],'layers.unknown.uvOffset':[.6,.7]},before=JSON.stringify(values);
 const filtered=adapter.shaderProperties(adapter.material(m,'Armor'),values);
 assert.deepEqual(Object.keys(filtered),['layers.diffuse.uvOffset','layers.unknown.uvOffset']);assert.equal(JSON.stringify(values),before);
 const e=effective();assert.equal(adapter.shaderProperties(e,values)['layers.normalBlend1.uvOffset'],values['layers.normalBlend1.uvOffset']);
 assert.equal(adapter.shaderProperties(e,{'layers.diffuse.uvOffset':values['layers.diffuse.uvOffset']})['layers.diffuse.uvOffset'],values['layers.diffuse.uvOffset']);
});

test('both detail normals share config1 sample centers; disabled missing mask2 differentiates native emitter0',()=>{
 const m=effective(),a=createMaterialTextureAdapter(),before=JSON.stringify(m),p=pass(m,{'layers.normalBlend1.uvOffset':[.2,-.3],'layers.normalBlend1Mask.uvOffset':[-.4,.1],'layers.normalBlend2.uvOffset':[8,9]}),s=a.fragment(p.fragmentSource,p.textures,m);
 assert.deepEqual(a.detailNormalRoute(m),{normal:1,mask1:1,mask2:0,mask2Matrix:false});
 assert.ok(s.includes('textureGrad(u_normalBlend1Map, previewNativeUv_normalBlend1(), dFdx(previewNativeUv_normalBlend1Mask()), dFdy(previewNativeUv_normalBlend1Mask()))'));
 assert.ok(s.includes('textureGrad(u_normalBlend2Map, previewNativeUv_normalBlend1(), dFdx(previewNativeUv_normalBlend2Mask()), dFdy(previewNativeUv_normalBlend2Mask()))'));
 assert.ok(s.includes('vec2 previewNativeUv_normalBlend2Mask(){return v_uv0;}'));
 assert.ok(!s.includes('u_previewUv_normalBlend2;'));assert.ok(!s.includes('u_previewUv_normalBlend2Mask;'));
 near(a.nativeUvMatrix(p,m,'normalBlend1')!.slice(12,14),[-.2,.3]);near(a.nativeUvMatrix(p,m,'normalBlend1Mask')!.slice(12,14),[.4,-.1]);
 assert.equal(JSON.stringify(m),before);
});

test('related layers supply only the emitter basis; each detail/mask matrix retains its own sampled properties',()=>{
 const m=effective(),a=createMaterialTextureAdapter();m.layers.normalBlend1.uvSource=9;
 const p=pass(m,{'layers.specular.uvOffset':[9,8],'layers.normalBlend1.uvOffset':[.2,-.3]});
 assert.equal(a.detailNormalRoute(m)!.normal,1,'normal1 borrows specular emitter1 despite its own source9');
 const s=a.fragment(p.fragmentSource,p.textures,m);assert.ok(s.includes('u_previewUv_normalBlend1*vec4(v_uv1,0.,1.)'));
 near(a.nativeUvMatrix(p,m,'normalBlend1')!.slice(12,14),[-.2,.3]);
});

test('emitter0 follows the first native sampled layer rather than a fixed model UV0',()=>{
 const m=standard();m.layers.diffuse.uvSource=9;
 const a=createMaterialTextureAdapter(),e=effective(m),p=pass(e),s=a.fragment(p.fragmentSource,p.textures,e);
 assert.equal(a.detailNormalRoute(e)!.mask2,9);assert.ok(s.includes('vec2 previewNativeUv_normalBlend2Mask(){return v_uv2;}'));
});

test('inactive existing mask2 keeps its independent UV matrix, M3A overrides and missing vertex input',()=>{
 const m=standard();m.layers.normalBlend2Mask=layer('normalBlend2Mask',10);m.layers.normalBlend2Mask.uvOffset={value:[.1,.2]};
 const e=effective(m),a=createMaterialTextureAdapter(),p=pass(e),s=a.fragment(p.fragmentSource,p.textures,e),v=a.vertex(p.vertexSource,e);
 assert.equal(e.normalBlendPolicy!.secondMask,false);assert.equal(p.uniforms.u_normalBlend2MaskUvOffset,undefined);
 assert.ok(!p.vertexSource.includes('out vec2 v_uv3;'));assert.ok(v.includes('in vec2 a_uv3;'));assert.ok(v.includes('out vec2 v_uv3;'));assert.ok(v.includes('v_uv3=a_uv3;'));
 assert.ok(s.includes('in vec2 v_uv3;'));assert.ok(s.includes('u_previewUv_normalBlend2Mask*vec4(v_uv3,0.,1.)'));
 assert.ok(!s.includes('vec4 computeLayer_normalBlend2Mask()'),'disabled factor does not sample/process mask2 colour');
 near(a.nativeUvMatrix(p,e,'normalBlend2Mask')!.slice(12,14),[-.1,-.2]);
 near(a.nativeUvMatrix(p,e,'normalBlend2Mask',{'layers.normalBlend2Mask.uvOffset':[.7,-.8]})!.slice(12,14),[-.7,.8]);
 m.layers.normalBlend2Mask.uvOffset.sequenceTracks=[{sequenceIndex:0,keyframes:[{time:0,value:[0,0]},{time:1,value:[1,0]}]}];
 assert.throws(()=>a.nativeUvMatrix(p,e,'normalBlend2Mask'),/DETAIL_UV_SAMPLE_REQUIRED/);
 near(a.nativeUvMatrix(p,e,'normalBlend2Mask',{'layers.normalBlend2Mask.uvOffset':[.5,0]})!.slice(12,14),[-.5,0]);
});

test('unknown provenance, forward references, flipbook and special draw paths retain prior handling',()=>{
 const a=createMaterialTextureAdapter();
 for(const change of [(m:StandardMaterial)=>{delete m.layers.diffuse.sourceUvRelated;},(m:StandardMaterial)=>{m.layers.normalBlend1.sourceUvRelated=17;},(m:StandardMaterial)=>{m.layers.normalBlend1.flipbook={rows:2,cols:2,frame:{value:0}};},(m:StandardMaterial)=>{m.layers.height=layer('height');}]){
  const m=standard();change(m);const e=effective(m),p=pass(e);assert.equal(a.detailNormalRoute(e),undefined);assert.equal(a.fragment(p.fragmentSource,p.textures),a.fragment(p.fragmentSource,p.textures,undefined));
 }
 const m=effective(),p=pass(m),browser=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()') as typeof a;
 assert.equal(browser.fragment(p.fragmentSource,p.textures,m),a.fragment(p.fragmentSource,p.textures,m));assert.equal(browser.vertex(p.vertexSource,m),a.vertex(p.vertexSource,m));
});

test('native layer importer retains raw flags and related-UV provenance without altering the source',()=>{
 const ref={index:1},raw={flags:0x2400,uv_source:1,uv_source_related:2},before=JSON.stringify(raw);
 const sections={getSectionByReference:(r:unknown)=>r===ref?{content:[raw]}:undefined};
 const material=builder.convertStandardMaterial(sections,{flags:4,layer_diff:ref});
 assert.equal(material.layers.diffuse.sourceFlags,0x2400);assert.equal(material.layers.diffuse.sourceUvRelated,2);assert.equal(JSON.stringify(raw),before);
});

test('GPU uploads animated inactive-mask UVs and links its extra varying while retaining Body property ownership',async()=>{
 const effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),m=standard();m.layers.normalBlend2Mask=layer('normalBlend2Mask',10);
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a" modelPath="test.m3"><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="Body" duration="1000" priority="5"/><CCutsceneElementAnim anim="Face" duration="1000" priority="9"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor><CCutsceneNodeTargetCamera guid="c" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','detail UV');
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],bounds:{min:[0,0,0],max:[1,1,0]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'Armor',standard:m}],batches:[{start:0,count:3,material:0}],clips:[{name:'Body',start:0,end:1000,sequenceIndex:0,tracks:{101:{times:[0,1000],values:[[0,0],[1,0]],quaternion:false}}},{name:'Face',start:0,end:1000,sequenceIndex:1,tracks:{}}],materialBindings:[{material:0,path:['layers','normalBlend2Mask','uvOffset'],ref:{id:101,value:[0,0],interpolation:1}}]};
 scene.models['test.m3']=mesh;let id=0,programs=0;const constants=new Map(),uniforms=new Map<string,number[]>(),sources:string[]=[];
 const values:Record<string,unknown>={getExtension:()=>null,getParameter:(p:number)=>p===gl.MAX_FRAGMENT_UNIFORM_VECTORS?1024:32,getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_p:unknown,name:string)=>name,createProgram:()=>{programs++;return {};},shaderSource:(_s:unknown,source:string)=>sources.push(source),uniformMatrix4x2fv:(name:string,_transpose:boolean,v:Float32Array)=>uniforms.set(name,Array.from(v))};
 const gl=new Proxy(values,{get:(o,key:string)=>key in o?o[key]:/^[A-Z0-9_]+$/.test(key)?(constants.has(key)?constants.get(key):(constants.set(key,++id),id)):(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;
 const k=createPreviewKernel(),renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,vendor);await renderer.ready;const prepared=programs;
 for(const time of[250,750]){renderer.draw(k.sample(scene,time,'director',undefined,false),320,200,'solid',undefined,false);near(uniforms.get('u_previewUv_normalBlend2Mask')!.slice(6,8),[-time/1000,0]);assert.equal(programs,prepared);}
 assert.ok(sources.some(s=>s.includes('layout(location=9) in vec2 a_uv3;')&&s.includes('v_uv3=a_uv3;')));
 assert.ok(sources.some(s=>s.includes('textureGrad(u_normalBlend2Map, previewNativeUv_normalBlend1()')));
});
