import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BinaryTransactions} from '../core/binaryTransactions.js';
import {Workspace} from '../core/workspace.js';
import {ModkitIntegration} from '../integrations/modkit/runtime.js';
import {ModkitTerrainWorkspace,MODKIT_TERRAIN_COMPONENTS} from '../modules/terrain/modkitWorkspace.js';

async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'binary-read-pair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const texts=new Map<string,string>(),binary=new BinaryTransactions(root,file=>path.resolve(root,file),file=>texts.get(file),file=>texts.delete(file));
 return{root,texts,binary};
}

test('paired read uses one disk read and independently owned current/disk bytes',async t=>{
 const d=await fixture(t),file=path.join(d.root,'one.bin');await fs.writeFile(file,Buffer.from([1,2,3]));
 const original=fs.readFile;let reads=0;t.mock.method(fs,'readFile',async(...args:Parameters<typeof fs.readFile>)=>{reads++;return original(...args);});
 const pair=await d.binary.readPair('one.bin');assert.equal(reads,1);assert.equal(pair.current.file,'one.bin');assert.deepEqual(pair.current,pair.disk);assert.notEqual(pair.current.bytes,pair.disk.bytes);
 pair.current.bytes[0]=99;assert.equal(pair.disk.bytes[0],1);pair.disk.bytes[1]=98;assert.equal(pair.current.bytes[1],2);
 const fresh=await d.binary.readPair('one.bin');assert.deepEqual([...fresh.current.bytes],[1,2,3]);assert.deepEqual([...fresh.disk.bytes],[1,2,3]);
});

test('paired snapshots preserve binary over text over disk precedence and draft isolation',async t=>{
 const d=await fixture(t);await fs.writeFile(path.join(d.root,'one.bin'),'disk');d.texts.set('one.bin','text');
 const text=await d.binary.readPair('one.bin');assert.equal(text.current.bytes.toString(),'text');assert.equal(text.current.staged,true);assert.equal(text.disk.bytes.toString(),'disk');assert.equal(text.disk.staged,false);
 await d.binary.apply(['one.bin'],()=>new Map([['one.bin',Buffer.from('binary')]]),{dryRun:false,stage:true});d.texts.set('one.bin','later text');
 const staged=await d.binary.readPair('one.bin');assert.equal(staged.current.bytes.toString(),'binary');assert.equal(staged.current.staged,true);assert.equal(staged.disk.bytes.toString(),'disk');
 staged.current.bytes.fill(0);assert.equal((await d.binary.readPair('one.bin')).current.bytes.toString(),'binary');
 assert.deepEqual(await d.binary.read('one.bin'),(await d.binary.readPair('one.bin')).current);
 assert.deepEqual(await d.binary.read('one.bin',false),(await d.binary.readPair('one.bin')).disk);
});

test('paired snapshots retain missing-file state and propagate non-missing errors',async t=>{
 const d=await fixture(t),missing=await d.binary.readPair('absent');assert.equal(missing.current.exists,false);assert.equal(missing.disk.exists,false);assert.equal(missing.current.bytes.length,0);assert.equal(missing.disk.bytes.length,0);
 d.texts.set('absent','new text');const drafted=await d.binary.readPair('absent');assert.equal(drafted.current.exists,false);assert.equal(drafted.current.staged,true);assert.equal(drafted.current.bytes.toString(),'new text');assert.equal(drafted.disk.staged,false);
 const denied=Object.assign(new Error('read denied'),{code:'EACCES'});t.mock.method(fs,'readFile',async()=>{throw denied;});await assert.rejects(d.binary.readPair('denied'),e=>e===denied);
});

test('terrain paired loading reads each target/donor/template once and keeps disk stale guards',async t=>{
 const d=await fixture(t);await fs.mkdir(path.join(d.root,'Map'));await fs.mkdir(path.join(d.root,'Donor'));await fs.mkdir(path.join(d.root,'Templates'));await fs.writeFile(path.join(d.root,'Map','Objects'),'disk objects');await fs.writeFile(path.join(d.root,'Templates','Pnp'),Buffer.from([1,2,3]));
 const workspace=new Workspace(d.root),integration=new ModkitIntegration(workspace,path.join(d.root,'missing'));let loaded:Map<string,Uint8Array>|undefined;
 integration.port=async()=>({terrain:async(_view:string,files:Map<string,Uint8Array>)=>{loaded=files;return{next:new Map([...files,['t3CellFlags',Buffer.from([5])]]),reports:[],warnings:[]};}}) as any;
 const terrain=new ModkitTerrainWorkspace(integration),original=fs.readFile;let reads=0;t.mock.method(fs,'readFile',async(...args:Parameters<typeof fs.readFile>)=>{if(String(args[0]).startsWith(d.root))reads++;return original(...args);});
 const plan=await terrain.plan({directory:'Map',templates:{CellAttribute_Pnp:'Templates/Pnp'},operations:[{op:'ramp.place',donorDirectory:'Donor',rampIndex:2,bounds:{minX:96,minY:14,maxX:128,maxY:42},offsetX:-80,offsetY:0,cliffSetIndex:1}]});
 const componentsPerDirectory=MODKIT_TERRAIN_COMPONENTS.length+6;assert.equal(reads,componentsPerDirectory*2+1,'one physical read per declared target/donor dependency and one template');assert.deepEqual([...loaded!.get('CellAttribute_Pnp')!],[1,2,3]);assert.equal(Buffer.from(loaded!.get('Objects')!).toString(),'disk objects');
 await fs.writeFile(path.join(d.root,'Map','Objects'),'changed objects');await assert.rejects(terrain.apply(plan.planId,false),/STALE/);assert.deepEqual(workspace.binary.draftFiles(),[]);
});
