import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {inflateSync} from 'node:zlib';
import {createGlobalToneMath} from '../modules/lighting/tone.js';
import {resolveGlobalLighting} from '../modules/lighting/catalog.js';
import {createPostprocess} from '../modules/cutscenePreview/postprocess.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {HeightMap,TerrainDescriptor} from '../modules/terrain/document.js';
import {renderTerrainPng} from '../modules/terrain/preview.js';
import type {GlobalLighting} from '../modules/lighting/types.js';

const bright=[4,2,.5],close=(actual:number[],expected:number[])=>{assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-12,`${actual} != ${expected}`));};
function light(operatorHDR=1,synthetic=0):GlobalLighting{const base=resolveGlobalLighting([]);return {...base,operatorHDR,ambient:[1,1,1],directional:base.directional.map(d=>({...d,color:[0,0,0],specular:[0,0,0]})),parameters:{HDRExposure:.2,ColorizationContrast:1,HDRWhitePoint:2,HDRWhiteShift:synthetic}};}

test('normal HDR control resolution always enables native WhiteShift independently of catalog, synthetic fields, operator and Colorize/Blend',()=>{
 const tone=createGlobalToneMath();assert.equal(tone.controls(resolveGlobalLighting([])).whiteShift,true);
 for(let operator=0;operator<5;operator++)for(const synthetic of [0,1,-2])for(const colorize of [false,true]){
  const source=light(operator,synthetic);source.colorization={colorize,variations:[]};source.parameters!.ColorizationBlend=0;assert.equal(tone.controls(source).whiteShift,true);assert.equal(source.parameters!.HDRWhiteShift,synthetic);
 }
});

test('independent bright RGB oracles use native luminance and desaturation before each scalar tone operator while Reinhard0 remains unchanged',()=>{
 const tone=createGlobalToneMath();
 // L=2.4625; saturation ratio=(L-1.5)/L=.3908629441624365.
 // Shifted RGB=[3.399048223350254,2.180774111675127,1.2670685279187817].
 const expected=[[.6020100502512563,.30100502512562816,.07525125628140704],[.5368125609535656,.3444102168682091,.20010845880419176],[9.402892483920377,6.032743037575079,3.505130952816106],[3.3990482233502544,2.180774111675127,1.2670685279187817],[1.1586247835271704,.7433548355400571,.43190237454972213]];
 for(let operator=0;operator<5;operator++){const c=tone.controls(light(operator,0));close(tone.color(bright,c.operator,c.exposure,c.contrast,c.whitePoint,c.whiteShift),expected[operator]);}
 assert.notDeepEqual(tone.color(bright,1,.2,1,2,true),tone.color(bright,1,.2,1,2,false));
 // The low-level numerical helper retains its explicit false default.
 close(tone.color(bright,1,.2,1,2),tone.color(bright,1,.2,1,2,false));
});

test('native WhiteShift leaves dark pixels, the exact threshold, black and every Reinhard pixel unchanged',()=>{
 const tone=createGlobalToneMath();
 for(let operator=0;operator<5;operator++)for(const rgb of [[0,0,0],[.1,.25,.5],[0,3,0]])close(tone.color(rgb,operator,.2,1,2,true),tone.color(rgb,operator,.2,1,2,false));
 for(const rgb of [bright,[100,.01,.01],[4,4,4]])close(tone.color(rgb,0,.2,1,2,true),tone.color(rgb,0,.2,1,2,false));
});

test('sampled and interrupted EnvironmentLight transitions cannot toggle the normal native WhiteShift flag using synthetic authored values',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="a" hdrWhiteShift="0" hdrExposure=".4"/><CCutsceneNodeEnvironmentLight guid="b" hdrWhiteShift="1" hdrExposure=".2"/><CCutsceneElementActiveLight lightGUID="a" start="0" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="b" start="500" blendTime="1000"/></CutsceneState>','white-shift-transition');scene.lighting=light();const environment=createEnvironmentKernel(createPreviewKernel()),tone=createGlobalToneMath();
 for(const [time,exposure]of [[0,.2],[500,.3],[750,.275],[1000,.25],[1500,.2]]){const c=tone.controls(environment.lighting(scene,time));assert.equal(c.whiteShift,true);close([c.exposure],[exposure]);}
 assert.equal(scene.environmentLights![0].values.hdrWhiteShift,0);assert.equal(scene.sourceObjects!.find(object=>object.id==='a')!.attrs.hdrWhiteShift,'0');
});

test('standalone browser tone factory preserves the native flag and bright RGB outputs after JSON control transport',()=>{
 const tone=createGlobalToneMath(),browser=vm.runInNewContext('('+createGlobalToneMath.toString()+')()') as ReturnType<typeof createGlobalToneMath>;
 for(let operator=0;operator<5;operator++){const source=JSON.parse(JSON.stringify(light(operator,0))) as GlobalLighting,c=browser.controls(source),local=tone.controls(source);assert.equal(c.whiteShift,true);assert.deepEqual(JSON.parse(JSON.stringify(c)),local);close([...browser.color(bright,c.operator,c.exposure,c.contrast,c.whitePoint,c.whiteShift)],tone.color(bright,local.operator,local.exposure,local.contrast,local.whitePoint,local.whiteShift));}
});

function recordingGL(){const uniforms:Record<string,number|number[]>={},shaders:string[]=[];const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,FRAMEBUFFER_COMPLETE:3,TEXTURE0:100,getExtension:()=>null,checkFramebufferStatus:()=>3,getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_p:unknown,name:string)=>({name}),shaderSource:(_s:unknown,source:string)=>shaders.push(source),uniform1i:(l:{name:string},v:number)=>{uniforms[l.name]=v;},uniform2fv:(l:{name:string},v:Float32Array)=>{uniforms[l.name]=[...v];},uniform4fv:(l:{name:string},v:Float32Array)=>{uniforms[l.name]=[...v];}} as Record<string,unknown>,{get:(o,k:string)=>k in o?o[k]:(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;return {gl,uniforms,shaders};}
test('recording WebGL binds WhiteShift1 even for synthetic0 or missing catalog and preserves operator0 shader exclusion before LUT',()=>{
 const {gl,uniforms,shaders}=recordingGL(),post=createPostprocess(gl),camera=parsePreviewScene('<CutsceneState><CCutsceneNodeTargetCamera guid="camera"/></CutsceneState>','white-shift-uniforms').cameras[0];post.begin(16,16);
 for(const source of [light(0,0),light(1,0),light(4,0),resolveGlobalLighting([])]){post.finish(source,camera);assert.deepEqual(uniforms.toneControls,[source.parameters?.ColorizationContrast??1,1]);assert.equal(uniforms.toneOperator,source.operatorHDR??0);}
 const fragment=shaders.find(shader=>shader.includes('previewColorMap'))!;assert.ok(fragment.includes('toneControls.y>0.&&toneOperator!=0'));assert.ok(fragment.indexOf('mix(c,vec3(luma)')<fragment.indexOf('c=globalTone(luma'));assert.ok(fragment.indexOf('c=globalTone(luma')<fragment.indexOf('c=previewColorMap(c)'));post.dispose();
});

function flatTerrain(){const descriptor=new TerrainDescriptor('<terrain version="1"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"><vertData name="t3HeightMap" quantizeBias="0" quantizeScale="1"/></heightMap></terrain>'),bytes=Buffer.alloc(56);bytes.write('HMAP');bytes.writeUInt32LE(101,4);bytes.writeUInt32LE(2,8);bytes.writeUInt32LE(2,12);for(let i=0;i<4;i++)bytes.writeUInt16LE(1,36+i*6);return {sources:new Map<string,Buffer>(),descriptor,heights:new HeightMap(bytes,descriptor)};}
function pixels(png:Buffer){const parts:Buffer[]=[];for(let off=8;off<png.length;){const size=png.readUInt32BE(off);if(png.toString('ascii',off+4,off+8)==='IDAT')parts.push(png.subarray(off+8,off+8+size));off+=size+12;}return inflateSync(Buffer.concat(parts));}
test('actual terrain PNG bright pixels apply native WhiteShift despite synthetic0, with an independent numerical pixel oracle',()=>{
 const terrain=flatTerrain(),source=light(1,0);source.ambient=[10,2,.5];
 // BaseRGB131/145/155; litRGB[5.13725490196,1.13725490196,.30392156863].
 // L=2.4046568627450977, ratio=.3762103761084496. Exp exposure.2 gives166/65/44.
 // The old synthetic0 binding instead produced208/46/12.
 for(const synthetic of [0,1]){source.parameters!.HDRWhiteShift=synthetic;const raw=pixels(renderTerrainPng(terrain,'lit',16,JSON.parse(JSON.stringify(source))));for(let y=0;y<16;y++)for(let x=0;x<16;x++)assert.deepEqual([...raw.subarray(y*49+1+x*3,y*49+4+x*3)],[166,65,44]);}
 source.parameters!.HDRWhiteShift=0;source.ambient=[1,1,1];assert.deepEqual([...pixels(renderTerrainPng(terrain,'height',16,source)).subarray(1,4)],[131,145,155]);
});
