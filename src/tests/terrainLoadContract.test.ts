import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createFlatTerrain} from '../modules/document/codecs/flatTerrainFactory.js';
import {inspectTerrainLoadContract,repairLegacyTerrainLoadContract,validateTerrainLoadContract} from '../modules/terrain/loadContract.js';
import {parseState} from '../modules/terrain/operations.js';
import {TerrainWorkspace} from '../modules/terrain/workspace.js';
import {Workspace} from '../core/workspace.js';

const legacy=()=>{const files=createFlatTerrain(64,48,{id:'Test',textures:['Dirt'],cliffs:['Cliff'],sourcePaths:[]},'Dirt',8);files.get('t3SyncHeightMap')!.fill(0,28,40);files.set('t3Terrain.xml',Buffer.from(files.get('t3Terrain.xml')!.toString().replace(/\s*<cliffCellList[^>]*\/>/,'')));return files;};
test('four independent native maps satisfy shared allocation/Q12 checks with native whitespace',async()=>{
 for(const id of ['ant','city','nydus','warships']){const dir='src/tests/fixtures/terrain-native/'+id,files=new Map<string,Buffer>();for(const file of await fs.readdir(dir))if(file.endsWith('.gz'))files.set(file.slice(0,-3),gunzipSync(await fs.readFile(path.join(dir,file))));const s=parseState(files);assert.equal(inspectTerrainLoadContract(files).valid,true,id);assert.doesNotThrow(()=>validateTerrainLoadContract(files,s.heights.width-1,s.heights.height-1));}
});
test('diagnosed legacy repair changes only missing allocation and scale header; preserves authored surface',()=>{
 const files=legacy(),before=new Map([...files].map(([k,v])=>[k,Buffer.from(v)])),state=parseState(files),broken=inspectTerrainLoadContract(files);
 assert.equal(broken.valid,false);assert.deepEqual(broken.syncFrame?.scale,[0,0,0]);
 const r=repairLegacyTerrainLoadContract(state);assert.deepEqual(new Set(r.changed),new Set(['t3Terrain.xml','t3SyncHeightMap']));assert.equal(r.after.valid,true);
 for(const [file,bytes]of before)if(!r.changed.includes(file))assert.deepEqual(state.sources.get(file),bytes,file);
 assert.deepEqual(state.sources.get('t3SyncHeightMap')!.subarray(40),before.get('t3SyncHeightMap')!.subarray(40));assert.deepEqual(state.sources.get('t3SyncHeightMap')!.subarray(0,28),before.get('t3SyncHeightMap')!.subarray(0,28));
 assert.deepEqual(repairLegacyTerrainLoadContract(state).changed,[]);
});
test('legacy repair refuses partial transforms, real cliff levels and unrelated missing fields without mutation',()=>{
 for(const kind of ['partial','cliff','blocks']){const files=legacy();if(kind==='partial')files.get('t3SyncHeightMap')!.writeInt32LE(4096,28);if(kind==='cliff')files.get('t3SyncCliffLevel')!.writeUInt16LE(65,32);if(kind==='blocks')files.set('t3Terrain.xml',Buffer.from(files.get('t3Terrain.xml')!.toString().replace(/<blockTextureSetList[\s\S]*?<\/blockTextureSetList>/,'')));const before=new Map([...files].map(([k,v])=>[k,Buffer.from(v)]));assert.throws(()=>repairLegacyTerrainLoadContract(parseState(files)),/TERRAIN_LOAD_REPAIR/);for(const [name,bytes]of before)assert.deepEqual(files.get(name),bytes,kind+' '+name);}
});
test('ordinary edits reject bad load structure; explicit repair stages/saves through the existing transaction',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'terrain-load-repair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const files=legacy();for(const [name,bytes]of files)await fs.writeFile(path.join(root,name),bytes);const terrain=new TerrainWorkspace(new Workspace(root));
 await assert.rejects(terrain.plan({operations:[{op:'height.raise',amount:.1,area:{type:'rectangle',minX:8,minY:8,maxX:12,maxY:12}}]}),/INVALID_TERRAIN_LOAD_CONTRACT/);
 const p=await terrain.plan({operations:[{op:'load.repair'}]});assert.equal(p.valid,true);assert.equal((await fs.readFile(path.join(root,'t3SyncHeightMap'))).readInt32LE(28),0);await terrain.apply(p.id,{dryRun:false,stage:true,backup:false});await terrain.savePlan(p.id,{dryRun:false,backup:false});assert.equal((await terrain.inspect()).nativeLoad?.valid,true);assert.ok((await terrain.plan({operations:[{op:'load.repair'}]})).files.every(f=>f.changedBytes===0));
 await assert.rejects(terrain.plan({operations:[{op:'load.repair'},{op:'height.raise',amount:.1,area:{type:'rectangle',minX:8,minY:8,maxX:12,maxY:12}}]}),/MUST_BE_STANDALONE/);
});
