import test from 'node:test';import assert from 'node:assert/strict';import {environmentIrradiance} from '../modules/cutscenePreview/environmentMap.js';import {resolvePreviewLighting,createLightingKernel} from '../modules/cutscenePreview/lighting.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
function cube(){const b=Buffer.alloc(128+6*8);b.write('DDS ');b.writeUInt32LE(124,4);b.writeUInt32LE(4,12);b.writeUInt32LE(4,16);b.writeUInt32LE(1,28);b.writeUInt32LE(32,76);b.write('DXT1',84);b.writeUInt32LE(0xfe00,112);for(let i=0;i<6;i++)b.writeUInt16LE(0xffff,128+i*8);return b;}
test('Uniform native cube produces constant Lambert ambient in every direction',()=>{const sh=environmentIrradiance(cube()),k=createLightingKernel();for(const normal of [[1,0,0],[-1,0,0],[0,1,0],[0,0,-1],[1,1,1]])for(const value of k.irradiance(sh,normal))assert.ok(Math.abs(value-1)<.00002,String(value));});
test('Cube +X illumination remains in world space and differs from opposite direction',()=>{const b=cube();for(let i=1;i<6;i++)b.writeUInt16LE(0,128+i*8);const sh=environmentIrradiance(b),k=createLightingKernel();assert.ok(k.irradiance(sh,[1,0,0])[0]>k.irradiance(sh,[-1,0,0])[0]+.3);});
test('Native bridge inherits environment path and preserves zero Ambient/Key and HDR operator',()=>{const light=resolvePreviewLighting(['<Catalog><CLight id="base"><AmbientEnvironmentMap value="Assets/a.dds"/><ToDInfoArray AmbientColor=".2,.2,.2" OperatorHDR="4"/></CLight><CLight id="bridge" parent="base"><ToDInfoArray AmbientColor="0,0,0"><DirectionalLight index="Key" ColorMultiplier="0" SpecColorMultiplier="0"/></ToDInfoArray></CLight></Catalog>'],'bridge');assert.equal(light.environmentMap,'Assets/a.dds');assert.deepEqual(light.ambient,[0,0,0]);assert.deepEqual(light.directional[0].color,[0,0,0]);assert.equal(light.operatorHDR,4);});

test('EnvironmentLight retains authored HDR/AO/colorization controls and blends their animated catalog aliases',()=>{
 const scene=parsePreviewScene(`<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" name="Authored" hdrExposure="1" hdrContrast="1.5" hdrWhitePoint="0" hdrBloomThreshold=".4" hdrBloomMultiplier="2" operatorHDR="4" ssaoOcclusionRadius="4" ssaoFullOcclusion=".8" ssaoDetailOcclusionRadius="8" colorizationBlend=".6" colorize="1"><CCutsceneNodePropertyValue propertyName="hdrExposure"><CCutsceneElementPropertyCurve time="0" value="1"/><CCutsceneElementPropertyCurve time="500" value="3"/></CCutsceneNodePropertyValue></CCutsceneNodeEnvironmentLight><CCutsceneElementActiveLight lightGUID="1" start="0" duration="1000" blendTime="1000"/></CutsceneState>`,'environment-transition');
 scene.lighting=resolvePreviewLighting(['<Catalog><CLight id="base"><AmbientEnvironmentMap value="Assets/sky.dds"/><ToDInfoArray OperatorHDR="1"><Param index="HDRExposure" value="1"/><Param index="AOOcclusionRadius" value="0"/><Param index="ColorizationBlend" value="0"/></ToDInfoArray></CLight></Catalog>'],'base');
 scene.lighting.environmentSH=[[1,2,3]];
 const environment=createEnvironmentKernel(createPreviewKernel()),quarter=environment.lighting(scene,250),half=environment.lighting(scene,500),end=environment.lighting(scene,1000);
 assert.equal(quarter.parameters?.HDRExposure,1.25);assert.equal(quarter.parameters?.hdrExposure,1.25);
 assert.equal(quarter.parameters?.AOOcclusionRadius,1);assert.equal(quarter.parameters?.ssaoOcclusionRadius,1);assert.equal(quarter.parameters?.ColorizationBlend,.15);
 assert.equal(quarter.operatorHDR,1);assert.equal(half.operatorHDR,4);assert.equal(half.parameters?.HDRExposure,2);
 assert.equal(end.parameters?.HDRExposure,3);assert.equal(end.parameters?.HDRContrast,1.5);assert.equal(end.parameters?.HDRWhitePoint,0);
 assert.equal(end.parameters?.HDRBloomMultiplier,2);assert.equal(end.parameters?.AOFullOcclusion,.8);assert.equal(end.parameters?.AODetailOcclusionRadius,8);assert.equal(end.parameters?.Colorize,1);
 assert.equal(end.environmentMap,'Assets/sky.dds');assert.deepEqual(end.environmentSH,[[1,2,3]]);assert.match(end.source??'',/EnvironmentLight 1/);
 assert.equal(scene.environmentLights?.[0].values.hdrExposure,1);assert.equal(scene.environmentLights?.[0].values.hdrWhitePoint,0);
});

test('An interrupted ActiveLight fade starts from the prior fade value and obeys environment node filters',()=>{
 const scene=parsePreviewScene(`<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" hdrExposure="5"/><CCutsceneNodeEnvironmentLight guid="2" hdrExposure="9"/><CCutsceneNodeEnvironmentLight guid="3" filter="Hidden" hdrExposure="100"/><CCutsceneElementActiveLight lightGUID="1" start="0" duration="1000" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="2" start="500" duration="1000" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="3" start="2000" duration="1000"/></CutsceneState>`,'environment-interruption');
 scene.lighting=resolvePreviewLighting(['<Catalog><CLight id="base"><ToDInfoArray><Param index="HDRExposure" value="1"/></ToDInfoArray></CLight></Catalog>'],'base');
 const environment=createEnvironmentKernel(createPreviewKernel());assert.equal(environment.lighting(scene,500).parameters?.HDRExposure,3);assert.equal(environment.lighting(scene,750).parameters?.HDRExposure,4.5);assert.equal(environment.lighting(scene,2000,{filters:['Visible']}).parameters?.HDRExposure,1);
});

test('Height fog follows the shipped integral and saturates instead of applying an extra exponential',()=>{
 const environment=createEnvironmentKernel(createPreviewKernel()),fog={color:[0,0,0],density:.02,falloff:.1,startHeight:3},eye=[0,0,2],point=[0,10,7],distance=Math.hypot(10,5);
 const expected=.02*distance*Math.exp(.1)*(1-Math.exp(-.5))/.5;
 assert.ok(Math.abs(environment.fogAmount(fog,point,eye)-expected)<1e-12);
 assert.equal(environment.fogAmount({...fog,density:1},[100,0,2],eye),1);
 // common.fx explicitly clears integration on an elevated ray with zero height slope.
 assert.equal(environment.fogAmount({...fog,falloff:0},point,eye),0);
 assert.equal(environment.fogAmount({...fog,falloff:0},[0,10,2],eye),.2);
});

test('Native Zerg10 packed environment RGB/direction vectors parse and retain raw string fields',()=>{
 const scene=parsePreviewScene(`<CutsceneState><CCutsceneNodeEnvironmentLight guid="80357805747730801620" ambientColor="0.066667,0.105882,0.141176" keyDiffuseColor="1.000000,1.000000,1.000000" keySpecularColor="1.000000,1.000000,1.000000" keyDirection="-0.020759,0.010382,-0.999731" hdrExposure="1.000000" hdrAmbientMultiplier="1" keyColorMultiplier="0" ambientEnvironmentMap="Assets/Textures/ZergSky.dds" colorize="false"/><CCutsceneElementActiveLight lightGUID="80357805747730801620" lightID="DefaultLight" start="0" duration="1000"/></CutsceneState>`,'Zerg10-environment');
 const node=scene.environmentLights![0],environment=createEnvironmentKernel(createPreviewKernel()),light=environment.lighting(scene,0);
 assert.equal(node.values.ambientColorRed,.066667);assert.equal(node.values.keyDirectionY,.010382);assert.equal(node.values.colorize,0);
 assert.equal(node.rawValues?.ambientColor,'0.066667,0.105882,0.141176');assert.equal(node.rawValues?.ambientEnvironmentMap,'Assets/Textures/ZergSky.dds');
 assert.deepEqual(light.ambient,[.066667,.105882,.141176]);assert.deepEqual(light.directional[0].color,[0,0,0]);assert.ok(light.directional[0].direction[2]>.999);
 assert.ok(scene.issues.some(i=>i.code==='ENVIRONMENT_VALUE_UNEVALUATED'&&i.detail.startsWith('ambientEnvironmentMap=')));
});

test('A native-sized HotS fog timeline retains sixty-five nodes while selecting one timed fog state',()=>{
 const source='<CutsceneState>'+Array.from({length:65},(_,i)=>`<CCutsceneNodeFog guid="${i}" fogDensity="${i/1000}"><CCutsceneElementObject start="${i*1000}" duration="1000"/></CCutsceneNodeFog>`).join('')+'</CutsceneState>',scene=parsePreviewScene(source,'HotS-fog-timeline'),environment=createEnvironmentKernel(createPreviewKernel());
 assert.equal(scene.fog?.length,65);assert.equal(environment.fog(scene,64000).density,.064);assert.equal(environment.fog(scene,65000).density,0);
});
