import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const cli=path.resolve('scripts/evidence-status.mjs');
test('evidence status retains old source drift, never upgrades partial coverage, and gates readiness',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-evidence-status-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'current.ts'),'current\r\n');await fs.writeFile(path.join(root,'old.ts'),'changed\n');
 const old=JSON.stringify({sourceFingerprints:[{file:'old.ts',sha256LfUtf8:sha('original\n')}]}),current=JSON.stringify({sourceFingerprints:{'current.ts':sha('current\r\n')}});
 await fs.writeFile(path.join(root,'old.json'),old);await fs.writeFile(path.join(root,'current.json'),current);
 const index={schemaVersion:1,records:[{id:'old',file:'old.json',sha256:sha(old),role:'historical'},{id:'new',file:'current.json',sha256:sha(current),role:'scoped'}],coverage:[{id:'regional',required:true,state:'passed',records:['new']},{id:'general',required:true,state:'partial',records:['old'],reason:'Unfinished native save/reopen'}]};
 await fs.writeFile(path.join(root,'index.json'),JSON.stringify(index));
 const run=(...args:string[])=>{const r=spawnSync(process.execPath,[cli,'--root',root,'--index','index.json',...args],{encoding:'utf8'});return {code:r.status,body:JSON.parse(r.stdout)};};
 let r=run('--details');assert.equal(r.code,0);assert.equal(r.body.integrity,true);assert.equal(r.body.roadmapReady,false);assert.equal(r.body.changedSourceScopes,1);assert.equal(r.body.coverage[0].effectiveState,'passed');assert.equal(r.body.coverage[1].effectiveState,'partial');assert.equal(run('--require-ready').code,2);
 await fs.writeFile(path.join(root,'current.ts'),'modified\r\n');r=run();assert.equal(r.body.coverage[0].effectiveState,'stale');assert.equal(r.body.pending.length,2);
 await fs.writeFile(path.join(root,'current.json'),current+' ');r=run();assert.equal(r.code,1);assert.equal(r.body.integrity,false);assert.match(r.body.error,/EVIDENCE_RECORD_DIGEST/);
});
test('evidence status rejects escaping paths, undeclared references and unsupported fingerprint scope',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-evidence-guards-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source='content\n';await fs.writeFile(path.join(root,'source.ts'),source);
 const run=async(record:unknown,coverage:unknown)=>{
  const body=JSON.stringify(record);await fs.writeFile(path.join(root,'record.json'),body);await fs.writeFile(path.join(root,'index.json'),JSON.stringify({schemaVersion:1,records:[{id:'r',role:'scoped',file:'record.json',sha256:sha(body)}],coverage}));
  const r=spawnSync(process.execPath,[cli,'--root',root,'--index','index.json'],{encoding:'utf8'});assert.equal(r.status,1);return JSON.parse(r.stdout);
 };
 assert.match((await run({sourceFingerprints:{'../outside.ts':sha(source)}},[])).error,/EVIDENCE_PATH_SCOPE/);
 assert.match((await run({sourceFingerprints:{}},[])).error,/EVIDENCE_FINGERPRINT_SCOPE_MISSING/);
 assert.match((await run({sourceFingerprints:{'source.ts':sha(source)}},[{id:'c',required:true,state:'passed',records:['missing']}])).error,/EVIDENCE_COVERAGE_SCHEMA/);
 assert.match((await run({sourceFingerprints:{'source.ts':sha(source)}},[{id:'c',required:true,state:'passed',records:[]}])).error,/EVIDENCE_PASSED_WITHOUT_RECORD/);
 assert.match((await run({sourceFingerprints:{'source.ts':sha(source)}},[])).error,/EVIDENCE_COVERAGE_SCHEMA/);
 assert.match((await run({sourceFingerprints:{'source.ts':sha(source)}},[{id:'c',required:false,state:'passed',records:['r']}])).error,/EVIDENCE_COVERAGE_SCHEMA/);
});
