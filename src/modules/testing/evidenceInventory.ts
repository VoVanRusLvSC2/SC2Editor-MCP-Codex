import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=/^[a-f0-9]{64}$/;
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export async function evidenceFile(root:string,file:string){
 if(typeof file!=='string'||!file||file.length>1024||path.isAbsolute(file)||file.includes('\\')||file.split('/').includes('..'))throw Error('EVIDENCE_PATH_SCOPE');
 const realRoot=await fs.realpath(root),real=await fs.realpath(path.resolve(realRoot,file)),relative=path.relative(realRoot,real);
 if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('EVIDENCE_PATH_SCOPE');
 return real;
}
export async function readEvidenceInventory(root:string,indexFile='docs/verification/index.json',options:{details?:boolean;allowMissingSources?:boolean}={}){
 const read=async(file:string,limit:number)=>{const real=await evidenceFile(root,file),stat=await fs.stat(real);if(!stat.isFile()||stat.size>limit)throw Error('EVIDENCE_FILE_LIMIT');const bytes=await fs.readFile(real);if(bytes.length>limit)throw Error('EVIDENCE_FILE_LIMIT');return bytes;};
 const index=JSON.parse((await read(indexFile,2*1024*1024)).toString('utf8'));
 if(index.schemaVersion!==1||!Array.isArray(index.records)||!Array.isArray(index.coverage)||!index.records.length||index.records.length>512)throw Error('EVIDENCE_INDEX_SCHEMA');
 const ids=new Set<string>(),records:Array<{id:string;role:string;recordedAt:string|null;recordIntegrity:string;sourceScope:string;sourceFiles:number;changedSourceFiles:number;missingSourceFiles:number;file?:string;changed?:string[];missing?:string[]}>=[];
 const currentSources=new Map<string,Promise<{bytes:string;lfUtf8:string}|undefined>>();let totalBytes=0,totalFingerprints=0;
 const source=(file:string)=>{let value=currentSources.get(file);if(!value){value=read(file,8*1024*1024).then(bytes=>{totalBytes+=bytes.length;if(totalBytes>256*1024*1024)throw Error('EVIDENCE_SOURCE_BYTE_LIMIT');return {bytes:sha(bytes),lfUtf8:sha(bytes.toString('utf8').replaceAll('\r\n','\n'))};}).catch(error=>{if(options.allowMissingSources&&(error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});currentSources.set(file,value);}return value;};
 for(const entry of index.records){
  if(typeof entry.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(entry.id)||ids.has(entry.id)||!hash.test(entry.sha256)||!['historical','scoped'].includes(entry.role))throw Error('EVIDENCE_INDEX_RECORD');ids.add(entry.id);
  const bytes=await read(entry.file,4*1024*1024);if(sha(bytes)!==entry.sha256)throw Error('EVIDENCE_RECORD_DIGEST: '+entry.id);
  const record=JSON.parse(bytes.toString('utf8')),raw=record.sourceFingerprints??record.nativeBridgeSourceFingerprints?.files;
  const fingerprints:Array<{file:string;sha256:string;encoding:string}>=Array.isArray(raw)?raw.map(r=>({file:r.file,sha256:r.sha256LfUtf8,encoding:'lf_utf8'})):raw&&typeof raw==='object'?Object.entries(raw).map(([file,sha256])=>({file,sha256:sha256 as string,encoding:'bytes'})):[];
  if(!fingerprints.length||fingerprints.length>4096)throw Error('EVIDENCE_FINGERPRINT_SCOPE_MISSING: '+entry.id);
  totalFingerprints+=fingerprints.length;if(totalFingerprints>65536)throw Error('EVIDENCE_FINGERPRINT_LIMIT');
  const changed:string[]=[],missing:string[]=[];
  for(const item of fingerprints){if(!hash.test(item.sha256))throw Error('EVIDENCE_SOURCE_DIGEST: '+entry.id);const value=await source(item.file);if(value===undefined){missing.push(item.file);continue;}if((item.encoding==='lf_utf8'?value.lfUtf8:value.bytes)!==item.sha256)changed.push(item.file);}
  records.push({id:entry.id,role:entry.role,recordedAt:record.recordedAt??null,recordIntegrity:'matched',sourceScope:changed.length?'changed':missing.length?'unavailable':'matched',sourceFiles:fingerprints.length,changedSourceFiles:changed.length,missingSourceFiles:missing.length,...(options.details?{file:entry.file,changed,missing}:{})});
 }
 if(!index.coverage.length||index.coverage.length>64||!index.coverage.some((item:{required?:boolean})=>item.required===true))throw Error('EVIDENCE_COVERAGE_SCHEMA');
 const coverage:Array<{id:string;required:boolean;state:string;reason?:string;records:string[];effectiveState:string;staleRecords:string[];unavailableRecords:string[]}>=[],coverageIds=new Set<string>();
 for(const item of index.coverage){
  if(typeof item.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(item.id)||coverageIds.has(item.id)||typeof item.required!=='boolean'||!['passed','partial','unsupported','not_checked','failed'].includes(item.state)||!Array.isArray(item.records)||item.records.length>512||item.records.some((id:string)=>!ids.has(id)))throw Error('EVIDENCE_COVERAGE_SCHEMA');coverageIds.add(item.id);
  if(item.state==='passed'&&!item.records.length)throw Error('EVIDENCE_PASSED_WITHOUT_RECORD');
  const stale=item.records.filter((id:string)=>records.find(r=>r.id===id)!.sourceScope==='changed'),unavailable=item.records.filter((id:string)=>records.find(r=>r.id===id)!.sourceScope==='unavailable');
  coverage.push({...item,effectiveState:item.state==='passed'?(stale.length?'stale':unavailable.length?'unverified':item.state):item.state,staleRecords:stale,unavailableRecords:unavailable});
 }
 const pending=coverage.filter(c=>c.required&&c.effectiveState!=='passed').map(c=>({id:c.id,state:c.effectiveState,reason:c.reason}));
 return {schemaVersion:1,integrity:true,roadmapReady:pending.length===0,recordCount:records.length,matchingSourceScopes:records.filter(r=>r.sourceScope==='matched').length,changedSourceScopes:records.filter(r=>r.sourceScope==='changed').length,unavailableSourceScopes:records.filter(r=>r.sourceScope==='unavailable').length,records,coverage,pending,scope:'Read-only retained record digests and their declared source fingerprints. Matching source scope does not extend native observations, certify unrecorded behavior or replace the separate evidence:check acceptance gate. No Editor/Game execution.'};
}
