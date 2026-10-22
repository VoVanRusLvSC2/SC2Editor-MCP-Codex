import {promises as fs} from 'node:fs';
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
import {routeDeviation} from './routeGeometry.js';
import {observeStartupEvents} from './startupEvents.js';

type Game=Pick<NativeGameBridge,'configuration'|'status'|'attach'|'call'|'detach'>;
type Editor=Pick<NativeEditorBridge,'status'|'check'|'job'>;
interface Runtime {game:Game;editor:Editor}
interface Identity {file:string;sha256:string;id?:string}
interface Plan {id:string;manifest:TestManifest;manifestSha256:string;manifestFile?:Identity;source:Identity;dependencies:Identity[];issues:TestCheck[];capabilities:Record<string,unknown>}
interface Job {id:string;plan:Plan;state:'queued'|'running'|'completed'|'cancelled';phase:string;cancelRequested:boolean;createdAt:string;finishedAt?:string;checks:TestCheck[];directory:string;error?:string;gameRuntime?:ReturnType<NativeGameBridge['configuration']>['runtimeIdentity'];testedArtifact?:Identity&{origin:'source'|'native_saved'};nativeProgress?:{jobId:string;state:string;phase:string;startedAt?:string;deadlineExceeded:boolean}}
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
 private plans=new Map<string,Plan>();private jobs=new Map<string,Job>();private tail:Promise<void>=Promise.resolve();private closing=false;
 private mapInfoCache=new Map<string,Buffer>();
 private terrainLoadCache=new Map<string,TestCheck|undefined>();
 readonly work:string;
 constructor(readonly workspace:Workspace,private options:{runtime:Runtime;gate:NativeWorkflowGate;inspect?:(file:string)=>Promise<unknown>;mapInfo?:(file:string)=>Promise<Buffer>;terrainLoad?:(file:string)=>Promise<Awaited<ReturnType<typeof readArchiveTerrainLoadContract>>>;pollMs?:number}){this.work=workspace.resolveUserPath('.sc2mcp-output/project-tests');}
 private pending(){if(this.workspace.draftFiles().length||this.workspace.binary.draftFiles().length)throw Error('TEST_PENDING_DRAFTS: save or discard complete groups first');}
 private async identity(file:string,id?:string):Promise<Identity>{const real=await fs.realpath(this.workspace.resolveUserPath(file));this.workspace.resolveUserPath(real);if(!(await fs.stat(real)).isFile())throw Error('TEST_FILE_REQUIRED: '+file);return {file:real,sha256:digest(await fs.readFile(real)),...(id?{id}:{})};}
 private async unchanged(p:Plan){for(const f of [p.source,...p.dependencies,...(p.manifestFile?[p.manifestFile]:[])])if((await this.identity(f.file,f.id)).sha256!==f.sha256)throw Error('TEST_INPUT_STALE: '+f.file);}
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
 async plan(input:unknown){
  this.pending();const manifest=testManifestSchema.parse(input),source=await this.identity(manifest.map);
  if(!/\.sc2map$/i.test(source.file))throw Error('TEST_SAVED_SC2MAP_REQUIRED');
  const dependencies:Identity[]=[],issues:TestCheck[]=[];
  for(const d of manifest.dependencies){try{const value=await this.identity(d.file,d.id);if(d.sha256&&value.sha256!==d.sha256)throw Error('Dependency digest mismatch');dependencies.push(value);}catch(e){issues.push({id:'dependency:'+d.id,status:'failed',required:true,reason:String(e)});}}
  const load=await this.terrainLoadCheck(source);if(load&&load.status!=='passed')issues.push(load);
  const game=this.options.runtime.game.configuration();
  if(manifest.game&&(!game.configured||!game.launchEnabled))issues.push({id:'game.configuration',status:'unsupported',required:manifest.game.required,reason:'Configure SC2_GAME_TOOLKIT_HOME and explicitly enable SC2_GAME_ALLOW_LAUNCH=1'});
  if(manifest.game?.routes.some(r=>r.expected==='blocked'))issues.push({id:'navigation.authoritative_query',status:'unsupported',required:false,reason:'No direct engine path query; a move timeout cannot prove an obstruction'});
  const p:Plan={id:randomUUID(),manifest,manifestSha256:digest(JSON.stringify(manifest)),source,dependencies,issues,capabilities:{game,groundMobility:'Declared by the test author; runtime inspection does not expose the movement plane',dependencyScope:'Explicit file digests plus native load and observed runtime build; installed transitive dependencies are not fully pinned'}};
  if(this.plans.size>=32)this.plans.delete(this.plans.keys().next().value!);this.plans.set(p.id,p);
  return {planId:p.id,map:manifest.map,sourceSha256:source.sha256,manifestSha256:p.manifestSha256,dependencies:dependencies.map(d=>({id:d.id,sha256:d.sha256})),issues,capabilities:p.capabilities,suites:{editor:manifest.editor?.checks??[],routes:manifest.game?.routes.length??0,scenarios:manifest.game?.scenarios.length??0,views:manifest.game?.views.length??0},ready:!issues.some(c=>c.required&&c.status!=='passed')};
 }
 async planFile(file:string){const source=await this.identity(file),bytes=await fs.readFile(source.file);if(bytes.length>256*1024)throw Error('TEST_MANIFEST_SIZE_LIMIT');if(digest(bytes)!==source.sha256)throw Error('TEST_MANIFEST_STALE');const result=await this.plan(JSON.parse(bytes.toString('utf8')));this.plans.get(result.planId)!.manifestFile=source;return {...result,manifestFileSha256:source.sha256};}
 async run(planId:string){
  if(this.closing)throw Error('TEST_RUNNER_CLOSING');this.pending();const plan=this.plans.get(planId);if(!plan)throw Error('TEST_PLAN_UNKNOWN');await this.unchanged(plan);
  if(plan.issues.some(c=>c.required&&c.status!=='passed'))throw Error('TEST_PLAN_BLOCKED: resolve required plan issues');
  if([...this.jobs.values()].filter(j=>j.state==='queued'||j.state==='running').length>=4)throw Error('TEST_QUEUE_FULL');
  for(const [id,j]of this.jobs)if(this.jobs.size>=32&&j.state!=='queued'&&j.state!=='running')this.jobs.delete(id);
  const id=randomUUID(),job:Job={id,plan,state:'queued',phase:'queued',cancelRequested:false,createdAt:new Date().toISOString(),checks:[],directory:path.join(this.work,id)};this.jobs.set(id,job);
  this.tail=this.tail.then(()=>this.execute(job)).catch(e=>{job.error=String(e);job.state='completed';job.checks.push({id:'runner',status:'failed',required:true,reason:String(e)});});
  return this.status(id);
 }
 status(id:string){const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');return {jobId:id,state:j.state,phase:j.phase,nativeProgress:j.nativeProgress?{...j.nativeProgress,elapsedSeconds:j.nativeProgress.startedAt?Math.max(0,Math.floor((Date.now()-Date.parse(j.nativeProgress.startedAt))/1000)):undefined}:undefined,cancelRequested:j.cancelRequested,createdAt:j.createdAt,finishedAt:j.finishedAt,outcome:j.state==='completed'?testVerdict(j.checks):null,checks:j.checks.map(({id,status,required,reason})=>({id,status,required,reason})),sourceSha256:j.plan.source.sha256,testedArtifact:j.testedArtifact,gameRuntime:j.gameRuntime,report:path.join(j.directory,'result.json'),error:j.error};}
 async report(id:string,offset=0,limit=10){const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');let current=true;try{await this.unchanged(j.plan);if(j.testedArtifact&&(await this.identity(j.testedArtifact.file)).sha256!==j.testedArtifact.sha256)current=false;}catch{current=false;}return {...this.status(id),current,evidenceValidForCurrentInputs:current&&j.state==='completed',checks:j.checks.slice(offset,offset+limit),offset,nextOffset:offset+limit<j.checks.length?offset+limit:null,total:j.checks.length,manifestSha256:j.plan.manifestSha256,capabilities:j.plan.capabilities};}
 cancel(id:string){const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');if(j.state==='queued'||j.state==='running')j.cancelRequested=true;return this.status(id);}
 async image(id:string,viewId?:string){const j=this.jobs.get(id);if(!j)throw Error('TEST_JOB_UNKNOWN');if(viewId&&!j.plan.manifest.game?.views.some(v=>v.id===viewId))throw Error('TEST_VIEW_UNKNOWN');const check=j.checks.find(c=>c.id===(viewId?'view:'+viewId:'game.capture'));if(check?.status!=='passed'||typeof check.evidence?.sha256!=='string')throw Error('TEST_IMAGE_UNCONFIRMED');const file=path.join(j.directory,viewId?'View_'+viewId+'.png':'Game.png'),b=await fs.readFile(file);if(b.length>6*1024*1024||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||digest(b)!==check.evidence.sha256)throw Error('TEST_IMAGE_INVALID');return {type:'image' as const,mimeType:'image/png',data:b.toString('base64')};}
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
  let runtime:Runtime|undefined,attemptedAttach=false,release:(()=>void)|undefined;const m=j.plan.manifest;
  j.state='running';
  try{
   await fs.mkdir(j.directory,{recursive:true});this.checkCancel(j);await this.unchanged(j.plan);j.phase='static';
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
     const nativeRoot=await fs.realpath(this.workspace.resolveUserPath(editorStatus.workerDirectory));
     this.workspace.resolveUserPath(nativeRoot);
     const real=await fs.realpath(a.path),rel=path.relative(nativeRoot,real);
     if(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep)||!/\.sc2map$/i.test(real))throw Error('TEST_NATIVE_ARTIFACT_OUTSIDE_WORKER');
     const bytes=await fs.readFile(real);if(digest(bytes)!==a.sha256||bytes.length!==a.bytes)throw Error('TEST_NATIVE_ARTIFACT_DIGEST_MISMATCH');
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
   if(m.game?.routes.length){
    this.checkCancel(j);j.phase='map.playable_bounds';let check:TestCheck;
    try{
     const artifact=j.testedArtifact!;
     if((await this.identity(artifact.file)).sha256!==artifact.sha256)throw Error('TEST_EXECUTED_ARTIFACT_CHANGED');
     let bytes=this.mapInfoCache.get(artifact.sha256);
     if(!bytes){bytes=await (this.options.mapInfo??readArchiveMapInfo)(artifact.file);if((await this.identity(artifact.file)).sha256!==artifact.sha256)throw Error('TEST_EXECUTED_ARTIFACT_CHANGED');if(bytes.length>1024*1024)throw Error('TEST_MAPINFO_SIZE_LIMIT');if(this.mapInfoCache.size>=32)this.mapInfoCache.delete(this.mapInfoCache.keys().next().value!);this.mapInfoCache.set(artifact.sha256,Buffer.from(bytes));}
     check=routeBoundsCheck(m,bytes);
    }catch(e){check={id:'map.playable_bounds',status:'unsupported',required:true,reason:'TEST_ROUTE_BOUNDS_UNAVAILABLE: '+String(e)};}
    j.checks.push(check);if(check.status!=='passed')return;
   }
   if(m.game){this.checkCancel(j);j.phase='launch';const config=runtime.game.configuration();if(!config.configured||!config.launchEnabled){j.checks.push({id:'game.launch',status:'unsupported',required:m.game.required,reason:'Game runtime or explicit launch configuration unavailable'});return;}attemptedAttach=true;const attached=await runtime.game.attach(privateArchive,m.game.timeout,m.game.renderBackend);j.gameRuntime=runtime.game.configuration().runtimeIdentity;await this.record(j,'launch',attached);
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
    for(const route of m.game.routes){for(const reverse of route.bidirectional?[false,true]:[false]){this.checkCancel(j);j.phase='route:'+route.id;await this.route(j,runtime.game,route,reverse);}}
    for(const s of m.game.scenarios){this.checkCancel(j);j.phase='scenario:'+s.id;const r=await runtime.game.call('game.test.run',{steps:s.steps});await this.record(j,'scenario_'+s.id,r);j.checks.push({id:'scenario:'+s.id,status:responseState(r),required:s.required,evidence:{report:path.join(j.directory,'scenario_'+s.id+'.json')}});}
    for(const view of m.game.views){this.checkCancel(j);j.phase='view:'+view.id;await this.view(j,runtime.game,view);}
    j.phase='diagnostics';const after=await runtime.game.call('game.diagnostics',{...(testBody(before).cursor?{cursor:testBody(before).cursor}:{}),limit:128});await this.record(j,'diagnostics_after',after);
    const diagnostics=[...testBody(before).messages??[],...testBody(after).messages??[]];const unexpected=diagnostics.filter((d:any)=>d.severity==='error'&&!m.game!.diagnostics.expected.some(e=>e.source===d.source&&e.text===(d.text??d.message)&&e.build===build));
    j.checks.push({id:'game.diagnostics',status:unexpected.length?'failed':'inconclusive',required:m.game.diagnostics.required,reason:unexpected.length?'Observed unexpected runtime errors':'No unexpected errors observed in available sources; diagnostic coverage is partial',evidence:{unexpected:unexpected.slice(0,16),sources:testBody(after).sources??null}});
    if(m.game.capture){this.checkCancel(j);j.phase='capture';const r=await runtime.game.call('game.capture',{include_ui:true});const png=r.content.find(c=>c.type==='image');if(png?.type==='image'){const b=Buffer.from(png.data,'base64');await fs.writeFile(path.join(j.directory,'Game.png'),b);j.checks.push({id:'game.capture',status:responseState(r),required:false,evidence:{file:path.join(j.directory,'Game.png'),sha256:digest(b),visualReview:'not_checked'}});}else j.checks.push({id:'game.capture',status:'inconclusive',required:false,reason:'No native image returned'});}
   }
  }catch(e){const reason=e instanceof Error?e.message:String(e);if(reason!=='TEST_CANCEL_REQUESTED')j.checks.push({id:j.phase||'runner',status:'failed',required:true,reason});}
  finally{
   j.phase='cleanup';
   if(runtime){try{if(attemptedAttach){const d=await runtime.game.detach();await this.record(j,'detach',d);j.checks.push({id:'game.cleanup',status:d.stopped&&d.sourceUnchanged===true?'passed':'failed',required:true,evidence:{stopped:d.stopped,sourceUnchanged:d.sourceUnchanged}});}}catch(e){j.checks.push({id:'game.cleanup',status:'failed',required:true,reason:String(e)});}}
   release?.();
   if(j.testedArtifact)try{const valid=(await this.identity(j.testedArtifact.file)).sha256===j.testedArtifact.sha256;j.checks.push({id:'artifact.unchanged',status:valid?'passed':'failed',required:true,reason:valid?undefined:'TEST_EXECUTED_ARTIFACT_CHANGED',evidence:{sha256:j.testedArtifact.sha256,origin:j.testedArtifact.origin}});}catch(e){j.checks.push({id:'artifact.unchanged',status:'failed',required:true,reason:String(e)});}
   try{await this.unchanged(j.plan);j.checks.push({id:'source.unchanged',status:'passed',required:true});}catch(e){j.checks.push({id:'source.unchanged',status:'failed',required:true,reason:String(e)});}
   j.state=j.cancelRequested?'cancelled':'completed';j.phase='finished';j.finishedAt=new Date().toISOString();await this.record(j,'result',{...this.status(j.id),manifest:j.plan.manifest,capabilities:j.plan.capabilities,dependencies:j.plan.dependencies,checks:j.checks});
  }
 }
 private async view(j:Job,game:Game,view:NonNullable<TestManifest['game']>['views'][number]){
  const id='view:'+view.id,camera=await game.call('game.camera.set',view.camera);await this.record(j,id+'_camera',camera);
  const observed=testBody(camera).camera,request=view.camera;
  const evidence:Record<string,unknown>={requested:request,observed:observed??null,includeUI:view.includeUI,visualReview:'not_checked',scope:'Camera readback and native PNG capture; framing and art quality require image review'};
  const values=[observed?.target?.x,observed?.target?.y,observed?.distance,observed?.pitch,observed?.yaw];
  if(responseState(camera)!=='passed'||!values.every(v=>typeof v==='number'&&Number.isFinite(v))){j.checks.push({id,status:responseState(camera)==='passed'?'inconclusive':responseState(camera),required:view.required,reason:'Native camera readback unavailable',evidence});return;}
  const yawError=Math.abs(((observed.yaw-request.yaw)%360+540)%360-180);
  if(Math.max(Math.abs(observed.target.x-request.x),Math.abs(observed.target.y-request.y),Math.abs(observed.distance-request.distance),Math.abs(observed.pitch-request.pitch),yawError)>0.5){j.checks.push({id,status:'failed',required:view.required,reason:'Native camera did not reach the requested viewpoint within 0.5 world units/degrees',evidence});return;}
  this.checkCancel(j);const captured=await game.call('game.capture',{include_ui:view.includeUI}),png=captured.content.find(c=>c.type==='image');
  const bytes=png?.type==='image'&&png.mimeType==='image/png'?Buffer.from(png.data,'base64'):undefined;
  if(responseState(captured)!=='passed'||!bytes||bytes.length>6*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){await this.record(j,id+'_capture',testBody(captured));j.checks.push({id,status:responseState(captured)==='passed'?'inconclusive':responseState(captured),required:view.required,reason:'Valid bounded native PNG unavailable',evidence});return;}
  const file=path.join(j.directory,'View_'+view.id+'.png');await fs.writeFile(file,bytes);j.checks.push({id,status:'passed',required:view.required,evidence:{...evidence,file,sha256:digest(bytes)}});
 }
 private async route(j:Job,game:Game,r:NonNullable<TestManifest['game']>['routes'][number],reverse:boolean){
  const points=j.plan.manifest.game!.points,from=points[reverse?r.to:r.from],to=points[reverse?r.from:r.to],id='route:'+r.id+(reverse?':reverse':':forward');
  const created=await game.call('game.fixture',{type:r.type,owner:r.owner,...from});await this.record(j,id+'_fixture',created);const unit=testBody(created).unit?.id;
  if(responseState(created)!=='passed'||unit===undefined){j.checks.push({id,status:'failed',required:r.required,reason:'Ground fixture could not be created'});return;}
  const trajectory:unknown[]=[];let arrived=false,interference=false,maxObservedDeviation:number;
  try{
   const initial=await game.call('game.units.inspect',{unit:String(unit)}),u=testBody(initial).unit;await this.record(j,id+'_initial',initial);
   if(!u?.valid||!u?.alive||u.type!==r.type||Math.hypot(u.position.x-from.x,u.position.y-from.y)>r.tolerance)throw Error('Fixture invalid, wrong type or displaced at spawn: requested '+JSON.stringify(from)+', observed '+JSON.stringify(u?.position));
   maxObservedDeviation=routeDeviation(u.position,from,to);trajectory.push({at:new Date().toISOString(),...u});
   if(j.plan.manifest.game?.capture)await game.call('game.camera.set',{unit:String(unit),player:r.owner||1,distance:24});
   const issued=await game.call('game.order',{unit:String(unit),action:'move',...to});if(testBody(issued).accepted!==true||issued.isError)throw Error('Move order rejected');
   const end=Date.now()+r.timeout*1000;do{this.checkCancel(j);const snap=await game.call('game.units.inspect',{unit:String(unit)}),v=testBody(snap).unit;trajectory.push({at:new Date().toISOString(),...v});if(responseState(snap)!=='passed'||!v?.valid||!v?.alive||!Number.isFinite(v.position?.x)||!Number.isFinite(v.position?.y)){interference=true;break;}maxObservedDeviation=Math.max(maxObservedDeviation,routeDeviation(v.position,from,to));if(Math.hypot(v.position.x-to.x,v.position.y-to.y)<=r.tolerance){arrived=true;break;}await delay(this.options.pollMs??250);}while(Date.now()<end);
   const outsideCorridor=r.maxDeviation!==undefined&&maxObservedDeviation>r.maxDeviation;
   const status:CheckState=outsideCorridor?'failed':r.expected==='blocked'?(arrived?'failed':'inconclusive'):arrived?'passed':'inconclusive';
   j.checks.push({id,status,required:r.required,reason:outsideCorridor?'Observed trajectory left the declared route corridor':arrived?undefined:interference?'Unit invalid/dead or inspection unavailable':'Arrival not observed; timeout does not prove an obstruction',evidence:{type:r.type,mobility:r.mobility,mobilitySource:'manifest_declaration',expected:r.expected,arrived,trajectorySamples:trajectory.length,maxObservedDeviation,...(r.maxDeviation!==undefined?{maxDeviation:r.maxDeviation,corridorScope:'sampled_unit_centers'}:{}),trajectoryFile:path.join(j.directory,id.replaceAll(':','_')+'_trajectory.json')}});await this.record(j,id+'_trajectory',trajectory);
   if(j.plan.manifest.game?.capture){const frame=await game.call('game.capture',{include_ui:true}),png=frame.content.find(c=>c.type==='image');if(png?.type==='image')await fs.writeFile(path.join(j.directory,id.replaceAll(':','_')+'.png'),Buffer.from(png.data,'base64'));}
  }finally{const cleanup=await game.call('game.fixture',{action:'cleanup'});await this.record(j,id+'_cleanup',cleanup);const readback=await game.call('game.units.inspect',{unit:String(unit)});if(responseState(cleanup)!=='passed'||testBody(readback).unit?.valid!==false)j.checks.push({id:id+':cleanup',status:'failed',required:true,reason:'Fixture removal was not confirmed'});}
 }
 async close(){this.closing=true;for(const j of this.jobs.values())if(j.state==='queued'||j.state==='running')j.cancelRequested=true;await this.tail;}
}
