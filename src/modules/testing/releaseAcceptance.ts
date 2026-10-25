import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import * as z from 'zod/v4';
import {evidenceFile,readEvidenceInventory} from './evidenceInventory.js';

const digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const state=z.enum(['passed','failed','partial','unsupported','not_checked']);
const runtime=z.object({version:z.string().min(1).max(80),nativeProtocol:z.number().int().positive(),archiveSha256:digest}).strict();
const pointer=z.object({schemaVersion:z.literal(1),file:z.string().min(1).max(1024),sha256:digest}).strict();
const binding=z.object({schemaVersion:z.literal(1),runtime,nativeRecord:id,artRecord:id}).strict();
const nativeAcceptance=z.object({schemaVersion:z.literal(1),runtime,live:state,adapter:state}).strict();
const artAcceptance=z.object({schemaVersion:z.literal(1),state,humanApproval:z.boolean(),reviewer:z.string().trim().min(1).max(200).optional(),scope:z.string().trim().min(1).max(1000)}).strict();
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const sameRuntime=(a:z.infer<typeof runtime>,b:z.infer<typeof runtime>)=>a.version===b.version&&a.nativeProtocol===b.nativeProtocol&&a.archiveSha256===b.archiveSha256;

/** Read-only release selection. Historical records never acquire new source hashes. */
export async function readReleaseAcceptance(root:string,indexFile='docs/verification/index.json'){
 const read=async(file:string,limit=4*1024*1024)=>{const real=await evidenceFile(root,file),stat=await fs.stat(real);if(!stat.isFile()||stat.size>limit)throw Error('RELEASE_EVIDENCE_FILE_LIMIT');const bytes=await fs.readFile(real);if(bytes.length>limit)throw Error('RELEASE_EVIDENCE_FILE_LIMIT');return bytes;};
 const indexBytes=await read(indexFile,2*1024*1024),index=JSON.parse(indexBytes.toString('utf8'));
 const inventory=await readEvidenceInventory(root,indexFile);
 if(sha(await read(indexFile,2*1024*1024))!==sha(indexBytes))throw Error('RELEASE_INDEX_CHANGED_DURING_READ');
 const pinDocument=JSON.parse((await read('native-toolkit-release.json')).toString('utf8'));
 const pin=runtime.parse({version:pinDocument.version,nativeProtocol:pinDocument.nativeProtocol,archiveSha256:pinDocument.archiveSha256});
 const pending=inventory.pending.map(c=>({id:'coverage:'+c.id,state:c.state}));
 const base={schemaVersion:1,integrity:true,runtime:pin,roadmapReady:inventory.roadmapReady,recordCount:inventory.recordCount,matchingSourceScopes:inventory.matchingSourceScopes,changedSourceScopes:inventory.changedSourceScopes,scope:'Digest-bound current-release selection plus all required inventory coverage. Historical observations remain historical; no native execution, inferred equivalence or automatic human approval.'};
 if(index.currentRelease===undefined)return {...base,ready:false,currentNativeAcceptance:false,artAccepted:false,binding:null,pending:[...pending,{id:'current_release_binding',state:'not_bound'}]};
 const selected=pointer.parse(index.currentRelease),bytes=await read(selected.file,64*1024);
 if(sha(bytes)!==selected.sha256)throw Error('RELEASE_BINDING_DIGEST');
 const declared=binding.parse(JSON.parse(bytes.toString('utf8')));
 if(!sameRuntime(declared.runtime,pin))throw Error('RELEASE_BINDING_RUNTIME_MISMATCH');
 const acceptedRecord=async(recordId:string)=>{
  const row=inventory.records.find(r=>r.id===recordId),entry=index.records.find((r:{id:string})=>r.id===recordId);
  if(!row||!entry)throw Error('RELEASE_RECORD_NOT_INDEXED: '+recordId);
  if(row.role!=='scoped')throw Error('RELEASE_RECORD_HISTORICAL: '+recordId);
  const content=await read(entry.file);if(sha(content)!==entry.sha256)throw Error('RELEASE_RECORD_CHANGED_DURING_READ');
  return {row,content:JSON.parse(content.toString('utf8'))};
 };
 const native=await acceptedRecord(declared.nativeRecord),art=declared.artRecord===declared.nativeRecord?native:await acceptedRecord(declared.artRecord);
 const n=nativeAcceptance.parse(native.content.releaseAcceptance?.native),a=artAcceptance.parse(art.content.releaseAcceptance?.art);
 if(!sameRuntime(n.runtime,pin))throw Error('RELEASE_NATIVE_RUNTIME_MISMATCH');
 const currentNativeAcceptance=native.row.sourceScope==='matched'&&n.live==='passed'&&n.adapter==='passed';
 const artAccepted=art.row.sourceScope==='matched'&&a.state==='passed'&&a.humanApproval&&!!a.reviewer;
 if(!currentNativeAcceptance)pending.push({id:'native_release',state:native.row.sourceScope!=='matched'?'stale':n.live!=='passed'?n.live:n.adapter});
 if(!artAccepted)pending.push({id:'human_art_review',state:art.row.sourceScope!=='matched'?'stale':a.state!=='passed'?a.state:'not_approved'});
 return {...base,ready:inventory.roadmapReady&&currentNativeAcceptance&&artAccepted,currentNativeAcceptance,artAccepted,binding:{file:selected.file,sha256:selected.sha256,nativeRecord:declared.nativeRecord,artRecord:declared.artRecord},pending};
}
