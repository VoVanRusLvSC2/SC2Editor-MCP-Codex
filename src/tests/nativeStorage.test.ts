import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {NativeStorage,nativePathBudget} from '../integrations/native/storage.js';
import {NativeEditorBridge} from '../integrations/native/bridge.js';
import {Workspace} from '../core/workspace.js';
import type {NativeClient} from '../integrations/native/transport.js';

async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-ne-store-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const workspace=path.join(root,'map'),home=path.join(root,'sdk'),external=path.join(root,'out');
 await fs.mkdir(workspace);await fs.mkdir(home);await fs.writeFile(path.join(workspace,'Test.SC2Map'),'ordinary map');
 let started=0,calls=0;
 const client:NativeClient={start:async()=>{started++;},info:()=>({connected:started>0}),close:async()=>{},call:async()=>{calls++;return {structuredContent:{status:'OK',nativeValidationPassed:true}};}};
 return {root,workspace,home,external,client,counts:()=>({started,calls})};
}

test('Windows path budget includes the save temp directory and localized tables',()=>{
 const worker='L:\\SC2EditorToolkit_PrivateEvidence\\Verification\\SyncMasks-314374b1-2645-4548-8ee4-518b67cb93ed\\.sc2mcp-output\\ne\\w\\4dbbeb3eeb314c87b34ff2b079bbc076';
 const long=nativePathBudget(worker,'win32');assert.equal(long.status,'failed');assert.equal(long.knownSavePathLength,280);assert.match(long.reason??'',/SC2_NATIVE_WORK_ROOT/);
 const short=nativePathBudget('L:\\NE\\w\\'+'a'.repeat(32),'win32');assert.equal(short.status,'passed');assert.ok(short.knownSavePathLength<200);
 assert.equal(nativePathBudget('/tmp/native','linux').status,'not_applicable');
});

test('a long default native path rejects before client start and creates no output', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),workspace=path.join(f.workspace,'a'.repeat(42));await fs.mkdir(workspace);await fs.writeFile(path.join(workspace,'Test.SC2Map'),'ordinary map');
 const bridge=new NativeEditorBridge(new Workspace(workspace),{home:f.home,client:f.client,env:{}});t.after(()=>bridge.close());
 assert.equal(bridge.configuration().pathBudget.status,'failed');assert.deepEqual(f.counts(),{started:0,calls:0});
 const job=await bridge.check({archive:'Test.SC2Map',checks:['load'],includeDiffs:false,deadlineSeconds:1200});
 for(let i=0;i<100&&bridge.job(job.id).state!=='failed';i++)await new Promise(r=>setTimeout(r,2));
 const failed=bridge.job(job.id);assert.equal(failed.state,'failed');assert.match(failed.error??'',/NATIVE_WORK_PATH_TOO_LONG/);assert.equal(failed.reportPersistence,'memory_only');
 assert.deepEqual(f.counts(),{started:0,calls:0});await assert.rejects(fs.access(bridge.work));assert.equal((await bridge.details(job.id)).available,false);
});

test('an external native root remains private, stable and unique across bridges',async t=>{
 const f=await fixture(t),env={SC2_NATIVE_WORK_ROOT:f.external};
 const a=new NativeEditorBridge(new Workspace(f.workspace),{home:f.home,client:f.client,env}),b=new NativeEditorBridge(new Workspace(f.workspace),{home:f.home,client:f.client,env});t.after(()=>a.close());t.after(()=>b.close());
 const config=a.configuration();assert.equal(config.artifactStorage,'configured_external');assert.equal(config.workerDirectory,a.configuration().workerDirectory);assert.notEqual(config.workerDirectory,b.configuration().workerDirectory);
 await assert.rejects(fs.access(f.external));env.SC2_NATIVE_WORK_ROOT=path.join(f.root,'changed');await a.status(true);
 assert.equal(a.work,f.external);assert.deepEqual(f.counts(),{started:1,calls:0});assert.equal(await fs.readFile(path.join(f.workspace,'Test.SC2Map'),'utf8'),'ordinary map');
 await assert.rejects(a.check({archive:path.join(f.external,'Other.SC2Map'),checks:['load'],includeDiffs:false,deadlineSeconds:1200}),/outside|OUTSIDE|escape|workspace/i);
});

test('external native storage refuses relative, volume, workspace and runtime roots',async t=>{
 const f=await fixture(t);
 for(const [external,reason] of [['relative',/ROOT_INVALID/],[path.parse(f.root).root,/ROOT_INVALID/],['\\\\server\\share\\work',/ROOT_INVALID/],[f.workspace,/WORKSPACE_OVERLAP/],[f.root,/WORKSPACE_OVERLAP/],[path.join(f.home,'out'),/RUNTIME_OVERLAP/]] as const){
  const storage=new NativeStorage(f.workspace,f.home,'owned',external);await assert.rejects(storage.prepare(),reason);
 }
 assert.deepEqual(f.counts(),{started:0,calls:0});
});

test('external native storage refuses a junction or symlink in its parent chain',async t=>{
 const f=await fixture(t),target=path.join(f.root,'real'),link=path.join(f.root,'link');await fs.mkdir(target);await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');
 const storage=new NativeStorage(f.workspace,f.home,'owned',path.join(link,'out'));await assert.rejects(storage.prepare(),/REPARSE_REFUSED/);await assert.rejects(fs.access(path.join(target,'out')));
});

test('native artifact reads keep the exact worker boundary, size limits and root guards',async t=>{
 const f=await fixture(t),storage=new NativeStorage(f.workspace,f.home,'owned',f.external);await storage.prepare();
 const own=path.join(storage.worker,'export','Saved.SC2Map'),sibling=path.join(f.external,'w','other','Saved.SC2Map');await fs.mkdir(path.dirname(own),{recursive:true});await fs.mkdir(path.dirname(sibling),{recursive:true});await fs.writeFile(own,'native saved');await fs.writeFile(sibling,'foreign');
 assert.equal((await storage.readWorkerArtifact(own)).toString(),'native saved');await assert.rejects(storage.readWorkerArtifact(sibling),/OUTSIDE_WORKER/);await assert.rejects(storage.readWorkerArtifact(own,2),/SIZE_LIMIT/);
 const link=path.join(storage.worker,'export','Foreign.SC2Map');await fs.symlink(path.dirname(sibling),path.join(storage.worker,'foreign'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(storage.readWorkerArtifact(path.join(storage.worker,'foreign','Saved.SC2Map')),/OUTSIDE_WORKER/);await assert.rejects(fs.access(link));
 await fs.rename(f.external,path.join(f.root,'previous'));await fs.symlink(path.join(f.root,'previous'),f.external,process.platform==='win32'?'junction':'dir');
 await assert.rejects(storage.readWorkerArtifact(own),/REPARSE_REFUSED/);
});

test('capture storage accepts only the owning job or worker, rejecting sibling jobs and reparse escapes',async t=>{
 const f=await fixture(t),storage=new NativeStorage(f.workspace,f.home,'owned',f.external);await storage.prepare();
 const directory=path.join(storage.work,'jobs','owned'),own=path.join(directory,'Frame.png'),sibling=path.join(storage.work,'jobs','other','Frame.png');
 for(const file of [own,sibling]){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'frame');}
 assert.equal((await storage.readCaptureArtifact(own,directory)).toString(),'frame');await assert.rejects(storage.readCaptureArtifact(sibling,directory),/OUTSIDE_OWNER/);await assert.rejects(storage.readCaptureArtifact(sibling,storage.work),/OUTSIDE_OWNER/);
 const link=path.join(directory,'other');await fs.symlink(path.dirname(sibling),link,process.platform==='win32'?'junction':'dir');await assert.rejects(storage.readCaptureArtifact(path.join(link,'Frame.png'),directory),/OUTSIDE_OWNER/);
});
