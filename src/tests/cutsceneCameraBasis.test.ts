import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createEnvironmentKernel} from '../modules/cutscenePreview/environment.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import type {PreviewMesh} from '../modules/cutscenePreview/types.js';

const close=(actual:number[],expected:number[])=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-12,`${actual} != ${expected}`));

test('native camera basis keeps bone Y and reconstructs perpendicular forward under shear',()=>{
 const k=createPreviewKernel(),environment=createEnvironmentKernel(k),matrix=[1,0,0,0,1,1,0,0,1,2,1,0,3,4,5,1],axes=environment.cameraAxes(matrix);
 close(axes.up,[1/Math.sqrt(2),1/Math.sqrt(2),0]);
 close(axes.right,[1/Math.sqrt(3),-1/Math.sqrt(3),1/Math.sqrt(3)]);
 close(axes.forward,[1/Math.sqrt(6),-1/Math.sqrt(6),-2/Math.sqrt(6)]);
 const oldForward=[-1,-2,-1].map(v=>v/Math.sqrt(6));
 assert.ok(Math.abs(oldForward.reduce((sum,v,i)=>sum+v*axes.up[i],0))>.5,'independent axis normalization retained shear');
 close(k.transform(matrix,[0,0,0]),[3,4,5]);
});

test('ordinary M3 camera axes and serialized browser factory retain the same convention',()=>{
 const k=createPreviewKernel(),environment=createEnvironmentKernel(k),browser=vm.runInNewContext('('+createEnvironmentKernel.toString()+')')(k),matrix=k.trs([0,-2,-30],k.euler([90,0,0]),[2,3,4]);
 close(environment.cameraAxes(matrix).forward,[0,1,0]);close(environment.cameraAxes(matrix).up,[0,0,1]);
 close([...browser.cameraAxes(matrix).forward],environment.cameraAxes(matrix).forward);
});

test('embedded camera extraction applies the native basis after actor nonuniform scale',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="actor" modelPath="camera.m3" scale="2,1,4"/></CutsceneState>','scaled-camera'),k=createPreviewKernel(),environment=createEnvironmentKernel(k);
 const ref=(value:number[])=>({id:0,interpolation:0,value});
 const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[{name:'Camera',parent:-1,flags:0,position:ref([3,4,5]),rotation:ref(k.euler([30,45,10])),scale:ref([1,1,1])}],inverseBind:[k.identity()],bounds:{min:[0,0,0],max:[0,0,0]},clips:[],source:'fixture',sha256:'fixture',pose:'native-bind-geometry',issues:[],modelCameras:[{index:0,name:'Camera',boneIndex:0,fieldOfView:.5,nearClip:.1,farClip:100,useVerticalFov:false}]};scene.models['camera.m3']=mesh;
 const state=k.sample(scene,0),matrix=k.multiply(state.actors[0].matrix,state.actors[0].pose!.globals[0]),camera=environment.camera(scene,state,'actor',0)!,axes=environment.cameraAxes(matrix);
 close(camera.eye,[6,4,20]);close(camera.target.map((v,i)=>v-camera.eye[i]),axes.forward);
 const old=matrix.slice(8,11).map(v=>-v/Math.hypot(...matrix.slice(8,11)));
 assert.ok(Math.hypot(...old.map((v,i)=>v-axes.forward[i]))>.1);
});
