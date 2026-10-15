import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {inflateSync} from 'node:zlib';
import {createGlobalToneMath} from '../modules/lighting/tone.js';
import {resolveGlobalLighting} from '../modules/lighting/catalog.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createPostprocess} from '../modules/cutscenePreview/postprocess.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {HeightMap,TerrainDescriptor} from '../modules/terrain/document.js';
import {renderTerrainPng} from '../modules/terrain/preview.js';
import type {GlobalLighting} from '../modules/lighting/types.js';

const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
function light(parameters:Record<string,number>={},operatorHDR=3):GlobalLighting{const base=resolveGlobalLighting([]);return {...base,ambient:[1,1,1],directional:base.directional.map(entry=>({...entry,color:[0,0,0],specular:[0,0,0]})),operatorHDR,parameters};}

test('native tone controls select effective ColorizationContrast, retain explicit zero, and label missing effective scalar1 as compatibility',()=>{
 const tone=createGlobalToneMath(),input=light({HDRExposure:2,ColorizationContrast:2,HDRWhitePoint:3,HDRContrast:99,HDRGain:15,HDRScale:20});
 assert.deepEqual(tone.controls(input),{operator:3,exposure:2,contrast:2,whitePoint:3,whiteShift:true,compatibilityFallback:false});
 assert.deepEqual(tone.controls(light({HDRExposure:0,ColorizationContrast:0,HDRWhitePoint:0,HDRContrast:99},0)),{operator:0,exposure:0,contrast:0,whitePoint:0,whiteShift:true,compatibilityFallback:false});
 assert.deepEqual(tone.controls({parameters:{HDRContrast:99}}),{operator:0,exposure:1,contrast:1,whitePoint:1,whiteShift:true,compatibilityFallback:true});
 assert.deepEqual(tone.controls({parameters:{hdrExposure:.5,colorizationContrast:0,hdrWhitePoint:4,OperatorHDR:2}}),{operator:2,exposure:.5,contrast:0,whitePoint:4,whiteShift:true,compatibilityFallback:false});
 assert.equal(input.parameters!.HDRContrast,99);assert.equal(input.parameters!.ColorizationContrast,2);
});

test('the resolved contrast drives independent numeric oracles for operators0 through3 while Filmic4 ignores it and Gain/Scale stay unused',()=>{
 const tone=createGlobalToneMath(),expected=[.11265432098765432,.11750309741540454,.05518290887673615,.0625,.30972942758995003];
 // Independent evaluation of pstonemap.fx at luminance.25, exposure2, contrast2, whitePoint3.
 for(let operator=0;operator<5;operator++){
  const c=tone.controls(light({HDRExposure:2,ColorizationContrast:2,HDRWhitePoint:3,HDRContrast:99,HDRGain:99,HDRScale:0},operator));
  close(tone.tonemap(.25,c.operator,c.exposure,c.contrast,c.whitePoint),expected[operator]);
 }
 const c=tone.controls(light({HDRExposure:20,ColorizationContrast:0,HDRWhitePoint:3,HDRContrast:2}));assert.equal(tone.tonemap(.25,c.operator,c.exposure,c.contrast,c.whitePoint),1);
 const zeroContrast=[.8148148148148149,.8646647167633873,.6309297535714574,1,.30972942758995003];
 for(let operator=0;operator<5;operator++){const c=tone.controls(light({HDRExposure:2,ColorizationContrast:0,HDRWhitePoint:3},operator));close(tone.tonemap(.25,c.operator,c.exposure,c.contrast,c.whitePoint),zeroContrast[operator]);}
});

function transition(){
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="first" colorizationContrast="3" hdrExposure="3" hdrWhitePoint="4" hdrContrast="200"/><CCutsceneNodeEnvironmentLight guid="second" colorizationContrast="0" hdrExposure="1" hdrWhitePoint="2" hdrContrast="100"/><CCutsceneElementActiveLight lightGUID="first" start="0" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="second" start="500" blendTime="1000"/><CCutsceneNodeTargetCamera guid="camera"/></CutsceneState>','tone-control-interruption');
 scene.lighting=light({ColorizationContrast:1,HDRExposure:1,HDRWhitePoint:2,HDRContrast:99});return {scene,environment:createEnvironmentKernel(createPreviewKernel())};
}
test('active and interrupted EnvironmentLight transitions supply the sampled effective contrast, exposure and whitePoint without changing authored controls',()=>{
 const {scene,environment}=transition(),tone=createGlobalToneMath();
 for(const [time,contrast,exposure,whitePoint]of [[-1,1,1,2],[0,1,1,2],[500,2,2,3],[750,1.5,1.75,2.75],[1000,1,1.5,2.5],[1500,0,1,2]]){
  const c=tone.controls(environment.lighting(scene,time));assert.deepEqual(c,{operator:3,exposure,contrast,whitePoint,whiteShift:true,compatibilityFallback:false});
  close(tone.tonemap(.25,c.operator,c.exposure,c.contrast,c.whitePoint),.25**contrast);
 }
 assert.equal(scene.environmentLights![1].values.colorizationContrast,0);assert.equal(scene.environmentLights![0].values.hdrContrast,200);assert.equal(scene.lighting!.parameters!.ColorizationContrast,1);
 const animated=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="animated" colorizationContrast="1"><CCutsceneNodePropertyValue propertyName="colorizationContrast"><CCutsceneElementPropertyCurve time="0" value="1"/><CCutsceneElementPropertyCurve time="500" value="3"/></CCutsceneNodePropertyValue></CCutsceneNodeEnvironmentLight><CCutsceneElementActiveLight lightGUID="animated" start="0" blendTime="1000"/></CutsceneState>','animated-tone-control');animated.lighting=scene.lighting;
 assert.equal(tone.controls(environment.lighting(animated,250)).contrast,1.25);assert.equal(tone.controls(environment.lighting(animated,500)).contrast,2);
});

test('the serialized standalone tone factory keeps control resolution and color outputs identical after packed JSON transport',()=>{
 const tone=createGlobalToneMath(),browser=vm.runInNewContext('('+createGlobalToneMath.toString()+')()') as ReturnType<typeof createGlobalToneMath>,{scene,environment}=transition();
 for(const source of [light({HDRExposure:0,ColorizationContrast:0,HDRWhitePoint:0,HDRContrast:99},3),light(),environment.lighting(scene,750),environment.lighting(scene,1500)]){
  const packed=JSON.parse(JSON.stringify(source)) as GlobalLighting,c=browser.controls(packed);assert.deepEqual(JSON.parse(JSON.stringify(c)),tone.controls(source));
  const actual=browser.color([.1,.25,.5],c.operator,c.exposure,c.contrast,c.whitePoint),native=tone.controls(source),expected=tone.color([.1,.25,.5],native.operator,native.exposure,native.contrast,native.whitePoint);actual.forEach((v,i)=>close(v,expected[i]));
 }
});

function recordingGL(){
 const uniforms:Record<string,number|number[]>={},draws:number[]=[];let stage=-1;
 const write=(location:{name:string},values:Float32Array)=>{uniforms[location.name]=Array.from(values);};
 const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,FRAMEBUFFER_COMPLETE:3,getExtension:()=>null,checkFramebufferStatus:()=>3,getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_program:unknown,name:string)=>({name}),uniform2fv:write,uniform4fv:write,uniform1i:(location:{name:string},value:number)=>{uniforms[location.name]=value;if(location.name==='stage')stage=value;},drawArrays:()=>draws.push(stage)} as Record<string,unknown>,{get:(object,key:string)=>key in object?object[key]:(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;
 return {gl,uniforms,draws};
}
test('recording WebGL uploads native contrast and identity exposure/whitePoint for active fades, preserving zero and existing bloom/grading controls',()=>{
 const {scene,environment}=transition(),{gl,uniforms,draws}=recordingGL(),post=createPostprocess(gl);post.begin(16,16);
 for(const [time,contrast,exposure,whitePoint]of [[0,1,1,2],[500,2,2,3],[750,1.5,1.75,2.75],[1500,0,1,2]]){
  draws.length=0;assert.deepEqual(post.finish(environment.lighting(scene,time),scene.cameras[0]),{passes:3,floatColor:false,colorization:{enabled:false,diagnostic:'COLORIZATION_SOURCE_UNKNOWN'}});
  assert.deepEqual(uniforms.hdr,[exposure,1.5,Math.fround(.15),whitePoint]);assert.deepEqual(uniforms.toneControls,[contrast,1]);assert.equal(uniforms.toneOperator,3);assert.deepEqual(draws,[1,2,0]);
  assert.equal(uniforms.colorMapEnabled,0);assert.equal(uniforms.grading,undefined);
 }
 post.finish(light({HDRExposure:0,ColorizationContrast:0,HDRWhitePoint:0,HDRWhiteShift:1,HDRBloomThreshold:.4,HDRBloomMultiplier:2,HDRContrast:99},0),scene.cameras[0]);
 assert.deepEqual(uniforms.hdr,[0,Math.fround(.4),2,0]);assert.deepEqual(uniforms.toneControls,[0,1]);assert.equal(uniforms.toneOperator,0);post.dispose();
});

function flatTerrain(){
 const descriptor=new TerrainDescriptor('<terrain version="1"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"><vertData name="t3HeightMap" quantizeBias="0" quantizeScale="1"/></heightMap></terrain>'),bytes=Buffer.alloc(32+4*6);bytes.write('HMAP');bytes.writeUInt32LE(101,4);bytes.writeUInt32LE(2,8);bytes.writeUInt32LE(2,12);for(let i=0;i<4;i++)bytes.writeUInt16LE(1,32+i*6+4);
 return {sources:new Map<string,Buffer>(),descriptor,heights:new HeightMap(bytes,descriptor)};
}
function pngPixels(png:Buffer){const data:Buffer[]=[];for(let off=8;off<png.length;){const size=png.readUInt32BE(off);if(png.toString('ascii',off+4,off+8)==='IDAT')data.push(png.subarray(off+8,off+8+size));off+=size+12;}return inflateSync(Buffer.concat(data));}
test('actual terrain PNG pixels use shared native contrast instead of synthetic HDRContrast, including explicit zero and transported controls',()=>{
 const state=flatTerrain();
 // Flat terrain baseRGB=[131,145,155]; native luminance=.5400980392156862.
 // Linear contrast2 multiplies baseRGB by luminance, giving rounded [71,78,84].
 for(const [contrast,expected]of [[2,[71,78,84]],[1,[131,145,155]],[0,[243,255,255]]] as const){
  const source=light({HDRExposure:20,ColorizationContrast:contrast,HDRWhitePoint:3,HDRContrast:99,HDRGain:0,HDRScale:99}),packed=JSON.parse(JSON.stringify(source)) as GlobalLighting,raw=pngPixels(renderTerrainPng(state,'lit',16,packed));
  for(let y=0;y<16;y++){assert.equal(raw[y*49],0);for(let x=0;x<16;x++)assert.deepEqual([...raw.subarray(y*49+1+x*3,y*49+4+x*3)],expected);}
 }
 const unlit=pngPixels(renderTerrainPng(state,'height',16,light({ColorizationContrast:0})));assert.deepEqual([...unlit.subarray(1,4)],[131,145,155]);
});
