import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {resolveGlobalLighting} from '../modules/lighting/catalog.js';
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LightingWorkspace } from "../modules/lighting/workspace.js";
import type { CascWorkspace } from "../modules/casc/workspace.js";
import {createGlobalLightingKernel} from '../modules/lighting/math.js';
import {decodeAmbientCube} from '../modules/lighting/cube.js';
import {createGlobalToneMath} from '../modules/lighting/tone.js';
const native='<Catalog><CLight id="Base"><AmbientEnvironmentMap value="Assets/sky.dds"/><ToDInfoArray AmbientColor=".2,.3,.4"><DirectionalLight index="Key" Color="1,.5,.25" Direction="0,0,-1" ColorMultiplier="2"/><DirectionalLight index="Fill" Color=".2,.4,.6" Direction="0,0,1"/></ToDInfoArray></CLight><CLight id="Scene" parent="Base"><ToDInfoArray><DirectionalLight index="Key" ColorMultiplier="0"/><Param index="HDRExposure" value="2"/></ToDInfoArray></CLight></Catalog>';

test("prepared lighting follows exact local content and ordered overlays while preserving fresh source guards", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lighting-preparation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = "Base.SC2Data/GameData/LightData.xml";
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  const xml =
    '<Catalog><CLight id="Scene"><ToDInfoArray AmbientColor=".2,.3,.4"/></CLight></Catalog>';
  await fs.writeFile(path.join(root, file), xml);
  const workspace = new Workspace(root),
    lights = new LightingWorkspace(workspace, {} as CascWorkspace),
    request = { packages: [], preset: "Scene" };
  const first = await lights.resolve(request);
  first.lighting.ambient[0] = 9;
  assert.deepEqual((await lights.resolve(request)).lighting.ambient, [0.2, 0.3, 0.4]);
  await fs.writeFile(path.join(root, file), xml.replace(".2,", ".8,"));
  assert.deepEqual((await lights.resolve(request)).lighting.ambient, [0.8, 0.3, 0.4]);
  const overlay = xml.replace(".2,", ".6,");
  assert.deepEqual(
    (await lights.resolve({ ...request, localTexts: [xml, overlay] })).lighting.ambient,
    [0.6, 0.3, 0.4],
  );
  assert.deepEqual(
    (await lights.resolve({ ...request, localTexts: [overlay, xml] })).lighting.ambient,
    [0.2, 0.3, 0.4],
  );
  const read = workspace.readRaw.bind(workspace);
  let reads = 0;
  workspace.readRaw = async (name) => {
    const value = await read(name);
    if (++reads === 1) await fs.writeFile(path.join(root, file), xml);
    return value;
  };
  await assert.rejects(lights.resolve(request), /LIGHTING_LOCAL_CATALOG_CHANGED|STALE_DEPENDENCY/);
});
const close=(actual:number[],expected:number[])=>actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-12,`${actual} != ${expected}`));
function knownCube(color=0xffff){const b=Buffer.alloc(128+48);b.write('DDS ');b.writeUInt32LE(124,4);b.writeUInt32LE(4,12);b.writeUInt32LE(4,16);b.writeUInt32LE(1,28);b.writeUInt32LE(32,76);b.write('DXT1',84);b.writeUInt32LE(0xfe00,112);for(let i=0;i<6;i++)b.writeUInt16LE(color,128+i*8);return decodeAmbientCube(b);}
test('shared global catalog retains native zero overrides and exact inherited asset path',()=>{const l=resolveGlobalLighting([native],'Scene');assert.equal(l.environmentMap,'Assets/sky.dds');assert.deepEqual(l.directional[0].color,[0,0,0]);assert.deepEqual(l.ambient,[.2,.3,.4]);assert.equal(l.parameters?.HDRExposure,2);});
test('ambient cube modulates the shader ambient input and a zero uniform remains zero',()=>{const l=resolveGlobalLighting([native],'Scene'),k=createGlobalLightingKernel();assert.deepEqual(k.diffuse(l,[0,0,1],[.5,.5,.5],1,[.5,.25,1]),[.05,.0375,.2]);assert.deepEqual(k.diffuse({...l,ambient:[0,0,0]},[0,0,1],[1,1,1],1,[1,1,1]),[0,0,0]);});

test('native environment multiplier is retained independently of ambient color, including inherited and explicit zero values',()=>{
 const xml='<Catalog><CLight id="Base"><ToDInfoArray AmbientColor="0,0,0" AmbientEnvironmentMultiplier="0.025"/></CLight><CLight id="Child" parent="Base"/><CLight id="Zero" parent="Base"><ToDInfoArray><AmbientEnvironmentMultiplier value="0"/></ToDInfoArray></CLight></Catalog>';
 assert.equal(resolveGlobalLighting([xml],'Child').ambientEnvironmentMultiplier,.025);
 assert.equal(resolveGlobalLighting([xml],'Zero').ambientEnvironmentMultiplier,0);
 assert.deepEqual(resolveGlobalLighting([xml],'Child').ambient,[0,0,0]);
});
test('the native environment multiplier default materializes for effective catalog presets and inheritance, while source-free fallback stays unknown',()=>{
 const xml='<Catalog><CLight id="DefaultLight"><ToDInfoArray AmbientColor=".2,.3,.4"/></CLight><CLight id="Child" parent="DefaultLight"/></Catalog>';
 assert.equal(resolveGlobalLighting([xml],'DefaultLight').ambientEnvironmentMultiplier,1);
 assert.equal(resolveGlobalLighting([xml],'Child').ambientEnvironmentMultiplier,1);
 const defaultPreset=resolveGlobalLighting([xml],'missing');assert.equal(defaultPreset.found,false);assert.equal(defaultPreset.preset,'DefaultLight');assert.equal(defaultPreset.ambientEnvironmentMultiplier,1);
 assert.equal(resolveGlobalLighting([]).ambientEnvironmentMultiplier,undefined);
});

test('Nova zero RGB with omitted native scalar uses default1 and real decoded cube texels instead of black ambient',()=>{
 // Source field excerpt from the installed Nova bridge preset; the decoded cube is a deterministic fixture.
 const xml='<Catalog><CLight id="SMX3_Cutscene_MP02_010_Bridge"><AmbientEnvironmentMap value="Assets/Textures/smx3_cutscene_mp02_010_bridge.dds"/><ToDInfoArray AmbientColor="0,0,0"><DirectionalLight index="Key" ColorMultiplier="0"/></ToDInfoArray></CLight></Catalog>',light=resolveGlobalLighting([xml],'SMX3_Cutscene_MP02_010_Bridge'),k=createGlobalLightingKernel();
 light.environmentCube=knownCube(0xf800);
 assert.deepEqual(k.ambientUniform(light),[1,1,1]);assert.deepEqual(k.diffuse(light,[1,0,0],[.5,.25,.75],1,k.cube(light,[1,0,0])),[.5,0,0]);
 assert.deepEqual(light.ambient,[0,0,0]);assert.equal(light.ambientEnvironmentMultiplier,1);
});

test('resolved cubes use the independent inherited scalar including .025 and explicit zero without multiplying authored RGB',()=>{
 const xml='<Catalog><CLight id="Base"><ToDInfoArray AmbientColor=".8,.6,.4" AmbientEnvironmentMultiplier=".025"><DirectionalLight index="Key" ColorMultiplier="0"/></ToDInfoArray></CLight><CLight id="Child" parent="Base"/><CLight id="Zero" parent="Base"><ToDInfoArray AmbientEnvironmentMultiplier="0"/></CLight></Catalog>',k=createGlobalLightingKernel();
 for(const [preset,scalar]of [['Child',.025],['Zero',0]] as const){const light=resolveGlobalLighting([xml],preset);light.environmentCube=knownCube();
  assert.deepEqual(k.ambientUniform(light),[scalar,scalar,scalar]);close(k.diffuse(light,[0,0,1],[.5,.25,.75],1,k.cube(light,[0,0,1])),[.5,.25,.75].map(value=>value*scalar));assert.deepEqual(light.ambient,[.8,.6,.4]);
 }
});

test('a named but missing or undecodable environment keeps the RGB fallback and existing HDR factor exactly once',()=>{
 const xml='<Catalog><CLight id="Base"><AmbientEnvironmentMap value="Assets/missing.dds"/><ToDInfoArray AmbientColor=".1,.2,.3" AmbientEnvironmentMultiplier=".025"><Param index="HDRAmbientMultiplier" value="2"/><DirectionalLight index="Key" ColorMultiplier="0"/></ToDInfoArray></CLight></Catalog>',light=resolveGlobalLighting([xml],'Base'),k=createGlobalLightingKernel();
 assert.throws(()=>decodeAmbientCube(Buffer.alloc(128)));assert.equal(light.environmentCube,undefined);
 close(k.ambientUniform(light),[.2,.4,.6]);close(k.diffuse(light,[0,0,1],[.5,.5,.5],1,k.cube(light,[0,0,1])),[.1,.2,.3]);
 light.environmentCube=knownCube();assert.deepEqual(k.ambientUniform(light),[.025,.025,.025]);close(k.diffuse(light,[0,0,1],[.5,.5,.5],1,k.cube(light,[0,0,1])),[.0125,.0125,.0125]);
 close(light.ambient,[.2,.4,.6]);assert.equal(light.ambientEnvironmentMultiplier,.025);
});

test('the serialized lighting factory selects the same late-bound RGB or scalar uniforms and cube shading as Node',()=>{
 const k=createGlobalLightingKernel(),browser=vm.runInNewContext('('+createGlobalLightingKernel.toString()+')()',{atob}),base=resolveGlobalLighting([native],'Base');
 for(const light of [base,{...base,environmentCube:knownCube(0xf800)},{...base,environmentCube:knownCube(),ambientEnvironmentMultiplier:0}]){
  assert.deepEqual([...browser.ambientUniform(light)],k.ambientUniform(light));
  close([...browser.diffuse(light,[0,0,1],[.2,.3,.4],.7,browser.cube(light,[0,0,1]))],k.diffuse(light,[0,0,1],[.2,.3,.4],.7,k.cube(light,[0,0,1])));
 }
});
test('shared native lighting factory is standalone in the browser and matches Node',()=>{const k=createGlobalLightingKernel(),browser=vm.runInNewContext('('+createGlobalLightingKernel.toString()+')()'),l=resolveGlobalLighting([native],'Base');assert.deepEqual([...browser.diffuse(l,[0,0,1],[.2,.3,.4],.7,[.8,.6,.4])],k.diffuse(l,[0,0,1],[.2,.3,.4],.7,[.8,.6,.4]));});
test('actual cube face texels survive decoding instead of being replaced with Lambert SH convolution',()=>{const b=Buffer.alloc(128+48);b.write('DDS ');b.writeUInt32LE(124,4);b.writeUInt32LE(4,12);b.writeUInt32LE(4,16);b.writeUInt32LE(1,28);b.writeUInt32LE(32,76);b.write('DXT1',84);b.writeUInt32LE(0xfe00,112);for(let i=0;i<6;i++)b.writeUInt16LE([0xf800,0x7e0,0x1f,0xffff,0xffe0,0xf81f][i],128+i*8);const image=decodeAmbientCube(b),l={...resolveGlobalLighting([]),environmentCube:image},k=createGlobalLightingKernel();assert.equal(image.faces.length,6);assert.deepEqual(k.cube(l,[1,0,0]),[1,0,0]);assert.deepEqual(k.cube(l,[-1,0,0]),[0,1,0]);assert.deepEqual(k.cube(l,[0,1,0]),[0,0,1]);assert.deepEqual(k.cube(l,[0,0,-1]),[1,0,1]);});
test('native LINEAR tone operator ignores exposure as the source specifies',()=>{const k=createGlobalToneMath();assert.equal(k.tonemap(.4,3,20,2,1),.4**2);assert.deepEqual(k.color([0,0,0],4),[0,0,0]);});
