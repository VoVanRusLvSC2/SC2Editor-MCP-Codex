import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {bytesHash} from '../core/binaryTransactions.js';
import {TerrainWorkspace} from '../modules/terrain/workspace.js';
import {TERRAIN_COMPONENTS} from '../modules/terrain/operations.js';
import {ownedFixture,ownedZone,ownedChild} from './support/ownedZoneFixture.js';

test('main terrain loader halves physical reads with exact legacy bytes and current/disk hashes',async t=>{
 const d=await ownedFixture(t),originalRead=fs.readFile;let reads=0;
 t.mock.method(fs,'readFile',async(...args:Parameters<typeof fs.readFile>)=>{if(String(args[0]).startsWith(d.root))reads++;return originalRead(...args);});
 const legacy=async()=>{const sources=new Map<string,Buffer>(),sourceSha256:Record<string,string>={},diskSha256:Record<string,string>={};for(const name of TERRAIN_COMPONENTS){const raw=await d.workspace.binary.read(name),disk=await d.workspace.binary.read(name,false);sources.set(name,raw.bytes);sourceSha256[name]=bytesHash(raw.bytes);diskSha256[name]=bytesHash(disk.bytes);}return{sources,sourceSha256,diskSha256};};
 const before=await legacy();assert.equal(reads,48);reads=0;const after=await(d.terrain as any).load();assert.equal(reads,24);assert.deepEqual(after,before);
 const first=after.sources.get('t3HeightMap') as Buffer;first[32]^=1;assert.notDeepEqual(first,before.sources.get('t3HeightMap'));assert.deepEqual((await(d.terrain as any).load()).sources.get('t3HeightMap'),before.sources.get('t3HeightMap'));
});

test('main terrain paired load retains binary/text draft and missing-component semantics',async t=>{
 const d=await ownedFixture(t),disk=await fs.readFile(path.join(d.root,'t3HeightMap')),changed=Buffer.from(disk);changed[32]^=1;
 await d.workspace.binary.apply(['t3HeightMap'],()=>new Map([['t3HeightMap',changed]]),{dryRun:false,stage:true});
 await d.workspace.applyRawTransaction(['t3Terrain.xml'],sources=>new Map([['t3Terrain.xml',sources.get('t3Terrain.xml')!+'\n<!-- staged descriptor -->']]),{dryRun:false,stage:true});
 const loaded=await(d.terrain as any).load();assert.deepEqual(loaded.sources.get('t3HeightMap'),changed);assert.equal(loaded.sourceSha256.t3HeightMap,bytesHash(changed));assert.equal(loaded.diskSha256.t3HeightMap,bytesHash(disk));assert.match(loaded.sources.get('t3Terrain.xml').toString(),/staged descriptor/);assert.notEqual(loaded.sourceSha256['t3Terrain.xml'],loaded.diskSha256['t3Terrain.xml']);
 assert.equal(loaded.sources.get('Terrain').length,0);assert.equal(loaded.sourceSha256.Terrain,bytesHash(Buffer.alloc(0)));assert.equal(loaded.diskSha256.Terrain,bytesHash(Buffer.alloc(0)));
});

test('main paired planning matches legacy no-op and parent/dependent component and ledger output',async t=>{
 const d=await ownedFixture(t),parent=ownedZone(),child=ownedChild(),other=ownedZone('east',22,4,28,10);await d.apply({zones:[parent,child,other]});
 const paired=d.workspace.binary.readPair.bind(d.workspace.binary);
 for(const zones of [[parent],[{...parent,config:{...parent.config,objectCount:5}}]]){
  d.workspace.binary.readPair=async file=>({current:await d.workspace.binary.read(file),disk:await d.workspace.binary.read(file,false)});
  const legacyTerrain=new TerrainWorkspace(d.workspace,d.browse,d.placement),old=await legacyTerrain.ownedLandscape({zones});
  d.workspace.binary.readPair=paired;const current=await d.terrain.ownedLandscape({zones});
  assert.deepEqual(current.ownership,old.ownership);assert.deepEqual(current.files,old.files);assert.deepEqual((d.terrain as any).plans.get(current.id).next,(legacyTerrain as any).plans.get(old.id).next);
 }
});
