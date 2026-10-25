import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as z from 'zod/v4';
import type {Workspace} from '../../core/workspace.js';
import {evidenceFile,readEvidenceInventory} from './evidenceInventory.js';
import {testManifestSchema} from './schemas.js';

const name=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
const relative=z.string().min(1).max(512).refine(v=>!path.isAbsolute(v)&&!v.includes('\\')&&!v.split('/').includes('..'),'Use a scoped relative path');
const hashes=z.record(relative,digest).refine(v=>Object.keys(v).length<=64,'At most64 fingerprint files');
export const qualityBindingsSchema=z.object({version:z.literal(1),bindings:z.array(z.object({id:name,label:z.string().min(1).max(160),scope:z.string().min(1).max(640),coverage:z.array(name).min(1).max(16),directory:relative.or(z.literal('')).default(''),manifest:relative,records:z.array(name).max(16).default([]),requiredViews:z.array(name).max(8).default([]),expectedInputs:hashes.default({}),expectedSources:hashes.default({})}).strict()).max(64)}).strict().refine(v=>new Set(v.bindings.map(b=>b.id)).size===v.bindings.length,'Binding IDs must be unique');
export const qualityPlanSchema=z.object({file:relative.optional(),indexFile:relative.optional(),coverage:z.array(name).min(1).max(16).optional(),bindingIds:z.array(name).min(1).max(8).optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(8).default(4)}).strict();
type Args=z.infer<typeof qualityPlanSchema>;
const packageRoot=fileURLToPath(new URL('../../../',import.meta.url));
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
async function json(root:string,file:string){const target=await evidenceFile(root,file),stat=await fs.stat(target);if(!stat.isFile()||stat.size>1024*1024)throw Error('QUALITY_JSON_BYTE_LIMIT');const bytes=await fs.readFile(target);if(bytes.length>1024*1024)throw Error('QUALITY_JSON_BYTE_LIMIT');return {value:JSON.parse(bytes.toString('utf8')),sha256:sha(bytes),file:target};}
async function fileDigest(root:string,file:string){
 const relativeFile=path.relative(path.resolve(root),path.resolve(root,file)).replaceAll('\\','/');
 const target=await evidenceFile(root,relativeFile),stat=await fs.stat(target);if(!stat.isFile()||stat.size>256*1024*1024)throw Error('QUALITY_FILE_BYTE_LIMIT');const hash=createHash('sha256');let total=0;
 for await(const chunk of createReadStream(target)){total+=chunk.length;if(total>256*1024*1024)throw Error('QUALITY_FILE_BYTE_LIMIT');hash.update(chunk);}return {file:target,sha256:hash.digest('hex')};
}
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
/** Discovery only: bind declared coverage to existing suites without leasing runtimes. */
export async function planQuality(workspace:Workspace,input:z.input<typeof qualityPlanSchema>,options:{packageRoot?:string}={}){
 const args:Args=qualityPlanSchema.parse(input),codeRoot=options.packageRoot??packageRoot;
 let evidenceRoot=workspace.root,indexFile=args.indexFile;
 if(!indexFile){evidenceRoot=codeRoot;indexFile='docs/verification/index.json';try{await evidenceFile(evidenceRoot,indexFile);}catch(error){if(!missing(error))throw error;evidenceRoot=path.dirname(codeRoot);}}
 const inventory=await readEvidenceInventory(evidenceRoot,indexFile,{allowMissingSources:true});
 const knownCoverage=new Set(inventory.coverage.map(c=>c.id)),knownRecords=new Map(inventory.records.map(r=>[r.id,r]));
 if(args.coverage?.some(id=>!knownCoverage.has(id)))throw Error('QUALITY_COVERAGE_UNKNOWN');
 const source=args.file?await json(workspace.root,args.file):undefined,bindings=source?qualityBindingsSchema.parse(source.value).bindings:[];
 for(const b of bindings)if(b.coverage.some(id=>!knownCoverage.has(id))||b.records.some(id=>!knownRecords.has(id)))throw Error('QUALITY_BINDING_REFERENCE_UNKNOWN: '+b.id);
 if(args.bindingIds?.some(id=>!bindings.some(b=>b.id===id)))throw Error('QUALITY_BINDING_UNKNOWN');
 const selected=bindings.filter(b=>(!args.coverage||b.coverage.some(id=>args.coverage!.includes(id)))&&(!args.bindingIds||args.bindingIds.includes(b.id)));
 const rows:Array<Record<string,unknown>>=[];
 const drafts=workspace.draftFiles().length+workspace.binary.draftFiles().length;
 for(const binding of selected.slice(args.offset,args.offset+args.limit)){
  const issues:Array<{code:string;file?:string;detail?:string}>=[],inputs:Array<{file:string;sha256?:string;state:string}>=[],sources:Array<{file:string;state:string}>=[];
  let root=workspace.root,manifest:ReturnType<typeof testManifestSchema.parse>|undefined,manifestFile:string|undefined;
  try{
   root=binding.directory?await evidenceFile(workspace.root,binding.directory):await fs.realpath(workspace.root);if(!(await fs.stat(root)).isDirectory())throw Error('QUALITY_DIRECTORY_REQUIRED');
   const item=await json(root,binding.manifest);manifest=testManifestSchema.parse(item.value);manifestFile=item.file;
   const inputName=(file:string)=>path.relative(root,path.resolve(root,file)).replaceAll('\\','/');
   const required=new Set([binding.manifest,manifest.map,...manifest.dependencies.map(d=>d.file)].map(inputName)),declared=new Set(Object.keys(binding.expectedInputs));
   for(const file of new Set([...required,...declared])){
    try{const current=await fileDigest(root,file),expected=binding.expectedInputs[file];inputs.push({file,sha256:current.sha256,state:expected?current.sha256===expected?'matched':'stale':'unbound'});}catch(error){if(!missing(error))throw error;inputs.push({file,state:'missing'});issues.push({code:'QUALITY_INPUT_MISSING',file});}
   }
   for(const view of binding.requiredViews)if(!manifest.game?.views.some(v=>v.id===view))issues.push({code:'QUALITY_REQUIRED_VIEW_MISSING',detail:view});
   for(const dependency of manifest.dependencies){const current=inputs.find(i=>i.file===inputName(dependency.file));if(dependency.sha256&&current?.sha256!==dependency.sha256)issues.push({code:'QUALITY_DECLARED_DEPENDENCY_STALE',file:dependency.file.slice(0,512)});}
  }catch(error){if(missing(error))issues.push({code:'QUALITY_MANIFEST_MISSING'});else throw error;}
  for(const [file,expected]of Object.entries(binding.expectedSources)){
   try{const current=await fileDigest(codeRoot,file);sources.push({file,state:current.sha256===expected?'matched':'stale'});}catch(error){if(!missing(error))throw error;sources.push({file,state:'unavailable'});}
  }
  const freshness=issues.some(i=>i.code.endsWith('MISSING'))?'missing':issues.some(i=>i.code.endsWith('STALE'))||inputs.some(i=>i.state==='stale')||sources.some(i=>i.state==='stale')?'stale':!inputs.length||inputs.some(i=>i.state!=='matched')||!sources.length||sources.some(i=>i.state!=='matched')?'unbound':'matched';
  const recordRefs=binding.records.map(id=>{const r=knownRecords.get(id)!;return{id,recordIntegrity:r.recordIntegrity,sourceScope:r.sourceScope};});
  rows.push({id:binding.id,label:binding.label,scope:binding.scope,coverage:binding.coverage,freshness,readyForPlan:issues.length===0&&!!manifest&&!drafts,issues:issues.slice(0,8),issuesTotal:issues.length,issuesTruncated:issues.length>8,inputs:inputs.slice(0,8),inputsTotal:inputs.length,inputsTruncated:inputs.length>8,sourceFingerprints:{total:sources.length,matched:sources.filter(s=>s.state==='matched').length,stale:sources.filter(s=>s.state==='stale').length,unavailable:sources.filter(s=>s.state==='unavailable').length,changed:sources.filter(s=>s.state!=='matched').slice(0,8)},records:recordRefs,
   ...(manifest?{suite:{editorChecks:manifest.editor?.checks??[],gameArtifact:manifest.editor?.gameArtifact??'source',routes:manifest.game?.routes.length??0,formations:manifest.game?.formations.length??0,pads:manifest.game?.pads.length??0,pathing:manifest.game?.pathing.length??0,views:manifest.game?.views.map(v=>v.id)??[]},next:{workspace:root,tool:'project.test.plan',args:{file:binding.manifest},manifestFile,repeat:2,cli:{argv:[process.execPath,path.join(codeRoot,'scripts/run-map-tests.mjs'),'--workspace',root,'--manifest',binding.manifest,'--repeat','2','--entry',path.join(codeRoot,'dist/index.js')],liveRequiresExplicitFlag:'--live'}}}:{})});
 }
 const filtered=inventory.coverage.filter(c=>!args.coverage||args.coverage.includes(c.id));
 const result={schemaVersion:1,readOnly:true,integrity:inventory.integrity,roadmapReady:inventory.roadmapReady,index:{file:path.resolve(evidenceRoot,indexFile),records:inventory.recordCount,matchingSourceScopes:inventory.matchingSourceScopes,changedSourceScopes:inventory.changedSourceScopes,unavailableSourceScopes:inventory.unavailableSourceScopes},bindingsFile:source?{file:source.file,sha256:source.sha256}:null,pendingDrafts:drafts,coverage:filtered.map(c=>({id:c.id,required:c.required,state:c.effectiveState,declaredState:c.state,recordCount:c.records.length,reason:String(c.reason??'').slice(0,320),bindings:bindings.filter(b=>b.coverage.includes(c.id)).map(b=>b.id).slice(0,8),bindingCount:bindings.filter(b=>b.coverage.includes(c.id)).length})),bindingsTotal:selected.length,offset:args.offset,nextOffset:args.offset+args.limit<selected.length?args.offset+args.limit:null,bindings:rows,scope:'Bounded discovery of digest-bound declarations and existing local manifests. Matching inputs only establish fingerprint freshness, never a native test pass or broad coverage upgrade. Missing portable source files stay unverified. No Editor/Game worker, lease, retry or map mutation; run the existing planner in the returned workspace and retain its original stop/cleanup policy.'};
 if(Buffer.byteLength(JSON.stringify(result))>64*1024)throw Error('QUALITY_OUTPUT_LIMIT: reduce limit or select coverage');return result;
}
