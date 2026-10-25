import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readReleaseAcceptance} from '../modules/testing/releaseAcceptance.js';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const cli=path.resolve('scripts/check-verification-evidence.mjs');
async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'release-gate-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const write=async(file:string,value:unknown)=>fs.writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));
 const runtime={version:'1.0.0',nativeProtocol:15,archiveSha256:'a'.repeat(64)};
 await write('native-toolkit-release.json',runtime);await write('adapter.ts','current adapter');await write('art-review.txt','synthetic human review');await write('old.ts','new source, old evidence stays unchanged');
 const native:any={sourceFingerprints:{'adapter.ts':sha('current adapter')},releaseAcceptance:{native:{schemaVersion:1,runtime,live:'passed',adapter:'passed'}}};
 const art:any={sourceFingerprints:{'art-review.txt':sha('synthetic human review')},releaseAcceptance:{art:{schemaVersion:1,state:'passed',humanApproval:true,reviewer:'Synthetic test reviewer',scope:'Synthetic fixture only; never real art acceptance'}}};
 const old={sourceFingerprints:{'old.ts':sha('original source')}};
 const records=[{id:'old',file:'old.json',role:'historical',sha256:sha(JSON.stringify(old))},{id:'native',file:'native.json',role:'scoped',sha256:sha(JSON.stringify(native))},{id:'art',file:'art.json',role:'scoped',sha256:sha(JSON.stringify(art))}];
 await write('old.json',old);await write('native.json',native);await write('art.json',art);
 const binding:any={schemaVersion:1,runtime,nativeRecord:'native',artRecord:'art'};
 const index:any={schemaVersion:1,records,coverage:[{id:'native',required:true,state:'passed',records:['native']},{id:'terrain',required:true,state:'passed',records:['native']},{id:'art',required:true,state:'passed',records:['art']}],currentRelease:{schemaVersion:1,file:'binding.json',sha256:sha(JSON.stringify(binding))}};
 await write('binding.json',binding);await write('index.json',index);
 const saveBinding=async()=>{await write('binding.json',binding);index.currentRelease.sha256=sha(JSON.stringify(binding));await write('index.json',index);};
 const saveRecord=async(id:string,value:unknown)=>{await write(id+'.json',value);index.records.find((r:any)=>r.id===id).sha256=sha(JSON.stringify(value));await write('index.json',index);};
 const run=(...args:string[])=>{const r=spawnSync(process.execPath,[cli,'--root',root,'--index','index.json',...args],{encoding:'utf8'});return {exit:r.status,body:JSON.parse(r.stdout)};};
 return {root,write,runtime,native,art,binding,index,saveBinding,saveRecord,run,read:()=>readReleaseAcceptance(root,'index.json')};
}
test('versioned release selection accepts only its synthetic current records while preserving historical drift',async t=>{
 const f=await fixture(t),old=await fs.readFile(path.join(f.root,'old.json'));
 const r=await f.read();assert.equal(r.ready,true);assert.equal(r.currentNativeAcceptance,true);assert.equal(r.artAccepted,true);assert.equal(r.changedSourceScopes,1);assert.equal(r.matchingSourceScopes,2);assert.equal(f.run().exit,0);assert.deepEqual(await fs.readFile(path.join(f.root,'old.json')),old);
});
test('missing current binding is not ready, while integrity-only explicitly remains nonacceptance',async t=>{
 const f=await fixture(t);delete f.index.currentRelease;await f.write('index.json',f.index);
 assert.equal((await f.read()).ready,false);const strict=f.run();assert.equal(strict.exit,2);assert.equal(strict.body.ok,false);assert.equal(strict.body.currentNativeAcceptance,false);
 const integrity=f.run('--integrity-only');assert.equal(integrity.exit,0);assert.equal(integrity.body.ready,false);assert.equal(integrity.body.mode,'integrity_only');
});
test('missing or tampered binding fails before any acceptance including integrity-only',async t=>{
 const f=await fixture(t);await f.write('binding.json',JSON.stringify(f.binding)+' ');await assert.rejects(f.read(),/RELEASE_BINDING_DIGEST/);assert.equal(f.run('--integrity-only').exit,1);
 await fs.unlink(path.join(f.root,'binding.json'));await assert.rejects(f.read(),/ENOENT/);
});
test('tampered and missing indexed records fail; changed current sources cannot become accepted',async t=>{
 const f=await fixture(t);await f.write('native.json',JSON.stringify(f.native)+' ');await assert.rejects(f.read(),/EVIDENCE_RECORD_DIGEST/);
 await f.saveRecord('native',f.native);await f.write('adapter.ts','changed adapter');const r=await f.read();assert.equal(r.ready,false);assert.equal(r.currentNativeAcceptance,false);assert.equal(r.artAccepted,true);assert.equal(f.run().exit,2);
 await fs.unlink(path.join(f.root,'native.json'));await assert.rejects(f.read(),/ENOENT/);
});
test('binding and native evidence must both match the exact pinned version protocol and archive digest',async t=>{
 const f=await fixture(t);for(const [key,value]of [['version','0.10.0-rc.1'],['nativeProtocol',14],['archiveSha256','b'.repeat(64)]] as const){
  f.binding.runtime={...f.runtime,[key]:value};await f.saveBinding();await assert.rejects(f.read(),/RELEASE_BINDING_RUNTIME_MISMATCH/);
 }
 f.binding.runtime=f.runtime;await f.saveBinding();f.native.releaseAcceptance.native.runtime={...f.runtime,archiveSha256:'b'.repeat(64)};await f.saveRecord('native',f.native);await assert.rejects(f.read(),/RELEASE_NATIVE_RUNTIME_MISMATCH/);
});
test('required inventory gates remain mandatory despite passing native and art declarations',async t=>{
 const f=await fixture(t);for(const state of ['partial','failed','unsupported','not_checked']){f.index.coverage[1].state=state;await f.write('index.json',f.index);const r=await f.read();assert.equal(r.currentNativeAcceptance,true);assert.equal(r.artAccepted,true);assert.equal(r.ready,false);assert.equal(f.run().exit,2);}
 f.binding.requiredCoverage=['native'];await f.saveBinding();await assert.rejects(f.read(),/Unrecognized key/);
});
test('native completion and human art approval are separate required claims, never inferred from counts',async t=>{
 const f=await fixture(t);f.native.releaseAcceptance.native.adapter='partial';await f.saveRecord('native',f.native);assert.equal((await f.read()).ready,false);
 f.native.releaseAcceptance.native.adapter='passed';await f.saveRecord('native',f.native);
 for(const a of [{...f.art.releaseAcceptance.art,humanApproval:false},{...f.art.releaseAcceptance.art,reviewer:undefined},{...f.art.releaseAcceptance.art,state:'partial'}]){f.art.releaseAcceptance.art=a;await f.saveRecord('art',f.art);const r=await f.read();assert.equal(r.currentNativeAcceptance,true);assert.equal(r.artAccepted,false);assert.equal(r.ready,false);}
});
test('historical or unindexed records cannot substitute for current release declarations',async t=>{
 const f=await fixture(t);f.binding.nativeRecord='old';await f.saveBinding();await assert.rejects(f.read(),/RELEASE_RECORD_HISTORICAL/);
 f.binding.nativeRecord='foreign';await f.saveBinding();await assert.rejects(f.read(),/RELEASE_RECORD_NOT_INDEXED/);
});
test('stale art sources and escaping release paths remain rejected without rewriting any evidence',async t=>{
 const f=await fixture(t);await f.write('art-review.txt','different scene');const r=await f.read();assert.equal(r.artAccepted,false);assert.equal(r.ready,false);
 f.index.currentRelease.file='../outside.json';await f.write('index.json',f.index);await assert.rejects(f.read(),/EVIDENCE_PATH_SCOPE/);
});
test('release checker CLI rejects unknown options instead of silently weakening its gate',async t=>{
 const f=await fixture(t);assert.equal(f.run('--accept-all').exit,1);assert.equal(f.run('--index').exit,1);
});
test('human approval rejects whitespace-only reviewer or scope and accepts padded meaningful values',async t=>{
 const f=await fixture(t),original={...f.art.releaseAcceptance.art};
 for(const field of ['reviewer','scope']){f.art.releaseAcceptance.art={...original,[field]:' \t\n '};await f.saveRecord('art',f.art);await assert.rejects(f.read(),/Too small/);assert.equal(f.run().exit,1);}
 f.art.releaseAcceptance.art={...original,reviewer:'  Synthetic test reviewer  ',scope:'  Synthetic fixture only  '};await f.saveRecord('art',f.art);assert.equal((await f.read()).artAccepted,true);
});
