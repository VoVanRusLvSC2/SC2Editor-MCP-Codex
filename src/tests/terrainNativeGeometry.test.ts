import {gunzipSync} from 'node:zlib';
import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';import {TerrainWorkspace} from '../modules/terrain/workspace.js';import {Workspace} from '../core/workspace.js';import {parseTerrainXml} from '../modules/terrain/surface/format/terrain-params.js';
async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-cliff-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const n of await fs.readdir('src/tests/fixtures/terrain-native/nydus'))await fs.writeFile(path.join(root,n.slice(0,-3)),gunzipSync(await fs.readFile(path.join('src/tests/fixtures/terrain-native/nydus',n))));
 const xml=await fs.readFile(path.join(root,'t3Terrain.xml'),'utf8');
 await fs.writeFile(path.join(root,'t3Terrain.xml'),xml.replace('<vertData','<cliffSetList num="1"><cliffSet i="0" name="AgriaCliff0"/></cliffSetList><vertData'));
 return {root,tr:new TerrainWorkspace(new Workspace(root))};
}
test('native cliff sync preserves the high side at right/top edges and convex caps',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const bytes=(await f.tr.state()).sources.get('t3SyncCliffLevel')!;
 const words=(x:number,y:number)=>[bytes.readUInt16LE(32+(y*32+x)*2),bytes.readUInt16LE(32+(y*32+x+1)*2),bytes.readUInt16LE(32+((y+1)*32+x)*2),bytes.readUInt16LE(32+((y+1)*32+x+1)*2)];
 assert.deepEqual(words(20,10),[128,64,128,64]);assert.deepEqual(words(10,28),[128,128,64,64]);assert.deepEqual(words(20,28),[128,64,64,64]);
});
const area={type:'rectangle' as const,minX:4,minY:4,maxX:20,maxY:28};

test('native cliff and ramp SMAP level labels follow HMAP while retaining independent upper bits',async t=>{
 const f=await fixture(t),file=path.join(f.root,'t3SyncHeightMap'),bytes=await fs.readFile(file),width=bytes.readUInt32LE(8),height=bytes.readUInt32LE(12);
 for(let i=0;i<width*height;i++)bytes.writeUInt16LE((bytes.readUInt16LE(64+i*4+2)&255)|0xab00,64+i*4+2);
 await fs.writeFile(file,bytes);
 const plan=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}},{op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1}}]});await f.tr.apply(plan.id,{dryRun:false,stage:false,backup:false});
 const state=await f.tr.state(),sync=state.sources.get('t3SyncHeightMap')!;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const word=sync.readUInt16LE(64+(y*width+x)*4+2);assert.equal(word&255,state.heights.mask(x,y)&255,'native level label '+x+','+y);assert.equal(word&0xff00,0xab00,'independent SMAP upper bits');}
});

test('mixed height/cliff/ramp batches match sequential component output without double SMAP displacement',async t=>{
 const batch=await fixture(t),sequential=await fixture(t);
 const operations:Parameters<TerrainWorkspace['plan']>[0]['operations']=[
  {op:'height.raise',area:{type:'circle',center:{x:10,y:10},radius:3},amount:.2},
  {op:'cliff.paint',area,parameters:{level:2}},
  {op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1}},
  {op:'height.raise',area:{type:'circle',center:{x:10,y:10},radius:1},amount:.15},
  // The protected ramp is deliberately included in a later brush's bounds.
  // Its measured residual must survive even when that brush skips the vertex.
  {op:'height.raise',area:{type:'circle',center:{x:22,y:17},radius:1},amount:.1},
 ];
 const before=await batch.tr.state(),plan=await batch.tr.plan({operations});
 assert.ok(plan.changedVertices>0);
 await batch.tr.apply(plan.id,{dryRun:false,stage:false,backup:false});
 for(const operation of operations){const p=await sequential.tr.plan({operations:[operation]});await sequential.tr.apply(p.id,{dryRun:false,stage:false,backup:false});}
 const actual=await batch.tr.state(),expected=await sequential.tr.state();
 for(const file of ['t3Terrain.xml','t3HeightMap','t3SyncHeightMap','t3SyncCliffLevel','t3CellFlags'])assert.deepEqual(actual.sources.get(file),expected.sources.get(file),file);
 let changed=0;for(let y=0;y<actual.heights.height;y++)for(let x=0;x<actual.heights.width;x++)if(Math.abs(actual.heights.z(x,y)-before.heights.z(x,y))>1e-12)changed++;
 assert.equal(plan.changedVertices,changed);
});

test('native-only plans report their actual changed height vertices and byte-identical repeats report zero',async t=>{
 const f=await fixture(t),request={operations:[{op:'cliff.paint' as const,area,parameters:{level:2}}]};
 const first=await f.tr.plan(request);assert.ok(first.changedVertices>0);await f.tr.apply(first.id,{dryRun:false,stage:false,backup:false});
 const repeat=await f.tr.plan(request);assert.equal(repeat.changedVertices,0);assert.ok(repeat.files.every(file=>file.changedBytes===0));
});

test('native geometry retains additional cell/list attributes and rejects unhandled list payloads before staging',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const file=path.join(f.root,'t3Terrain.xml'),original=await fs.readFile(file,'utf8');
 const annotated=original.replace('<cliffCellList ','<cliffCellList owner="manual" ').replace('<rampList ','<rampList review="retained" ').replace('<cc ','<cc note="manual &amp; &lt; &quot; &gt;" ');
 await fs.writeFile(file,annotated);const repair=await f.tr.plan({operations:[{op:'cliff.repair',area:{type:'rectangle',minX:2,minY:2,maxX:24,maxY:30},parameters:{}}]});await f.tr.apply(repair.id,{dryRun:false,stage:false,backup:false});
 const after=await fs.readFile(file,'utf8');assert.match(after,/<cliffCellList owner="manual"/);assert.match(after,/<rampList review="retained"/);assert.equal(parseTerrainXml(after).cliffCells!.find(c=>c.attributes?.note)?.attributes?.note,'manual & < " >');
 for(const payload of ['<unsupported authored="1"/>','<!-- authored note -->','unhandled text']){
  const source=after.replace('</cliffCellList>',payload+'</cliffCellList>');await fs.writeFile(file,source);
  await assert.rejects(f.tr.plan({operations:[{op:'cliff.repair',area:{type:'rectangle',minX:2,minY:2,maxX:24,maxY:30},parameters:{}}]}),/UNKNOWN_LIST_CONTENT/);assert.equal(await fs.readFile(file,'utf8'),source);
 }
});

test('diagonally touching plateaus use the measured low HMAP and high SMAP saddle center',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area:{type:'rectangle',minX:4,minY:4,maxX:12,maxY:12},parameters:{level:2}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const file=path.join(f.root,'t3HeightMap'),before=await fs.readFile(file);
 const request={operations:[{op:'cliff.paint' as const,area:{type:'rectangle' as const,minX:14,minY:14,maxX:20,maxY:20},parameters:{level:2}}]},plan=await f.tr.plan(request);
 assert.deepEqual(await fs.readFile(file),before);
 await f.tr.apply(plan.id,{dryRun:false,stage:false,backup:false});const s=await f.tr.state();
 assert.deepEqual([[12,12],[14,12],[14,14],[12,14]].map(([x,y])=>s.heights.mask(x,y)&255),[2,1,2,1]);
 assert.equal(s.heights.mask(13,13)&255,1);assert.ok(Math.abs(s.heights.z(13,13)-8)<.002);
 assert.ok(Math.abs(s.sources.get('t3SyncHeightMap')!.readInt16LE(64+(13*33+13)*4)/256-10)<.005);
 const measured=JSON.parse(await fs.readFile('src/tests/fixtures/terrain-native/cliff-sync-mask-reference.json','utf8')).cases.find((c:{corners:number[]})=>c.corners.join(',')==='2,1,2,1'),masks:number[]=[];
 for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)masks.push(s.sources.get('t3SyncHeightMap')!.readUInt16LE(64+((12+dy)*33+12+dx)*4+2));
 assert.deepEqual(masks,measured.syncMask,'SMAP height is high at the saddle center, but its level label follows low HMAP');
 const sync=s.sources.get('t3SyncCliffLevel')!;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)assert.equal(sync.readUInt16LE(32+((12+dy)*32+12+dx)*2),128);
 const repeat=await f.tr.plan(request);assert.equal(repeat.changedVertices,0);assert.ok(repeat.files.every(v=>v.changedBytes===0));
});

test('cliff painting fills a concave fine-vertex pit and synchronizes its height without moving coarse corners',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area:{type:'rectangle',minX:10,minY:10,maxX:20,maxY:20},parameters:{level:2}},{op:'cliff.paint',area:{type:'rectangle',minX:10,minY:20,maxX:14,maxY:26},parameters:{level:2}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const s=await f.tr.state(),levels=(x:number,y:number)=>s.heights.mask(x,y)&255;
 assert.deepEqual([[14,20],[16,20],[16,22],[14,22]].map(([x,y])=>levels(x,y)),[2,2,1,2]);
 assert.equal(levels(15,21),2);assert.ok(Math.abs(s.heights.z(15,21)-10)<.002);
 assert.ok(Math.abs(s.sources.get('t3SyncHeightMap')!.readInt16LE(64+(21*33+15)*4)/256-10)<.005);
 const remove=await f.tr.plan({operations:[{op:'cliff.paint',area:{type:'rectangle',minX:10,minY:20,maxX:14,maxY:26},parameters:{level:1}}]});assert.equal(remove.valid,true);
});

test('canonical cliff normalization retains base heights outside the stroke and is repeatable',async t=>{
 const f=await fixture(t),initial=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}}]});await f.tr.apply(initial.id,{dryRun:false,stage:false,backup:false});
 const file=path.join(f.root,'t3HeightMap'),before=await fs.readFile(file),index=32+(5*33+3)*6,raw=62000;
 before.writeUInt16LE(raw,index);await fs.writeFile(file,before);const tr=new TerrainWorkspace(new Workspace(f.root));
 const request={operations:[{op:'cliff.paint' as const,area,parameters:{level:2}}]};
 const p=await tr.plan(request);await tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 assert.equal((await fs.readFile(file)).readUInt16LE(index),raw);
 const snapshot=await tr.state(),again=await tr.plan(request);await tr.apply(again.id,{dryRun:false,stage:false,backup:false});
 const current=await tr.state();for(const name of ['t3HeightMap','t3SyncHeightMap','t3SyncCliffLevel','t3CellFlags','t3Terrain.xml'])assert.deepEqual(current.sources.get(name),snapshot.sources.get(name),name);
});

test('explicit cliff repair closes a registered fine-vertex pit without replacing outline, base heights or hiding',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area:{type:'rectangle',minX:10,minY:10,maxX:20,maxY:20},parameters:{level:2}},{op:'cliff.paint',area:{type:'rectangle',minX:10,minY:20,maxX:14,maxY:26},parameters:{level:2}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const state=await f.tr.state(),hmap=Buffer.from(state.heights.bytes),vertex=32+(21*33+15)*6;
 hmap.writeUInt16LE(60000,vertex);hmap.writeUInt16LE(Math.round(state.descriptor.quantizeBias/state.descriptor.quantizeScale),vertex+2);hmap.writeUInt16LE(0xab01,vertex+4);
 await fs.writeFile(path.join(f.root,'t3HeightMap'),hmap);
 const flags=Buffer.from(state.sources.get('t3CellFlags')!);flags[32+20*32+14]=0x84;await fs.writeFile(path.join(f.root,'t3CellFlags'),flags);
 const cliff=Buffer.from(state.sources.get('t3SyncCliffLevel')!);cliff.writeUInt16LE(64,32+(20*32+14)*2);await fs.writeFile(path.join(f.root,'t3SyncCliffLevel'),cliff);
 const tr=new TerrainWorkspace(new Workspace(f.root)),request={operations:[{op:'cliff.repair' as const,area:{type:'rectangle' as const,minX:14,minY:20,maxX:16,maxY:22},parameters:{}}]};
 const repair=await tr.plan(request);assert.equal(repair.valid,true);assert.equal(repair.issues.filter(i=>i.code==='NATIVE_NAVIGATION_NOT_REBUILT').length,1);await tr.apply(repair.id,{dryRun:false,stage:false,backup:false});
 const current=await tr.state();assert.equal(current.heights.mask(15,21),0xab02);assert.equal(current.heights.bytes.readUInt16LE(vertex),60000);assert.equal(current.sources.get('t3CellFlags')![32+20*32+14],0x85);assert.equal(current.sources.get('t3SyncCliffLevel')!.readUInt16LE(32+(20*32+14)*2),128);
 for(let y=0;y<33;y++)for(let x=0;x<33;x++){const at=32+(y*33+x)*6;assert.equal(current.heights.bytes.readUInt16LE(at),hmap.readUInt16LE(at));if(x%2===0&&y%2===0)assert.equal(current.heights.bytes.readUInt16LE(at+4),hmap.readUInt16LE(at+4));}
 assert.ok(Math.abs(current.sync!.bytes.readInt16LE(64+(21*33+15)*4)/256-current.heights.z(15,21))<.005);
 const again=await tr.plan(request);await tr.apply(again.id,{dryRun:false,stage:false,backup:false});const repeated=await tr.state();for(const name of ['t3HeightMap','t3SyncHeightMap','t3SyncCliffLevel','t3CellFlags','t3Terrain.xml'])assert.deepEqual(repeated.sources.get(name),current.sources.get(name));
});

test('cliff repair leaves unregistered freeform terrain alone and rejects ramp contact',async t=>{
 const f=await fixture(t),initial=await f.tr.state();const empty=await f.tr.plan({operations:[{op:'cliff.repair',area:{type:'rectangle',minX:4,minY:4,maxX:20,maxY:28},parameters:{}}]});await f.tr.apply(empty.id,{dryRun:false,stage:false,backup:false});const unchanged=await f.tr.state();for(const [name,bytes]of initial.sources)assert.deepEqual(unchanged.sources.get(name),bytes,name);
 const p=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}},{op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const before=(await f.tr.state()).heights.bytes;await assert.rejects(f.tr.plan({operations:[{op:'cliff.repair',area:{type:'rectangle',minX:20,minY:14,maxX:24,maxY:20},parameters:{}}]}),/TOUCHES_EXISTING_RAMP/);assert.deepEqual((await f.tr.state()).heights.bytes,before);
});

test('saving an unchanged applied terrain plan still rejects an intervening source edit',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.repair',area:{type:'rectangle',minX:4,minY:4,maxX:20,maxY:28},parameters:{}}]});await f.tr.apply(p.id,{dryRun:false,stage:true,backup:false});
 assert.deepEqual(await f.tr.savePlan(p.id,{dryRun:false}),{saved:false,unchanged:true,planId:p.id});
 const file=path.join(f.root,'t3HeightMap'),bytes=await fs.readFile(file);bytes[40]^=1;await fs.writeFile(file,bytes);
 await assert.rejects(f.tr.savePlan(p.id,{dryRun:false}),/STALE_TERRAIN_PLAN/);
});

test('a cliff brush halo sharing a measured ramp vertex is rejected before changing donor data',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}},{op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const before=await fs.readFile(path.join(f.root,'t3HeightMap'));
 await assert.rejects(f.tr.plan({operations:[{op:'cliff.paint',area:{type:'rectangle',minX:26,minY:16,maxX:28,maxY:18},parameters:{level:2}}]}),/TOUCHES_EXISTING_RAMP/);
 assert.deepEqual(await fs.readFile(path.join(f.root,'t3HeightMap')),before);
});

test('all four measured cardinal ramp frames can be removed without retaining a slope',async t=>{
 const native=parseTerrainXml(gunzipSync(await fs.readFile('src/tests/fixtures/terrain-native/city/t3Terrain.xml.gz')).toString()).ramps!;
 for(const [direction,x,y]of [['west',22,15],['east',8,15],['north',15,8],['south',15,22]] as const){
  const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area:{type:'rectangle',minX:10,minY:10,maxX:20,maxY:20},parameters:{level:2}},{op:'ramp.create',parameters:{center:{x,y},direction,lowerLevel:1}}]});
  assert.equal(p.issues.filter(i=>i.code==='NATIVE_NAVIGATION_NOT_REBUILT').length,1);
  await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});const state=await f.tr.state(),authored=parseTerrainXml(state.descriptor.source).ramps!;assert.equal(authored.length,1);assert.ok(Math.abs(state.heights.z(x,y)-9)<.002);
  const matched=native.filter(r=>r.frames.mid?.up.every((v,i)=>v===authored[0].frames.mid!.up[i]));assert.ok(matched.length>0);assert.ok(matched.every(r=>r.dir===authored[0].dir),'direction enum agrees with original native frame, not compass angle');
  const remove=await f.tr.plan({operations:[{op:'ramp.remove',parameters:{index:0}}]});await f.tr.apply(remove.id,{dryRun:false,stage:false,backup:false});assert.equal(parseTerrainXml((await f.tr.state()).descriptor.source).ramps?.length,0);
 }
});

test('ramp removal rejects unmeasured frames and neighboring ramp intersections before commit',async t=>{
 const f=await fixture(t);const p=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}},...[13,19].map(y=>({op:'ramp.create' as const,parameters:{center:{x:22,y},direction:'west',lowerLevel:1}}))]});
 await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});const file=path.join(f.root,'t3Terrain.xml'),before=await fs.readFile(file,'utf8');
 await assert.rejects(f.tr.plan({operations:[{op:'ramp.remove',parameters:{index:0}}]}),/TOUCHES_ANOTHER_RAMP/);assert.equal(await fs.readFile(file,'utf8'),before);
 const altered=before.replace(/mid="([^"]*)w=1 h=2"/,'mid="$1w=2 h=2"');assert.notEqual(altered,before);await fs.writeFile(file,altered);
 await assert.rejects(f.tr.plan({operations:[{op:'ramp.remove',parameters:{index:0}}]}),/PROFILE_UNSUPPORTED/);assert.equal(await fs.readFile(file,'utf8'),altered);
});

test('legacy ramp repair changes only the diagnosed direction attribute and rejects edited channels',async t=>{
 const f=await fixture(t),p=await f.tr.plan({operations:[{op:'cliff.paint',area:{type:'rectangle',minX:10,minY:10,maxX:20,maxY:20},parameters:{level:2}},{op:'ramp.create',parameters:{center:{x:8,y:15},direction:'east',lowerLevel:1}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});
 const file=path.join(f.root,'t3Terrain.xml'),correct=await fs.readFile(file,'utf8'),legacy=correct.replace('<ramp dir="3"','<ramp dir="6"');assert.notEqual(legacy,correct);await fs.writeFile(file,legacy);
 const tr=new TerrainWorkspace(new Workspace(f.root)),before=await tr.state(),repair=await tr.plan({operations:[{op:'ramp.repair',parameters:{index:0}}]});await tr.apply(repair.id,{dryRun:false,stage:false,backup:false});
 assert.equal(await fs.readFile(file,'utf8'),correct);const repaired=await tr.state();for(const [name,bytes]of before.sources)if(name!=='t3Terrain.xml')assert.deepEqual(repaired.sources.get(name),bytes,name);
 const noop=await tr.plan({operations:[{op:'ramp.repair',parameters:{index:0}}]});assert.ok(noop.files.every(f=>f.changedBytes===0));
 await fs.writeFile(file,legacy);const hm=Buffer.from(repaired.heights.bytes);hm.writeUInt16LE(hm.readUInt16LE(32+(15*33+8)*6)+20,32+(15*33+8)*6);await fs.writeFile(path.join(f.root,'t3HeightMap'),hm);
 await assert.rejects(tr.plan({operations:[{op:'ramp.repair',parameters:{index:0}}]}),/CHANNEL_MISMATCH/);assert.equal(await fs.readFile(file,'utf8'),legacy);
});
test('native cliff updates records, levels, wall holes and sync height in one transaction',async t=>{const f=await fixture(t),before=await fs.readFile(path.join(f.root,'t3CellFlags'));const plan=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2,cliffSet:0}}]});assert.equal(plan.valid,true);assert.ok(plan.files.filter(p=>p.changedBytes>0).some(p=>p.file==='t3Terrain.xml'));await f.tr.apply(plan.id,{dryRun:false,stage:false,backup:false});const xml=parseTerrainXml(await fs.readFile(path.join(f.root,'t3Terrain.xml'),'utf8'));assert.ok(xml.cliffCells!.length>0);const state=await f.tr.state();assert.equal(state.heights.mask(8,8)&255,2);assert.ok(Math.abs(state.heights.z(8,8)-10)<.002);const flags=await fs.readFile(path.join(f.root,'t3CellFlags'));assert.ok(flags.subarray(32).some(v=>v&1));assert.deepEqual(flags.subarray(0,32),before.subarray(0,32));assert.equal(xml.cliffCellCount,256);assert.equal(xml.cliffCellOccupiedCount,xml.cliffCells?.length);});
test('native ramp carries measured channels and frame registration, then removes its slope',async t=>{const f=await fixture(t);const cliff=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2,cliffSet:0}}]});await f.tr.apply(cliff.id,{dryRun:false,stage:false,backup:false});const p=await f.tr.plan({operations:[{op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1,width:4,cliffSet:0}}]});assert.equal(p.valid,true);await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});const state=await f.tr.state(),xml=parseTerrainXml(state.descriptor.source);assert.equal(xml.ramps?.length,1);assert.deepEqual(xml.ramps![0].frames.mid?.center,[22,17]);assert.ok(Math.abs(state.heights.z(22,17)-9)<.002);assert.equal(state.sources.get('t3SyncCliffLevel')!.readUInt16LE(32+(17*32+22)*2),88);assert.equal(state.sources.get('t3CellFlags')![32+17*32+22]&1,0);const remove=await f.tr.plan({operations:[{op:'ramp.remove',parameters:{index:0}}]});await f.tr.apply(remove.id,{dryRun:false,stage:false,backup:false});assert.equal(parseTerrainXml((await f.tr.state()).descriptor.source).ramps?.length,0);});
test('height brush retains the native cliff adjustment lane',async t=>{const f=await fixture(t);const p=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});const state=await f.tr.state(),before=state.heights.bytes.readUInt16LE(34+(10*33+10)*6);const brush=await f.tr.plan({operations:[{op:'height.raise',area:{type:'circle',center:{x:10,y:10},radius:2},amount:.25}]});await f.tr.apply(brush.id,{dryRun:false,stage:false,backup:false});const next=await f.tr.state();assert.equal(next.heights.bytes.readUInt16LE(34+(10*33+10)*6),before);assert.ok(next.heights.z(10,10)>state.heights.z(10,10));});
test('native writer rejects unproven profiles and ramps without a level boundary',async t=>{const f=await fixture(t);await assert.rejects(f.tr.plan({operations:[{op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1,width:4}}]}),/ADJACENT_ONE_LEVEL_STEP/);await assert.rejects(f.tr.plan({operations:[{op:'cliff.paint',area:{...area,minX:3},parameters:{level:2}}]}),/TWO_CELL_GRID/);});
test('native ramp rejects an organic cliff that breaks a side rail',async t=>{const f=await fixture(t);for(const [paintArea,level] of [[area,2],[{type:'rectangle' as const,minX:18,minY:18,maxX:20,maxY:20},1]] as const){const p=await f.tr.plan({operations:[{op:'cliff.paint',area:paintArea,parameters:{level}}]});await f.tr.apply(p.id,{dryRun:false,stage:false,backup:false});}await assert.rejects(f.tr.plan({operations:[{op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1,width:4}}]}),/UNEVEN_CLIFF_RAILS/);});

test('ramp side-cap terrain cutouts match the measured donor and preserve authored hiding',async t=>{const f=await fixture(t);const cliff=await f.tr.plan({operations:[{op:'cliff.paint',area,parameters:{level:2}}]});await f.tr.apply(cliff.id,{dryRun:false,stage:false,backup:false});const file=path.join(f.root,'t3CellFlags'),before=await fs.readFile(file);for(let y=14;y<20;y++)for(let x=20;x<24;x++)before[32+y*32+x]|=4;await fs.writeFile(file,before);const tr=new TerrainWorkspace(new Workspace(f.root));const p=await tr.plan({operations:[{op:'ramp.create',parameters:{center:{x:22,y:17},direction:'west',lowerLevel:1}}]});await tr.apply(p.id,{dryRun:false,stage:false,backup:false});const flags=await fs.readFile(file);for(let y=14;y<20;y++)for(let x=20;x<24;x++){assert.equal(flags[32+y*32+x]&1,[0,1,4,5].includes(y-14)?1:0,'native side-cap cutout');assert.equal(flags[32+y*32+x]&4,4,'authored hiding');}assert.ok(flags.subarray(32).some(v=>v&1),'cliff walls retain cutouts');});
