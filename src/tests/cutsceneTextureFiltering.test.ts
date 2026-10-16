import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';

function recordingGl(maximum:number|null){
 let extensionReads=0,limitReads=0,id=0;
 const bound=new Map<number,unknown>(),filtered:Array<{texture:unknown;target:number;value:number}>=[],uploaded=new Set<unknown>(),mipmapped=new Set<unknown>();
 const values:Record<string,unknown>={TEXTURE_2D:10,TEXTURE_CUBE_MAP:11,MAX_TEXTURE_IMAGE_UNITS:20,MAX_FRAGMENT_UNIFORM_VECTORS:21,
  TEXTURE_MIN_FILTER:30,TEXTURE_MAG_FILTER:31,LINEAR:32,LINEAR_MIPMAP_LINEAR:33,FRAMEBUFFER_COMPLETE:34,
  getExtension:(name:string)=>{assert.equal(name,'EXT_texture_filter_anisotropic');extensionReads++;return maximum===null?null:{TEXTURE_MAX_ANISOTROPY_EXT:40,MAX_TEXTURE_MAX_ANISOTROPY_EXT:41};},
  getParameter:(key:number)=>{if(key===41){limitReads++;return maximum;}return key===21?1024:16;},
  createTexture:()=>({id:++id}),bindTexture:(target:number,texture:unknown)=>bound.set(target,texture),
  texParameterf:(target:number,key:number,value:number)=>{assert.equal(key,40);filtered.push({texture:bound.get(target),target,value});},
  texImage2D:(target:number,...args:unknown[])=>{if(args.length===5)uploaded.add(bound.get(target));},
  generateMipmap:(target:number)=>mipmapped.add(bound.get(target)),
  getShaderParameter:()=>true,getProgramParameter:()=>true,checkFramebufferStatus:()=>34,
 };
 const gl=new Proxy(values,{get:(o,key:string)=>key in o?o[key]:(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;
 return {gl,filtered,uploaded,mipmapped,counts:()=>({extensionReads,limitReads})};
}

test('standalone texture filtering respects device limits and caches capability absence per context',()=>{
 const adapter=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()');
 for(const [maximum,expected] of [[16,8],[4,4],[1,1],[null,1],[NaN,1],[Infinity,1],[-1,1]] as const){
  const r=recordingGl(maximum);
  assert.equal(adapter.filterStaticTexture(r.gl),expected);assert.equal(adapter.filterStaticTexture(r.gl),expected);
  assert.deepEqual(r.counts(),{extensionReads:1,limitReads:maximum===null?0:1});
  assert.deepEqual(r.filtered.map(item=>item.value),expected===1?[]:[expected,expected]);
  assert.equal(r.mipmapped.size,1,'ordinary mipmaps still generated without the extension');
 }
 assert.match(createMaterialTextureAdapter.toString(),/Copyright \(c\) 2026 Modkit contributors/);
 assert.match(createMaterialTextureAdapter.toString(),/THE SOFTWARE IS PROVIDED/);
});

test('GPU upload filters only static material images and reports the applied anisotropy',async()=>{
 const library=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href);
 const standard={layers:{diffuse:{slot:'diffuse',texturePath:'Assets/diffuse.dds',uvSource:0,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true},decal:{slot:'decal',texturePath:'rtt://0',uvSource:0,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true}},blendMode:0,priority:0,specularity:4,specMode:0,specMult:0,emisMult:1,alphaTestThreshold:0,twoSided:true,unshaded:true,doubleLambert:false,clampOutput:false,usesVertexColor:false,usesVertexAlpha:false} as StandardMaterial;
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],clips:[],bounds:{min:[0,0,0],max:[1,1,0]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'DDS and RTT',standard}],batches:[{start:0,count:3,material:0}]};
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" modelPath="base.m3"/><CCutsceneNodeTargetCamera guid="99" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','filter');scene.models['base.m3']=mesh;
 scene.textures={'assets/diffuse.dds':{png:'data:fixture',width:8,height:8,sha256:'fixture',format:'DXT5'}};
 const previous=Object.getOwnPropertyDescriptor(globalThis,'Image');
 class FakeImage {onload:()=>void=()=>{};set src(_value:string){queueMicrotask(()=>this.onload());}}
 Object.defineProperty(globalThis,'Image',{configurable:true,value:FakeImage});
 try{
  const r=recordingGl(16),k=createPreviewKernel(),renderer=createGpuRenderer(r.gl,scene,k,effects,createEffectFrames,library);await renderer.ready;
  assert.equal(r.uploaded.size,1);assert.equal(r.filtered.length,1);assert.ok(r.uploaded.has(r.filtered[0].texture));
  assert.equal(r.filtered[0].target,r.gl.TEXTURE_2D);assert.equal(r.filtered[0].value,8);
  const state=k.sample(scene,0,'director',undefined,false);
  for(let i=0;i<3;i++)assert.equal(renderer.draw(state,320,200,'solid',undefined,false).textureAnisotropy,8);
  assert.deepEqual(r.counts(),{extensionReads:1,limitReads:1});assert.equal(r.filtered.length,1,'no filtering or synchronous extension queries per draw');
 }finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});
