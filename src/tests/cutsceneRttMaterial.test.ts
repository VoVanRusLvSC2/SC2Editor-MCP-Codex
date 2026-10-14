import test from 'node:test';import assert from 'node:assert/strict';
import {attachNativeFeatures} from '../modules/cutscenePreview/nativeFeatures.js';
import type {SurfaceMaterial,MaterialLayer} from '../modules/cutscenePreview/types.js';
test('bitmapless RTT layers are restored on standard and composite passes without changing raw selectors',()=>{
 const rawLayer={video_channel:0,flags:0,uv_source:1},raw={layer_diff:'layer',flags:0},sections=new Map<unknown,unknown[]>([['refs',[{type:1,material_index:0},{type:3,material_index:0}]],['std',[raw]],['cmp',[{sections:'passes'}]],['passes',[{material_reference_index:0}]],['layer',[rawLayer]]]),material={layers:{}} as NonNullable<SurfaceMaterial['standard']>;
 const materials=[{name:'RTT',standard:material},{name:'Composite',composite:{priority:0,passes:[{material:{...material,layers:{}},alphaFactor:{value:1}}]}}] as SurfaceMaterial[];
 const restore=()=>({slot:'diffuse',texturePath:null,uvSource:1,channels:0,op:2,teamColorMode:0,invert:false,clampResult:false,wrapX:false,wrapY:false,constantColor:{value:[0,0,0,1]}} as MaterialLayer);
 const r=attachNativeFeatures({material_references:'refs',materials_standard:'std',materials_composite:'cmp'},{getSectionByReference:ref=>sections.has(ref)?{content:sections.get(ref)!}:undefined},materials,[],[],restore);
 assert.equal(r.features.rttLayers.length,2);assert.equal(material.layers.diffuse.texturePath,'rtt://0');assert.equal(material.layers.diffuse.constantColor,undefined);assert.equal(materials[1].composite?.passes[0].material.layers.diffuse.uvSource,1);assert.equal(rawLayer.flags,0);assert.deepEqual(r.features.unsupportedMaterialFlags,[]);
});
