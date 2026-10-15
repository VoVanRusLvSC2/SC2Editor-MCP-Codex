import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {rasterMaterials} from '../modules/cutscenePreview/materialRaster.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {resolveGlobalLighting} from '../modules/lighting/catalog.js';
import type {MaterialLibrary} from '../modules/cutscenePreview/materialRuntime.js';
import type {PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';

const close=(actual:number[],expected:number[])=>actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-12,`${actual} != ${expected}`));
const albedo=[.5,.25,.75];
const standard:StandardMaterial={layers:{diffuse:{slot:'diffuse',texturePath:null,constantColor:{value:[...albedo,1]},uvSource:0,channels:1,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:false,wrapY:false}},blendMode:0,priority:0,specularity:4,specMode:0,specMult:0,emisMult:0,alphaTestThreshold:0,twoSided:true,unshaded:false,doubleLambert:false,clampOutput:false,usesVertexColor:false,usesVertexAlpha:false};

test('GPU ambient uploads and CPU material pixels share native scalar selection through timed and interrupted ActiveLight fades',async()=>{
 const materialLibrary=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),k=createPreviewKernel(),environment=createEnvironmentKernel(k);
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelPath="fixture.m3"/><CCutsceneNodeTargetCamera guid="camera" eyePositionX="0" eyePositionY="-10" eyePositionZ="3"/><CCutsceneNodeEnvironmentLight guid="first" ambientEnvironmentMultiplier=".2" hdrAmbientMultiplier="5"/><CCutsceneNodeEnvironmentLight guid="second" ambientEnvironmentMultiplier="0"/><CCutsceneElementActiveLight lightGUID="first" start="0" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="second" start="500" blendTime="1000"/></CutsceneState>','ambient-render-paths');
 scene.lighting=resolveGlobalLighting(['<Catalog><CLight id="Native"><ToDInfoArray AmbientColor="0,0,0"><DirectionalLight index="Key" ColorMultiplier="0"/></ToDInfoArray></CLight></Catalog>'],'Native');
 scene.lighting.environmentCube={size:1,faces:Array(6).fill(Buffer.from([255,255,255,255]).toString('base64')),sha256:'white'};
 const ref=(value:number[])=>({id:0,interpolation:0,value}),mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,0,1],normals:[0,-1,0,0,-1,0,0,-1,0],indices:[0,1,2],weights:[1,0,0,0,1,0,0,0,1,0,0,0],joints:[0,-1,-1,-1,0,-1,-1,-1,0,-1,-1,-1],bones:[{name:'Root',parent:-1,flags:7,position:ref([0,0,0]),rotation:ref([0,0,0,1]),scale:ref([1,1,1])}],inverseBind:[k.identity()],bounds:{min:[0,0,0],max:[1,0,1]},clips:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',issues:[],materials:[{name:'Diffuse',standard}],batches:[{start:0,count:3,material:0}]};
 scene.models['fixture.m3']=mesh;
 const uploaded:number[][]=[],sampled:number[][]=[];
 const recordingLibrary:MaterialLibrary={createStandardMaterialPrograms:(parameters,options)=>{const sampler=materialLibrary.createStandardMaterialPrograms(parameters,options);return {sample:(time,lighting,overrides)=>{sampled.push([...lighting.ambient]);return sampler.sample(time,lighting,overrides);}};}};
 const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,ARRAY_BUFFER:3,FLOAT:4,TEXTURE_2D:17,TEXTURE0:100,MAX_TEXTURE_IMAGE_UNITS:16,MAX_FRAGMENT_UNIFORM_VECTORS:512,getUniformLocation:(_program:unknown,name:string)=>({name}),uniform3fv:(location:{name:string},values:Float32Array)=>{if(location.name==='u_sceneAmbientColor')uploaded.push(Array.from(values));}} as Record<string,unknown>,{get:(object,key:string)=>key in object?object[key]:(..._args:unknown[])=>{if(key==='getShaderParameter'||key==='getProgramParameter')return true;if(key==='getParameter')return 16;return {};}}) as unknown as WebGL2RenderingContext;
 const renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,recordingLibrary);await renderer.ready;
 assert.ok(sampled.some(value=>value.join(',')==='1,1,1,0'),'GPU material preparation uses the selected scalar uniform');
 const times=[0,500,750,1000,1500],expected=[1,.6,.45,.3,0];
 for(let i=0;i<times.length;i++){
  const time=times[i],light=environment.lighting(scene,time),state=k.sample(scene,time,'director',undefined,false);renderer.draw(state,320,200,'solid',undefined,false);
  close(uploaded.at(-1)!,Array(3).fill(Math.fround(expected[i])));
  const raster=await rasterMaterials({...scene,lighting:light}),prepared=raster.prepare(standard,0,0,[1,1,1]);
  close(prepared.shade([], [0,-1,0],[0,0,0],[1,1,1,1],[0,-10,3]),albedo.map(value=>value*expected[i]).concat(1));
 }
 assert.deepEqual(scene.lighting.ambient,[0,0,0]);assert.equal(scene.lighting.ambientEnvironmentMultiplier,1);assert.equal(scene.environmentLights![0].values.hdrAmbientMultiplier,5);
});

test('CPU materials retain the legacy RGB HDR fallback on a missing cube and use the independent scalar when decoding resolves',async()=>{
 const scene=parsePreviewScene('<CutsceneState/>','ambient-missing-cube');
 scene.lighting=resolveGlobalLighting(['<Catalog><CLight id="Native"><AmbientEnvironmentMap value="Assets/missing.dds"/><ToDInfoArray AmbientColor=".1,.2,.3" AmbientEnvironmentMultiplier=".025"><Param index="HDRAmbientMultiplier" value="2"/><DirectionalLight index="Key" ColorMultiplier="0"/></ToDInfoArray></CLight></Catalog>'],'Native');
 let raster=await rasterMaterials(scene);close(raster.prepare(standard,0,0,[1,1,1],{}).shade([],[0,-1,0],[0,0,0],[1,1,1,1],[0,-10,3]),[.1,.1,.45,1]);
 scene.lighting.environmentCube={size:1,faces:Array(6).fill(Buffer.from([255,255,255,255]).toString('base64')),sha256:'white'};
 raster=await rasterMaterials(scene);close(raster.prepare(standard,0,0,[1,1,1],{propertyValues:{}}).shade([],[0,-1,0],[0,0,0],[1,1,1,1],[0,-10,3]),[.0125,.00625,.01875,1]);
});
