import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {packPreviewCube} from '../modules/assets/cubeTexture.js';
import {decodeDds} from '../modules/assets/dds.js';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {PreviewCubeTexture,PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';

function fixture(format='DXT1',size=8,mips=4){
 const header=Buffer.alloc(128);header.write('DDS ');header.writeUInt32LE(124,4);header.writeUInt32LE(0x100f,8);header.writeUInt32LE(size,12);header.writeUInt32LE(size,16);header.writeUInt32LE(size*4,20);header.writeUInt32LE(mips,28);header.writeUInt32LE(32,76);header.writeUInt32LE(0xfe00,112);
 if(format==='RGB32'){header.writeUInt32LE(0x41,80);header.writeUInt32LE(32,88);[0x00ff0000,0x0000ff00,0x000000ff,0xff000000].forEach((mask,i)=>header.writeUInt32LE(mask,92+i*4));}
 else{header.writeUInt32LE(4,80);header.write(format,84);}
 const faces:Array<Array<{raw:Buffer;rgba:Buffer}>>=[];
 for(let face=0;face<6;face++){
  const levels=[];
  for(let mip=0;mip<mips;mip++){
   const w=Math.max(1,size>>mip),raw=Buffer.alloc(format==='RGB32'?w*w*4:Math.ceil(w/4)**2*(format==='DXT1'?8:16));
   for(let i=0;i<raw.length;i++)raw[i]=(face*137+mip*71+i*43+19)&255;
   const h=Buffer.from(header);h.writeUInt32LE(w,12);h.writeUInt32LE(w,16);h.writeUInt32LE(w*4,20);h.writeUInt32LE(1,28);h.writeUInt32LE(0,112);
   levels.push({raw,rgba:decodeDds(Buffer.concat([h,raw])).rgba});
  }
  faces.push(levels);
 }
 return {bytes:Buffer.concat([header,...faces.flatMap(face=>face.map(level=>level.raw))]),faces};
}
function recorder(compressed=false){
 let id=100,extensionReads=0,current:unknown;
 const uploads:Array<{compressed:boolean;target:number;mip:number;size:number;data:Buffer;texture:unknown}>=[],sources:string[]=[],parameters:Array<[number,number]>=[],binds:Array<{target:number;texture:unknown}>=[];
 const values:Record<string,unknown>={TEXTURE_2D:1,TEXTURE_CUBE_MAP:2,TEXTURE_CUBE_MAP_POSITIVE_X:10,MAX_TEXTURE_IMAGE_UNITS:20,MAX_FRAGMENT_UNIFORM_VECTORS:21,TEXTURE_MAX_LEVEL:22,
  createTexture:()=>({id:++id}),bindTexture:(target:number,texture:unknown)=>{current=texture;binds.push({target,texture});},getParameter:(p:number)=>p===21?1024:32,
  getExtension:(name:string)=>{if(name==='EXT_texture_filter_anisotropic')return null;assert.equal(name,'WEBGL_compressed_texture_s3tc');extensionReads++;return compressed?{COMPRESSED_RGBA_S3TC_DXT1_EXT:50,COMPRESSED_RGBA_S3TC_DXT3_EXT:51,COMPRESSED_RGBA_S3TC_DXT5_EXT:52}:null;},
  texImage2D:(target:number,mip:number,_format:number,size:number,...args:unknown[])=>{const data=args.at(-1);if(target>=10&&target<16&&ArrayBuffer.isView(data))uploads.push({compressed:false,target,mip,size,data:Buffer.from(data.buffer,data.byteOffset,data.byteLength),texture:current});},
  compressedTexImage2D:(target:number,mip:number,_format:number,size:number,_height:number,_border:number,data:Uint8Array)=>uploads.push({compressed:true,target,mip,size,data:Buffer.from(data),texture:current}),
  texParameteri:(_target:number,key:number,value:number)=>parameters.push([key,value]),generateMipmap:()=>{throw new Error('NATIVE_CUBE_MUST_NOT_GENERATE_MIPS');},
  shaderSource:(_shader:unknown,source:string)=>sources.push(source),getShaderParameter:()=>true,getProgramParameter:()=>true,
 };
 const constants=new Map<string,number>();
 const gl=new Proxy(values,{get:(o,key:string)=>key in o?o[key]:/^[A-Z0-9_]+$/.test(key)?(constants.has(key)?constants.get(key):(constants.set(key,++id),id)):(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;
 return {gl,uploads,sources,parameters,binds,reads:()=>extensionReads};
}

test('cube transport retains all original face-major mip blocks and RGB channel masks',()=>{
 for(const format of ['DXT1','DXT3','DXT5','RGB32']){
  const input=fixture(format),before=Buffer.from(input.bytes),packed=packPreviewCube(input.bytes);
  assert.equal(packed.size,8);assert.equal(packed.levels.length,4);
  for(let mip=0;mip<4;mip++)for(let face=0;face<6;face++)assert.deepEqual(Buffer.from(packed.levels[mip].faces[face],'base64'),format==='RGB32'?input.faces[face][mip].rgba:input.faces[face][mip].raw,`${format}/${face}/${mip}`);
  assert.deepEqual(input.bytes,before);assert.throws(()=>packPreviewCube(input.bytes.subarray(0,-1)),/DDS_CUBE_TRUNCATED/);
 }
});

test('native cube uploads preserve BC mip blocks, RGBA rows, partial chains and bounded max level',()=>{
 for(const format of ['DXT1','DXT3','DXT5','RGB32']){
  const input=fixture(format,8,2),cube=packPreviewCube(input.bytes),r=recorder(true),adapter=createMaterialTextureAdapter();
  const result=adapter.uploadCube(r.gl,cube);adapter.uploadCube(r.gl,cube);
  assert.equal(result.nativeLevels,2);assert.equal(result.compressed,format!=='RGB32');assert.equal(r.reads(),format==='RGB32'?0:1);
  assert.ok(r.parameters.some(([key,value])=>key===r.gl.TEXTURE_MAX_LEVEL&&value===1));
  assert.equal(r.uploads.length,24);
  for(let mip=0;mip<2;mip++)for(let face=0;face<6;face++)assert.deepEqual(r.uploads[mip*6+face].data,format==='RGB32'?input.faces[face][mip].rgba:input.faces[face][mip].raw);
 }
});

test('serialized BC fallback matches the existing DDS decoder for every mip and alpha palette',()=>{
 const adapter=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()',{atob}) as ReturnType<typeof createMaterialTextureAdapter>;
 for(const format of ['DXT1','DXT3','DXT5']){
  const input=fixture(format),r=recorder(),cube=packPreviewCube(input.bytes),result=adapter.uploadCube(r.gl,cube);
  assert.equal(result.compressed,false);assert.equal(r.uploads.length,24);
  for(let mip=0;mip<4;mip++)for(let face=0;face<6;face++)assert.deepEqual(r.uploads[mip*6+face].data,input.faces[face][mip].rgba,`${format}/${face}/${mip}`);
 }
});

test('tiny or incompatible non-power-of-two BC cubes use RGBA uploads allowed by WebGL',()=>{
 for(const size of [1,2,6,7]){
  const input=fixture('DXT1',size,1),r=recorder(true),result=createMaterialTextureAdapter().uploadCube(r.gl,packPreviewCube(input.bytes));
  assert.equal(result.compressed,false);assert.equal(r.reads(),0);
  for(let face=0;face<6;face++)assert.deepEqual(r.uploads[face].data,input.faces[face][0].rgba);
 }
});

test('invalid cube payloads fail before creating GPU resources',()=>{
 const cube=packPreviewCube(fixture().bytes),adapter=createMaterialTextureAdapter();
 for(const change of [(c:PreviewCubeTexture)=>{c.levels[1].size=8;},(c:PreviewCubeTexture)=>{c.levels[0].faces.pop();},(c:PreviewCubeTexture)=>{c.levels[0].faces[0]='!'.repeat(c.levels[0].faces[0].length);},(c:PreviewCubeTexture)=>{c.levels.push(c.levels[3]);}]){
  const copy=structuredClone(cube),r=recorder();change(copy);assert.throws(()=>adapter.uploadCube(r.gl,copy),/CUTSCENE_CUBE_/);assert.equal(r.binds.length,0);
 }
});

test('GPU chooses a real cube sampler, keeps native mip data and reuses its resource across draws',async()=>{
 const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href);
 const standard:StandardMaterial={materialClass:0,sourceFlags:0,layers:{envi:{slot:'envi',texturePath:'env.dds',uvSource:2,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:true}},blendMode:0,priority:0,specularity:4,specMult:1,emisMult:0,specMode:0,clampOutput:false,doubleLambert:false,alphaTestThreshold:0,twoSided:false,unshaded:false,usesVertexAlpha:false,usesVertexColor:false};
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],clips:[],bounds:{min:[0,0,0],max:[1,1,0]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'Native reflection',standard}],batches:[{start:0,count:3,material:0}]};
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" modelPath="base.m3"/><CCutsceneNodeTargetCamera guid="99" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','cube mips');scene.models['base.m3']=mesh;
 const source=fixture(),cube=packPreviewCube(source.bytes);scene.textures={'env.dds':{sha256:'cube',width:32,height:24,png:'data:atlas-must-not-be-loaded',cube}};
 const r=recorder(true),k=createPreviewKernel(),renderer=createGpuRenderer(r.gl,scene,k,effects,createEffectFrames,vendor);await renderer.ready;
 assert.ok(r.sources.some(s=>s.includes('uniform highp samplerCube u_enviMap;')&&s.includes('return texture(u_enviMap, p, -0.75);')&&/previewSampler_texture_u_enviMap\(\s*previewEnvironmentReflection\(\)\)/.test(s)));
 assert.equal(r.uploads.filter(u=>u.compressed).length,24);
 for(let i=0;i<3;i++)renderer.draw(k.sample(scene,0,'director',undefined,false),320,200,'solid',undefined,false);
 assert.equal(r.uploads.filter(u=>u.compressed).length,24);assert.equal(r.reads(),1);
 const handle=r.uploads.find(u=>u.compressed)!.texture;assert.ok(r.binds.filter(b=>b.texture===handle).every(b=>b.target===r.gl.TEXTURE_CUBE_MAP));
 const adapter=createMaterialTextureAdapter(),pass=vendor.createStandardMaterialPrograms({renderModel:{version:1,standard}},{budget:{maxDepth:64,maxNodes:500000,maxBytes:16000000}}).sample({time:0,sequenceTime:0,sequenceIndex:0},{teamColor:[1,0,0],ambient:[1,1,1,0]})[0];
 assert.deepEqual(adapter.cubeBindings({...standard,materialClass:undefined},pass.textures,scene.textures),{});
 assert.deepEqual(adapter.cubeBindings({...standard,layers:{...standard.layers,enviMask:{...standard.layers.envi,slot:'enviMask'}}},pass.textures,scene.textures),{});
});
