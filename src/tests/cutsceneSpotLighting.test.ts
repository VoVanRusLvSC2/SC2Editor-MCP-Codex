import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createGlobalLightingKernel} from '../modules/lighting/math.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {AnimRef,PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';

const close=(actual:number[],expected:number[])=>{assert.equal(actual.length,expected.length);actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-12,`${actual} != ${expected}`));};
const coefficients=(value:NonNullable<ReturnType<ReturnType<typeof createGlobalLightingKernel>['spotParameters']>>)=>[value.bias,value.scale,value.hotspotMultiplier];

test('native full-radian spot coefficients match independent numeric oracles including the exact .95 cap and zero hotspot',()=>{
 const k=createGlobalLightingKernel();
 for(const [hotspot,falloff,expected]of [
  [.2,.5,[-.9689124217106447,32.16718879458073,1.1914718619348914]],
  [.5,1,[-.8775825618903728,8.168770850313663,1.340387890121944]],
  [1,1,[-.8775825618903728,8.168770850313663,10.453948742462345]],
  [0,.5,[-.9689124217106447,32.16718879458073,1]],
 ] as const)close(coefficients(k.spotParameters(hotspot,falloff)!),[...expected]);
 close(coefficients(k.spotParameters(2,1)!),coefficients(k.spotParameters(1,1)!));
 const cone=k.spotParameters(1,1)!;assert.equal(k.spotAttenuation(Math.cos(.6),cone.bias,cone.scale,cone.hotspotMultiplier),0,'a .6-radian ray is outside the default .5-radian half cone');
});

test('native nested squared spot attenuation reaches inner and outer edges and a cosine midpoint quarter value',()=>{
 const k=createGlobalLightingKernel(),cone=k.spotParameters(.2,.5)!,evaluate=(dot:number)=>k.spotAttenuation(dot,cone.bias,cone.scale,cone.hotspotMultiplier),outer=Math.cos(.25),inner=Math.cos(.1);
 close([evaluate(-1),evaluate(outer),evaluate((outer+inner)/2),evaluate(inner),evaluate(1)],[0,0,.25,1,1]);
 const noCore=k.spotParameters(0,.5)!;assert.equal(noCore.hotspotMultiplier,1);assert.equal(k.spotAttenuation(1,noCore.bias,noCore.scale,noCore.hotspotMultiplier),1);
});

test('singular and nonfinite cones are explicitly undefined for the bounded preview guard',()=>{
 const k=createGlobalLightingKernel();for(const [hotspot,falloff]of [[0,0],[1,0],[NaN,1],[1,NaN],[Infinity,1],[1,Infinity]])assert.equal(k.spotParameters(hotspot,falloff),undefined);
 assert.ok(k.spotParameters(0,1));assert.ok(k.spotParameters(1,1));
});

test('spot coefficients and attenuation serialize with identical numeric behavior in the browser factory',()=>{
 const k=createGlobalLightingKernel(),browser=vm.runInNewContext('('+createGlobalLightingKernel.toString()+')()') as ReturnType<typeof createGlobalLightingKernel>;
 for(const [hotspot,falloff]of [[.2,.5],[1,1],[0,.5],[1,0]]){
  const actual=browser.spotParameters(hotspot,falloff),expected=k.spotParameters(hotspot,falloff);
  if(!expected){assert.equal(actual,undefined);continue;}close(coefficients(actual!),coefficients(expected));
  for(const dot of [-1,.5,.9,1])assert.equal(browser.spotAttenuation(dot,actual!.bias,actual!.scale,actual!.hotspotMultiplier),k.spotAttenuation(dot,expected.bias,expected.scale,expected.hotspotMultiplier));
 }
});

test('authored spot defaults are full-radian1 while explicit zero and raw attribute presence remain distinct',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeLight guid="default" type="2"/><CCutsceneNodeLight guid="zero" type="2" hotspot="0" falloff="0"/></CutsceneState>','spot-defaults');
 assert.deepEqual(scene.lights!.map(light=>[light.hotspot,light.falloff]),[[1,1],[0,0]]);
 assert.equal(Object.hasOwn(scene.sourceObjects!.find(object=>object.id==='default')!.attrs,'hotspot'),false);
 assert.equal(scene.sourceObjects!.find(object=>object.id==='zero')!.attrs.hotspot,'0');assert.equal(scene.sourceObjects!.find(object=>object.id==='zero')!.attrs.falloff,'0');
});

function fixture(){
 const k=createPreviewKernel(),ref=(id:number,value:number[]):AnimRef=>({id,value,interpolation:1});
 const standard:StandardMaterial={layers:{diffuse:{slot:'diffuse',texturePath:null,constantColor:{value:[.5,.5,.5,1]},uvSource:0,channels:1,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:false,wrapY:false}},blendMode:0,priority:0,specularity:4,specMode:0,specMult:0,emisMult:0,alphaTestThreshold:0,twoSided:true,unshaded:false,doubleLambert:false,clampOutput:false,usesVertexColor:false,usesVertexAlpha:false};
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelPath="fixture.m3"><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="Body" duration="1000"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor><CCutsceneNodeTargetCamera guid="camera" eyePositionX="0" eyePositionY="-10" eyePositionZ="3"/><CCutsceneNodeLight guid="node" type="2" hotspot=".2" falloff=".5" attenuationStart="0" range="10" lightTransparent="1"><CCutsceneNodePropertyValue propertyName="hotspot"><CCutsceneElementPropertyCurve time="0" value=".2"/><CCutsceneElementPropertyCurve time="1000" value=".5"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="falloff"><CCutsceneElementPropertyCurve time="0" value=".5"/><CCutsceneElementPropertyCurve time="1000" value="1"/></CCutsceneNodePropertyValue></CCutsceneNodeLight><CCutsceneNodeLight guid="singular" type="2" hotspot="0" falloff="0" colorMultiplier="10"/></CutsceneState>','spot-samplers');
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,0,1],normals:[0,-1,0,0,-1,0,0,-1,0],indices:[0,1,2],weights:[1,0,0,0,1,0,0,0,1,0,0,0],joints:[0,-1,-1,-1,0,-1,-1,-1,0,-1,-1,-1],bones:[{name:'Root',parent:-1,flags:7,position:ref(1,[0,0,0]),rotation:ref(2,[0,0,0,1]),scale:ref(3,[1,1,1])}],inverseBind:[k.identity()],bounds:{min:[0,0,0],max:[1,0,1]},clips:[{name:'Body',start:0,end:1000,tracks:{101:{times:[0,1000],values:[[.2],[.8]],quaternion:false},102:{times:[0,1000],values:[[.5],[1.5]],quaternion:false}}}],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',issues:[],materials:[{name:'Diffuse',standard}],batches:[{start:0,count:3,material:0},{start:0,count:3,material:0}],modelLights:[{index:0,name:'M3 spot',boneIndex:0,type:2,flags:24,color:[.5,.5,.5],intensity:1,specularColor:[0,0,0],specularIntensity:0,attenuationNear:0,attenuationFar:10,hotspot:.2,falloff:.5,animated:{hotspot:{value:.2,ref:ref(101,[.2])},falloff:{value:.5,ref:ref(102,[.5])}}}]};
 scene.models['fixture.m3']=mesh;return {k,scene,mesh};
}

test('node curves and M3 LITE property samplers retain full-radian values and the existing light transform convention',()=>{
 const {k,scene,mesh}=fixture(),environment=createEnvironmentKernel(k),lights=environment.lights(scene,k.sample(scene,500,'director',undefined,false)).filter(light=>light.falloff>0);
 close([lights[0].hotspot,lights[0].falloff,lights[1].hotspot,lights[1].falloff],[.35,.75,.5,1]);
 for(const light of lights)close(light.direction,[0,0,-1]);
 assert.equal(scene.lights![0].hotspot,.2);assert.equal(scene.lights![0].falloff,.5);assert.equal(mesh.modelLights![0].hotspot,.2);assert.equal(mesh.modelLights![0].falloff,.5);
});

test('GPU packs shared native spot coefficients once per sampled light and reports skipped singular cones',async()=>{
 const materialLibrary=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),{k,scene}=fixture(),math=createGlobalLightingKernel(),uploaded=new Map<string,number[]>();let parameterCalls=0;
 const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,ARRAY_BUFFER:3,FLOAT:4,TEXTURE_2D:17,TEXTURE0:100,MAX_TEXTURE_IMAGE_UNITS:16,MAX_FRAGMENT_UNIFORM_VECTORS:512,getUniformLocation:(_program:unknown,name:string)=>({name}),uniform4fv:(location:{name:string},value:Float32Array)=>uploaded.set(location.name,Array.from(value))} as Record<string,unknown>,{get:(object,key:string)=>key in object?object[key]:(..._args:unknown[])=>{if(key==='getShaderParameter'||key==='getProgramParameter')return true;if(key==='getParameter')return 16;return {};}}) as unknown as WebGL2RenderingContext;
 const renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,materialLibrary,()=>({...math,spotParameters:(hotspot:number,falloff:number)=>{parameterCalls++;return math.spotParameters(hotspot,falloff);}}));await renderer.ready;
 const stats=renderer.draw(k.sample(scene,500,'director',undefined,false),320,200,'solid',undefined,false);
 assert.equal(parameterCalls,3,'each sampled spot is converted once, independent of repeated material batches');assert.equal(stats.localLights,2);assert.equal(stats.skippedSpotLights,1);
 const options=uploaded.get('u_previewLocalOptions[0]')!,directions=uploaded.get('u_previewLocalDirection[0]')!,node=math.spotParameters(.35,.75)!;
 close(options.slice(0,4),[1,node.bias,node.scale,3].map(Math.fround));close(directions.slice(0,4),[0,0,-1,node.hotspotMultiplier].map(Math.fround));
 close(options.slice(4,8),[1,-.8775825618903728,8.168770850313663,3].map(Math.fround));close(directions.slice(4,8),[0,0,-1,1.340387890121944].map(Math.fround));
 assert.ok([...options,...directions].every(Number.isFinite));assert.equal(scene.lights![1].falloff,0);
});
