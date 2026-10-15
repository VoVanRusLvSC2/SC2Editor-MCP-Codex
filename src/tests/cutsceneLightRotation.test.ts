import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {PreviewMesh,SceneLight} from '../modules/cutscenePreview/types.js';

const close=(actual:number[],expected:number[])=>{assert.equal(actual.length,expected.length);actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-10,`${actual} != ${expected}`));};

test('authored Lights inherit native Object rotation defaults and distinguish absent from explicit zero without changing synthetic lights',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeLight guid="missing"/><CCutsceneNodeLight guid="zero" rotation="0,0,0"/></CutsceneState>','light-rotation-presence'),k=createPreviewKernel();
 assert.deepEqual(scene.lights!.map(light=>light.rotation),[[0,0,-90],[0,0,0]]);assert.ok(scene.lights!.every(light=>light.rotationConvention==='native-actor'));
 close(k.trs([0,0,0],k.objectRotation(scene.lights![0].rotation,scene.lights![0].rotationConvention),[1,1,1]),k.identity());
 close(k.transform(k.trs([0,0,0],k.objectRotation(scene.lights![1].rotation,scene.lights![1].rotationConvention),[1,1,1]),[1,0,0]),[0,1,0]);
 const synthetic:SceneLight={...scene.lights![1],rotationConvention:undefined,rotation:[90,90,0]};
 close(k.transform(k.trs([0,0,0],k.objectRotation(synthetic.rotation,synthetic.rotationConvention),[1,1,1]),[1,0,0]),[0,0,-1]);
 assert.equal(Object.hasOwn(scene.sourceObjects!.find(object=>object.id==='missing')!.attrs,'rotation'),false);assert.equal(scene.sourceObjects!.find(object=>object.id==='zero')!.attrs.rotation,'0,0,0');
});

test('authored Palace Light XYZ rotations match independent native minus-Z oracles and preserve scale-dependent ranges',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeLight guid="first" rotation="67.873512,31.596764,-155.992477" position="5,-2,7" scale="2,3,4" attenuationStart="1" range="9"/><CCutsceneNodeLight guid="second" rotation="24.281919,-29.058159,-201.238098" position="5,-2,7"/></CutsceneState>','palace-light-rotation'),k=createPreviewKernel(),lights=createEnvironmentKernel(k).lights(scene,k.sample(scene,0));
 close(lights[0].direction,[-.5239378005727159,.7890285787683147,-.32081627611123215]);
 close(lights[1].direction,[.4856971670922478,.3594644412022415,-.7967958191341904]);
 close(lights[0].position,[5,-2,7]);close([lights[0].near,lights[0].range],[4,36]);
 assert.deepEqual(scene.lights![0].rotation,[67.873512,31.596764,-155.992477]);
});

test('Light curves sample raw Euler before shared bearing conversion and native local yaw leaves minus-Z unchanged',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeLight guid="light" rotation="30,45,0"><CCutsceneNodePropertyValue propertyName="rotationX"><CCutsceneElementPropertyCurve time="0" value="30"/><CCutsceneElementPropertyCurve time="1000" value="90"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="rotationZ"><CCutsceneElementPropertyCurve time="0" value="0"/><CCutsceneElementPropertyCurve time="1000" value="180"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="positionX"><CCutsceneElementPropertyCurve time="0" value="1"/><CCutsceneElementPropertyCurve time="1000" value="5"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="scaleZ"><CCutsceneElementPropertyCurve time="0" value="1"/><CCutsceneElementPropertyCurve time="1000" value="3"/></CCutsceneNodePropertyValue></CCutsceneNodeLight></CutsceneState>','animated-light-rotation'),k=createPreviewKernel(),environment=createEnvironmentKernel(k),source=scene.lights![0];
 Object.freeze(source.rotation);const light=environment.lights(scene,k.sample(scene,500))[0];
 close(light.direction,[-Math.SQRT1_2,Math.sqrt(3/8),-Math.sqrt(1/8)]);close(light.position,[3,0,0]);assert.equal(light.range,2);assert.deepEqual(source.rotation,[30,45,0]);
 for(const yaw of [-90,0,90]){const matrix=k.trs([0,0,0],k.objectRotation([60,45,yaw],'native-actor'),[1,1,1]);close(k.transform(matrix,[0,0,-1]),light.direction);}
});

test('constrained Light full basis applies native rotation once and reuses sampled transform curves including range scale',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="host" modelLink="Host" rotation="0,0,0" position="10,0,0"/><CCutsceneNodeLight guid="light" rotation="90,0,0" scale="2,3,4" attenuationStart="1" range="10"><CCutsceneElementAttachment start="0" duration="1000" attachGuid="host" offsetX="1" rotationZ="30"/><CCutsceneNodePropertyValue propertyName="rotationX"><CCutsceneElementPropertyCurve time="0" value="90"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="positionX"><CCutsceneElementPropertyCurve time="0" value="0"/><CCutsceneElementPropertyCurve time="1000" value="100"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="scaleZ"><CCutsceneElementPropertyCurve time="0" value="4"/></CCutsceneNodePropertyValue><CCutsceneNodePropertyValue propertyName="colorMultiplier"><CCutsceneElementPropertyCurve time="0" value="1"/><CCutsceneElementPropertyCurve time="1000" value="3"/></CCutsceneNodePropertyValue></CCutsceneNodeLight></CutsceneState>','attached-light-rotation'),k=createPreviewKernel(),state=k.sample(scene,500),matrix=state.objects.light.matrix;
 close(matrix,[0,0,2,0,1.5,-3*Math.sqrt(3)/2,0,0,2*Math.sqrt(3),2,0,0,10,1,0,1]);
 const sampled:string[]=[],curve=k.curve;k.curve=(value,...args)=>{sampled.push(value.property);return curve(value,...args);};
 const light=createEnvironmentKernel(k).lights(scene,state)[0];close(light.direction,[-Math.sqrt(3)/2,-.5,0]);close(light.position,[10,1,0]);close([light.near,light.range],[4,40]);close(light.color,[2,2,2]);
 assert.deepEqual(sampled,['colorMultiplier'],'constraint pseudoActor already sampled all transform curves');assert.deepEqual(scene.lights![0].rotation,[90,0,0]);
});

test('embedded M3 lights keep their bone quaternion path without authored Object rotation conversion',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelPath="fixture.m3"/></CutsceneState>','embedded-light-rotation'),k=createPreviewKernel(),ref=(value:number[])=>({id:0,interpolation:0,value});
 const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[{name:'Light',parent:-1,flags:0,position:ref([0,0,2]),rotation:ref(k.euler([30,45,15])),scale:ref([1,1,1])}],inverseBind:[k.identity()],bounds:{min:[0,0,0],max:[0,0,0]},clips:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',issues:[],modelLights:[{index:0,name:'Embedded',boneIndex:0,type:2,flags:24,color:[1,1,1],intensity:1,specularColor:[0,0,0],specularIntensity:0,attenuationNear:0,attenuationFar:10,hotspot:1,falloff:1}]};scene.models['fixture.m3']=mesh;
 const rx=30*Math.PI/180,ry=45*Math.PI/180,rz=15*Math.PI/180,x=-Math.sin(ry)*Math.cos(rx),y=Math.sin(rx),z=-Math.cos(ry)*Math.cos(rx),light=createEnvironmentKernel(k).lights(scene,k.sample(scene,0))[0];
 close(light.direction,[Math.cos(rz)*x-Math.sin(rz)*y,Math.sin(rz)*x+Math.cos(rz)*y,z]);close(light.position,[0,0,2]);
});

test('native Light metadata and source presence survive packed JSON with matching standalone browser kernels',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeLight guid="default"/><CCutsceneNodeLight guid="animated" rotation="37,-28,15"><CCutsceneNodePropertyValue propertyName="rotationZ"><CCutsceneElementPropertyCurve time="0" value="15"/><CCutsceneElementPropertyCurve time="1000" value="165"/></CCutsceneNodePropertyValue></CCutsceneNodeLight></CutsceneState>','serialized-light-rotation'),packed=JSON.parse(JSON.stringify(scene)),k=createPreviewKernel(),browser=vm.runInNewContext('('+createPreviewKernel.toString()+')()') as ReturnType<typeof createPreviewKernel>,environment=vm.runInNewContext('('+createEnvironmentKernel.toString()+')')(browser) as ReturnType<typeof createEnvironmentKernel>;
 const expected=createEnvironmentKernel(k).lights(scene,k.sample(scene,500)),actual=environment.lights(packed,browser.sample(packed,500));
 assert.equal(packed.lights[0].rotationConvention,'native-actor');assert.deepEqual(packed.lights[0].rotation,[0,0,-90]);assert.equal(Object.hasOwn(packed.sourceObjects.find((object:{id:string})=>object.id==='default').attrs,'rotation'),false);
 actual.forEach((light,i)=>{close([...light.direction],expected[i].direction);close([...light.position],expected[i].position);});
 close([...actual[1].direction],[.4694715627858908,.5313711260384404,-.7051533011679186]);
});
