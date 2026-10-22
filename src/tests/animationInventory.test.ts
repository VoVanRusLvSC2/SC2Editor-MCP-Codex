import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {readAnimationInventory} from '../modules/assets/animationInventory.js';
import type {CascWorkspace} from '../modules/casc/workspace.js';
import {sequenceModel} from './support/animationModel.js';
const resource='Assets/Units/Hero/Hero.m3';
async function fixture(t:test.TestContext){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-anim-assets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,workspace:new Workspace(root),async write(file:string,bytes:Buffer){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),bytes);}};}
const absent={read:async()=>{throw Error('CASC_FILE_NOT_FOUND');}} as Pick<CascWorkspace,'read'>;

test('actual local model overrides declared CASC sources and supplemental coverage stays explicit',async t=>{
 const f=await fixture(t);await f.write(resource,sequenceModel());let calls=0;
 const casc={read:async()=>{calls++;throw Error('CASC_FILE_NOT_FOUND');}} as Pick<CascWorkspace,'read'>;
 const r=await readAnimationInventory(f.workspace,casc,[resource,'Assets/Missing.m3a'],[{root:f.root},{root:path.join(f.root,'dependency'),package:'mods/liberty.sc2mod'}]);
 assert.deepEqual(r.animations,['Attack','Spell','Stand Victory']);assert.equal(r.supplementalCoverage,'partial');assert.equal(r.assets.length,1);assert.equal(r.assets[0].file,path.join(f.root,resource));assert.equal(calls,1);assert.match(r.revision,/^[a-f0-9]{64}$/);
});
test('declared asset precedence, CASC build provenance and supplemental sequences participate in revision',async t=>{
 const f=await fixture(t);await f.write('low/'+resource,sequenceModel(['Walk']));const reads:string[]=[];
 const casc={read:async(file:string)=>{reads.push(file);return {bytes:sequenceModel(file.endsWith('.m3a')?['Spell Channel']:['Attack']),metadata:{buildKey:'fixture-build'}};}} as Pick<CascWorkspace,'read'>;
 const sources=[{root:path.join(f.root,'high'),package:'mods/liberty.sc2mod'},{root:path.join(f.root,'low')}];
 const first=await readAnimationInventory(f.workspace,casc,[resource,'Assets/Spell.m3a'],sources);assert.deepEqual(first.animations,['Attack','Spell Channel']);assert.equal(first.assets[0].build,'fixture-build');assert.equal(first.supplementalCoverage,'resolved');assert.ok(reads[0].startsWith('mods/liberty.sc2mod/base.sc2assets/'));
 await f.write('high/'+resource,sequenceModel(['Attack','Walk']));const overridden=await readAnimationInventory(f.workspace,casc,[resource,'Assets/Spell.m3a'],sources);assert.notEqual(overridden.revision,first.revision);assert.ok(overridden.animations.includes('Walk'));
});
test('missing primary, empty or invalid overrides, ambiguous imports, pending drafts and traversal reject',async t=>{
 const f=await fixture(t);const read=()=>readAnimationInventory(f.workspace,absent,[resource],[{root:f.root}]);
 await assert.rejects(read(),/MODEL_ASSET_MISSING/);await f.write(resource,Buffer.alloc(0));await assert.rejects(read(),/ASSET_EMPTY/);await f.write(resource,Buffer.from('invalid'));await assert.rejects(read(),/METADATA_INVALID/);
 await f.write(resource,sequenceModel());await f.write('Base.SC2Assets/'+resource,sequenceModel(['Walk']));await assert.rejects(read(),/OVERRIDE_AMBIGUOUS/);
 await f.write('Base.SC2Assets/'+resource,sequenceModel());await f.workspace.binary.apply([resource],s=>new Map(s).set(resource,sequenceModel(['Attack'])),{dryRun:false,stage:true});await assert.rejects(read(),/PENDING_DRAFT/);f.workspace.discard(resource);
 await assert.rejects(readAnimationInventory(f.workspace,absent,['../Outside.m3'],[{root:f.root}]),/PATH/);
 await assert.rejects(readAnimationInventory(f.workspace,{read:async()=>{throw Error('CASC_UNAVAILABLE');}} as Pick<CascWorkspace,'read'>,[resource],[{root:path.join(f.root,'empty'),package:'mods/liberty.sc2mod'}]),/CASC_UNAVAILABLE/);
});
test('local junction or symbolic-link asset directories are refused',async t=>{
 const f=await fixture(t);await f.write('outside/Hero.m3',sequenceModel());await fs.mkdir(path.join(f.root,'Assets'),{recursive:true});
 try{await fs.symlink(path.join(f.root,'outside'),path.join(f.root,'Assets/Linked'),process.platform==='win32'?'junction':'dir');}catch(e){if((e as NodeJS.ErrnoException).code==='EPERM'){t.skip('Symbolic link unavailable');return;}throw e;}
 await assert.rejects(readAnimationInventory(f.workspace,absent,['Assets/Linked/Hero.m3'],[{root:f.root}]),/REPARSE_REFUSED/);
});
