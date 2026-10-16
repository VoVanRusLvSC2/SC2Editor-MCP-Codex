import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {decodeDds} from '../modules/assets/dds.js';
import {packPreviewTexture2D} from '../modules/assets/texture2D.js';
import {createMaterialTextureAdapter} from '../modules/cutscenePreview/materialTextures.js';
import type {PreviewTexture2D} from '../modules/cutscenePreview/types.js';
import type {PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';

function fixture(format='DXT1',width=16,height=8,count=5){
 const header=Buffer.alloc(128);header.write('DDS ');header.writeUInt32LE(124,4);header.writeUInt32LE(0x100f,8);
 header.writeUInt32LE(height,12);header.writeUInt32LE(width,16);header.writeUInt32LE(width*4+8,20);header.writeUInt32LE(count,28);header.writeUInt32LE(32,76);
 if(format==='RGB32'){
  header.writeUInt32LE(0x41,80);header.writeUInt32LE(32,88);
  [0x00ff0000,0x0000ff00,0x000000ff,0xff000000].forEach((mask,i)=>header.writeUInt32LE(mask,92+i*4));
 }else{header.writeUInt32LE(4,80);header.write(format,84);}
 const levels=[];
 for(let mip=0;mip<count;mip++){
  const w=Math.max(1,width>>mip),h=Math.max(1,height>>mip),pitch=mip===0?width*4+8:w*4;
  const raw=Buffer.alloc(format==='RGB32'?pitch*h:Math.ceil(w/4)*Math.ceil(h/4)*(format==='DXT1'?8:16));
  for(let i=0;i<raw.length;i++)raw[i]=(i*43+mip*71+19)&255;
  const hh=Buffer.from(header);hh.writeUInt32LE(h,12);hh.writeUInt32LE(w,16);hh.writeUInt32LE(pitch,20);hh.writeUInt32LE(1,28);
  levels.push({width:w,height:h,raw,rgba:decodeDds(Buffer.concat([hh,raw])).rgba});
 }
 return {bytes:Buffer.concat([header,...levels.map(l=>l.raw)]),levels};
}

function recorder(compressed=false){
 let created=0,extensionReads=0;
 const uploads:Array<{mip:number;width:number;height:number;compressed:boolean;data:Buffer}>=[],parameters:Array<[number,number]>=[];
 const gl={TEXTURE_2D:1,TEXTURE_CUBE_MAP:2,TEXTURE_BASE_LEVEL:3,TEXTURE_MAX_LEVEL:4,TEXTURE_MIN_FILTER:5,TEXTURE_MAG_FILTER:6,TEXTURE_WRAP_S:7,TEXTURE_WRAP_T:8,
  LINEAR:9,LINEAR_MIPMAP_LINEAR:10,CLAMP_TO_EDGE:11,REPEAT:12,RGBA:13,UNSIGNED_BYTE:14,UNPACK_FLIP_Y_WEBGL:15,
  getExtension:(name:string)=>{assert.equal(name,'WEBGL_compressed_texture_s3tc');extensionReads++;return compressed?{COMPRESSED_RGBA_S3TC_DXT1_EXT:20,COMPRESSED_RGBA_S3TC_DXT3_EXT:21,COMPRESSED_RGBA_S3TC_DXT5_EXT:22}:null;},
  createTexture:()=>({id:++created}),bindTexture:()=>{},pixelStorei:(key:number,value:boolean)=>{assert.equal(key,15);assert.equal(value,false);},
  texParameteri:(_target:number,key:number,value:number)=>parameters.push([key,value]),
  compressedTexImage2D:(_target:number,mip:number,_format:number,width:number,height:number,_border:number,data:Uint8Array)=>uploads.push({mip,width,height,compressed:true,data:Buffer.from(data)}),
  texImage2D:(_target:number,mip:number,_internal:number,width:number,height:number,_border:number,_format:number,_type:number,data:Uint8Array)=>uploads.push({mip,width,height,compressed:false,data:Buffer.from(data)}),
  generateMipmap:()=>{throw new Error('ORIGINAL_2D_MIPS_MUST_NOT_BE_REGENERATED');}
 } as unknown as WebGL2RenderingContext;
 return {gl,uploads,parameters,counts:()=>({created,extensionReads})};
}

test('2D transport retains rectangular source mip bytes and RGB32 masks/padded top rows',()=>{
 for(const format of ['DXT1','DXT3','DXT5','RGB32']){
  const source=fixture(format),before=Buffer.from(source.bytes),image=packPreviewTexture2D(source.bytes);
  assert.deepEqual([image.sourceWidth,image.sourceHeight,image.firstMip,image.width,image.height],[16,8,0,16,8]);
  assert.equal(image.levels.length,5);
  image.levels.forEach((level,i)=>{
   assert.deepEqual([level.width,level.height],[source.levels[i].width,source.levels[i].height]);
   assert.deepEqual(Buffer.from(level.data,'base64'),format==='RGB32'?source.levels[i].rgba:source.levels[i].raw);
  });
  assert.deepEqual(source.bytes,before);
 }
});

test('preview limit selects an actual source mip and preserves later levels without resizing',()=>{
 for(const format of ['DXT1','DXT3','DXT5','RGB32']){
  const source=fixture(format),image=packPreviewTexture2D(source.bytes,8);
  assert.equal(image.firstMip,1);assert.equal(image.levels.length,4);
  assert.deepEqual([image.width,image.height],[8,4]);
  image.levels.forEach((l,i)=>assert.deepEqual(Buffer.from(l.data,'base64'),format==='RGB32'?source.levels[i+1].rgba:source.levels[i+1].raw));
 }
 const partial=fixture('DXT1',16,8,2);
 assert.equal(packPreviewTexture2D(partial.bytes).levels.length,2);
 assert.throws(()=>packPreviewTexture2D(partial.bytes,4),/DDS_2D_MIP_SIZE_UNAVAILABLE/);
});

test('2D transport rejects truncated skipped/retained levels, malformed layouts and unsupported formats',()=>{
 const source=fixture();
 for(const max of [8192,8,1])assert.throws(()=>packPreviewTexture2D(source.bytes.subarray(0,-1),max),/DDS_2D_TRUNCATED/);
 assert.throws(()=>packPreviewTexture2D(source.bytes.subarray(0,130),1),/DDS_2D_TRUNCATED/);
 for(const max of [0,-1,NaN,Infinity,1.5,8193])assert.throws(()=>packPreviewTexture2D(source.bytes,max),/DDS_2D_SIZE_BUDGET/);
 for(const change of [(b:Buffer)=>b.writeUInt32LE(0x200,112),(b:Buffer)=>b.writeUInt32LE(2,24),(b:Buffer)=>b.writeUInt32LE(6,28),(b:Buffer)=>b.write('DX10',84)]){
  const bytes=Buffer.from(source.bytes);change(bytes);assert.throws(()=>packPreviewTexture2D(bytes),/DDS_2D_/);
 }
 const rgb=fixture('RGB32');rgb.bytes.writeUInt32LE(1,20);assert.throws(()=>packPreviewTexture2D(rgb.bytes),/DDS_2D_TRUNCATED/);
});

test('2D WebGL upload preserves BC bytes, partial chains, dimensions and wrap state',()=>{
 for(const format of ['DXT1','DXT3','DXT5','RGB32']){
  const source=fixture(format,16,8,2),image=packPreviewTexture2D(source.bytes),r=recorder(true),adapter=createMaterialTextureAdapter();
  const result=adapter.upload2D(r.gl,image,true,false);adapter.upload2D(r.gl,image,false,true);
  assert.equal(result.compressed,format!=='RGB32');assert.equal(result.nativeLevels,2);
  assert.deepEqual(r.counts(),{created:2,extensionReads:format==='RGB32'?0:1});
  assert.equal(r.uploads.length,4);
  r.uploads.forEach((u,i)=>{
   const expected=source.levels[i%2];assert.deepEqual([u.width,u.height],[expected.width,expected.height]);
   assert.deepEqual(u.data,format==='RGB32'?expected.rgba:expected.raw);
  });
  assert.ok(r.parameters.some(([key,value])=>key===r.gl.TEXTURE_MAX_LEVEL&&value===1));
  assert.ok(r.parameters.some(([key,value])=>key===r.gl.TEXTURE_WRAP_S&&value===r.gl.REPEAT));
  assert.ok(r.parameters.some(([key,value])=>key===r.gl.TEXTURE_WRAP_T&&value===r.gl.REPEAT));
 }
});

test('serialized 2D BC fallback matches independent DDS decoding across every rectangular mip',()=>{
 const adapter=vm.runInNewContext('('+createMaterialTextureAdapter.toString()+')()',{atob}) as ReturnType<typeof createMaterialTextureAdapter>;
 for(const format of ['DXT1','DXT3','DXT5','RGB32'])for(const [width,height]of [[16,8],[8,16],[7,3],[1,8],[8,1],[2,2]]){
  const count=1+Math.floor(Math.log2(Math.max(width,height))),source=fixture(format,width,height,count),image=packPreviewTexture2D(source.bytes),r=recorder();
  const result=adapter.upload2D(r.gl,image);assert.equal(result.compressed,false);
  assert.equal(result.bytes,source.levels.reduce((n,l)=>n+l.width*l.height*4,0));
  r.uploads.forEach((u,i)=>assert.deepEqual(u.data,source.levels[i].rgba,`${format}/${width}x${height}/${i}`));
 }
});

test('incompatible compressed rectangular dimensions choose RGBA before extension lookup',()=>{
 for(const [width,height]of [[7,3],[1,8],[8,1],[2,2]]){
  const source=fixture('DXT5',width,height,1),r=recorder(true),result=createMaterialTextureAdapter().upload2D(r.gl,packPreviewTexture2D(source.bytes));
  assert.equal(result.compressed,false);assert.equal(r.counts().extensionReads,0);assert.deepEqual(r.uploads[0].data,source.levels[0].rgba);
 }
});

test('malformed 2D payloads fail before creating a GPU texture',()=>{
 const source=packPreviewTexture2D(fixture().bytes),adapter=createMaterialTextureAdapter();
 const changes=[(i:PreviewTexture2D)=>{i.firstMip=1;},(i:PreviewTexture2D)=>{i.sourceWidth=NaN;},(i:PreviewTexture2D)=>{i.levels[1].width=16;},
  (i:PreviewTexture2D)=>{i.levels[0].data='!'.repeat(i.levels[0].data.length);},(i:PreviewTexture2D)=>{i.levels[0].data=i.levels[0].data.slice(4);},
  (i:PreviewTexture2D)=>{i.levels.push(i.levels.at(-1)!);},(i:PreviewTexture2D)=>{i.levels=[];}];
 for(const change of changes){const image=structuredClone(source),r=recorder();change(image);assert.throws(()=>adapter.upload2D(r.gl,image),/CUTSCENE_2D_/);assert.equal(r.counts().created,0);}
});

test('GPU uses original 2D mip data without PNG/Image or mip generation and reuses the upload',async()=>{
 const vendor=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href);
 const standard:StandardMaterial={materialClass:0,sourceFlags:16,layers:{diffuse:{slot:'diffuse',texturePath:'native.dds',uvSource:0,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:true,wrapY:false}},blendMode:0,priority:0,specularity:4,specMult:0,emisMult:0,specMode:0,clampOutput:false,doubleLambert:false,alphaTestThreshold:0,twoSided:false,unshaded:true,usesVertexAlpha:false,usesVertexColor:false};
 const mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2],weights:[],joints:[],bones:[],inverseBind:[],clips:[],bounds:{min:[0,0,0],max:[1,1,0]},issues:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',materials:[{name:'Native mip data',standard}],batches:[{start:0,count:3,material:0}]};
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" modelPath="base.m3"/><CCutsceneNodeTargetCamera guid="99" eyePositionY="-10" eyePositionZ="3"/></CutsceneState>','2D mips');scene.models['base.m3']=mesh;
 const source=fixture('DXT5'),image=packPreviewTexture2D(source.bytes,8);
 scene.textures={'native.dds':{sha256:'fixture',width:8,height:4,format:'DXT5',png:'PNG_MUST_NOT_BE_LOADED',native2D:image}};
 const r=recorder(true),constants=new Map<string,number>();let id=200;
 const gl=new Proxy(r.gl as unknown as Record<string,unknown>,{get:(o,key:string)=>{
  if(key==='MAX_TEXTURE_IMAGE_UNITS')return 100;if(key==='MAX_FRAGMENT_UNIFORM_VECTORS')return 101;
  if(key==='getParameter')return (p:number)=>p===101?1024:32;
  if(key==='getShaderParameter'||key==='getProgramParameter')return ()=>true;
  if(key in o)return o[key];
  if(/^[A-Z0-9_]+$/.test(key)){if(!constants.has(key))constants.set(key,++id);return constants.get(key);}
  return ()=>({});
 }}) as unknown as WebGL2RenderingContext;
 const previous=Object.getOwnPropertyDescriptor(globalThis,'Image');
 Object.defineProperty(globalThis,'Image',{configurable:true,value:class {constructor(){throw new Error('NATIVE_2D_MUST_NOT_LOAD_PNG');}}});
 try{
  const k=createPreviewKernel(),renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,vendor);await renderer.ready;
  let native=r.uploads.filter(u=>u.compressed);assert.equal(native.length,image.levels.length);
  native.forEach((u,i)=>assert.deepEqual(u.data,source.levels[i+1].raw));
  for(let i=0;i<3;i++)renderer.draw(k.sample(scene,0,'director',undefined,false),320,200,'solid',undefined,false);
  native=r.uploads.filter(u=>u.compressed);assert.equal(native.length,image.levels.length);
  assert.equal(r.counts().extensionReads,1);
 }finally{if(previous)Object.defineProperty(globalThis,'Image',previous);else Reflect.deleteProperty(globalThis,'Image');}
});
