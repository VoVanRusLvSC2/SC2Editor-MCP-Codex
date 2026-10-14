import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {parsePreviewScene} from '../modules/cutscenePreview/scene.js';
import {readM3Clips} from '../modules/cutscenePreview/m3Clips.js';
import type {PreviewMesh} from '../modules/cutscenePreview/types.js';
const k=createPreviewKernel(),ref=(id:number,value:number[])=>({id,value,interpolation:1});
test('native long tint channel names and curves preserve actor color',()=>{
 const s=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a" tintColorRed="0.8" tintColorGreen="0.6" tintColorBlue="0.2"><CCutsceneNodePropertyValue propertyName="tintColorGreen"><CCutsceneElementPropertyValue time="0" value="0.1"/></CCutsceneNodePropertyValue></CCutsceneNodeActor></CutsceneState>','fixture');
 assert.deepEqual(s.actors[0].tint,[.8,.6,.2]);assert.deepEqual(k.sample(s,0).actors[0].tint,[.8,.1,.2]);assert.ok(!s.issues.some(i=>i.code==='CURVE_PROPERTY_UNSUPPORTED'));
});
const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[{name:'toggle',parent:-1,flags:0x4000,position:ref(1,[0,0,0]),rotation:ref(2,[0,0,0,1]),scale:ref(3,[1,1,1]),batching:ref(4,[1])}],batches:[{start:0,count:3,material:0,bone:0},{start:3,count:3,material:1}],inverseBind:[k.identity()],clips:[{name:'hide',start:0,end:1000,tracks:{4:{times:[0,500,1000],values:[[1],[0],[1]],quaternion:false,step:true}}}],bounds:{min:[0,0,0],max:[1,1,1]},source:'fixture',sha256:'fixture',issues:[],pose:'native-bind-geometry'};
test('M3 batch flag uses step visibility and survives serialized CPU/GPU kernel',()=>{
 const browser=vm.runInNewContext('('+createPreviewKernel.toString()+')()') as typeof k;
 for(const kernel of [k,browser]){assert.deepEqual([...kernel.pose(mesh,'hide',499,false,false).batchVisibility],[true,true]);assert.deepEqual([...kernel.pose(mesh,'hide',500,false,false).batchVisibility],[false,true]);assert.deepEqual([...kernel.pose(mesh,'hide',1500,true,false).batchVisibility],[false,true]);assert.deepEqual([...kernel.pose(mesh,undefined,0,false,false).batchVisibility],[true,true]);}
});
test('concurrent native channels wrap by their own fend and mismatched channel types cannot deform a bone',()=>{
 const m=structuredClone(mesh);m.clips[0].tracks['1']={times:[0,100],values:[[0,0,0],[10,0,0]],quaternion:false,wrap:100};m.clips[0].tracks['2']={times:[0],values:[[0]],quaternion:false};
 assert.equal(k.pose(m,'hide',150,false,false).globals[0][12],5);assert.ok(k.pose(m,'hide',150).globals[0].every(Number.isFinite));
});
test('native SDFG reader returns integer flags and STC concurrent fend',()=>{
 const sections:Array<[string,number,Buffer]>=[['MODL',23,Buffer.alloc(124)],['SEQS',2,Buffer.alloc(92)],['CHAR',0,Buffer.from('Toggle\0')],['STC_',4,Buffer.alloc(204)],['STG_',0,Buffer.alloc(24)],['U32_',0,Buffer.alloc(4)],['U32_',0,Buffer.alloc(4)],['SDFG',0,Buffer.alloc(32)],['U32_',0,Buffer.alloc(4)],['I32_',0,Buffer.alloc(8)],['FLAG',0,Buffer.alloc(8)]];
 const ref=(section:number,at:number,count:number,index:number)=>{sections[section][2].writeUInt32LE(count,at);sections[section][2].writeUInt32LE(index,at+4);};
 ref(0,16,1,1);ref(0,28,1,3);ref(0,40,1,4);ref(1,8,7,2);sections[1][2].writeUInt32LE(1000,24);ref(3,20,1,5);ref(3,32,1,6);ref(3,180,1,7);sections[3][2].writeUInt16LE(1,12);ref(4,12,1,8);sections[5][2].writeUInt32LE(4);sections[6][2].writeUInt32LE(11<<16);ref(7,0,2,9);ref(7,20,2,10);sections[7][2].writeUInt32LE(500,16);sections[9][2].writeInt32LE(500,4);sections[10][2].writeUInt32LE(1);let size=32;const offsets=sections.map(([, ,data])=>{const at=size;size+=data.length;return at;});const b=Buffer.alloc(size+sections.length*16);b.write('43DM');b.writeUInt32LE(size,4);b.writeUInt32LE(sections.length,8);b.writeUInt32LE(1,12);for(const [i,[tag,version,data]]of sections.entries()){data.copy(b,offsets[i]);const at=size+i*16;b.write([...tag].reverse().join(''),at);b.writeUInt32LE(offsets[i],at+4);b.writeUInt32LE(i===2?7:[9,10].includes(i)?2:1,at+8);b.writeUInt32LE(version,at+12);}const track=readM3Clips(b)[0].tracks['4'];assert.deepEqual(track.values,[[1],[0]]);assert.equal(track.step,true);assert.equal(track.wrap,500);
});

test('clip start offset is not multiplied by playback speed',()=>{
 const m=structuredClone(mesh);m.clips=[{name:'move',start:0,end:1000,tracks:{1:{times:[0,1000],values:[[0,0,0],[10,0,0]],quaternion:false}}}];
 const s=parsePreviewScene('<CutsceneState><CCutsceneNodeActor guid="a" modelPath="fixture"><CCutsceneNodeAnimLayer><CCutsceneElementAnim anim="move" duration="1000" startOffset="200" timeScale="2"/></CCutsceneNodeAnimLayer></CCutsceneNodeActor></CutsceneState>','fixture');s.models.fixture=m;s.ticksPerSecond=1000;assert.equal(k.sample(s,100).actors[0].pose!.globals[0][12],4);
});
