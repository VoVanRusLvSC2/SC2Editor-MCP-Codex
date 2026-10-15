import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import type {PreviewMesh,SceneActor} from '../modules/cutscenePreview/types.js';

const close=(actual:number[],expected:number[])=>{
 assert.equal(actual.length,expected.length);
 actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-10,`${actual} != ${expected}`));
};
const kernels=()=>[createPreviewKernel(),vm.runInNewContext('('+createPreviewKernel.toString()+')()') as ReturnType<typeof createPreviewKernel>];

test('catalog Actor rotation distinguishes the native default from explicitly authored zero and preserves source presence',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="missing" modelLink="Communicator"/><CCutsceneNodeActor guid="zero" modelLink="Portrait" rotation="0,0,0"/><CCutsceneNodeActor guid="raw" modelPath="raw.m3"/><CCutsceneNodeActor guid="unresolved"/><CCutsceneNodeActor guid="empty" modelLink=" "/></CutsceneState>','native-rotation-presence');
 assert.equal(scene.actors[0].rotationConvention,'native-actor');assert.deepEqual(scene.actors[0].rotation,[0,0,-90]);
 assert.equal(scene.actors[1].rotationConvention,'native-actor');assert.deepEqual(scene.actors[1].rotation,[0,0,0]);
 for(const actor of scene.actors.slice(2)){assert.equal(actor.rotationConvention,undefined);assert.deepEqual(actor.rotation,[0,0,0]);}
 assert.equal(Object.hasOwn(scene.sourceObjects!.find(o=>o.id==='missing')!.attrs,'rotation'),false);
 assert.equal(scene.sourceObjects!.find(o=>o.id==='zero')!.attrs.rotation,'0,0,0');
 assert.match(scene.issues.find(i=>i.code==='TRANSFORM_CONVENTION_APPROXIMATE')!.detail,/raw\/unresolved actor rotation.*unvalidated/);
});

test('native default keeps model identity while explicit zero and Raynor 270 degrees receive the Actor bearing conversion once',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="missing" modelLink="Communicator"/><CCutsceneNodeActor guid="zero" modelLink="Portrait" rotation="0,0,0"/><CCutsceneNodeActor guid="raynor" modelLink="Master_Raynor" rotation="0,0,270.000061"/></CutsceneState>','native-actor-bearing');
 for(const actor of scene.actors)Object.freeze(actor.rotation);
 const residual=.000061*Math.PI/180;
 for(const k of kernels()){
  close(k.actorAt(scene.actors[0],0).matrix,k.identity());
  close(k.transform(k.actorAt(scene.actors[1],0).matrix,[1,0,0]),[0,1,0]);
  close(k.transform(k.actorAt(scene.actors[2],0).matrix,[1,0,0]),[Math.cos(residual),Math.sin(residual),0]);
 }
 assert.deepEqual(scene.actors.map(a=>a.rotation),[[0,0,-90],[0,0,0],[0,0,270.000061]]);
});

test('Actor RotationZ curves sample native Euler before the bearing conversion in Node and serialized browser kernels',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelLink="Portrait"><CCutsceneNodePropertyValue propertyName="rotationZ"><CCutsceneElementPropertyCurve time="0" value="0"/><CCutsceneElementPropertyCurve time="1000" value="180"/></CCutsceneNodePropertyValue></CCutsceneNodeActor></CutsceneState>','native-rotation-curve');
 const actor=scene.actors[0];Object.freeze(actor.rotation);Object.freeze(actor.curves[0].keys);
 for(const k of kernels()){
  close(k.transform(k.actorAt(actor,0).matrix,[1,0,0]),[0,1,0]);
  close(k.transform(k.actorAt(actor,500).matrix,[1,0,0]),[-1,0,0]);
  close(k.transform(k.actorAt(actor,1000).matrix,[1,0,0]),[0,-1,0]);
 }
 assert.deepEqual(actor.rotation,[0,0,-90]);assert.equal(actor.curves[0].keys[1].value,180);
});

test('arbitrary Actor XYZ angles use native Rx Ry Rz order with bearing added to Euler Z before quaternion construction',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelLink="Portrait" rotation="37,-28,15" position="3,-4,5" scale="2,3,4"/></CutsceneState>','native-rotation-xyz');
 // Independent axis rotations, rather than the kernel Euler/quaternion helper, are the numeric oracle.
 const reference=(point:number[])=>{
  const [x,y,z]=point.map((value,i)=>value*[2,3,4][i]),rx=37*Math.PI/180,ry=-28*Math.PI/180,rz=105*Math.PI/180;
  const afterZ=[Math.cos(rz)*x-Math.sin(rz)*y,Math.sin(rz)*x+Math.cos(rz)*y,z];
  const afterY=[Math.cos(ry)*afterZ[0]+Math.sin(ry)*afterZ[2],afterZ[1],-Math.sin(ry)*afterZ[0]+Math.cos(ry)*afterZ[2]];
  return [afterY[0]+3,Math.cos(rx)*afterY[1]-Math.sin(rx)*afterY[2]-4,Math.sin(rx)*afterY[1]+Math.cos(rx)*afterY[2]+5];
 };
 for(const k of kernels())for(const point of [[1,0,0],[0,1,0],[0,0,1],[.3,-.7,1.2]])close(k.transform(k.actorAt(scene.actors[0],0).matrix,point),reference(point));
 assert.deepEqual(scene.actors[0].rotation,[37,-28,15]);
});

test('an embedded root camera keeps its source eye and heading when the catalog Actor omits rotation',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelLink="Communicator"/></CutsceneState>','native-default-camera');
 const k=createPreviewKernel(),ref=(value:number[])=>({id:0,interpolation:0,value});
 const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[{name:'Camera',parent:-1,flags:0,position:ref([0,-2,-30]),rotation:ref(k.euler([90,0,0])),scale:ref([1,1,1])}],inverseBind:[k.identity()],bounds:{min:[0,0,0],max:[0,0,0]},clips:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',issues:[],modelCameras:[{index:0,name:'Camera',boneIndex:0,fieldOfView:.5,nearClip:.1,farClip:100,useVerticalFov:false}]};
 scene.models.Communicator=mesh;
 for(const kernel of kernels())for(const deform of [true,false]){
  const environment=createEnvironmentKernel(kernel),state=kernel.sample(scene,0,'director',undefined,deform),camera=environment.camera(scene,state,'actor',0)!;
  close(camera.eye,[0,-2,-30]);close(camera.target.map((v,i)=>v-camera.eye[i]),[0,1,0]);
  close(state.actors[0].matrix,k.identity());
 }
});

test('unmarked synthetic and raw-file actors keep their existing model-space rotation convention',()=>{
 const synthetic:SceneActor={id:'synthetic',name:'synthetic',position:[0,0,0],rotation:[90,90,0],scale:[1,1,1],color:[1,1,1,1],visible:true,windows:[],clips:[],curves:[]};
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="raw" modelPath="raw.m3" rotation="0,0,90"/><CCutsceneNodeActor guid="unresolved" rotation="0,0,90"/></CutsceneState>','raw-rotation-scope');
 for(const k of kernels()){
  close(k.actorAt({...synthetic,rotation:[0,0,0]},0).matrix,k.identity());
  close(k.transform(k.actorAt(synthetic,0).matrix,[1,0,0]),[0,0,-1]);
  for(const actor of scene.actors)close(k.transform(k.actorAt(actor,0).matrix,[1,0,0]),[0,1,0]);
 }
});

test('embedded cameras inherit native arbitrary-XYZ Actor orientation and nonuniform scale through the shared matrix',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelLink="CameraModel" rotation="37,-28,15" position="3,-4,5" scale="2,3,4"/></CutsceneState>','native-xyz-camera');
 const k=createPreviewKernel(),ref=(value:number[])=>({id:0,interpolation:0,value});
 const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[{name:'Camera',parent:-1,flags:0,position:ref([0,-2,-30]),rotation:ref([0,0,0,1]),scale:ref([1,1,1])}],inverseBind:[k.identity()],bounds:{min:[0,0,0],max:[0,0,0]},clips:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',issues:[],modelCameras:[{index:0,name:'Camera',boneIndex:0,fieldOfView:.5,nearClip:.1,farClip:100,useVerticalFov:false}]};
 scene.models.CameraModel=mesh;
 // Native-call audit numerical oracle: Rx(37)*Ry(-28)*Rz(15+90), before column scale.
 const rows=[[-.22852365285931683,-.8528618832022029,-.4694715627858908],[.8445481140587787,.06620581131894615,-.5313711260384404],[.4842679249378328,-.5179221937013245,.7051533011679186]],eye=rows.map((row,i)=>row[1]*-6+row[2]*-120+[3,-4,5][i]);
 for(const kernel of kernels())for(const deform of [true,false]){
  const environment=createEnvironmentKernel(kernel),state=kernel.sample(scene,0,'director',undefined,deform),camera=environment.camera(scene,state,'actor',0)!;
  close(camera.eye,eye);close(camera.target.map((v,i)=>v-camera.eye[i]),rows.map(row=>-row[2]));
 }
});

test('text and camera adapters keep their legacy basis while authored Light uses the scoped native Object conversion',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="host" modelLink="Host"/><CCutsceneNodeLight guid="light" rotation="0,0,90"/><CCutsceneNodeText guid="text" text="label"><CCutsceneElementAttachment start="0" duration="1000" attachGuid="host"/></CCutsceneNodeText><CCutsceneNodeTargetCamera guid="camera" eyePositionX="2" eyePositionY="3" eyePositionZ="4"/></CutsceneState>','nonactor-rotation-scope');
 for(const k of kernels()){
  const state=k.sample(scene,500);
  close(k.transform(state.objects.light.matrix,[1,0,0]),[-1,0,0]);
  close(k.transform(state.objects.text.matrix,[1,0,0]),[1,0,0]);
  close(k.transform(state.objects.camera.matrix,[1,0,0]),[3,3,4]);
 }
});

test('attachment offsets remain model-space and receive only the converted host and child Actor matrices',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="host" modelLink="Host" position="10,0,0" rotation="0,0,0"/><CCutsceneNodeActor guid="child" modelLink="Child"><CCutsceneElementAttachment start="0" duration="1000" attachGuid="host" offsetX="1" rotationZ="30"/></CCutsceneNodeActor></CutsceneState>','native-attachment-heading');
 for(const k of kernels()){
  const child=k.sample(scene,500).actors[1];close(child.matrix.slice(12,15),[10,1,0]);
  close(k.transform(child.matrix,[1,0,0]),[9.5,1+Math.sqrt(3)/2,0]);
 }
 assert.deepEqual(scene.actors[1].attachments![0].rotation,[0,0,30]);
});

test('FollowPath keeps its existing tangent/model-space override without a second Actor bearing conversion',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodePath guid="path"><CCutsceneNodePathMarker position="0,0,0"/><CCutsceneNodePathMarker position="10,0,0"/></CCutsceneNodePath><CCutsceneNodeActor guid="actor" modelLink="Portrait" rotation="0,0,0" movespeed="2" useAnimMovespeed="0"><CCutsceneElementFollowPath start="0" duration="1000" pathGuid="path" alwaysPointUp="1" pathRotationOffsetZ="30"/></CCutsceneNodeActor></CutsceneState>','native-path-heading');
 for(const k of kernels()){
  const actor=k.sample(scene,500).actors[0];close(actor.matrix.slice(12,15),[1,0,0]);
  close(k.transform(actor.matrix,[1,0,0]),[.5,Math.sqrt(3)/2,0]);
 }
});
