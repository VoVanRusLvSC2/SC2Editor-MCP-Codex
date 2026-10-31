import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {probeStorage,testStorageChecks} from '../modules/testing/storagePreflight.js';
import {testManifestSchema} from '../modules/testing/schemas.js';
const manifest=testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{capture:true,points:{a:{x:1,y:1},b:{x:5,y:1}},routes:[{id:'route',from:'a',to:'b',type:'Marine',mobility:'ground'}]}});
test('storage budgets combine same-volume roles with one reserve and keep different volumes separate',async()=>{
 const input={directory:'/suite',gameDirectory:'/game',sourceBytes:1024,manifest},ample=Number.MAX_SAFE_INTEGER;
 const same=await testStorageChecks(input,async directory=>({volume:'same',directory,availableBytes:ample}));
 assert.equal(same.length,1);assert.deepEqual(same[0].evidence?.roles,['suite','game']);assert.equal(same[0].status,'passed');
 const separate=await testStorageChecks(input,async directory=>({volume:directory,directory,availableBytes:ample}));
 assert.equal(separate.length,2);assert.equal(separate.reduce((n,c)=>n+Number(c.evidence?.minimumFreeBytes),0),Number(same[0].evidence?.minimumFreeBytes)+Number(same[0].evidence?.reserveBytes));
 const boundary=Number(same[0].evidence?.minimumFreeBytes);
 assert.equal((await testStorageChecks(input,async directory=>({volume:'same',directory,availableBytes:boundary})))[0].status,'passed');
 assert.equal((await testStorageChecks(input,async directory=>({volume:'same',directory,availableBytes:boundary-1})))[0].status,'failed');
});
test('storage inspection failures and invalid counts stay required and cannot claim adequate space',async()=>{
 const input={directory:'/suite',sourceBytes:0,manifest:testManifestSchema.parse({version:1,map:'Map.SC2Map',editor:{checks:['load']}})};
 for(const probe of [async()=>{throw Error('unavailable');},async(directory:string)=>({volume:'volume',directory,availableBytes:NaN})]){const checks=await testStorageChecks(input,probe);assert.equal(checks[0].status,'inconclusive');assert.equal(checks[0].required,true);}
});
test('storage probe reads the nearest existing real ancestor without creating planned output',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-storage-probe-'));assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));t.after(()=>fs.rm(root,{recursive:true,force:true}));const directory=path.join(root,'missing','output');
 const result=await probeStorage(directory);assert.equal(result.directory,await fs.realpath(root));assert.ok(result.volume);assert.ok(Number.isSafeInteger(result.availableBytes)&&result.availableBytes>=0);await assert.rejects(fs.access(path.join(root,'missing')));
});

test('formation frames have separate storage slots before group cleanup and do not replace final named views',async()=>{
 const group={id:'group',from:'a',to:'b',type:'Marine',mobility:'ground',offsets:[{x:-1,y:0},{x:1,y:0}],viewId:'gate'};
 const parsed=testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{capture:false,launchDiagnostics:false,points:{a:{x:12,y:12},b:{x:12,y:20}},formations:[group],views:[{id:'gate',camera:{x:12,y:16,distance:24,pitch:55,yaw:90}}]}});
 const checks=await testStorageChecks({directory:'/suite',sourceBytes:1024,manifest:parsed},async directory=>({volume:'same',directory,availableBytes:Number.MAX_SAFE_INTEGER}));
 assert.equal(checks[0].evidence?.plannedCaptureSlots,3);
});

test('timed recordings budget native frames, selected copies and both video copies on their volumes',async()=>{
 const base={version:1 as const,map:'Map.SC2Map',game:{capture:false,launchDiagnostics:false,views:[{id:'cast',camera:{x:20,y:20,distance:24,pitch:60,yaw:0}}]}};
 const plain=testManifestSchema.parse(base);
 const recorded=testManifestSchema.parse({...base,game:{...base.game,presentations:[{id:'cast-action',viewId:'cast',beforeSeconds:.5,afterSeconds:3,fps:8,action:{method:'game.order',arguments:{unit:'hero',action:'ability',ability:'Bolt'}},events:[{id:'hit',match:{kind:'damage',source:'galaxy'}}]}]}});
 const budget=async(manifest:typeof plain)=>testStorageChecks({directory:'/suite',gameDirectory:'/game',sourceBytes:0,manifest},async directory=>({volume:'same',directory,availableBytes:Number.MAX_SAFE_INTEGER}));
 const before=(await budget(plain))[0].evidence!,after=(await budget(recorded))[0].evidence!;
 assert.equal(after.plannedRecordingFrames,30);
 assert.equal(after.selectedRecordingFrames,8);
 assert.equal(after.plannedRecordingVideoBytes,64*1024*1024);
 assert.equal(Number(after.minimumFreeBytes)-Number(before.minimumFreeBytes),(30*6+8*8+2*64)*1024*1024);
});
