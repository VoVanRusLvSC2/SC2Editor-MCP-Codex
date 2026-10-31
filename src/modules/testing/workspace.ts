import {promises as fs} from 'node:fs';
import type * as z from 'zod/v4';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Workspace} from '../../core/workspace.js';
import {NativeGameBridge} from '../../integrations/game/bridge.js';
import {NativeEditorBridge} from '../../integrations/native/bridge.js';
import type {GameResult} from '../../integrations/game/transport.js';
import {inspectArchive} from '../../archive/archiveAdapter.js';
import {readArchiveTerrainLoadContract} from '../../archive/terrainLoadContract.js';
import {testManifestSchema,testVerdict,type TestManifest,type TestCheck,type CheckState} from './schemas.js';
import {NativeWorkflowGate} from './gate.js';
import {readArchiveMapInfo,routeBoundsCheck} from './playableBounds.js';
import {observeStartupEvents} from './startupEvents.js';
import {runActionCheck} from './actionChecks.js';
import {testStorageChecks,type StorageProbe} from './storagePreflight.js';
import {runFormationCheck} from './formationChecks.js';
import {runCombatCheck} from './combatChecks.js';
import {runPresentationCheck,readOwnedRecordingMedia} from './presentationChecks.js';
import {runRouteCheck} from './routeChecks.js';
import {preparePadProbe} from './padPreparation.js';
import {observePadQueries} from './padChecks.js';
import {planQuality,qualityPlanSchema} from './qualityPlan.js';
import {prepareVisualReview,recordVisualObservations,visualReviewSchema,visualObservationSchema,type VisualReviewContext} from './visualReview.js';
import {compareVisualReviews,visualCompareSchema} from './visualReview.js';

type Game=Pick<NativeGameBridge,'configuration'|'status'|'attach'|'call'|'detach'> & Partial<Pick<NativeGameBridge,'action'>>;
type Editor=Pick<NativeEditorBridge,'status'|'check'|'job'|'readWorkerArtifact'>;
interface Runtime {game:Game;editor:Editor}
interface Identity {file:string;sha256:string;id?:string}
interface Plan {id:string;manifest:TestManifest;manifestSha256:string;manifestFile?:Identity;source:Identity;dependencies:Identity[];issues:TestCheck[];capabilities:Record<string,unknown>}
interface Job {id:string;plan:Plan;state:'queued'|'running'|'completed'|'cancelled';phase:string;cancelRequested:boolean;createdAt:string;finishedAt?:string;checks:TestCheck[];directory:string;reportPersistence?:'memory_only'|'workspace_file';error?:string;gameRuntime?:ReturnType<NativeGameBridge['configuration']>['runtimeIdentity'];testedArtifact?:Identity&{origin:'source'|'native_saved'};nativeProgress?:{jobId:string;state:string;phase:string;startedAt?:string;deadlineExceeded:boolean}}
export const testBody=(r:GameResult):Record<string,any>=>{
 if(r.structuredContent)return r.structuredContent;
 for(const c of r.content)if(c.type==='text'){try{return JSON.parse(c.text);}catch{/* Preserve unreadable status as inconclusive. */}}
 return {status:'inconclusive',reason:'No structured runtime response'};
};
const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function responseState(r:GameResult):CheckState {const s=testBody(r).status;return s==='unsupported'?'unsupported':s==='inconclusive'||s==='timeout'?'inconclusive':r.isError||s==='failed'?'failed':s==='ok'||s==='passed'?'passed':'inconclusive';}
function runtimeReason(body:Record<string,any>,fallback:string):string {
 const message=[body.reason,body.error,body.message].find(v=>typeof v==='string'&&v.trim());
 return (typeof message==='string'?message:fallback).replace(/\p{Cc}/gu,' ').trim().slice(0,640);
}
export function gameLaunchCheck(r:GameResult,required:boolean):TestCheck {
 const body=testBody(r),upstream=responseState(r),confirmed=body.mapConfirmed===true;
 const status=upstream==='passed'&&!confirmed?'inconclusive':upstream;
 const reason=status==='passed'?undefined:runtimeReason(body,status==='unsupported'?'The runtime does not support this launch request':status==='inconclusive'?'The runtime did not confirm the requested map with a live Galaxy handshake':'The runtime reported an error while attaching the requested map');
 // Adjacent Script code lines may contain private instrumentation. Promote only
 // bounded compiler summary lines; keep the complete response local.
 const compilerDiagnostics=body.error==='map_compile_failed'&&typeof body.details==='string'?body.details.split(/\r?\n/).filter((s:string)=>/^\s*Script compile error:/i.test(s)).slice(0,3).map((s:string)=>s.replace(/\p{Cc}/gu,' ').trim().slice(0,640)):[];
 return {id:'game.launch',status,required,reason,evidence:{mapConfirmed:confirmed,hidden:body.hidden===true,nativeStatus:typeof body.status==='string'?body.status.slice(0,32):'unknown',runtimeError:r.isError===true,confirmation:confirmed?'confirmed':'unconfirmed',...(compilerDiagnostics.length?{compilerDiagnostics}:{})}};
}

/** Reusable map suites lease the project's retained bridges and use private archives. */
export class ProjectTestWorkspace {
 private visualContext(id: string, historical = false): VisualReviewContext {
  const job = this.jobs.get(id);
  if (!job) throw Error('TEST_JOB_UNKNOWN');
  return {
   id: job.id,
   state: job.state,
   directory: job.directory,
   sourceSha256: job.plan.source.sha256,
   testedSha256: job.testedArtifact?.sha256 ?? job.plan.source.sha256,
   checks: job.checks,
   unchanged: async () => {
    if(historical&&!job.testedArtifact)throw Error('VISUAL_COMPARE_HISTORICAL_ARTIFACT_REQUIRED');
    if(!historical)await this.unchanged(job.plan);
    if (job.testedArtifact && (await this.identity(job.testedArtifact.file)).sha256 !== job.testedArtifact.sha256)
     throw Error('VISUAL_REVIEW_TESTED_ARTIFACT_STALE');
   },
  };
 }
 review(input: z.input<typeof visualReviewSchema>) {
  const args = visualReviewSchema.parse(input);
  return prepareVisualReview(this.workspace, this.visualContext(args.jobId), args);
 }
 observe(input: z.input<typeof visualObservationSchema>) {
  const args = visualObservationSchema.parse(input);
  return recordVisualObservations(this.workspace, this.visualContext(args.jobId), args);
 }
 compare(input:z.input<typeof visualCompareSchema>){const args=visualCompareSchema.parse(input);return compareVisualReviews(this.workspace,this.visualContext(args.baselineJobId,true),this.visualContext(args.candidateJobId),args);}
 qualityPlan(args:z.input<typeof qualityPlanSchema>){return planQuality(this.workspace,args);}
 private plans=new Map<string,Plan>();private jobs=new Map<string,Job>();private tail:Promise<void>=Promise.resolve();private closing=false;
 private mapInfoCache=new Map<string,Buffer>();
 private terrainLoadCache=new Map<string,TestCheck|undefined>();
 readonly work:string;
 constructor(readonly workspace:Workspace,private options:{runtime:Runtime;gate:NativeWorkflowGate;inspect?:(file:string)=>Promise<unknown>;mapInfo?:(file:string)=>Promise<Buffer>;terrainLoad?:(file:string)=>Promise<Awaited<ReturnType<typeof readArchiveTerrainLoadContract>>>;storageProbe?:StorageProbe;pollMs?:number}){this.work=workspace.resolveUserPath('.sc2mcp-output/project-tests');}
 private pending(){if(this.workspace.draftFiles().length||this.workspace.binary.draftFiles().length)throw Error('TEST_PENDING_DRAFTS: save or discard complete groups first');}
 private async identity(file:string,id?:string):Promise<Identity>{const real=await fs.realpath(this.workspace.resolveUserPath(file));this.workspace.resolveUserPath(real);if(!(await fs.stat(real)).isFile())throw Error('TEST_FILE_REQUIRED: '+file);return {file:real,sha256:digest(await fs.readFile(real)),...(id?{id}:{})};}
 private async unchanged(p:Plan){for(const f of [p.source,...p.dependencies,...(p.manifestFile?[p.manifestFile]:[])])if((await this.identity(f.file,f.id)).sha256!==f.sha256)throw Error('TEST_INPUT_STALE: '+f.file);}
 private async storageChecks(manifest:TestManifest,source:Identity){
  const config=this.options.runtime.game.configuration();
  return testStorageChecks({directory:this.work,...typeof config.work==='string'?{gameDirectory:config.work}:{},sourceBytes:(await fs.stat(source.file)).size,manifest},this.options.storageProbe);
 }
 private async terrainLoadCheck(source:Identity):Promise<TestCheck|undefined>{
  if(this.terrainLoadCache.has(source.sha256))return this.terrainLoadCache.get(source.sha256);
  let check:TestCheck|undefined;
  try{
   const result=this.options.terrainLoad?await this.options.terrainLoad(source.file):await readArchiveTerrainLoadContract(source.file,await (this.options.inspect??inspectArchive)(source.file));
   if((await this.identity(source.file)).sha256!==source.sha256)throw Error('TEST_INPUT_STALE_DURING_TERRAIN_LOAD_CHECK');
   if(result.kind==='checked'){
    const invalid=result.result.issues.some(i=>i.severity==='error');
    check={id:'map.terrain_load',status:invalid?'failed':result.result.valid?'passed':'unsupported',required:invalid,reason:invalid?'Known invalid native terrain load structure: '+result.result.issues.map(i=>i.message).join('; ').slice(0,900)+'; inspect terrain.load.repair before launching':result.result.valid?undefined:'Native load profile is not verified; original structure is preserved',evidence:{sha256:source.sha256,contract:result.result}};
   }else if(result.kind==='unavailable')check={id:'map.terrain_load',status:'unsupported',required:false,reason:'Bounded terrain load inspection unavailable: '+result.reason};
  }catch(e){if(String(e).includes('TEST_INPUT_STALE'))throw e;check={id:'map.terrain_load',status:'unsupported',required:false,reason:('Terrain load preflight unavailable: '+String(e)).slice(0,640)};}
  if(this.terrainLoadCache.size>=32)this.terrainLoadCache.delete(this.terrainLoadCache.keys().next().value!);
  this.terrainLoadCache.set(source.sha256,check);return check;
 }
 private async playableBoundsCheck(manifest:TestManifest,artifact:Identity):Promise<TestCheck|undefined>{
  if(!manifest.game||!(manifest.game.routes.length||manifest.game.formations.length||manifest.game.combats.length||manifest.game.pads.length||manifest.game.pathing.length))return;
  try{
   if((await this.identity(artifact.file)).sha256!==artifact.sha256)throw Error('TEST_EXECUTED_ARTIFACT_CHANGED');
   let bytes=this.mapInfoCache.get(artifact.sha256);
   if(!bytes){bytes=await (this.options.mapInfo??readArchiveMapInfo)(artifact.file);if((await this.identity(artifact.file)).sha256!==artifact.sha256)throw Error('TEST_EXECUTED_ARTIFACT_CHANGED');if(bytes.length>1024*1024)throw Error('TEST_MAPINFO_SIZE_LIMIT');if(this.mapInfoCache.size>=32)this.mapInfoCache.delete(this.mapInfoCache.keys().next().value!);this.mapInfoCache.set(artifact.sha256,Buffer.from(bytes));}
   return routeBoundsCheck(manifest,bytes);
  }catch(e){return {id:'map.playable_bounds',status:'unsupported',required:true,reason:('TEST_ROUTE_BOUNDS_UNAVAILABLE: '+String(e)).slice(0,640)};}
 }
 async plan(input:unknown){
  this.pending();const manifest=testManifestSchema.parse(input),source=await this.identity(manifest.map);
  if(!/\.sc2map$/i.test(source.file))throw Error('TEST_SAVED_SC2MAP_REQUIRED');
  const dependencies:Identity[]=[],issues:TestCheck[]=[];
  if(manifest.editor&&(manifest.editor.checks.includes('compile')||manifest.editor.gameArtifact==='native_saved')&&!manifest.editor.contextLabel?.trim())issues.push({id:'editor.compile_context',status:'unsupported',required:true,reason:'TEST_COMPILE_CONTEXT_REQUIRED: the pinned GUI compiler needs the actual authored root/library contextLabel, including native-saved artifact recompilation. Empty GUI trees with separate Galaxy startup require source-artifact game execution and separate native load/save checks; do not invent a label.'});
  for(const d of manifest.dependencies){try{const value=await this.identity(d.file,d.id);if(d.sha256&&value.sha256!==d.sha256)throw Error('Dependency digest mismatch');dependencies.push(value);}catch(e){issues.push({id:'dependency:'+d.id,status:'failed',required:true,reason:String(e)});}}
  const storage=await this.storageChecks(manifest,source);issues.push(...storage.filter(c=>c.status!=='passed'));
  const load=await this.terrainLoadCheck(source);if(load&&load.status!=='passed')issues.push(load);
  // Source metadata can reject invalid routes before an expensive Editor job.
  // The exact native-saved artifact is still checked separately before launch.
  const bounds=await this.playableBoundsCheck(manifest,source);if(bounds&&bounds.status!=='passed')issues.push({...bounds,id:'source.playable_bounds'});
  const game=this.options.runtime.game.configuration();
  if(manifest.game&&(!game.configured||!game.launchEnabled))issues.push({id:'game.configuration',status:'unsupported',required:manifest.game.required,reason:'Configure SC2_GAME_TOOLKIT_HOME and explicitly enable SC2_GAME_ALLOW_LAUNCH=1'});
  if(manifest.game?.routes.some(r=>r.expected==='blocked'))issues.push({id:'navigation.authoritative_query',status:'unsupported',required:false,reason:'Movement non-arrival cannot prove an obstruction. Explicit game.pathing checks report separate native point predicates; they do not certify this unit footprint or the later movement Game state'});
  const p:Plan={id:randomUUID(),manifest,manifestSha256:digest(JSON.stringify(manifest)),source,dependencies,issues,capabilities:{game,groundMobility:'Declared by the test author; runtime inspection does not expose the movement plane',dependencyScope:'Explicit file digests plus native load and observed runtime build; installed transitive dependencies are not fully pinned'}};
  if(this.plans.size>=32)this.plans.delete(this.plans.keys().next().value!);this.plans.set(p.id,p);
  return {planId:p.id,map:manifest.map,sourceSha256:source.sha256,manifestSha256:p.manifestSha256,dependencies:dependencies.map(d=>({id:d.id,sha256:d.sha256})),issues,storage,capabilities:p.capabilities,suites:{editor:manifest.editor?.checks??[],routes:manifest.game?.routes.length??0,formations:manifest.game?.formations.length??0,combats:manifest.game?.combats.length??0,presentations:manifest.game?.presentations.length??0,...(manifest.game?.pads.length?{pads:manifest.game.pads.length}:{}),...(manifest.game?.pathing.length?{pathing:manifest.game.pathing.length}:{}),scenarios:manifest.game?.scenarios.length??0,actions:manifest.game?.actions.length??0,views:manifest.game?.views.length??0},ready:!issues.some(c=>c.required&&c.status!=='passed')};
 }
 async planFile(file:string){const source=await this.identity(file),bytes=await fs.readFile(source.file);if(bytes.length>256*1024)throw Error('TEST_MANIFEST_SIZE_LIMIT');if(digest(bytes)!==source.sha256)throw Error('TEST_MANIFEST_STALE');const result=await this.plan(JSON.parse(bytes.toString('utf8')));this.plans.get(result.planId)!.manifestFile=source;return {...result,manifestFileSha256:source.sha256};}
 async run(planId:string){
  if(this.closing)throw Error('TEST_RUNNER_CLOSING');this.pending();const plan=this.plans.get(planId);if(!plan)throw Error('TEST_PLAN_UNKNOWN');await this.unchanged(plan);
  if(plan.issues.some(c=>c.required&&c.status!=='passed'))throw Error('TEST_PLAN_BLOCKED: resolve required plan issues');
  const storage=await this.storageChecks(plan.manifest,plan.source);if(storage.some(c=>c.status!=='passed'))throw Error('TEST_STORAGE_BLOCKED: '+storage.filter(c=>c.status!=='passed').map(c=>c.reason).join('; ').slice(0,900));
  if([...this.jobs.values()].filter(j=>j.state==='queued'||j.state==='running').length>=4)throw Error('TEST_QUEUE_FULL');
  for(const [id,j]of this.jobs)if(this.jobs.size>=32&&j.state!=='queued'&&j.state!=='running')this.jobs.delete(id);
  const id=randomUUID(),job:Job={id,plan,state:'queued',phase:'queued',cancelRequested:false,createdAt:new Date().toISOString(),checks:[],directory:path.join(this.work,id)};this.jobs.set(id,job);
  this.tail=this.tail.then(()=>this.execute(job)).catch(e=>{job.error=String(e);job.state='completed';job.checks.push({id:'runner',status:'failed',required:true,reason:String(e)});});
  return this.status(id);
 }
 status(id:string){const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');return {jobId:id,state:j.state,phase:j.phase,nativeProgress:j.nativeProgress?{...j.nativeProgress,elapsedSeconds:j.nativeProgress.startedAt?Math.max(0,Math.floor((Date.now()-Date.parse(j.nativeProgress.startedAt))/1000)):undefined}:undefined,cancelRequested:j.cancelRequested,createdAt:j.createdAt,finishedAt:j.finishedAt,outcome:j.state==='completed'?testVerdict(j.checks):null,checks:j.checks.map(({id,status,required,reason})=>({id,status,required,reason})),sourceSha256:j.plan.source.sha256,testedArtifact:j.testedArtifact,gameRuntime:j.gameRuntime,report:j.reportPersistence==='memory_only'?undefined:path.join(j.directory,'result.json'),reportPersistence:j.reportPersistence??'pending',error:j.error};}
 async report(id:string,offset=0,limit=10){const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');let current=true;try{await this.unchanged(j.plan);if(j.testedArtifact&&(await this.identity(j.testedArtifact.file)).sha256!==j.testedArtifact.sha256)current=false;}catch{current=false;}return {...this.status(id),current,evidenceValidForCurrentInputs:current&&j.state==='completed',checks:j.checks.slice(offset,offset+limit),offset,nextOffset:offset+limit<j.checks.length?offset+limit:null,total:j.checks.length,manifestSha256:j.plan.manifestSha256,capabilities:j.plan.capabilities};}
 cancel(id:string){const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');if(j.state==='queued'||j.state==='running')j.cancelRequested=true;return this.status(id);}
 async image(id:string,viewId?:string,formation?:{id:string;direction:'forward'|'reverse'}){
  const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');
  if(viewId&&formation)throw Error('TEST_IMAGE_SELECTOR_CONFLICT');
  if(viewId&&!j.plan.manifest.game?.views.some(v=>v.id===viewId))throw Error('TEST_VIEW_UNKNOWN');
  if(formation){const spec=j.plan.manifest.game?.formations.find(v=>v.id===formation.id);if(!spec||!spec.viewId||formation.direction==='reverse'&&!spec.bidirectional)throw Error('TEST_FORMATION_IMAGE_UNKNOWN');}
  const checkId=formation?'formation:'+formation.id+':'+formation.direction+':frame':viewId?'view:'+viewId:'game.capture';
  const check=j.checks.find(c=>c.id===checkId);if(check?.status!=='passed'||typeof check.evidence?.sha256!=='string')throw Error('TEST_IMAGE_UNCONFIRMED');
  const file=path.join(j.directory,formation?'Formation_'+formation.id+'_'+formation.direction+'.png':viewId?'View_'+viewId+'.png':'Game.png'),b=await fs.readFile(file);
  if(b.length>6*1024*1024||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||digest(b)!==check.evidence.sha256)throw Error('TEST_IMAGE_INVALID');
  return {type:'image' as const,mimeType:'image/png',data:b.toString('base64')};
 }
 private checkCancel(j:Job){if(j.cancelRequested)throw Error('TEST_CANCEL_REQUESTED');}
 private async record(j:Job,id:string,value:unknown){await fs.writeFile(path.join(j.directory,id.replace(/[^a-z0-9_-]/gi,'_')+'.json'),JSON.stringify(value,null,2)+'\n');}
 private async waitNative(j:Job,editor:Editor,id:string){
  let native=editor.job(id);
  for(;;){
   j.nativeProgress={jobId:id,state:native.state,phase:native.phase,startedAt:native.startedAt,deadlineExceeded:native.deadlineExceeded};
   if(native.state!=='queued'&&native.state!=='running')return native;
   // Cancellation remains cooperative: never abandon an active native handler.
   await delay(this.options.pollMs??250);native=editor.job(id);
  }
 }
 private async execute(j:Job){
  let runtime:Runtime|undefined,attemptedAttach=false,release:(()=>void)|undefined,outputPrepared=false;const m=j.plan.manifest;
  j.state='running';
  try{
   this.checkCancel(j);j.phase='storage';const storage=await this.storageChecks(m,j.plan.source);j.checks.push(...storage);if(storage.some(c=>c.status!=='passed')){j.reportPersistence='memory_only';return;}
   await fs.mkdir(j.directory,{recursive:true});outputPrepared=true;this.checkCancel(j);await this.unchanged(j.plan);j.phase='static';
   await (this.options.inspect??inspectArchive)(j.plan.source.file);j.checks.push({id:'archive',status:'passed',required:true});
   const copy=path.join(j.directory,'Input.SC2Map');await fs.copyFile(j.plan.source.file,copy);if(digest(await fs.readFile(copy))!==j.plan.source.sha256)throw Error('TEST_SNAPSHOT_CHANGED');
   this.checkCancel(j);release=this.options.gate.acquire(j.id);
   const shared=this.options.runtime;
   const gameStatus=await shared.game.status();
   const editorStatus=await shared.editor.status();
   if(gameStatus.source||editorStatus.jobs.some(v=>v.state==='queued'||v.state==='running'))throw Error('TEST_NATIVE_SESSION_BUSY: finish the existing native operation first');
   runtime=shared;let privateArchive=path.relative(this.workspace.root,copy).replaceAll('\\','/');
   j.testedArtifact={file:copy,sha256:j.plan.source.sha256,origin:'source'};
   if(m.editor){
    const context={...(m.editor.scope?{scope:m.editor.scope}:{}),...(m.editor.contextLabel?{contextLabel:m.editor.contextLabel}:{}),...(m.editor.locale?{locale:m.editor.locale}:{})};
    this.checkCancel(j);j.phase='editor';const started=await runtime.editor.check({archive:privateArchive,checks:m.editor.checks,...context,includeDiffs:false,renderBackend:m.editor.renderBackend,deadlineSeconds:1200});
    const native=await this.waitNative(j,runtime.editor,started.id);
    await this.record(j,'editor',native);
    const r=native.result,negative=m.editor.expected!=='passed';
    const failure=m.editor.expected==='compile_failed'?r?.checks?.compile:r?.checks?.load;
    const messages=JSON.stringify({error:failure?.error,newErrors:failure?.diagnostics?.newErrors,compilerErrors:failure?.diagnostics?.compilerErrors});
    const expectedFailure=(m.editor.expected==='compile_failed'?failure?.nativeCompilePassed===false:m.editor.expected==='load_failed'?failure?.status==='FAILED':false)&&!!m.editor.diagnosticIncludes&&messages.includes(m.editor.diagnosticIncludes);
    const status:CheckState=negative?(expectedFailure?'passed':'failed'):r?.outcome==='passed'?'passed':r?.outcome==='incomplete'?'inconclusive':'failed';
    const failedPhase=['open','load','save_reopen','compile'].map(phase=>({phase,value:r?.checks?.[phase]})).find(({value})=>value&&(value.error||value.status==='FAILED'||value.nativeCompilePassed===false||value.nativeValidationPassed===false));
    const reason=status==='passed'?undefined:runtimeReason(failedPhase?.value??{error:native.error},negative?'The expected native failure and diagnostic were not confirmed':`Native Editor ${failedPhase?.phase??'validation'} was not confirmed`);
    j.checks.push({id:'editor',status,required:m.editor.required,reason,evidence:{nativeJobId:started.id,report:native.report,expected:m.editor.expected}});
    if(negative||m.editor.required&&status!=='passed')return;
    if(m.editor.gameArtifact==='native_saved'){
     this.checkCancel(j);j.phase='native_artifact';
     const saved=r?.checks?.save_reopen,a=saved?.savedArchive;
     if(status!=='passed'||saved?.nativeSaveVerified!==true||saved?.nativeReopenVerified!==true||saved?.componentComparison?.savedToReopenedEqual!==true||typeof a?.path!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256??''))throw Error('TEST_NATIVE_ARTIFACT_UNCONFIRMED');
     if(typeof editorStatus.workerDirectory!=='string'||!path.isAbsolute(editorStatus.workerDirectory))throw Error('TEST_NATIVE_WORKER_IDENTITY_UNAVAILABLE');
     if(!/\.sc2map$/i.test(a.path))throw Error('TEST_NATIVE_ARTIFACT_OUTSIDE_WORKER');
     const bytes=await runtime.editor.readWorkerArtifact(a.path);if(digest(bytes)!==a.sha256||bytes.length!==a.bytes)throw Error('TEST_NATIVE_ARTIFACT_DIGEST_MISMATCH');
     const final=path.join(j.directory,'Final.SC2Map');await fs.writeFile(final,bytes);
     await (this.options.inspect??inspectArchive)(final);
     j.testedArtifact={file:final,sha256:a.sha256,origin:'native_saved'};
     privateArchive=path.relative(this.workspace.root,final).replaceAll('\\','/');
     // Revalidate the exact archive that will launch, rather than transferring the
     // original snapshot's load/compile result across native serialization changes.
     const validation=await runtime.editor.check({archive:privateArchive,checks:['load','compile'],...context,includeDiffs:false,renderBackend:m.editor.renderBackend,deadlineSeconds:1200});
     const verified=await this.waitNative(j,runtime.editor,validation.id);
     await this.record(j,'native_artifact',verified);
     const accepted=verified.result?.outcome==='passed'&&verified.result?.sourceSha256===a.sha256&&verified.result?.sourceUnchanged===true&&(await this.identity(final)).sha256===a.sha256;
     j.checks.push({id:'editor.game_artifact',status:accepted?'passed':'failed',required:true,evidence:{nativeJobId:validation.id,report:verified.report,sha256:a.sha256,changedByNativeSave:a.sha256!==j.plan.source.sha256}});
     if(!accepted)return;
    }
   }
   if(j.testedArtifact){const load=await this.terrainLoadCheck(j.testedArtifact);if(load){j.checks.push(load);if(load.status==='failed')return;}}
   if(m.game&&(m.game.routes.length||m.game.formations.length||m.game.combats.length||m.game.pads.length||m.game.pathing.length)){
    this.checkCancel(j);j.phase='map.playable_bounds';const check=(await this.playableBoundsCheck(m,j.testedArtifact!))!;
    j.checks.push(check);if(check.status!=='passed')return;
   }
   if(m.game&&(m.game.pads.length||m.game.pathing.length)&&!await this.pads(j,runtime))return;
   const mainGame=m.game&&(!(m.game.pads.length||m.game.pathing.length)||m.game.ready||m.game.startupEvents.length||m.game.routes.length||m.game.formations.length||m.game.combats.length||m.game.scenarios.length||m.game.actions.length||m.game.presentations.length||m.game.views.length||m.game.capture||m.game.diagnostics.required);
   if(m.game&&mainGame){this.checkCancel(j);j.phase='launch';const config=runtime.game.configuration();if(!config.configured||!config.launchEnabled){j.checks.push({id:'game.launch',status:'unsupported',required:m.game.required,reason:'Game runtime or explicit launch configuration unavailable'});return;}attemptedAttach=true;const attached=await runtime.game.attach(privateArchive,m.game.timeout,m.game.renderBackend);j.gameRuntime=runtime.game.configuration().runtimeIdentity;await this.record(j,'launch',attached);
    j.checks.push(gameLaunchCheck(attached,m.game.required));
    if(j.checks.at(-1)!.status!=='passed'){
     if(m.game.launchDiagnostics&&!j.cancelRequested){
      j.phase='launch_diagnostics';
      try{
       const debug=await runtime.game.call('game.debug.inspect',{open:false,offset:0,limit:16,text_offset:0,text_limit:2048});
       await this.record(j,'launch_debug',debug);
       j.checks.push({id:'game.launch_diagnostics',status:responseState(debug)==='unsupported'?'unsupported':'inconclusive',required:false,reason:'Read-only owned debugger snapshot; map execution remains unconfirmed',evidence:{report:path.join(j.directory,'launch_debug.json'),nativeStatus:String(testBody(debug).status??'unknown').slice(0,32),runtimeError:debug.isError===true,openRequested:false}});
      }catch(e){j.checks.push({id:'game.launch_diagnostics',status:'inconclusive',required:false,reason:('Owned debugger snapshot unavailable: '+String(e)).slice(0,640)});}
      if(!j.cancelRequested)try{
       const captured=await runtime.game.call('game.capture',{include_ui:true}),png=captured.content.find(c=>c.type==='image');
       await this.record(j,'launch_capture',testBody(captured));
       const bytes=png?.type==='image'?Buffer.from(png.data,'base64'):undefined;
       if(responseState(captured)==='passed'&&bytes&&bytes.length<=6*1024*1024&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
        const file=path.join(j.directory,'Launch.png');await fs.writeFile(file,bytes);
        j.checks.push({id:'game.launch_capture',status:'passed',required:false,reason:'Valid owned-process diagnostic frame; map execution remains unconfirmed',evidence:{file,sha256:digest(bytes),includeUI:true,purpose:'launch_diagnostics',mapConfirmed:false,visualReview:'not_checked'}});
       }else j.checks.push({id:'game.launch_capture',status:'inconclusive',required:false,reason:runtimeReason(testBody(captured),'No valid bounded owned-process diagnostic PNG returned'),evidence:{report:path.join(j.directory,'launch_capture.json'),nativeStatus:String(testBody(captured).status??'unknown').slice(0,32),runtimeError:captured.isError===true}});
      }catch(e){j.checks.push({id:'game.launch_capture',status:'inconclusive',required:false,reason:('Owned-process diagnostic capture unavailable: '+String(e)).slice(0,640)});}
     }
     return;
    }
    const state=await runtime.game.call('game.status',{});await this.record(j,'runtime',state);const stateBody=testBody(state),build=String(stateBody.versionSupport?.observedVersion??stateBody.native?.game?.version??stateBody.gameVersion??'unknown');
    j.checks.push({id:'game.build',status:m.expectedGameBuild?(build===m.expectedGameBuild?'passed':'failed'):'not_checked',required:!!m.expectedGameBuild,evidence:{observed:build}});if(m.expectedGameBuild&&build!==m.expectedGameBuild)return;
    if(m.game.ready){
     j.phase='ready';const ready=m.game.ready,end=Date.now()+ready.timeout*1000;let found=false;
     do{
      this.checkCancel(j);const r=await runtime.game.call('game.units.find',{type:ready.type,...(ready.owner===undefined?{}:{owner:ready.owner}),...(ready.area?{area:ready.area}:{}),limit:ready.state?16:1});await this.record(j,'readiness',r);if(responseState(r)!=='passed')break;
      for(const u of (testBody(r).units??[]).slice(0,16)){
       if(!u.valid||!u.alive)continue;
       if(!ready.state){found=true;break;}
       if(typeof u.id!=='string')continue;
       this.checkCancel(j);const inspected=await runtime.game.call('game.units.inspect',{unit:u.id});await this.record(j,'readiness_state',inspected);const unit=testBody(inspected).unit;
       const inArea=!ready.area||Number.isFinite(unit?.position?.x)&&Number.isFinite(unit?.position?.y)&&unit.position.x>=ready.area.xmin&&unit.position.x<=ready.area.xmax&&unit.position.y>=ready.area.ymin&&unit.position.y<=ready.area.ymax;
       if(responseState(inspected)==='passed'&&unit?.valid===true&&unit.alive===true&&unit.type===ready.type&&(ready.owner===undefined||unit.owner===ready.owner)&&inArea&&Object.entries(ready.state).every(([key,value])=>unit[key]===value)){found=true;break;}
      }
      if(found)break;await delay(this.options.pollMs??250);
     }while(Date.now()<end);
     j.checks.push({id:'game.ready',status:found?'passed':'failed',required:true,reason:found?undefined:'Named startup unit and any declared vitals were not observed before the deadline'});if(!found)return;
    }
    const before=await runtime.game.call('game.diagnostics',{limit:128});await this.record(j,'diagnostics_before',before);
    if(m.game.startupEvents.length){
     j.phase='startup_events';
     j.checks.push(...await observeStartupEvents(m.game.startupEvents,{call:(method,args)=>runtime!.game.call(method,args),body:testBody,checkCancel:()=>this.checkCancel(j),pollMs:this.options.pollMs,record:async(page,result)=>{const id='startup_events_'+page;await this.record(j,id,result);return path.join(j.directory,id+'.json');}}));
    }
    for(const route of m.game.routes){for(const reverse of route.bidirectional?[false,true]:[false]){this.checkCancel(j);j.phase='route:'+route.id;if(!await this.route(j,runtime.game,route,reverse))return;}}
    for(const formation of m.game.formations)for(const reverse of formation.bidirectional?[false,true]:[false]){
     this.checkCancel(j);j.phase='formation:'+formation.id;const direction=reverse?'reverse':'forward',prefix='formation_'+formation.id+'_'+direction;
     const selected=formation.viewId?m.game.views.find(v=>v.id===formation.viewId):undefined;
     const result=await runFormationCheck(formation,m.game.points[reverse?formation.to:formation.from],m.game.points[reverse?formation.from:formation.to],reverse,{
      call:(method,args)=>runtime!.game.call(method,args),body:testBody,state:responseState,checkCancel:()=>this.checkCancel(j),pollMs:this.options.pollMs,
      record:async(name,value)=>{const stem=prefix+'_'+name;await this.record(j,stem,value);return path.join(j.directory,stem+'.json');},
      ...(selected?{captureRequired:formation.required&&selected.required,capture:()=>this.view(j,runtime!.game,{...selected,required:formation.required&&selected.required},{id:'formation:'+formation.id+':'+direction+':frame',file:'Formation_'+formation.id+'_'+direction+'.png'})}:{})
     });
     j.checks.push(...result.checks);if(!result.continueSuite)return;
    }
    for(const combat of m.game.combats){
     this.checkCancel(j);j.phase='combat:'+combat.id;
     const selected=combat.viewId?m.game.views.find(v=>v.id===combat.viewId):undefined;
     const result=await runCombatCheck(combat,m.game.points,{
      call:(method,args)=>runtime!.game.call(method,args),body:testBody,state:responseState,checkCancel:()=>this.checkCancel(j),pollMs:this.options.pollMs,
      record:async(name,value)=>{const stem='combat_'+combat.id+'_'+name;await this.record(j,stem,value);return path.join(j.directory,stem+'.json');},
      ...(selected?{capture:()=>this.view(j,runtime!.game,selected,{id:'combat:'+combat.id+':frame',file:'Combat_'+combat.id+'.png'})}:{})
     });
     j.checks.push(...result.checks);if(!result.continueSuite)return;
    }
    for(const s of m.game.scenarios){this.checkCancel(j);j.phase='scenario:'+s.id;const r=await runtime.game.call('game.test.run',{steps:s.steps});await this.record(j,'scenario_'+s.id,r);j.checks.push({id:'scenario:'+s.id,status:responseState(r),required:s.required,evidence:{report:path.join(j.directory,'scenario_'+s.id+'.json')}});}
    let actionBlocked=false;
    for(const action of m.game.actions){
     this.checkCancel(j);j.phase='action:'+action.id;
     if(actionBlocked){const skipped={status:'inconclusive' as const,reason:'A prior action check was not confirmed; this action was not submitted',actionSubmitted:false};await this.record(j,'action_'+action.id+'_result',skipped);j.checks.push({id:'action:'+action.id,...skipped,required:action.required});continue;}
     const observed=await runActionCheck(action,{call:(method,args)=>runtime!.game.call(method,args),action:runtime.game.action?args=>runtime!.game.action!(args):undefined,checkCancel:()=>this.checkCancel(j),record:(name,value)=>this.record(j,'action_'+action.id+'_'+name,value)});
     j.checks.push({id:'action:'+action.id,status:observed.status,required:action.required,reason:observed.reason,evidence:{report:path.join(j.directory,'action_'+action.id+'_result.json'),actionSubmitted:observed.actionSubmitted,matchedEvents:observed.observation?.events.filter(e=>e.matched).length??0,scope:observed.scope}});
     actionBlocked=observed.status!=='passed';
    }
    for(const presentation of m.game.presentations){
     this.checkCancel(j);j.phase='presentation:'+presentation.id;
     const selected=m.game.views.find(v=>v.id===presentation.viewId)!;
     const result=await runPresentationCheck(presentation,{
      call:(method,args)=>runtime!.game.call(method,args),body:testBody,state:responseState,checkCancel:()=>this.checkCancel(j),
      camera:()=>this.view(j,runtime!.game,selected,{id:'presentation:'+presentation.id+':before',file:'Presentation_'+presentation.id+'_before.png'}),
      record:async(name,value)=>{const stem='presentation_'+presentation.id+'_'+name;await this.record(j,stem,value);return path.join(j.directory,stem+'.json');},
      media:async(file,hash,kind,name)=>{const root=runtime!.game.configuration().work;if(!root)throw Error('PRESENTATION_OWNED_RUNTIME_ROOT_UNAVAILABLE');const bytes=await readOwnedRecordingMedia(root,file,hash,kind),target=this.workspace.resolveUserPath(path.join(j.directory,'Presentation_'+presentation.id+'_'+name));await fs.writeFile(target,bytes);return {file:target,sha256:hash};},
     });
     j.checks.push(...result.checks);if(!result.continueSuite)return;
    }
    for(const view of m.game.views){this.checkCancel(j);j.phase='view:'+view.id;j.checks.push(await this.view(j,runtime.game,view));}
    j.phase='diagnostics';const after=await runtime.game.call('game.diagnostics',{...(testBody(before).cursor?{cursor:testBody(before).cursor}:{}),limit:128});await this.record(j,'diagnostics_after',after);
    const diagnostics=[...testBody(before).messages??[],...testBody(after).messages??[]];const unexpected=diagnostics.filter((d:any)=>d.severity==='error'&&!m.game!.diagnostics.expected.some(e=>e.source===d.source&&e.text===(d.text??d.message)&&e.build===build));
    j.checks.push({id:'game.diagnostics',status:unexpected.length?'failed':'inconclusive',required:m.game.diagnostics.required,reason:unexpected.length?'Observed unexpected runtime errors':'No unexpected errors observed in available sources; diagnostic coverage is partial',evidence:{unexpected:unexpected.slice(0,16),sources:testBody(after).sources??null}});
    if(m.game.capture){this.checkCancel(j);j.phase='capture';const r=await runtime.game.call('game.capture',{include_ui:true});const png=r.content.find(c=>c.type==='image');if(png?.type==='image'){const b=Buffer.from(png.data,'base64');await fs.writeFile(path.join(j.directory,'Game.png'),b);j.checks.push({id:'game.capture',status:responseState(r),required:false,evidence:{file:path.join(j.directory,'Game.png'),sha256:digest(b),visualReview:'not_checked'}});}else j.checks.push({id:'game.capture',status:'inconclusive',required:false,reason:'No native image returned'});}
   }
  }catch(e){const reason=e instanceof Error?e.message:String(e);if(reason!=='TEST_CANCEL_REQUESTED')j.checks.push({id:j.phase||'runner',status:'failed',required:true,reason});}
  finally{
   j.phase='cleanup';
   // Preserve console evidence even when an uncertain combat/action stops the suite early.
   if(runtime&&m.game&&attemptedAttach&&j.checks.some(c=>c.id==='game.launch'&&c.status==='passed')&&!j.checks.some(c=>c.id==='game.diagnostics')){
    try{
     const response=await runtime.game.call('game.diagnostics',{});await this.record(j,'diagnostics_early_exit',response);
     const body=testBody(response),build=String(j.checks.find(c=>c.id==='game.build')?.evidence?.observed??'unknown');
     const messages=Array.isArray(body.messages)?body.messages:[];
     const unexpected=messages.filter((d:any)=>d.severity==='error'&&!m.game!.diagnostics.expected.some(e=>e.source===d.source&&e.text===(d.text??d.message)&&e.build===build));
     j.checks.push({id:'game.diagnostics',status:unexpected.length?'failed':'inconclusive',required:m.game.diagnostics.required,reason:unexpected.length?'Observed unexpected runtime errors before early cleanup':'Early-exit console snapshot; absence and diagnostic coverage remain partial',evidence:{unexpected:unexpected.slice(0,16),sources:body.sources??null,scope:'Owned runtime snapshot before cleanup; no complete-suite or absence claim'}});
    }catch{j.checks.push({id:'game.diagnostics',status:'inconclusive',required:m.game.diagnostics.required,reason:'Early-exit console evidence unavailable'});}
   }
   if(runtime){try{if(attemptedAttach){const d=await runtime.game.detach();await this.record(j,'detach',d);j.checks.push({id:'game.cleanup',status:d.stopped&&d.sourceUnchanged===true?'passed':'failed',required:true,evidence:{stopped:d.stopped,sourceUnchanged:d.sourceUnchanged}});}}catch(e){j.checks.push({id:'game.cleanup',status:'failed',required:true,reason:String(e)});}}
   release?.();
   if(j.testedArtifact)try{const valid=(await this.identity(j.testedArtifact.file)).sha256===j.testedArtifact.sha256;j.checks.push({id:'artifact.unchanged',status:valid?'passed':'failed',required:true,reason:valid?undefined:'TEST_EXECUTED_ARTIFACT_CHANGED',evidence:{sha256:j.testedArtifact.sha256,origin:j.testedArtifact.origin}});}catch(e){j.checks.push({id:'artifact.unchanged',status:'failed',required:true,reason:String(e)});}
   try{await this.unchanged(j.plan);j.checks.push({id:'source.unchanged',status:'passed',required:true});}catch(e){j.checks.push({id:'source.unchanged',status:'failed',required:true,reason:String(e)});}
   j.state=j.cancelRequested?'cancelled':'completed';j.phase='finished';j.finishedAt=new Date().toISOString();if(!outputPrepared)j.reportPersistence='memory_only';if(j.reportPersistence!=='memory_only'){await this.record(j,'result',{...this.status(j.id),reportPersistence:'workspace_file',manifest:j.plan.manifest,capabilities:j.plan.capabilities,dependencies:j.plan.dependencies,checks:j.checks});j.reportPersistence='workspace_file';}
  }
 }
 private async pads(j:Job,runtime:Runtime):Promise<boolean>{
  const game=j.plan.manifest.game!,artifact=j.testedArtifact!,namespace=game.pathing.length?'game.native_query':'game.pad',phase=game.pathing.length?'native_query':'pad';this.checkCancel(j);j.phase=phase+'_preparation';
  const prepared=await preparePadProbe({source:artifact.file,sourceSha256:artifact.sha256,directory:j.directory,pads:game.pads,pathing:game.pathing,points:game.points,probe:(game.nativeProbe??game.padProbe)!,storageProbe:this.options.storageProbe});
  j.checks.push({id:namespace+'_preparation',status:'passed',required:true,evidence:{archive:prepared.archive,sha256:prepared.sha256,sourceSha256:prepared.sourceSha256,channelVersion:prepared.channel.version,unitType:prepared.channel.unitType,queryScriptSha256:prepared.queryScriptSha256,preservedComponentCount:prepared.preservedComponentCount,changedFiles:prepared.changedFiles,report:path.join(j.directory,'PadProbe.json'),scope:prepared.scope}});
  let attempted=false;let proceed:boolean;
  try{
   this.checkCancel(j);j.phase=phase+'_launch';if(digest(await fs.readFile(prepared.archive))!==prepared.sha256)throw Error('PAD_EXECUTED_ARTIFACT_STALE');
   attempted=true;const attached=await runtime.game.attach(path.relative(this.workspace.root,prepared.archive).replaceAll('\\','/'),game.timeout,game.renderBackend);j.gameRuntime=runtime.game.configuration().runtimeIdentity;await this.record(j,'pad_launch',attached);
   const launch=gameLaunchCheck(attached,game.required||game.pads.some(p=>p.required)||game.pathing.some(p=>p.required));j.checks.push({...launch,id:namespace+'_launch'});if(launch.status!=='passed')return false;
   const state=await runtime.game.call('game.status',{});await this.record(j,'pad_runtime',state);const body=testBody(state),build=String(body.versionSupport?.observedVersion??body.native?.game?.version??body.gameVersion??'unknown');
   j.checks.push({id:namespace+'_build',status:j.plan.manifest.expectedGameBuild?(build===j.plan.manifest.expectedGameBuild?'passed':'failed'):'not_checked',required:!!j.plan.manifest.expectedGameBuild,evidence:{observed:build}});if(j.plan.manifest.expectedGameBuild&&build!==j.plan.manifest.expectedGameBuild)return false;
   j.phase=phase+'_queries';const observed=await observePadQueries(prepared.channel,{call:(method,args)=>runtime.game.call(method,args),body:testBody,state:responseState,checkCancel:()=>this.checkCancel(j),pollMs:this.options.pollMs,record:async(name,value)=>{const id='pad_'+name;await this.record(j,id,value);return path.join(j.directory,id+'.json');}});j.checks.push(...observed.checks);proceed=observed.complete;
  }finally{
   if(attempted){j.phase=phase+'_cleanup';try{const closed=await runtime.game.detach();await this.record(j,'pad_detach',closed);const passed=closed.stopped&&closed.sourceUnchanged===true;j.checks.push({id:namespace+'_cleanup',status:passed?'passed':'failed',required:true,evidence:{stopped:closed.stopped,sourceUnchanged:closed.sourceUnchanged}});if(!passed)proceed=false;}catch(error){proceed=false;j.checks.push({id:namespace+'_cleanup',status:'failed',required:true,reason:String(error)});}}
   const unchanged=digest(await fs.readFile(prepared.archive))===prepared.sha256&&digest(await fs.readFile(artifact.file))===artifact.sha256;j.checks.push({id:namespace+'_artifact',status:unchanged?'passed':'failed',required:true,evidence:{sha256:prepared.sha256,sourceSha256:artifact.sha256}});if(!unchanged)proceed=false;
  }
  return proceed;
 }
 private async view(j:Job,game:Game,view:NonNullable<TestManifest['game']>['views'][number],context?:{id:string;file:string}):Promise<TestCheck>{
  const id=context?.id??'view:'+view.id,camera=await game.call('game.camera.set',view.camera);await this.record(j,id+'_camera',camera);
  const observed=testBody(camera).camera,request=view.camera;
  const evidence:Record<string,unknown>={requested:request,observed:observed??null,includeUI:view.includeUI,visualReview:'not_checked',scope:'Camera readback and native PNG capture; framing and art quality require image review'};
  const values=[observed?.target?.x,observed?.target?.y,observed?.distance,observed?.pitch,observed?.yaw];
  if(responseState(camera)!=='passed'||!values.every(v=>typeof v==='number'&&Number.isFinite(v)))return {id,status:responseState(camera)==='passed'?'inconclusive':responseState(camera),required:view.required,reason:'Native camera readback unavailable',evidence};
  const yawError=Math.abs(((observed.yaw-request.yaw)%360+540)%360-180);
  if(Math.max(Math.abs(observed.target.x-request.x),Math.abs(observed.target.y-request.y),Math.abs(observed.distance-request.distance),Math.abs(observed.pitch-request.pitch),yawError)>0.5)return {id,status:'failed',required:view.required,reason:'Native camera did not reach the requested viewpoint within 0.5 world units/degrees',evidence};
  this.checkCancel(j);const captured=await game.call('game.capture',{include_ui:view.includeUI}),png=captured.content.find(c=>c.type==='image');
  const bytes=png?.type==='image'&&png.mimeType==='image/png'?Buffer.from(png.data,'base64'):undefined;
  if(responseState(captured)!=='passed'||!bytes||bytes.length>6*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){await this.record(j,id+'_capture',testBody(captured));return {id,status:responseState(captured)==='passed'?'inconclusive':responseState(captured),required:view.required,reason:'Valid bounded native PNG unavailable',evidence};}
  const file=path.join(j.directory,context?.file??'View_'+view.id+'.png');await fs.writeFile(file,bytes);return {id,status:'passed',required:view.required,evidence:{...evidence,file,sha256:digest(bytes)}};
 }
 private async route(j:Job,game:Game,r:NonNullable<TestManifest['game']>['routes'][number],reverse:boolean){
  const points=j.plan.manifest.game!.points,from=points[reverse?r.to:r.from],to=points[reverse?r.from:r.to],id='route:'+r.id+(reverse?':reverse':':forward');
  const prefix=id.replaceAll(':','_'),result=await runRouteCheck(r,from,to,reverse,{
   call:(method,args)=>game.call(method,args),body:testBody,state:responseState,checkCancel:()=>this.checkCancel(j),pollMs:this.options.pollMs,
   record:async(name,value)=>{const stem=prefix+'_'+name;await this.record(j,stem,value);return path.join(j.directory,stem+'.json');},
   ...(j.plan.manifest.game?.capture?{
    focus:async(unit:string)=>{await game.call('game.camera.set',{unit,player:r.owner||1,distance:24});},
    capture:async()=>{const frame=await game.call('game.capture',{include_ui:true}),png=frame.content.find(c=>c.type==='image');if(png?.type==='image')await fs.writeFile(path.join(j.directory,prefix+'.png'),Buffer.from(png.data,'base64'));}
   }:{})
  });j.checks.push(...result.checks);return result.continueSuite;
 }
 async close(){this.closing=true;for(const j of this.jobs.values())if(j.state==='queued'||j.state==='running')j.cancelRequested=true;await this.tail;}
}
