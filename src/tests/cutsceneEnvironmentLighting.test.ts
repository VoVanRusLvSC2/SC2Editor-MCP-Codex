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

test('EnvironmentLight explicitly overrides the environment multiplier with zero and preserves authored AmbientColor',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientEnvironmentMultiplier="0" ambientColor=".2,.3,.4"/><CCutsceneElementActiveLight lightGUID="1" start="0"/></CutsceneState>','environment-multiplier-zero');
 scene.lighting=resolvePreviewLighting(['<Catalog><CLight id="base"><ToDInfoArray AmbientColor=".1,.1,.1" AmbientEnvironmentMultiplier="2"/></CLight></Catalog>'],'base');
 const light=createEnvironmentKernel(createPreviewKernel()).lighting(scene,0);
 assert.equal(light.ambientEnvironmentMultiplier,0);assert.deepEqual(light.ambient,[.2,.3,.4]);
 assert.equal(scene.lighting.ambientEnvironmentMultiplier,2);assert.deepEqual(scene.lighting.ambient,[.1,.1,.1]);
});

test('EnvironmentLight samples multiplier curves without mutating the authored node value or AmbientColor',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientEnvironmentMultiplier=".25" ambientColor=".2,.3,.4"><CCutsceneNodePropertyValue propertyName="ambientEnvironmentMultiplier"><CCutsceneElementPropertyCurve time="0" value="0"/><CCutsceneElementPropertyCurve time="1000" value=".4"/></CCutsceneNodePropertyValue></CCutsceneNodeEnvironmentLight><CCutsceneElementActiveLight lightGUID="1" start="0"/></CutsceneState>','environment-multiplier-curve');
 const node=scene.environmentLights![0],environment=createEnvironmentKernel(createPreviewKernel());Object.freeze(node.values);Object.freeze(node.curves[0].keys);
 assert.equal(environment.lighting(scene,0).ambientEnvironmentMultiplier,0);
 assert.equal(environment.lighting(scene,250).ambientEnvironmentMultiplier,.1);
 assert.equal(environment.lighting(scene,1000).ambientEnvironmentMultiplier,.4);
 assert.deepEqual(environment.lighting(scene,250).ambient,[.2,.3,.4]);assert.equal(node.values.ambientEnvironmentMultiplier,.25);
});

test('ActiveLight linearly blends environment multipliers to an explicit zero at the authored time',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientEnvironmentMultiplier="0"/><CCutsceneElementActiveLight lightGUID="1" start="100" blendTime="1000"/></CutsceneState>','environment-multiplier-fade');
 scene.lighting=resolvePreviewLighting(['<Catalog><CLight id="base"><ToDInfoArray AmbientEnvironmentMultiplier="4"/></CLight></Catalog>'],'base');
 const environment=createEnvironmentKernel(createPreviewKernel());
 assert.deepEqual([0,100,350,600,1100].map(time=>environment.lighting(scene,time).ambientEnvironmentMultiplier),[4,4,3,2,0]);
});

test('Interrupted multiplier fades freeze the prior animated target at the next ActiveLight start',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientEnvironmentMultiplier="6"><CCutsceneNodePropertyValue propertyName="ambientEnvironmentMultiplier"><CCutsceneElementPropertyCurve time="0" value="6"/><CCutsceneElementPropertyCurve time="1000" value="10"/></CCutsceneNodePropertyValue></CCutsceneNodeEnvironmentLight><CCutsceneNodeEnvironmentLight guid="2" ambientEnvironmentMultiplier="0"/><CCutsceneElementActiveLight lightGUID="1" start="0" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="2" start="500" blendTime="1000"/></CutsceneState>','environment-multiplier-interruption');
 scene.lighting=resolvePreviewLighting(['<Catalog><CLight id="base"><ToDInfoArray AmbientEnvironmentMultiplier="2"/></CLight></Catalog>'],'base');
 const environment=createEnvironmentKernel(createPreviewKernel());
 assert.deepEqual([250,500,750,1000,1500].map(time=>environment.lighting(scene,time).ambientEnvironmentMultiplier),[3.25,5,3.75,2.5,0]);
 assert.equal(scene.environmentLights![0].values.ambientEnvironmentMultiplier,6);
});

test('Missing multiplier endpoints preserve inheritance or the sole authored value without inventing a default',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientColor=".2,.3,.4"/><CCutsceneElementActiveLight lightGUID="1" start="0" blendTime="1000"/></CutsceneState>','environment-multiplier-inheritance');
 scene.lighting=resolvePreviewLighting(['<Catalog><CLight id="base"><ToDInfoArray AmbientEnvironmentMultiplier=".025"/></CLight><CLight id="child" parent="base"/></Catalog>'],'child');
 const environment=createEnvironmentKernel(createPreviewKernel());assert.equal(environment.lighting(scene,500).ambientEnvironmentMultiplier,.025);
 scene.lighting=resolvePreviewLighting([]);assert.equal(environment.lighting(scene,500).ambientEnvironmentMultiplier,undefined);
 scene.environmentLights![0].values.ambientEnvironmentMultiplier=0;assert.equal(environment.lighting(scene,500).ambientEnvironmentMultiplier,0);
 const presets=parsePreviewScene('<CutsceneState><CCutsceneElementActiveLight lightID="known" start="0"/><CCutsceneElementActiveLight lightID="missing" start="1000" blendTime="1000"/></CutsceneState>','environment-multiplier-missing-preset');
 presets.lightPresets={'known#0':{...resolvePreviewLighting([]),ambientEnvironmentMultiplier:2},'missing#0':resolvePreviewLighting([])};
 assert.deepEqual([0,1000,1500,2000].map(time=>environment.lighting(presets,time).ambientEnvironmentMultiplier),[2,2,2,2]);
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
 assert.equal(node.environmentMap,'Assets/Textures/ZergSky.dds');
 assert.ok(!scene.issues.some(i=>i.code==='ENVIRONMENT_VALUE_UNEVALUATED'&&i.detail.startsWith('ambientEnvironmentMap=')));
});

test('A native-sized HotS fog timeline retains sixty-five nodes while selecting one timed fog state',()=>{
 const source='<CutsceneState>'+Array.from({length:65},(_,i)=>`<CCutsceneNodeFog guid="${i}" fogDensity="${i/1000}"><CCutsceneElementObject start="${i*1000}" duration="1000"/></CCutsceneNodeFog>`).join('')+'</CutsceneState>',scene=parsePreviewScene(source,'HotS-fog-timeline'),environment=createEnvironmentKernel(createPreviewKernel());
 assert.equal(scene.fog?.length,65);assert.equal(environment.fog(scene,64000).density,.064);assert.equal(environment.fog(scene,65000).density,0);
});

test('ActiveLight selects the authored environment cube rather than the base preset cube',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientEnvironmentMap="Assets/blue.dds" ambientColor="1,1,1"/><CCutsceneElementActiveLight lightGUID="1" start="0" blendTime="1000"/></CutsceneState>','environment-cube');
 const baseCube={size:1,faces:Array(6).fill(Buffer.from([255,0,0,255]).toString('base64')),sha256:'red'},nodeCube={size:1,faces:Array(6).fill(Buffer.from([0,0,255,255]).toString('base64')),sha256:'blue'};
 scene.lighting={...createLightingKernel().fallback,environmentMap:'Assets/red.dds',environmentCube:baseCube};scene.environmentLights![0].environmentCube=nodeCube;
 const environment=createEnvironmentKernel(createPreviewKernel());
 assert.equal(environment.lighting(scene,0).environmentCube,baseCube);
 assert.equal(environment.lighting(scene,499).environmentMap,'Assets/red.dds');
 assert.equal(environment.lighting(scene,500).environmentCube,nodeCube);
 assert.deepEqual(createLightingKernel().cube(environment.lighting(scene,1000),[1,0,0]),[0,0,1]);
 // An authored but unavailable map must not silently reuse another map's pixels.
 delete scene.environmentLights![0].environmentCube;
 assert.equal(environment.lighting(scene,1000).environmentCube,undefined);
 assert.equal(scene.lighting.environmentCube,baseCube);
});

test('late-bound ambient follows cube replacement and scalar fades without applying the node HDR factor to the scalar',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientEnvironmentMap="Assets/blue.dds" ambientEnvironmentMultiplier=".025" ambientColor=".2,.3,.4" hdrAmbientMultiplier="3"/><CCutsceneElementActiveLight lightGUID="1" start="0" blendTime="1000"/></CutsceneState>','environment-late-ambient');
 scene.lighting=resolvePreviewLighting(['<Catalog><CLight id="base"><AmbientEnvironmentMap value="Assets/white.dds"/><ToDInfoArray AmbientColor=".1,.2,.3"><Param index="HDRAmbientMultiplier" value="2"/></ToDInfoArray></CLight></Catalog>'],'base');
 const white={size:1,faces:Array(6).fill(Buffer.from([255,255,255,255]).toString('base64')),sha256:'white'},blue={size:1,faces:Array(6).fill(Buffer.from([0,0,255,255]).toString('base64')),sha256:'blue'};scene.lighting.environmentCube=white;scene.environmentLights![0].environmentCube=blue;
 const environment=createEnvironmentKernel(createPreviewKernel()),k=createLightingKernel(),half=environment.lighting(scene,500),end=environment.lighting(scene,1000);
 assert.equal(half.environmentCube,blue);k.ambientUniform(half).forEach(value=>assert.ok(Math.abs(value-.5125)<1e-12));k.ambientUniform(end).forEach(value=>assert.ok(Math.abs(value-.025)<1e-12));
 assert.deepEqual(k.cube(half,[1,0,0]),[0,0,1]);assert.equal(scene.lighting.ambientEnvironmentMultiplier,1);
 delete scene.environmentLights![0].environmentCube;const missing=environment.lighting(scene,1000);
 assert.equal(missing.environmentCube,undefined);k.ambientUniform(missing).forEach((value,i)=>assert.ok(Math.abs(value-[.6,.9,1.2][i])<1e-12));
 assert.equal(scene.environmentLights![0].values.hdrAmbientMultiplier,3);assert.equal(scene.environmentLights![0].values.ambientColorRed,.2);
});

test('legacy packed cube states blend the effective default1 continuously into zero and interrupted fades without mutating the source',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeEnvironmentLight guid="1" ambientEnvironmentMultiplier="0"/><CCutsceneNodeEnvironmentLight guid="2" ambientEnvironmentMultiplier=".8"/><CCutsceneElementActiveLight lightGUID="1" start="100" blendTime="1000"/><CCutsceneElementActiveLight lightGUID="2" start="600" blendTime="1000"/></CutsceneState>','legacy-cube-multiplier');
 scene.lighting={...createLightingKernel().fallback,ambient:[0,0,0],environmentCube:{size:1,faces:Array(6).fill(Buffer.from([255,255,255,255]).toString('base64')),sha256:'legacy-white'}};
 const environment=createEnvironmentKernel(createPreviewKernel()),k=createLightingKernel(),times=[99,100,350,600,850,1100,1600],expected=[1,1,.75,.5,.575,.65,.8];
 times.forEach((time,i)=>k.ambientUniform(environment.lighting(scene,time)).forEach(value=>assert.ok(Math.abs(value-expected[i])<1e-12,`${time}: ${value} != ${expected[i]}`)));
 assert.equal(scene.lighting.ambientEnvironmentMultiplier,undefined);assert.equal(scene.environmentLights![0].values.ambientEnvironmentMultiplier,0);
});
