import assert from 'node:assert/strict';
import test from 'node:test';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {MaterialLibrary,MaterialPass,MaterialSampleOptions} from '../modules/cutscenePreview/materialRuntime.js';
import type {AnimRef,PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';

test('GPU native bindings force the default for an absent facial property and retain the body UV channel',async()=>{
  const materialLibrary=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href);
  const effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href);
  const kernel=createPreviewKernel();
  const ref=(id:number,value:number[]):AnimRef=>({id,value,interpolation:1});
  const colorDefault=[.2,.3,.4,1];
  // This legacy sequence track is deliberately inconsistent with the native
  // ID registry. Omitting a default-valued override would expose this red tint.
  const standard={layers:{diffuse:{slot:'diffuse',texturePath:null,constantColor:{value:colorDefault,sequenceTracks:[{sequenceIndex:1,track:{lineType:1,globalSeqId:null,keys:[{frame:0,vector:[1,0,0,1]}]}}]},uvOffset:{value:[0,0]},uvSource:0,channels:1,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:false,wrapY:false}},blendMode:0,priority:0,specMode:0,specularity:4,specMult:0,emisMult:1,alphaTestThreshold:0,twoSided:true,unshaded:true,doubleLambert:false,clampOutput:false,usesVertexColor:false,usesVertexAlpha:false} as unknown as StandardMaterial;
  const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],weights:[1,0,0,0,1,0,0,0,1,0,0,0],joints:[0,-1,-1,-1,0,-1,-1,-1,0,-1,-1,-1],bones:[{name:'Root',parent:-1,flags:7,position:ref(1,[0,0,0]),rotation:ref(2,[0,0,0,1]),scale:ref(3,[1,1,1])}],inverseBind:[kernel.identity()],bounds:{min:[0,0,0],max:[1,1,1]},issues:[],source:'native-property-fixture',sha256:'fixture',pose:'native-bind-geometry',clips:[{name:'Body',sequenceIndex:0,start:0,end:1000,tracks:{101:{times:[0,1000],values:[[0,0],[2,4]],quaternion:false}}},{name:'Face',sequenceIndex:1,start:0,end:1000,tracks:{}}],materials:[{name:'Bound material',standard}],batches:[{start:0,count:3,material:0}],materialBindings:[{material:0,path:['layers','diffuse','constantColor'],ref:ref(100,colorDefault)},{material:0,path:['layers','diffuse','uvOffset'],ref:ref(101,[0,0])}]};
  // The converter can omit default UV fields even when native bindings retain
  // them. Playback and preparation must still use the same shader variant.
  delete standard.layers.diffuse.uvOffset;
  mesh.batches!.push({...mesh.batches![0]});
  let propertyReads=0,programsCreated=0;
  const originalSampleProperty=kernel.sampleProperty;
  kernel.sampleProperty=(...args)=>{if(args[1].id===100||args[1].id===101)propertyReads++;return originalSampleProperty(...args);};
  const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" modelPath="base.m3"><CCutsceneElementObject duration="1000"/><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="Body" duration="1000" priority="5"/><CCutsceneElementAnim anim="Face" duration="1000" priority="9"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor><CCutsceneNodeTargetCamera guid="99" eyePositionX="0" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','GPU property fixture');
  scene.models['base.m3']=mesh;
  const samples:Array<{sequence:number;options:MaterialSampleOptions|undefined;passes:MaterialPass[]}>=[];
  const recordingLibrary:MaterialLibrary={createStandardMaterialPrograms:(parameters,options)=>{
    const sampler=materialLibrary.createStandardMaterialPrograms(parameters,options);
    return {sample:(time,lighting,overrides)=>{const passes=sampler.sample(time,lighting,overrides);samples.push({sequence:time.sequenceIndex,options:overrides,passes});return passes;}};
  }};
  const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,ARRAY_BUFFER:3,FLOAT:4,TEXTURE_2D:17,TEXTURE0:100,MAX_TEXTURE_IMAGE_UNITS:16,MAX_FRAGMENT_UNIFORM_VECTORS:512,createProgram:()=>{programsCreated++;return {};}} as Record<string,unknown>,{get:(object,key:string)=>key in object?object[key]:(..._args:unknown[])=>{if(key==='getShaderParameter'||key==='getProgramParameter')return true;if(key==='getParameter')return 16;return {};}}) as unknown as WebGL2RenderingContext;
  const renderer=createGpuRenderer(gl,scene,kernel,effects,createEffectFrames,recordingLibrary);
  await renderer.ready;
  const preparedPrograms=programsCreated;
  propertyReads=0;
  const state=kernel.sample(scene,500,'director',undefined,false);
  assert.equal(state.actors[0].clip?.name,'Face');
  renderer.draw(state,320,200,'solid',undefined,false);
  assert.equal(programsCreated,preparedPrograms,'the native default UV variant must be prepared before playback');
  assert.equal(propertyReads,2,'two batches of the same material reuse each sampled property once per actor');
  const actual=samples.at(-1)!;
  assert.equal(actual.sequence,1);
  assert.deepEqual(actual.options?.propertyValues?.['layers.diffuse.constantColor'],colorDefault,'an absent native channel must explicitly override the legacy face sequence');
  assert.deepEqual(actual.options?.propertyValues?.['layers.diffuse.uvOffset'],[1,2],'the lower-priority body clip still owns its UV property');
  assert.deepEqual(actual.passes[0].uniforms.u_diffuseColor,colorDefault);
  assert.deepEqual(actual.passes[0].uniforms.u_diffuseUvOffset,[1,2]);
  assert.deepEqual(actual.passes[0].shade({}).rgba,colorDefault,'the CPU shader contract sees the same native default as the GPU uniforms');
  assert.deepEqual(standard.layers.diffuse.constantColor?.value,colorDefault);
});
