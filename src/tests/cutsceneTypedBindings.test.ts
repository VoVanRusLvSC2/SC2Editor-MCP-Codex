import test from 'node:test';
import assert from 'node:assert/strict';
import {readM3Clips,mergeM3Clips} from '../modules/cutscenePreview/m3Clips.js';
import {collectNativeMaterialBindings,nativeAnimationReference,cloneModelAnimationReferences,mergeNativeAnimationHeaders} from '../modules/cutscenePreview/nativeBindings.js';
import {packModelAnimation,unpackModelAnimation} from '../modules/cutscenePreview/animationPacking.js';
import {meshResidentBytes} from '../modules/cutscenePreview/meshMemory.js';
import {createPreviewKernel} from '../modules/cutscenePreview/kernel.js';
import {validateNativeRenderBounds} from '../modules/cutscenePreview/nativeAdapter.js';
import type {SurfaceMaterial,PreviewMesh} from '../modules/cutscenePreview/types.js';

/** Byte layout taken from the versioned native schema, independent of the clip reader. */
function materialFixture(){
 const entries:Array<{tag:string;version:number;count:number;data:Buffer}>=[];
 const add=(tag:string,size:number,count=1,version=0)=>{entries.push({tag,version,count,data:Buffer.alloc(size)});return entries.length-1;};
 const reference=(owner:number,at:number,index:number,count=1)=>{entries[owner].data.writeUInt32LE(count,at);entries[owner].data.writeUInt32LE(index,at+4);};
 const model=add('MODL',124,1,23),sequences=add('SEQS',92,1,2),name=add('CHAR',6,6),collections=add('STC_',408,2,4),groups=add('STG_',24),membership=add('STS_',56,2);
 entries[name].data.write('Stand\0');reference(model,16,sequences);reference(model,28,collections,2);reference(model,40,groups);reference(model,68,membership,2);reference(sequences,8,name,6);
 entries[sequences].data.writeUInt32LE(1000,24);entries[sequences].data.writeUInt32LE(100,48);
 const groupIndices=add('U32_',8,2);entries[groupIndices].data.writeUInt32LE(1,4);reference(groups,12,groupIndices,2);
 for(let stc=0;stc<2;stc++){
  const at=stc*204,ids=add('U32_',12,3),refs=add('U32_',12,3),allowed=add('U32_',8,2);
  [10,11,12].forEach((id,i)=>entries[ids].data.writeUInt32LE(id,i*4));[1,5,4].forEach((type,i)=>entries[refs].data.writeUInt32LE(type<<16,i*4));
  entries[allowed].data.writeUInt32LE(10);entries[allowed].data.writeUInt32LE(12,4);reference(membership,stc*28,allowed,2);
  entries[collections].data.writeUInt16LE(stc,at+16);entries[collections].data.writeUInt16LE(stc?12:3,at+14);entries[collections].data.writeUInt16LE(stc,at+12);
  reference(collections,at+20,ids,3);reference(collections,at+32,refs,3);
  for(const [type,tag,keyTag,stride]of [[1,'SD2V','VEC2',8],[5,'SDR3','REAL',4],[4,'SDCC','COL',4]] as const){
   const block=add(tag,32),frames=add('I32_',8,2),keys=add(keyTag,stride*2,2);reference(collections,at+48+type*12,block);reference(block,0,frames,2);reference(block,20,keys,2);
   entries[frames].data.writeInt32LE(1000,4);entries[block].data.writeUInt32LE(1000,16);
   if(type===1){entries[keys].data.writeFloatLE(stc?4:1,8);entries[keys].data.writeFloatLE(-1,12);}
   if(type===5)entries[keys].data.writeFloatLE(2,4);
   if(type===4){entries[keys].data.set([10,20,30,40]);entries[keys].data.set([50,60,70,80],4);}
  }
 }
 let length=32;const offsets=entries.map(e=>{const at=length;length+=e.data.length;return at;});const bytes=Buffer.alloc(length+entries.length*16);
 bytes.write('43DM');bytes.writeUInt32LE(length,4);bytes.writeUInt32LE(entries.length,8);bytes.writeUInt32LE(1,12);
 entries.forEach((e,i)=>{e.data.copy(bytes,offsets[i]);const at=length+i*16;bytes.write([...e.tag].reverse().join(''),at);bytes.writeUInt32LE(offsets[i],at+4);bytes.writeUInt32LE(e.count,at+8);bytes.writeUInt32LE(e.version,at+12);});
 return bytes;
}

test('native vec2/scalar/color layouts retain STC priority and membership evidence',()=>{
 const clip=readM3Clips(materialFixture(),['Stand'],false,{sourceBundle:'fixture.m3a',sourceSha256:'raw-sha'})[0];
 assert.equal(clip.blendMs,100);assert.equal(clip.collections?.length,2);
 const [full,masked]=clip.collections!;assert.equal(full.priority,3);assert.equal(masked.priority,12);assert.equal(masked.concurrent,true);
 assert.deepEqual(masked.stsAnimIds,[10,12]);assert.deepEqual(masked.animIds,[10,11,12]);
 assert.deepEqual(masked.tracks['10'].values,[[0,0],[4,-1]]);assert.deepEqual(masked.tracks['11'].values,[[0],[2]]);
 assert.deepEqual(full.tracks['12'].values[0],[30/255,20/255,10/255,40/255]);
 assert.equal(masked.tracks['10'].fend,1000);assert.equal(masked.sourceBundle,'fixture.m3a');
 assert.equal(clip.tracks['11'],undefined,'STS-negative scalar remains in evidence but cannot enter the legacy valid-track projection');
});

test('native source merges preserve equal sequence names from separate files',()=>{
 const a=readM3Clips(materialFixture(),undefined,false,{sourceBundle:'a.m3a',sourceSha256:'one'}),b=readM3Clips(materialFixture(),undefined,false,{sourceBundle:'b.m3a',sourceSha256:'two'});
 mergeM3Clips(a,b);assert.equal(a.length,2);assert.deepEqual(a.map(c=>c.sourceBundle),['a.m3a','b.m3a']);mergeM3Clips(a,b);assert.equal(a.length,2);
});

test('large physically bounded native indexes retain selected channels and reject truncation',()=>{
 const fixture=materialFixture(),oldCount=fixture.readUInt32LE(8),offset=fixture.readUInt32LE(4),count=100001,large=Buffer.alloc(offset+count*16);fixture.copy(large);large.writeUInt32LE(count,8);
 for(let i=oldCount;i<count;i++){large.write('__8U',offset+i*16);large.writeUInt32LE(32,offset+i*16+4);}
 assert.deepEqual(readM3Clips(large)[0].collections![1].tracks['10'].values,[[0,0],[4,-1]]);
 assert.throws(()=>readM3Clips(large.subarray(0,large.length-1)),/CUTSCENE_M3A_INDEX/);
});

test('large vertex byte arrays obey physical size while decoded section budgets remain bounded',()=>{
 const size=4204376,index=32+size,bytes=Buffer.alloc(index+16);bytes.write('43DM');bytes.writeUInt32LE(index,4);bytes.writeUInt32LE(1,8);bytes.write('__8U',index);bytes.writeUInt32LE(32,index+4);bytes.writeUInt32LE(size,index+8);
 assert.doesNotThrow(()=>validateNativeRenderBounds(bytes),'Korhal city uses a valid U8__ array above four million bytes');
 bytes.writeUInt32LE(size+17,index+8);assert.throws(()=>validateNativeRenderBounds(bytes),/M3_NATIVE_SECTION_BUDGET/,'U8__ span beyond physical bytes is rejected');
 bytes.writeUInt32LE(size,index+8);bytes.write('ENOB',index);assert.throws(()=>validateNativeRenderBounds(bytes),/M3_NATIVE_SECTION_BUDGET/,'large object sections retain their count limit');
});

test('default UV references preserve every material target without modifying strict snapshots',()=>{
 const rawRef={header:{id:11280514,interpolation:0,flags:8},default:{x:0,y:0}},material={layer_emis1:{entries:1,index:2}};
 const model={material_references:{entries:2,index:0},materials_standard:{entries:1,index:1}},data=[{content:[{type:1,material_index:0},{type:1,material_index:0}]},{content:[material]},{content:[{flags:0,uv_offset:rawRef}]}];
 const standard={layers:{emissive1:{}}} as unknown as NonNullable<SurfaceMaterial['standard']>,materials:SurfaceMaterial[]=[{name:'one',standard},{name:'two',standard}];
 const before=JSON.stringify(materials),bindings=collectNativeMaterialBindings(model,{getSectionByReference:(ref:unknown)=>ref?data[(ref as {index:number}).index]:undefined},materials);
 assert.equal(bindings.length,2);assert.deepEqual(bindings.map(b=>b.material),[0,1]);assert.deepEqual(bindings[0].path,['layers','emissive1','uvOffset']);
 assert.deepEqual(bindings[0].ref,{id:11280514,interpolation:0,rawHeaderU16:0,flags:8,effectiveFlags:24,effectiveInterpolation:0,value:[0,0]});assert.equal(JSON.stringify(materials),before);
 assert.deepEqual(nativeAnimationReference({header:{id:7,interpolation:65535,flags:1},default:{b:10,g:20,r:30,a:40}})?.value,[30/255,20/255,10/255,40/255]);
});

test('serialized animation graph preserves property samples and every duplicate-ID entry',()=>{
 const clip=readM3Clips(materialFixture())[0],collection=clip.collections![0],original=collection.entries[0];
 collection.entries.push({id:original.id,packed:original.packed+1,track:{...original.track,values:[[8,9],[10,11]]}});
 const mesh:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[],inverseBind:[],clips:Array.from({length:20},(_,i)=>({...clip,name:'Stand'+i})),bounds:{min:[0,0,0],max:[1,1,1]},issues:[],source:'fixture.m3',sha256:'fixture',pose:'native-bind-geometry'};
 const packed=packModelAnimation(mesh),restored=unpackModelAnimation(JSON.parse(JSON.stringify({...mesh,...packed})) as PreviewMesh);
 assert.equal(packed.animationData.tracks.length,7);assert.equal(packed.animationData.collections.length,2);
 assert.equal(restored.clips[0].collections![0],restored.clips[19].collections![0]);
 assert.equal(restored.clips[0].collections![0].entries.filter(e=>e.id===original.id).length,2);
 assert.equal(restored.clips[0].tracks['10'],restored.clips[0].collections![0].entries[0].track);
 const kernel=createPreviewKernel(),ref={id:10,interpolation:1,value:[0,0]},layers=[{name:'Stand0',time:500,loop:false,weight:1}];
 assert.deepEqual(kernel.sampleProperty(restored,ref,layers),kernel.sampleProperty(mesh,ref,layers));
 assert.ok(JSON.stringify(packed).length<JSON.stringify({clips:mesh.clips}).length/2);
 const dense={times:Array.from({length:10000},(_,i)=>i),values:Array.from({length:10000},(_,i)=>[i,i+1]),quaternion:false};
 const one={...mesh,clips:[{name:'dense',start:0,end:10000,tracks:{'10':dense}}]},many={...one,clips:Array.from({length:20},(_,i)=>({...one.clips[0],name:'dense'+i}))};
 assert.ok(meshResidentBytes(many)-meshResidentBytes(one)<10000,'shared dense tracks contribute numeric storage once');
});

test('mapped M3A headers clear only native STEP and leave cached evidence intact',()=>{
 const raw=nativeAnimationReference({header:{id:11280514,interpolation:0,flags:8},default:{x:0,y:0}})!;
 const base:PreviewMesh={positions:[],indices:[],weights:[],joints:[],bones:[],inverseBind:[],clips:[],bounds:{min:[0,0,0],max:[0,0,0]},issues:[],source:'base.m3',sha256:'base',pose:'native-bind-geometry',materialBindings:[{material:0,path:['layers','emissive1','uvOffset'],ref:raw},{material:1,path:['layers','emissive1','uvOffset'],ref:raw}]};
 const local=cloneModelAnimationReferences(base),header={id:11280514,rawHeaderU16:1,flags:14,mapped:false};
 mergeNativeAnimationHeaders(local,[header],{sourceBundle:'required.m3a',sourceSha256:'required'});
 assert.equal(local.materialBindings![0].ref.effectiveInterpolation,0,'raw mode alone cannot replace a header without a mapped STC row');
 const changed=mergeNativeAnimationHeaders(local,[{...header,mapped:true}],{sourceBundle:'required.m3a',sourceSha256:'required'});
 assert.equal(changed.upgraded,1);assert.equal(local.materialBindings![0].ref,local.materialBindings![1].ref);
 assert.equal(local.materialBindings![0].ref.effectiveFlags,8,'other target bits remain; incoming flags 0xE do not overwrite them');
 assert.equal(local.materialBindings![0].ref.effectiveInterpolation,1);
 assert.equal(local.materialBindings![0].ref.rawHeaderU16,0);assert.equal(local.materialBindings![0].ref.flags,8);assert.equal(local.materialBindings![0].ref.interpolation,0);
 assert.equal(base.materialBindings![0].ref.effectiveFlags,24);assert.equal(base.materialBindings![0].ref.headerMergeSources,undefined);
 assert.equal(mergeNativeAnimationHeaders(local,[{...header,mapped:true,rawHeaderU16:0}]).upgraded,0,'cleared STEP is never downgraded by later bundles');
 assert.equal(local.materialBindings![0].ref.effectiveFlags,8);
 const rawFFFF=cloneModelAnimationReferences(base);mergeNativeAnimationHeaders(rawFFFF,[{...header,mapped:true,rawHeaderU16:65535}]);
 assert.equal(rawFFFF.materialBindings![0].ref.effectiveInterpolation,1,'native registry assigns a valid row independently of the serialized first word');
});
