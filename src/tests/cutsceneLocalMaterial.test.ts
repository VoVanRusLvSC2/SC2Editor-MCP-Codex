import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {StandardMaterial,MaterialLayer,PreviewMesh} from '../modules/cutscenePreview/types.js';

const materials=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
const effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href);
const layer=(slot:string):MaterialLayer=>({slot,texturePath:null,constantColor:{value:[.5,.4,.3,.7]},channels:1,op:2,teamColorMode:0,uvSource:0,invert:false,clampResult:false,wrapX:false,wrapY:false});
const material=(specular:boolean,unshaded=false):StandardMaterial=>({layers:{diffuse:layer('diffuse'),envi:layer('envi'),gloss:layer('gloss'),...(specular?{specular:layer('specular')}:{})},doubleLambert:false,clampOutput:false,blendMode:0,priority:0,specularity:24,specMode:0,specMult:2,emisMult:0,alphaTestThreshold:0,twoSided:true,unshaded,usesVertexColor:false,usesVertexAlpha:false});

async function fixture(standard:StandardMaterial,count=1,budget=16,inspect?:(stats:ReturnType<ReturnType<typeof createGpuRenderer>['draw']>)=>void){
 const shaders:string[]=[],k=createPreviewKernel(),scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a" modelPath="a.m3"><CCutsceneElementObject duration="1000"/></CCutsceneNodeActor><CCutsceneNodeLight type="1" position="0,0,2" range="10"/></CutsceneState>','local');
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,0,1],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],clips:[],bounds:{min:[0,0,0],max:[1,0,1]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'native standard',standard}],batches:[{start:0,count:3,material:0}]};scene.models['a.m3']=mesh;
 scene.lights=Array.from({length:count},(_,i)=>({...scene.lights![0],id:'light-'+i}));
 const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,MAX_TEXTURE_IMAGE_UNITS:16,MAX_FRAGMENT_UNIFORM_VECTORS:512,shaderSource:(_s:unknown,text:string)=>shaders.push(text)} as Record<string,unknown>,{get:(o,key:string)=>key in o?o[key]:(...args:unknown[])=>{if(key==='getShaderParameter'||key==='getProgramParameter')return true;if(key==='getParameter')return args[0]===512?budget:16;return {};}}) as unknown as WebGL2RenderingContext;
 const renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,materials);await renderer.ready;
 const stats=renderer.draw(k.sample(scene,0,'director',{id:'c',name:'c',eye:[0,-10,0],target:[0,0,0],fov:45,vertical:true,near:.1,far:100,roll:0,curves:[]},false),320,200,'solid',undefined,false);inspect?.(stats);
 return shaders.find(s=>s.includes('void previewLocalLight'))!;
}
test('local diffuse/specular enter the native material before environment composition, with one material sample per fragment',async()=>{
 const s=await fixture(material(true)),main=s.slice(s.lastIndexOf('void main()'));
 assert.ok(main.indexOf('lightDiffuse+=previewLocalDiffuse')<main.indexOf('vec3 shaded ='));
 assert.ok(main.indexOf('lightSpecular+=specColor.rgb*u_specMult*specEnergy*previewLocalSpecular')<main.indexOf('vec3 environmentLight'));
 assert.match(main,/u_previewSpecColor\*\(lambert>0/);assert.match(main,/previewLocalSpecular\)\*u_environmentMultipliers.z/);
 const local=s.slice(s.indexOf('void previewLocalLight'),s.lastIndexOf('void main()'));assert.ok(!local.includes('computeLayer_'),'no repeated texture lookup in per-light loop');
 assert.ok(!main.includes('shaded += previewLocalLight'),'no extra light after layers');
 assert.ok(main.includes('if(!useLightmap)'),'lightmapped materials retain their authored route');
});
test('environment-only specular reads gloss without requiring a material specular map',async()=>{
 const s=await fixture(material(false)),main=s.slice(s.lastIndexOf('void main()'));
 assert.match(main,/previewLocalLight\(normal,u_specularity\*pow\(computeLayer_gloss\(\).a,2.\)/);
 assert.ok(!main.includes('specPower')&&!main.includes('specEnergy'));assert.match(main,/lightSpecular\+=vec3\(0.\)\*previewLocalSpecular/);
});
test('unshaded materials do not acquire local-light calls',async()=>{
 const s=await fixture(material(true,true)),main=s.slice(s.lastIndexOf('void main()'));assert.ok(!main.includes('previewLocalLight('));assert.ok(!main.includes('previewLocalDiffuse'));
});
test('object-space normals retain world-space specular directions in the reflection route',async()=>{
 const m=material(true);m.layers.normal=layer('normal');Object.assign(m,{normalMapSpace:'object'});
 const s=await fixture(m),main=s.slice(s.lastIndexOf('void main()'));
 assert.ok(s.includes('sceneObjectHalfVector()'));assert.match(main,/u_previewSpecColor\*\(lambert>0.\?pow\(max\(clamp\(-dot\(sceneObjectHalfVector\(\),normal\)/);
});

test('capable GPUs retain all sixty authored lights instead of silently stopping at thirty-two',async()=>{
 const shader=await fixture(material(true),60,1024,stats=>{assert.equal(stats.eligibleLights,60);assert.equal(stats.localLights,60);assert.equal(stats.omittedLights,0);assert.equal(stats.lightLimit,60);});
 assert.ok(shader.includes('u_previewLocalPosition[60]'));assert.ok(shader.includes('if(weight<=0.)continue;'));
});

test('device and preview light limits remain bounded and report every omitted source',async()=>{
 await fixture(material(true),60,256,stats=>{assert.equal(stats.localLights,8);assert.equal(stats.omittedLights,52);assert.equal(stats.eligibleLights,60);});
 await fixture(material(true),140,1024,stats=>{assert.equal(stats.lightLimit,128);assert.equal(stats.localLights,128);assert.equal(stats.omittedLights,12);});
});
