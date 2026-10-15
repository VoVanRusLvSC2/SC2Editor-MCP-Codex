import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {createObjectInspector} from '../modules/cutscenePreview/objectInspector.js';
import {createLightingKernel} from '../modules/cutscenePreview/lighting.js';
import {orbitCamera} from '../modules/cutscenePreview/render.js';

const xml=`<CutsceneState><CCutsceneNodeDirector guid="d" name="DIRECTOR" autoDestroyOnEnd="1"/>
<CCutsceneNodeActor guid="1" name="Actor" modelLink="ActorModel" position="0,2,3" shadowBox="0" teamColorDiffuse="1,.5,0,1" customSetting="retained">
 <CCutsceneElementObject guid="obj" duration="1000"/>
 <CCutsceneNodePropertyValue guid="track" propertyName="positionX" enabled="1"><CCutsceneElementPropertyCurve guid="key0" time="0" value="0" curveOutType="3"/><CCutsceneElementPropertyCurve guid="key1" time="1000" value="10" curveInType="3"/></CCutsceneNodePropertyValue>
 <CCutsceneNodeAnimLayer guid="layer" name="Animation Layer"><CCutsceneElementAnim guid="clip" anim="Stand" priority="3" looping="1" duration="1000" blendTime="125"/></CCutsceneNodeAnimLayer>
</CCutsceneNodeActor></CutsceneState>`;

test('source inventory retains all authored native attributes and hierarchy independently of renderer coverage',()=>{
    const scene=parsePreviewScene(xml,'Inspector');
    const actor=scene.sourceObjects!.find(n=>n.id==='1')!;
    assert.equal(actor.attrs.shadowBox,'0');assert.equal(actor.attrs.customSetting,'retained');
    assert.ok(actor.children.includes('track'));assert.equal(scene.sourceObjects!.find(n=>n.id==='key1')!.parent,'track');
    assert.equal(scene.actors[0].sourceObjectId,'1');assert.equal(scene.actors[0].clips[0].sourceObjectId,'clip');
});

test('inspector shows authored, nested, unsupported and current animated values without changing the source',()=>{
    const scene=parsePreviewScene(xml,'Inspector'),kernel=createPreviewKernel(),inspector=createObjectInspector(kernel),camera=orbitCamera(scene),light=createLightingKernel().fallback;
    const rows=inspector.rows(scene,kernel.sample(scene,500), '1',camera,light);
    assert.equal(rows.find(r=>r.name==='customSetting')!.value,'retained');
    assert.equal(rows.find(r=>r.name==='position')!.value,'5, 2, 3');
    assert.equal(rows.find(r=>r.name==='position')!.authored,'0,2,3');assert.equal(rows.find(r=>r.name==='position')!.changed,true);
    assert.equal(rows.find(r=>r.name==='blendTime')!.value,'125');assert.ok(rows.some(r=>r.name==='curveInType'&&r.value==='3'));
    assert.ok(rows.some(r=>r.name==='propertyName'&&r.value==='positionX'));
    assert.equal(scene.sourceObjects!.find(n=>n.id==='1')!.attrs.position,'0,2,3');
    assert.equal(inspector.rows(scene,kernel.sample(scene,0),'1',camera,light).find(r=>r.name==='position')!.changed,false);
    assert.equal(inspector.rows(scene,kernel.sample(scene,500),'source:clip',camera,light).find(r=>r.name==='priority')!.value,'3');
    assert.equal(inspector.rows(scene,kernel.sample(scene,500),'director',camera,light).find(r=>r.name==='autoDestroyOnEnd')!.value,'1');
});

test('inspector factory serializes without imported runtime dependencies',()=>{
    const scene=parsePreviewScene(xml,'Inspector'),kernel=createPreviewKernel(),browser=vm.runInNewContext('('+createObjectInspector.toString()+')')(kernel);
    assert.deepEqual(JSON.parse(JSON.stringify(browser.rows(scene,kernel.sample(scene,500),'1',orbitCamera(scene),createLightingKernel().fallback))),JSON.parse(JSON.stringify(createObjectInspector(kernel).rows(scene,kernel.sample(scene,500),'1',orbitCamera(scene),createLightingKernel().fallback))));
});

test('inspector keeps settings within the selected scene object',()=>{
    const scene=parsePreviewScene('<CutsceneState><CCutsceneNodeDirector guid="d" name="Director"><CCutsceneNodeTargetCamera guid="cam" name="Camera" fov="48"/></CCutsceneNodeDirector></CutsceneState>','Owners');
    const k=createPreviewKernel(),inspector=createObjectInspector(k),state=k.sample(scene,0),camera=orbitCamera(scene),light=createLightingKernel().fallback;
    assert.equal(inspector.rows(scene,state,'director',camera,light).some(r=>r.name==='fov'),false);
    assert.equal(inspector.rows(scene,state,'cam',camera,light).find(r=>r.name==='fov')?.value,'48');
});

test('large authored scenes retain their actors within the bounded preview limit',()=>{
 const actors=Array.from({length:1024},(_,i)=>'<CCutsceneNodeActor guid="'+i+'" name="Actor '+i+'"/>').join('');
 assert.equal(parsePreviewScene('<CutsceneState>'+actors+'</CutsceneState>','Large scene').actors.length,1024);
 assert.throws(()=>parsePreviewScene('<CutsceneState>'+actors+'<CCutsceneNodeActor guid="extra"/></CutsceneState>','Too large'),/ACTOR_BUDGET/);
});

test('property inventory keeps original linked timing separately from resolved playback',()=>{
 const source='<CutsceneState><CCutsceneNodeActor guid="actor"><CCutsceneElementObject guid="life" duration="1000"/><CCutsceneElementAnim guid="one" anim="Stand" start="100" duration="200"/><CCutsceneElementAnim guid="two" anim="Talk" start="0" duration="400" startLinkGuid="one" startLinkAttachToPoint="2"/></CCutsceneNodeActor></CutsceneState>';
 const scene=parsePreviewScene(source,'Timing');
 assert.equal(scene.actors[0].clips.find(c=>c.sourceObjectId==='two')!.start,300);
 assert.equal(scene.sourceObjects!.find(n=>n.id==='two')!.attrs.start,'0');
});
