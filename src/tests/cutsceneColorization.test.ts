import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {inflateSync} from 'node:zlib';
import {createGlobalColorizationMath} from '../modules/lighting/colorization.js';
import {createGlobalToneMath} from '../modules/lighting/tone.js';
import {resolveGlobalLighting} from '../modules/lighting/catalog.js';
import {createPostprocess} from '../modules/cutscenePreview/postprocess.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {previewPage} from '../modules/cutscenePreview/viewer.js';
import {HeightMap,TerrainDescriptor} from '../modules/terrain/document.js';
import {renderTerrainPng} from '../modules/terrain/preview.js';
import type {ColorVariation,GlobalLighting} from '../modules/lighting/types.js';

const neutral={ColorizationInputLow:0,ColorizationInputHigh:1,ColorizationInputGamma:1,ColorizationOutputLow:0,ColorizationOutputHigh:1,ColorizationBrightness:1,ColorizationContrast:1,ColorizationHue:0,ColorizationSaturation:0,ColorizationLightness:0,ColorizationBlend:0};
function light(parameters:Record<string,number>={},colorize=false,variations:ColorVariation[]=[]):GlobalLighting{const base=resolveGlobalLighting([]);return {...base,operatorHDR:3,ambient:[1,1,1],directional:base.directional.map(d=>({...d,color:[0,0,0],specular:[0,0,0]})),parameters:{...neutral,...parameters},colorization:{colorize,variations}};}
const close=(actual:number[],expected:number[],epsilon=3e-7)=>{assert.equal(actual.length,expected.length);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<epsilon,`${actual} != ${expected}`));};

test('native HSL additive hue/saturation and Colorize tint use different equations, including negative hue reflection and explicit Blend0',()=>{
 const math=createGlobalColorizationMath(),input=[.2,.4,.6];
 // The analytic oracle is double precision; the native float32 hue leaf differs by~3.6e-7.
 close(math.transform(input,math.controls(light({ColorizationHue:.1,ColorizationSaturation:.2})))!,[.176,.12,.68],5e-7);
 close(math.transform(input,math.controls(light({ColorizationHue:.1,ColorizationSaturation:.2,ColorizationBlend:.5},true)))!,[.34,.408,.46]);
 close(math.transform(input,math.controls(light({ColorizationHue:.1,ColorizationSaturation:.2,ColorizationBlend:0},true)))!,input);
 // Red H=0 shifted negative is reflected to positive.1, rather than wrapped to.9.
 close(math.transform([1,0,0],math.controls(light({ColorizationHue:-.1})))!,[1,.6,0]);
 const shifted=math.prepare(light({ColorizationHue:.1,ColorizationSaturation:.2,ColorizationBlend:0},false));assert.equal(shifted.enabled,true);assert.ok(shifted.lut);
});

test('native lightness input/output levels, piecewise gamma and contrast preserve zero instead of substituting neutral',()=>{
 const math=createGlobalColorizationMath();
 close(math.transform([.25,.25,.25],math.controls(light({ColorizationInputGamma:.5})))!,[.00048828125,.00048828125,.00048828125],1e-12);
 close(math.transform([.25,.25,.25],math.controls(light({ColorizationInputGamma:5.5})))!,[.5,.5,.5]);
 // (.4-.2)/(.8-.2)=1/3; output[.1,.7],brightness2 =>.6; contrast2=>.36.
 close(math.transform([.4,.4,.4],math.controls(light({ColorizationInputLow:.2,ColorizationInputHigh:.8,ColorizationOutputLow:.1,ColorizationOutputHigh:.7,ColorizationBrightness:2,ColorizationContrast:2})))!,[.36,.36,.36]);
 close(math.transform([.2,.4,.6],math.controls(light({ColorizationBrightness:0})))!,[0,0,0]);
 close(math.transform([.2,.4,.6],math.controls(light({ColorizationContrast:0})))!,[1,1,1]);
});

test('ordered native Variations retain repeated commands, source sensitivity0, saturation region bypass and fixed pre-tint lightness weights',()=>{
 const math=createGlobalColorizationMath(),entry=(command:number,sensitivity=1,region=0)=>({command,sensitivity,region}),apply=(rgb:number[],variations:ColorVariation[])=>math.transform(rgb,math.controls(light({},false,variations)))!;
 close(apply([.2,.4,.6],[entry(3)]),[.215,.3925,.585]);
 close(apply([.2,.4,.6],[entry(1,2,1),entry(4,1,1)]),[.23705,.408525,.56295]);
 close(apply([.1,.2,.3],[entry(6,1,1)]),[.1253125,.2225,.3196875]);
 close(apply([.1,.2,.3],[entry(8,1,2)]),[.105,.2,.295]);
 close(apply([.2,.4,.6],[entry(3,0)]),[.2,.4,.6]);
 assert.notDeepEqual(apply([.2,.4,.6],[entry(4,1,1),entry(1,2,1)]),apply([.2,.4,.6],[entry(1,2,1),entry(4,1,1)]));
 close(math.transform([.2,.2,.2],math.controls(light({ColorizationBlend:1,ColorizationLightness:.4},true,[entry(7)])))!,[.57,.57,.57]);
});

test('native region weights use exact float32 boundaries and the observed Midtone discontinuity',()=>{
 const math=createGlobalColorizationMath(),f=Math.fround;
 assert.equal(math.regionWeight(f(.3),0),1);assert.equal(math.regionWeight(.5,0),0);close([math.regionWeight(.4,0)],[.75]);
 assert.equal(math.regionWeight(f(.15)-1e-6,1),0);close([math.regionWeight(f(.15),1)],[1]);assert.ok(math.regionWeight(f(.35)-1e-6,1)<1e-8);assert.equal(math.regionWeight(f(.35),1),1);assert.equal(math.regionWeight(f(.65),1),1);assert.equal(math.regionWeight(f(.85),1),0);
 assert.equal(math.regionWeight(.5,2),0);close([math.regionWeight(.6,2)],[.25]);assert.equal(math.regionWeight(f(.7)+1e-6,2),1);
});

test('native16-cube generation uses byte coordinatesi16/255 and explicit RGBA channel order with upward half rounding',()=>{
 const math=createGlobalColorizationMath(),prepared=math.prepare(light()),lut=prepared.lut!;assert.equal(prepared.enabled,true);assert.equal(lut.size,16);assert.equal(lut.data.length,16384);
 for(const [r,g,b]of [[0,0,0],[3,7,11],[15,0,0],[0,15,0],[0,0,15],[15,15,15]]){const off=((b*16+g)*16+r)*4;assert.deepEqual([...lut.data.slice(off,off+4)],[r*16,g*16,b*16,255]);}
 assert.equal(math.quantize(.5),128);assert.equal(math.quantize(Math.fround(.5/255)),1);assert.equal(math.quantize(-1),0);assert.equal(math.quantize(2),255);
 close(math.sample(lut,[3/16,7/16,11/16]),[48/255,112/255,176/255]);close(math.sample(lut,[1,1,1]),[240/255,240/255,240/255]);close(math.sample(lut,[-1,0,0]),[0,0,0]);
 close(math.sample(lut,[.5/16,0,0]),[8/255,0,0]);assert.match(math.shader(),/clamp\(c\+vec3\(\.5\/16\.\)/);
});

test('catalog Colorize and ordered Variations retain false, entry defaults, inheritance and indexed partial overrides without modifying XML',()=>{
 const xml='<Catalog><SLightInfo><Param index="ColorizationBrightness" value="1"/></SLightInfo><CLight id="Base"><ToDInfoArray Colorize="1"><Variations Command="MoreRed" Sensitivity="2" Region="Highlight"/><Variations Command="MoreBlue" Sensitivity="3"/></ToDInfoArray></CLight><CLight id="Child" parent="Base"><ToDInfoArray><Colorize value="0"/><Variations index="0" Sensitivity="0"/><Variations Command="MoreYellow"/></ToDInfoArray></CLight><CLight id="Edited" parent="Child"><ToDInfoArray><Variations index="1" removed="1"/><Variations index="0" reset="1" Command="Darker" Sensitivity="1"/></ToDInfoArray></CLight><CLight id="DefaultLight"/></Catalog>';
 assert.deepEqual(resolveGlobalLighting([xml],'Child').colorization,{colorize:false,variations:[{command:3,sensitivity:0,region:2},{command:4,sensitivity:3,region:0},{command:1,sensitivity:0,region:0}]});
 assert.deepEqual(resolveGlobalLighting([xml],'Edited').colorization,{colorize:false,variations:[{command:7,sensitivity:1,region:0},{command:1,sensitivity:0,region:0}]});
 assert.deepEqual(resolveGlobalLighting([xml],'DefaultLight').colorization,{colorize:false,variations:[]});assert.deepEqual(resolveGlobalLighting([xml],'missing').colorization,{colorize:false,variations:[]});assert.equal(resolveGlobalLighting([]).colorization,undefined);assert.match(xml,/Sensitivity="0"/);
 const layered=resolveGlobalLighting([xml,'<Catalog><CLight id="Child"><ToDInfoArray><Variations index="1" Region="Midtone"/></ToDInfoArray></CLight></Catalog>'],'Child');assert.deepEqual(layered.colorization!.variations[1],{command:4,sensitivity:3,region:1});
});

test('known numeric EnvironmentLight transitions rebuild effective LUTs across interruption while unproved node Colorize remains authored only',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="a" colorize="1" colorizationHue=".2"/><CCutsceneNodeEnvironmentLight guid="b" colorize="1" colorizationHue="0"/><CCutsceneElementActiveLight lightGUID="a" start="0" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="b" start="500" blendTime="1000"/></CutsceneState>','colorization-transitions');scene.lighting=light();const environment=createEnvironmentKernel(createPreviewKernel()),math=createGlobalColorizationMath();
 for(const [time,hue]of [[0,0],[500,.1],[750,.075],[1000,.05],[1500,0]]){const effective=environment.lighting(scene,time),prepared=math.prepare(effective);assert.equal(prepared.enabled,true);close([prepared.controls.hue],[hue]);assert.equal(prepared.controls.colorize,false);assert.equal(effective.colorization,scene.lighting.colorization);}
 assert.equal(scene.environmentLights![0].values.colorize,1);assert.equal(scene.sourceObjects!.find(object=>object.id==='a')!.attrs.colorize,'1');
 const presets=parsePreviewScene('<CutsceneState><CCutsceneElementActiveLight lightID="Tint" lightIndex="0" start="0" blendTime="1000"/></CutsceneState>','discrete-colorization');presets.lighting=light();presets.lightPresets={'Tint#0':light({},true,[{command:4,sensitivity:1,region:2}])};assert.equal(environment.lighting(presets,499).colorization!.colorize,false);assert.equal(environment.lighting(presets,500).colorization!.colorize,true);assert.equal(environment.lighting(presets,1000).colorization!.variations[0].command,4);
});

test('colorization cache uses effective float32 controls/list, excludes tone-only controls and diagnoses unknown, nonfinite and budgeted states',()=>{
 const math=createGlobalColorizationMath(),source=light(),first=math.prepare(source);assert.equal(first.lut,math.prepare(structuredClone(source)).lut);assert.equal(first.lut,math.prepare({...source,parameters:{...source.parameters,HDRExposure:9}}).lut);
 assert.notEqual(first.lut,math.prepare(light({ColorizationBrightness:.5})).lut);assert.notEqual(first.lut,math.prepare(light({},true)).lut);
 assert.equal(math.prepare(resolveGlobalLighting([])).diagnostic,'COLORIZATION_SOURCE_UNKNOWN');assert.equal(math.prepare(light({ColorizationInputHigh:0})).diagnostic,'COLORIZATION_UNSUPPORTED_CONTROLS');assert.equal(math.prepare(light({ColorizationHue:Infinity})).enabled,false);
 assert.equal(math.prepare(light({},false,[{command:4,sensitivity:245,region:0}])).diagnostic,'COLORIZATION_PREVIEW_WORK_BUDGET');assert.equal(math.prepare(light({ColorizationInputGamma:20})).diagnostic,'COLORIZATION_NONFINITE_RESULT');
});

function recordingGL(){
 const uniforms:Record<string,number|number[]>={},uploads:unknown[][]=[],parameters:number[][]=[],shaders:string[]=[];
 const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,FRAMEBUFFER_COMPLETE:3,TEXTURE_3D:4,RGBA8:5,RGBA:6,UNSIGNED_BYTE:7,TEXTURE_MIN_FILTER:8,TEXTURE_MAG_FILTER:9,TEXTURE_WRAP_S:10,TEXTURE_WRAP_T:11,TEXTURE_WRAP_R:12,LINEAR:13,CLAMP_TO_EDGE:14,TEXTURE0:100,getExtension:()=>null,checkFramebufferStatus:()=>3,getShaderParameter:()=>true,getProgramParameter:()=>true,getUniformLocation:(_p:unknown,name:string)=>({name}),shaderSource:(_shader:unknown,source:string)=>shaders.push(source),uniform1i:(l:{name:string},v:number)=>{uniforms[l.name]=v;},uniform2fv:(l:{name:string},v:Float32Array)=>{uniforms[l.name]=[...v];},uniform4fv:(l:{name:string},v:Float32Array)=>{uniforms[l.name]=[...v];},texImage3D:(...args:unknown[])=>uploads.push(args.map(arg=>arg instanceof Uint8Array?new Uint8Array(arg):arg)),texParameteri:(...args:number[])=>parameters.push(args)} as Record<string,unknown>,{get:(o,k:string)=>k in o?o[k]:(..._args:unknown[])=>({})}) as unknown as WebGL2RenderingContext;return {gl,uniforms,uploads,parameters,shaders};
}
test('recording WebGL uploads real3D RGBA8 bytes once per effective key with linear/clamp preview sampler and native coordinate offset',()=>{
 const {gl,uniforms,uploads,parameters,shaders}=recordingGL(),post=createPostprocess(gl),camera=parsePreviewScene('<CutsceneState><CCutsceneNodeTargetCamera guid="camera"/></CutsceneState>','lut-upload').cameras[0],source=light({ColorizationHue:.1,ColorizationSaturation:.2});post.begin(16,16);
 assert.deepEqual(uploads[0].slice(0,9),[4,0,5,1,1,1,0,6,7]);assert.deepEqual([...(uploads[0][9] as Uint8Array)],[0,0,0,255]);assert.equal(post.finish(source,camera).colorization!.enabled,true);post.finish(structuredClone(source),camera);post.finish({...source,parameters:{...source.parameters,HDRExposure:9}},camera);assert.equal(uploads.length,2);assert.deepEqual(uploads[1].slice(0,9),[4,0,5,16,16,16,0,6,7]);assert.deepEqual(uploads[1][9],createGlobalColorizationMath().prepare(source).lut!.data);assert.equal(uniforms.colorMap,3);assert.equal(uniforms.colorMapEnabled,1);
 for(const param of [8,9])assert.ok(parameters.some(args=>args[0]===4&&args[1]===param&&args[2]===13));for(const param of [10,11,12])assert.ok(parameters.some(args=>args[0]===4&&args[1]===param&&args[2]===14));
 post.finish(light({ColorizationHue:.2}),camera);assert.equal(uploads.length,3);const unknown=post.finish(resolveGlobalLighting([]),camera);assert.equal(unknown.colorization!.diagnostic,'COLORIZATION_SOURCE_UNKNOWN');assert.equal(uniforms.colorMapEnabled,0);assert.equal(uploads.length,3);
 assert.ok(shaders.some(s=>s.includes('sampler3D colorMap')&&s.includes('clamp(c+vec3(.5/16.)')));assert.equal(shaders.some(s=>s.includes('hueRotate')),false);post.dispose();
});

test('standalone browser factory and generated player bootstrap transport the same LUT math and byte data without imports',()=>{
 const browser=vm.runInNewContext('('+createGlobalColorizationMath.toString()+')()') as ReturnType<typeof createGlobalColorizationMath>,math=createGlobalColorizationMath(),source=light({ColorizationHue:.1,ColorizationSaturation:.2,ColorizationBlend:.5},true,[{command:4,sensitivity:3,region:1}]),packed=JSON.parse(JSON.stringify(source)) as GlobalLighting,a=math.prepare(source),b=browser.prepare(packed);assert.deepEqual([...b.lut!.data],[...a.lut!.data]);close([...browser.sample(b.lut!,[.1,.2,.6])],math.sample(a.lut!,[.1,.2,.6]));
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeTargetCamera guid="c"/></CutsceneState>','lut-serialization'),page=previewPage(scene,scene.cameras[0],'director','solid');assert.ok(page.includes('function createGlobalColorizationMath'));assert.ok(page.includes('COLORIZATION_SOURCE_UNKNOWN'));
});

function flatTerrain(){const descriptor=new TerrainDescriptor('<terrain version="1"><heightMap dim="2 2" offset="0 0 0" scale="1 1 1"><vertData name="t3HeightMap" quantizeBias="0" quantizeScale="1"/></heightMap></terrain>'),bytes=Buffer.alloc(56);bytes.write('HMAP');bytes.writeUInt32LE(101,4);bytes.writeUInt32LE(2,8);bytes.writeUInt32LE(2,12);for(let i=0;i<4;i++)bytes.writeUInt16LE(1,36+i*6);return {sources:new Map<string,Buffer>(),descriptor,heights:new HeightMap(bytes,descriptor)};}
function pixels(png:Buffer){const parts:Buffer[]=[];for(let off=8;off<png.length;){const size=png.readUInt32BE(off);if(png.toString('ascii',off+4,off+8)==='IDAT')parts.push(png.subarray(off+8,off+8+size));off+=size+12;}return inflateSync(Buffer.concat(parts));}
test('actual terrain PNG samples the same quantized LUT after tone, including false/Blend0, Colorize and metadata-missing neutral compatibility',()=>{
 const terrain=flatTerrain(),math=createGlobalColorizationMath(),tone=createGlobalToneMath();
 for(const source of [light(),light({ColorizationHue:.1,ColorizationSaturation:.2}),light({ColorizationHue:.1,ColorizationSaturation:.2,ColorizationBlend:.5},true),light({},false,[{command:4,sensitivity:3,region:1}])]){const packed=JSON.parse(JSON.stringify(source)) as GlobalLighting,lut=math.prepare(packed).lut!,c=tone.controls(packed),expected=math.sample(lut,tone.color([131/255,145/255,155/255],c.operator,c.exposure,c.contrast,c.whitePoint)).map(v=>Math.round(v*255)),raw=pixels(renderTerrainPng(terrain,'lit',16,packed));for(let y=0;y<16;y++)for(let x=0;x<16;x++)assert.deepEqual([...raw.subarray(y*49+1+x*3,y*49+4+x*3)],expected);}
 const unknown=light({ColorizationHue:.5});delete unknown.colorization;assert.deepEqual([...pixels(renderTerrainPng(terrain,'lit',16,unknown)).subarray(1,4)],[131,145,155]);
 assert.deepEqual([...pixels(renderTerrainPng(terrain,'lit',16,light())).subarray(1,4)],[132,146,156]);
});
