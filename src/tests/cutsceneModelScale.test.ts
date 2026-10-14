import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {resolvedModel,modelScaleValue,type ModelEntry} from '../modules/cutscenePreview/modelCatalog.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
test('catalog intrinsic scale follows parent and child overlays without choosing an unproven random range',()=>{
 const catalog=new Map<string,ModelEntry>([['Base',{model:'head.m3',required:[],optional:[],scaleMin:[.85,.85,.85],scaleMax:[.85,.85,.85]}],['Child',{parent:'Base',required:[],optional:[]}],['Varied',{parent:'Base',required:[],optional:[],scaleMax:[1,1,1]}]]);
 assert.deepEqual(resolvedModel(catalog,'Child').fixedScale,[.85,.85,.85]);assert.equal(resolvedModel(catalog,'Varied').fixedScale,undefined);assert.deepEqual(resolvedModel(catalog,'Base').scaleMax,[.85,.85,.85]);
});
test('fixed catalog scale composes after authored scale curves and preserves authored coordinates in Node and browser',()=>{
 const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="1" scale="2,3,4" position="5,6,7"><CCutsceneNodePropertyValue propertyName="scaleX"><CCutsceneElementPropertyCurve time="0" value="4"/></CCutsceneNodePropertyValue></CCutsceneNodeActor></CutsceneState>','scale');scene.actors[0].modelScale=[.85,.85,.85];
 for(const kernel of [createPreviewKernel(),vm.runInNewContext('('+createPreviewKernel.toString()+')()')]){const m=kernel.sample(scene,0).actors[0].matrix;assert.equal(m[0],3.4);assert.equal(m[5],2.55);assert.equal(m[10],3.4);assert.deepEqual([...m.slice(12,15)],[5,6,7]);}assert.deepEqual(scene.actors[0].scale,[2,3,4]);
});
test('native model scale vectors retain exact components and reject malformed or nonfinite values',()=>{assert.deepEqual(modelScaleValue('0.85,0.85,0.85'),[.85,.85,.85]);assert.equal(modelScaleValue(undefined),undefined);assert.throws(()=>modelScaleValue('1,2'),/MODEL_SCALE/);assert.throws(()=>modelScaleValue('1,2,NaN'),/MODEL_SCALE/);});
