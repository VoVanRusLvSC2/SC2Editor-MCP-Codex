import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createLightingKernel} from '../modules/cutscenePreview/lighting.js';
import {createNativePostprocessMath} from '../modules/cutscenePreview/nativePostprocessMath.js';
import type {AnimCollection,AnimTrack,ModelClip,PreviewMesh} from '../modules/cutscenePreview/types.js';

const constant=(value:number[]):AnimTrack=>({times:[0,1000],values:[value,value],quaternion:false,type:value.length===2?1:5});
const collection=(name:string,priority:number,tracks:Record<string,AnimTrack>,members=Object.keys(tracks).map(Number)):AnimCollection=>({name,priority,stcIndex:priority,concurrent:true,stsIndex:0,stsAnimIds:members,animIds:Object.keys(tracks).map(Number),animRefs:Object.keys(tracks).map(()=>0),tracks,entries:Object.entries(tracks).map(([id,track])=>({id:Number(id),packed:0,track}))});
const clip=(name:string,collections:AnimCollection[],sourceGuid?:string):ModelClip=>({name,start:0,end:1000,tracks:{},collections,sourceGuid});
const mesh=(clips:ModelClip[])=>({clips} as PreviewMesh);

test('Blizzard split-body track-set priorities choose each property separately',()=>{
 const k=createPreviewKernel(),m=mesh([
  clip('Walk',[collection('LowerBody',10,{'1':constant([10])}),collection('Default',5,{'2':constant([5])})]),
  clip('Attack',[collection('Default',9,{'1':constant([9]),'2':constant([9])})]),
 ]),layers=[{name:'Attack',time:500,loop:false,weight:1},{name:'Walk',time:500,loop:false,weight:1}];
 assert.deepEqual(k.sampleProperty(m,{id:1,value:[0],interpolation:1},layers),[10]);
 assert.deepEqual(k.sampleProperty(m,{id:2,value:[0],interpolation:1},layers),[9]);
});

test('a face clip with no material property preserves the concurrent body material channel',()=>{
 const k=createPreviewKernel(),m=mesh([clip('Stand',[collection('Body',3,{'11280514':constant([0,-1])})]),clip('BreathMouth',[collection('Face',13,{'3':constant([.8])})])]);
 assert.deepEqual(k.sampleProperty(m,{id:11280514,value:[0,0],interpolation:1},[{name:'BreathMouth',time:400,loop:true,weight:1},{name:'Stand',time:400,loop:true,weight:1}]),[0,-1]);
});

test('STS excludes an otherwise present ID and duplicate names respect native bundle GUIDs',()=>{
 const k=createPreviewKernel(),m=mesh([clip('Stand',[collection('a',99,{'4':constant([99])},[])],'a'),clip('Stand',[collection('b',3,{'4':constant([7])})],'b')]);
 assert.deepEqual(k.sampleProperty(m,{id:4,value:[2],interpolation:1},[{name:'Stand',sourceBundleGuid:'a',time:0,loop:false,weight:1}]),[2]);
 assert.deepEqual(k.sampleProperty(m,{id:4,value:[2],interpolation:1},[{name:'Stand',sourceBundleGuid:'b',time:0,loop:false,weight:1}]),[7]);
});

test('RGBA channel blending keeps color magnitude and does not normalize as a quaternion',()=>{
 const k=createPreviewKernel(),m=mesh([clip('a',[collection('a',3,{'5':constant([1,0,0,1])})]),clip('b',[collection('b',2,{'5':constant([0,1,0,1])})])]);
 assert.deepEqual(k.sampleProperty(m,{id:5,value:[0,0,0,1],interpolation:1},[{name:'a',time:0,loop:false,weight:.5},{name:'b',time:0,loop:false,weight:.5}]),[.5,.5,0,1]);
});

test('native bounded radial ramp has authored center/half-range/end values',()=>{
 const math=createLightingKernel();assert.equal(math.pointAttenuation(0,.1,1),1);assert.equal(math.pointAttenuation(5,.1,1),.25);assert.equal(math.pointAttenuation(10,.1,1),0);assert.equal(math.pointAttenuation(20,.1,1),0);
 assert.equal(math.blinn(.4,1,0,true).specular,0);assert.equal(math.blinn(1,0,0).specular,1);
});

test('Base98310 tone operators and CoC contracts match shipped numerical examples',()=>{
 const m=createNativePostprocessMath();assert.equal(m.tonemap(1,0,1,1,1),1);assert.ok(Math.abs(m.tonemap(1,1,1)-(.6321205588285577))<1e-12);
 assert.equal(m.tonemap(1,2,1),1);assert.equal(m.tonemap(2,3,99,2),4);
 assert.ok(Math.abs(m.tonemap(1,4,1)-12.8/16.32)<1e-12);
 assert.deepEqual(m.color([0,0,0],4),[0,0,0]);assert.equal(m.luminance([1,1,1]),.975);
 assert.equal(m.legacyCoC(8,10,[.5,-1,.5,-.5]),.5);assert.equal(m.legacyCoC(10,10,[.5,-1,.5,-.5]),0);
 assert.equal(m.cameraCoC(4,[-2,.5]),0);
});
