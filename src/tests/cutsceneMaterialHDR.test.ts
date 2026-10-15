import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createGlobalLightingKernel} from '../modules/lighting/math.js';
import {resolveGlobalLighting} from '../modules/lighting/catalog.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {createGpuRenderer} from '../modules/cutscenePreview/gpu.js';
import {createEffectFrames} from '../modules/cutscenePreview/effectFrames.js';
import {rasterMaterials} from '../modules/cutscenePreview/materialRaster.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {PreviewMesh,StandardMaterial} from '../modules/cutscenePreview/types.js';

const close=(actual:number[],expected:number[])=>{assert.equal(actual.length,expected.length);actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-10,`${actual} != ${expected}`));};
const layer=(slot:string,color:number[])=>({slot,texturePath:null,constantColor:{value:color},uvSource:0,channels:1,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:false,wrapY:false});
const standard=():StandardMaterial=>({sourceFlags:0,sourceAdditionalFlags:0,materialClass:0,layers:{diffuse:layer('diffuse',[0,0,0,1]),specular:layer('specular',[1,1,1,1]),emissive1:layer('emissive1',[.1,.2,.3,1])},blendMode:0,priority:0,specularity:4,specMode:0,specMult:.5,emisMult:3,alphaTestThreshold:0,twoSided:true,unshaded:false,doubleLambert:false,clampOutput:false,usesVertexColor:false,usesVertexAlpha:false});
function lighting(spec=2,emis=2){return resolveGlobalLighting([`<Catalog><CLight id="Native"><ToDInfoArray AmbientColor="0,0,0"><Param index="HDRSpecMultiplier" value="${spec}"/><Param index="HDREmisMultiplier" value="${emis}"/><Param index="HDRDiffuseMultiplier" value="99"/><DirectionalLight index="Key" ColorMultiplier="0"/></ToDInfoArray></CLight></Catalog>`],'Native');}

test('native authored Light distance defaults are1 while explicit values, aliases and raw zero presence survive existing guards',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeLight guid="missing"/><CCutsceneNodeLight guid="zero" attenuationStart="0" range="0"/><CCutsceneNodeLight guid="explicit" attenuationStart="2" range="7"/><CCutsceneNodeLight guid="alias" attenuationFar="3"/></CutsceneState>','light-distance-defaults');
 assert.deepEqual(scene.lights!.map(light=>[light.near,light.range]),[[1,1],[0,.001],[2,7],[1,3]]);
 assert.equal(Object.hasOwn(scene.sourceObjects!.find(object=>object.id==='missing')!.attrs,'attenuationStart'),false);assert.equal(Object.hasOwn(scene.sourceObjects!.find(object=>object.id==='missing')!.attrs,'range'),false);
 assert.equal(scene.sourceObjects!.find(object=>object.id==='zero')!.attrs.range,'0');assert.equal(scene.sourceObjects!.find(object=>object.id==='zero')!.attrs.attenuationStart,'0');
});

test('ordinary retained native material metadata selects scene HDR factors, preserving zero and labelling unknown effective defaults as compatibility',()=>{
 const k=createGlobalLightingKernel(),m=standard(),ordinary=k.materialHDR(lighting(),m);assert.equal(ordinary.route,'ordinary');close([ordinary.localSpecular,ordinary.emissive],[2,2]);assert.equal(ordinary.compatibilityFallback,false);
 const zero=k.materialHDR(lighting(0,0),m);close([zero.localSpecular,zero.emissive],[0,0]);
 const unknown=k.materialHDR(resolveGlobalLighting([]),m);close([unknown.localSpecular,unknown.emissive],[1,1]);assert.equal(unknown.compatibilityFallback,true);
 const alias=k.materialHDR({...lighting(),parameters:{hdrSpecMultiplier:4,hdrEmisMultiplier:.5}},m);close([alias.localSpecular,alias.emissive],[4,.5]);
 for(const [material,special,route]of [[{...m,unshaded:true},false,'unshaded'],[{...m,sourceFlags:0x200},false,'alternate-terrain-hdr'],[{...m,sourceFlags:undefined},false,'source-metadata-missing'],[{...m,materialClass:1},false,'unsupported-family'],[{...m,lightingModel:'pbr-metallic-roughness' as const},false,'unsupported-family'],[m,true,'effect']] as const){const result=k.materialHDR(lighting(),material,special);assert.equal(result.route,route);close([result.localSpecular,result.emissive],[1,1]);}
});

test('material HDR routing and explicit zero factors serialize identically without native schema default1 claims',()=>{
 const k=createGlobalLightingKernel(),browser=vm.runInNewContext('('+createGlobalLightingKernel.toString()+')()') as ReturnType<typeof createGlobalLightingKernel>;
 for(const light of [lighting(),lighting(0,0),resolveGlobalLighting([])])for(const material of [standard(),{...standard(),sourceFlags:0x200},{...standard(),sourceFlags:undefined}])assert.deepEqual(JSON.parse(JSON.stringify(browser.materialHDR(light,material))),k.materialHDR(light,material));
});

test('actual vendor CPU material pixels apply active emissive HDR to the sampled material multiplier once without mutating source data',async()=>{
 const scene=parsePreviewScene('<CutsceneState/>','hdr-emissive-pixels'),m=standard();scene.lighting=lighting();const raster=await rasterMaterials(scene),prepared=raster.prepare(m,0,0,[1,1,1]);
 assert.equal(prepared.pass.uniforms.u_emisMult,6);close(prepared.shade([],[0,0,1],[0,0,0],[1,1,1,1],[0,0,5]),[.6,1.2,1.8,1]);
 const sampled=raster.prepare(m,0,0,[1,1,1],{propertyValues:{emisMult:4}});assert.equal(sampled.pass.uniforms.u_emisMult,8);close(sampled.shade([],[0,0,1],[0,0,0],[1,1,1,1],[0,0,5]),[.8,1.6,2.4,1]);
 // MAT_.hdr_emis is static, while actual vendor layer channels still animate before the multiplier.
 const animated=structuredClone(m);Object.assign(animated.layers.emissive1.constantColor!,{sequenceTracks:[{sequenceIndex:0,track:{lineType:1,globalSeqId:null,keys:[{frame:0,vector:[.1,.2,.3,1]},{frame:1,vector:[.3,.4,.5,1]}]}}]});
 const afterAnimation=raster.prepare(animated,.5,0,[1,1,1],{propertyValues:{emisMult:[4]}});assert.equal(afterAnimation.pass.uniforms.u_emisMult,8);close(afterAnimation.shade([],[0,0,1],[0,0,0],[1,1,1,1],[0,0,5]),[1.6,2.4,3.2,1]);
 const passOverride=raster.prepare(animated,.5,0,[1,1,1],{propertyValues:{emisMult:[4]},passPropertyValues:[{emisMult:[0]}]});assert.equal(passOverride.pass.uniforms.u_emisMult,0);close(passOverride.shade([],[0,0,1],[0,0,0],[1,1,1,1],[0,0,5]),[0,0,0,1]);
 assert.equal(m.emisMult,3);assert.equal(m.specMult,.5);assert.equal(m.sourceFlags,0);
});

test('CPU emissive respects explicit scene zero while unshaded, alternate and metadata-missing routes retain material emission',async()=>{
 const scene=parsePreviewScene('<CutsceneState/>','hdr-emissive-gates');scene.lighting=lighting(0,0);const raster=await rasterMaterials(scene);
 const normal=raster.prepare(standard(),0,0,[1,1,1]);assert.equal(normal.pass.uniforms.u_emisMult,0);close(normal.shade([],[0,0,1],[0,0,0],[1,1,1,1],[0,0,5]),[0,0,0,1]);
 for(const m of [{...standard(),unshaded:true,sourceFlags:16},{...standard(),sourceFlags:0x200},{...standard(),sourceFlags:undefined},{...standard(),materialClass:1}]){const prepared=raster.prepare(m,0,0,[1,1,1]);assert.equal(prepared.pass.uniforms.u_emisMult,3);close(prepared.shade([],[0,0,1],[0,0,0],[1,1,1,1],[0,0,5]),[.3,.6,.9,1]);}
});

function fixture(){
 const k=createPreviewKernel(),scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelPath="fixture.m3"/><CCutsceneNodeTargetCamera guid="camera" eyePositionX="0" eyePositionY="-10" eyePositionZ="3"/><CCutsceneNodeLight guid="local" type="1" attenuationStart="0" range="10" colorR="1" colorG=".5" colorB=".25" colorMultiplier="2" specularColorR=".2" specularColorG=".4" specularColorB=".8" specularColorMultiplier="3"/><CCutsceneNodeEnvironmentLight guid="first" hdrSpecMultiplier="3" hdrEmisMultiplier="5"/><CCutsceneNodeEnvironmentLight guid="second" hdrSpecMultiplier="0" hdrEmisMultiplier="0"/><CCutsceneElementActiveLight lightGUID="first" start="0" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="second" start="500" blendTime="1000"/></CutsceneState>','hdr-render-paths');
 scene.lighting=lighting(1,1);const ref=(value:number[])=>({id:0,interpolation:0,value}),m=standard(),mesh:PreviewMesh={positions:[0,0,0,1,0,0,0,0,1],normals:[0,-1,0,0,-1,0,0,-1,0],indices:[0,1,2],weights:[1,0,0,0,1,0,0,0,1,0,0,0],joints:[0,-1,-1,-1,0,-1,-1,-1,0,-1,-1,-1],bones:[{name:'Root',parent:-1,flags:7,position:ref([0,0,0]),rotation:ref([0,0,0,1]),scale:ref([1,1,1])}],inverseBind:[k.identity()],bounds:{min:[0,0,0],max:[1,0,1]},clips:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',issues:[],materials:[{name:'Native standard',standard:m}],batches:[{start:0,count:3,material:0}]};scene.models['fixture.m3']=mesh;return {k,scene,m,mesh};
}
function recordingGL(){
 let id=0,current:{id:number}|undefined;const values=new Map<number,Record<string,number|number[]>>(),draws:Array<{kind:string;uniforms:Record<string,number|number[]>}>=[],uploads:Array<{program:number;name:string}>=[];
 const write=(location:{program:{id:number};name:string},value:number|number[])=>{const record=values.get(location.program.id)??{};record[location.name]=value;values.set(location.program.id,record);uploads.push({program:location.program.id,name:location.name});};
 const draw=(kind:string)=>{if(current)draws.push({kind,uniforms:structuredClone(values.get(current.id)??{})});};
 const gl=new Proxy({VERTEX_SHADER:1,FRAGMENT_SHADER:2,ARRAY_BUFFER:3,FLOAT:4,TEXTURE_2D:17,TEXTURE0:100,MAX_TEXTURE_IMAGE_UNITS:16,MAX_FRAGMENT_UNIFORM_VECTORS:512,createProgram:()=>({id:++id}),useProgram:(program:{id:number})=>{current=program;},getUniformLocation:(program:{id:number},name:string)=>({program,name}),uniform1f:(location:Parameters<typeof write>[0],value:number)=>write(location,value),uniform4fv:(location:Parameters<typeof write>[0],value:Float32Array)=>write(location,Array.from(value)),drawElements:()=>draw('elements'),drawArrays:()=>draw('arrays')} as Record<string,unknown>,{get:(object,key:string)=>key in object?object[key]:(..._args:unknown[])=>{if(key==='getShaderParameter'||key==='getProgramParameter')return true;if(key==='getParameter')return 16;return {};}}) as unknown as WebGL2RenderingContext;
 return {gl,draws,uploads};
}

test('recording WebGL local specular and vendor CPU emissive follow active and interrupted HDR blends exactly once while local diffuse stays raw',async()=>{
 const materialLibrary=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),{k,scene,m}=fixture(),environment=createEnvironmentKernel(k),{gl,draws}=recordingGL(),renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,materialLibrary);await renderer.ready;
 for(const [time,spec,emis]of [[0,1,1],[500,2,3],[750,1.5,2.25],[1000,1,1.5],[1500,0,0]]){
  draws.length=0;renderer.draw(k.sample(scene,time,'director',undefined,false),320,200,'solid',undefined,false);const uniforms=draws.find(draw=>draw.kind==='elements')!.uniforms;
  close((uniforms['u_previewLocalSpecular[0]'] as number[]).slice(0,4),[.2*3*spec,.4*3*spec,.8*3*spec,0].map(Math.fround));close((uniforms['u_previewLocalColor[0]'] as number[]).slice(0,4),[2,1,.5,10]);assert.equal(uniforms.u_specMult,.5);assert.equal(uniforms.u_emisMult,3*emis);
  const raster=await rasterMaterials({...scene,lighting:environment.lighting(scene,time)}),prepared=raster.prepare(m,0,0,[1,1,1]);close(prepared.shade([],[0,0,1],[0,0,0],[1,1,1,1],[0,0,5]),[.1,.2,.3].map(value=>value*3*emis).concat(1));
 }
 assert.equal(scene.lights![0].specularIntensity,3);close(scene.lights![0].specular,[.2,.4,.8]);assert.equal(scene.environmentLights![0].values.hdrSpecMultiplier,3);
});

test('GPU alternate, unshaded and generated standards bypass ordinary HDR and report unsupported routes',async()=>{
 const materialLibrary=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href);
 for(const [change,unsupported]of [[{sourceFlags:0x200},1],[{unshaded:true,sourceFlags:16},0],[{sourceFlags:undefined},1],[{materialClass:1},1]] as const){const {k,scene,m}=fixture();Object.assign(m,change);const {gl,draws}=recordingGL(),renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,materialLibrary);await renderer.ready;const stats=renderer.draw(k.sample(scene,500,'director',undefined,false),320,200,'solid',undefined,false),uniforms=draws.find(draw=>draw.kind==='elements')!.uniforms;
  assert.equal(uniforms.u_emisMult,3);close((uniforms['u_previewLocalSpecular[0]'] as number[]).slice(0,4),[.6,1.2,2.4,0].map(Math.fround));assert.equal(stats.unsupportedHDRMaterials,unsupported);
 }
});

test('particle and ribbon special standard draws keep material HDR multipliers when ordinary geometry uses scene factors',async()=>{
 const materialLibrary=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),{k,scene,m}=fixture(),{gl,draws}=recordingGL();
 const effectFactory:typeof createEffectFrames=()=>({sample:()=>({particles:1,ribbons:1,clamped:false,dropped:0,batches:[0,1].map(()=>({positions:[0,0,0,1,0,0,0,0,1],uvs:[0,0,1,0,0,1],colors:Array(12).fill(1),texture:null,blend:0,standard:m,sequence:0,time:0,team:[1,1,1]}))})});
 const renderer=createGpuRenderer(gl,scene,k,effects,effectFactory,materialLibrary);await renderer.ready;const stats=renderer.draw(k.sample(scene,500,'director',undefined,false),320,200,'solid');
 assert.equal(stats.liveParticles,1);assert.equal(stats.liveRibbons,1);const geometry=draws.filter(draw=>draw.kind==='elements'),special=draws.filter(draw=>draw.kind==='arrays'&&draw.uniforms.u_emisMult!==undefined);assert.equal(geometry[0].uniforms.u_emisMult,9);assert.equal(special.length,2);
 for(const draw of special){assert.equal(draw.uniforms.u_emisMult,3);assert.equal(draw.uniforms.u_specMult,.5);close((draw.uniforms['u_previewLocalSpecular[0]'] as number[]).slice(0,4),[.6,1.2,2.4,0].map(Math.fround));}
});

test('shared shader programs reuse local specular uploads until their ordinary or alternate HDR factor changes',async()=>{
 const materialLibrary=await import(new URL('../../vendor/blizzard-models/browser/material-entry.js',import.meta.url).href),effects=await import(new URL('../../vendor/blizzard-models/browser/effects-sim.js',import.meta.url).href),{k,scene,m,mesh}=fixture(),{gl,draws,uploads}=recordingGL();
 const ordinary2={...m,sourceFlags:0},alternate={...m,sourceFlags:0x200};mesh.materials!.push({name:'second ordinary',standard:ordinary2},{name:'alternate terrain route',standard:alternate});mesh.batches=[{start:0,count:3,material:0},{start:0,count:3,material:0},{start:0,count:3,material:1},{start:0,count:3,material:2}];
 const renderer=createGpuRenderer(gl,scene,k,effects,createEffectFrames,materialLibrary);await renderer.ready;uploads.length=0;renderer.draw(k.sample(scene,500,'director',undefined,false),320,200,'solid',undefined,false);
 const specUploads=uploads.filter(upload=>upload.name==='u_previewLocalSpecular[0]');assert.equal(new Set(specUploads.map(upload=>upload.program)).size,1,'raw source route flags reuse the same shader code');assert.equal(specUploads.length,2,'three ordinary batches share one upload, then alternate route selects its raw factor');
 const geometry=draws.filter(draw=>draw.kind==='elements');assert.equal(geometry.length,4);assert.equal(geometry[0].uniforms.u_emisMult,9);assert.equal(geometry[2].uniforms.u_emisMult,9);assert.equal(geometry[3].uniforms.u_emisMult,3);
 close((geometry[0].uniforms['u_previewLocalSpecular[0]'] as number[]).slice(0,3),[1.2,2.4,4.8].map(Math.fround));close((geometry[3].uniforms['u_previewLocalSpecular[0]'] as number[]).slice(0,3),[.6,1.2,2.4].map(Math.fround));
});
