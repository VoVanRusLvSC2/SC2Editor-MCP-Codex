// Read-only inventory of digest-bound verification records. No native execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath,URL} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const root=path.resolve(option('--root')??fileURLToPath(new URL('../',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=/^[a-f0-9]{64}$/;
async function scoped(file){
 if(typeof file!=='string'||!file||path.isAbsolute(file)||file.includes('\\')||file.split('/').includes('..'))throw Error('EVIDENCE_PATH_SCOPE');
 const target=path.resolve(root,file),realRoot=await fs.realpath(root),real=await fs.realpath(target),relative=path.relative(realRoot,real);
 if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('EVIDENCE_PATH_SCOPE');
 return target;
}
const load=async file=>JSON.parse(await fs.readFile(await scoped(file),'utf8'));
try{
 const index=await load(option('--index')??'docs/verification/index.json');
 if(index.schemaVersion!==1||!Array.isArray(index.records)||!Array.isArray(index.coverage)||!index.records.length)throw Error('EVIDENCE_INDEX_SCHEMA');
 const ids=new Set(),records=[];
 for(const entry of index.records){
  if(typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||!hash.test(entry.sha256)||!['historical','scoped'].includes(entry.role))throw Error('EVIDENCE_INDEX_RECORD');
  ids.add(entry.id);
  const bytes=await fs.readFile(await scoped(entry.file));if(sha(bytes)!==entry.sha256)throw Error('EVIDENCE_RECORD_DIGEST: '+entry.id);
  const record=JSON.parse(bytes),raw=record.sourceFingerprints??record.nativeBridgeSourceFingerprints?.files;
  const fingerprints=Array.isArray(raw)?raw.map(r=>({file:r.file,sha256:r.sha256LfUtf8,encoding:'lf_utf8'})):raw&&typeof raw==='object'?Object.entries(raw).map(([file,sha256])=>({file,sha256,encoding:'bytes'})):[];
  if(!fingerprints.length)throw Error('EVIDENCE_FINGERPRINT_SCOPE_MISSING: '+entry.id);
  const changed=[];
  for(const item of fingerprints){
   if(!hash.test(item.sha256))throw Error('EVIDENCE_SOURCE_DIGEST: '+entry.id);
   const source=await fs.readFile(await scoped(item.file)),value=item.encoding==='lf_utf8'?source.toString('utf8').replaceAll('\r\n','\n'):source;
   if(sha(value)!==item.sha256)changed.push(item.file);
  }
  records.push({id:entry.id,role:entry.role,recordedAt:record.recordedAt??null,recordIntegrity:'matched',sourceScope:changed.length?'changed':'matched',sourceFiles:fingerprints.length,changedSourceFiles:changed.length,...(args.includes('--details')?{file:entry.file,changed}: {})});
 }
 if(!index.coverage.length||!index.coverage.some(item=>item.required===true))throw Error('EVIDENCE_COVERAGE_SCHEMA');
 const coverage=[],coverageIds=new Set();
 for(const item of index.coverage){
  if(typeof item.id!=='string'||!item.id||coverageIds.has(item.id)||typeof item.required!=='boolean'||!['passed','partial','unsupported','not_checked','failed'].includes(item.state)||!Array.isArray(item.records)||item.records.some(id=>!ids.has(id)))throw Error('EVIDENCE_COVERAGE_SCHEMA');
  coverageIds.add(item.id);
  if(item.state==='passed'&&!item.records.length)throw Error('EVIDENCE_PASSED_WITHOUT_RECORD');
  const stale=item.records.filter(id=>records.find(r=>r.id===id).sourceScope==='changed');
  coverage.push({...item,effectiveState:item.state==='passed'&&stale.length?'stale':item.state,staleRecords:stale});
 }
 const pending=coverage.filter(c=>c.required&&c.effectiveState!=='passed').map(c=>({id:c.id,state:c.effectiveState,reason:c.reason}));
 const report={schemaVersion:1,integrity:true,roadmapReady:pending.length===0,recordCount:records.length,matchingSourceScopes:records.filter(r=>r.sourceScope==='matched').length,changedSourceScopes:records.filter(r=>r.sourceScope==='changed').length,records,coverage,pending,scope:'Read-only retained record digests and their declared source fingerprints. Matching source scope does not extend native observations, certify unrecorded behavior or replace the separate evidence:check acceptance gate. No Editor/Game execution.'};
 process.stdout.write(JSON.stringify(report)+'\n');
 if(args.includes('--require-ready')&&!report.roadmapReady)process.exitCode=2;
}catch(error){process.stdout.write(JSON.stringify({integrity:false,roadmapReady:false,error:String(error),scope:'Index/read/digest failure; no native execution'})+'\n');process.exitCode=1;}
