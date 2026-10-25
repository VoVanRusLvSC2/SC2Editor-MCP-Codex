import {parseNativeArguments,nativeArgumentSchemas} from './contracts.js';
import {nativeOutcome} from './outcome.js';
import {existsSync,promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import type {Workspace} from '../../core/workspace.js';
import {NativeStdioClient,type NativeClient} from './transport.js';
import {nativeRelease} from './release.js';
import {assessNativeFrame} from './frameAssessment.js';
import {nativeReportPage} from './details.js';
import type {NativeGuiEvidence} from './guiEvidence.js';
import {NativeStorage,nativePathBudget} from './storage.js';
import {nativeSubmission,nativeControl,nativeJobIdentity,observeNativeJob,nativeJobControls,nativeJobTerminal,nativeFileOnly,nativeDocumentFree,nativeQueuedMethods,nativeExtendedSummary,type NativeBackgroundBinding,type NativeSource} from './background.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
// DLL JSON uses integer flags; accept only its exact 0/1 and boolean forms.
const nativeFlag=(value:unknown)=>value===true||value===1?true:value===false||value===0?false:null;
export const nativeHome=(env:NodeJS.ProcessEnv=process.env)=>{
  const configured=env.SC2_NATIVE_TOOLKIT_HOME;
  if(configured!==undefined){
    if(!configured.trim()||!path.isAbsolute(configured))throw Error('NATIVE_RUNTIME_HOME_ABSOLUTE_REQUIRED');
    return path.resolve(configured);
  }
  return fileURLToPath(new URL(`../../../.native-toolkit-runtime/${nativeRelease.version}/`,import.meta.url));
};
type Check='load'|'compile'|'save_reopen';
interface Job {id:string;state:'queued'|'running'|'completed'|'failed';operation:string;phase:string;createdAt:string;startedAt?:string;finishedAt?:string;deadlineSeconds:number;report:string;reportPersistence?:'memory_only'|'workspace_file';result?:Record<string,any>;error?:string}
type Source=NativeSource;
interface DataDocument {source:Source;snapshot:Source;jobId:string}
const dataInspectionMethods=new Set(['sc2_read_data','sc2_data_links','sc2_check_resources']);
const dataInspectionKeys=new Set(['map','template','catalog','object_id','field_offset','field_limit','include_xml','query','offset','limit']);
interface Options {client?:NativeClient;home?:string;env?:NodeJS.ProcessEnv}
export const nativeOperations=['sc2_modules','sc2_editor_start','sc2_open_document','sc2_convert_xml','sc2_compile_all','sc2_export_galaxy','sc2_diagnostics','sc2_cutscene_open','sc2_cutscene_seek','sc2_capture_frame','sc2_capture_terrain','sc2_list_map_cameras','sc2_export_map_image','sc2_export_video','sc2_search_objects','sc2_capture_map_region','sc2_validate_document','sc2_save_reopen','sc2_submit_job','sc2_job_status','sc2_job_wait','sc2_job_cancel','sc2_check_map','sc2_read_data','sc2_data_links','sc2_check_resources','sc2_audit_data','sc2_doctor','sc2_query_audit','sc2_find_object_uses','sc2_compare_audits'] as const;

/** Optional native oracle. All map authoring remains in the existing modules. */
export class NativeEditorBridge {
  private client?:NativeClient;
  private jobs=new Map<string,Job>();
  private tail:Promise<void>=Promise.resolve();
  private closing=false;
  private connecting?:Promise<void>;
  private home:string;
  private ownedDocument?:Source;
  private loadedCaptureSource?:Source;
  private loadedDataDocument?:DataDocument;
  private dataDocumentVersion=0;
  private readonly workerId=randomUUID().replaceAll('-','');
  private guiEvidence=new Map<string,NativeGuiEvidence>();
  private background=new Map<string,NativeBackgroundBinding>();
  private observers=new Set<Promise<void>>();
  private observerJobs=new Set<string>();
  private captureDirectories=new WeakMap<Job,string>();
  private admissionUncertain=false;
  private storage:NativeStorage;
  private env:NodeJS.ProcessEnv;
  readonly work:string;
  constructor(readonly workspace:Workspace,options:Options={}){
    this.client=options.client;this.env={...(options.env??process.env)};this.home=options.home??nativeHome(this.env);
    // The upstream Windows archive extractor still has MAX_PATH-bound operations.
    // Keep the owned prefix compact; preserve the full UUID entropy and guards.
    this.storage=new NativeStorage(workspace.root,this.env.SC2_NATIVE_MCP_PATH?path.dirname(path.resolve(this.env.SC2_NATIVE_MCP_PATH)):this.home,this.workerId,this.env.SC2_NATIVE_WORK_ROOT||undefined);
    this.work=this.storage.work;
  }
  private workerDirectory(){return this.storage.worker;}
  readWorkerArtifact(file:string,limit?:number){return this.storage.readWorkerArtifact(file,limit);}
  readCaptureArtifact(jobId:string){
    const job=this.jobs.get(jobId);if(!job)throw Error('NATIVE_JOB_UNKNOWN');
    const capture=job.result?.capture,directory=this.captureDirectories.get(job),file=capture?.preview?.path??capture?.artifact?.path;
    if(job.state!=='completed'||capture?.artifactOwnershipVerified!==true||!directory||typeof file!=='string')throw Error('NATIVE_CAPTURE_ARTIFACT_UNCONFIRMED');
    return this.storage.readCaptureArtifact(file,directory);
  }
  configuration(){return {available:!!this.client||existsSync(path.join(this.home,'sc2-mcp-runtime.json'))||!!this.env.SC2_NATIVE_MCP_PATH,
    expectedVersion:nativeRelease.version,nativeProtocol:nativeRelease.nativeProtocol,runtimeHome:this.home,transport:'retained stdio MCP',launchPolicy:'Explicit editor.check/editor.capture may start an owned hidden Editor on private map copies',
    stability:'Pinned stable1.0 API; native startup, compilation and rendering still require local evidence',updatePolicy:'Pinned complete release; setup does not auto-upgrade or start an Editor',workerDirectory:this.workerDirectory(),storageLayout:'compact-owned-v1',artifactStorage:this.storage.external?'configured_external':'workspace_default',pathBudget:nativePathBudget(this.workerDirectory()),
    setup:'npm run native:setup',gameplayValidation:false,fastMapPreview:'map.preview (ModKit)',terrainCameraControl:'Saved map cameras only; native readback required'};}
  private async connect(){
    return this.connecting??=this.connectImpl().catch(error=>{this.connecting=undefined;throw error;});
  }
  private async connectImpl(){
    await this.storage.prepare();
    if(!this.client){
      const configured=this.env.SC2_NATIVE_MCP_PATH;
      let executable:string;
      if(configured)executable=path.resolve(configured);
      else{
        let receipt:{version:string;nativeProtocol:number;archiveSha256:string;executable:string;executableSha256:string};
        try{receipt=JSON.parse(await fs.readFile(path.join(this.home,'sc2-mcp-runtime.json'),'utf8'));}
        catch{throw Error('NATIVE_TOOLKIT_NOT_INSTALLED: npm run native:setup');}
        if(receipt.version!==nativeRelease.version||receipt.nativeProtocol!==nativeRelease.nativeProtocol)throw Error('NATIVE_RUNTIME_PROTOCOL_MISMATCH: install the complete pinned package');
        if(receipt.archiveSha256!==nativeRelease.archiveSha256)throw Error('NATIVE_RUNTIME_PACKAGE_MISMATCH: install the complete pinned package');
        executable=path.resolve(this.home,receipt.executable);
        const relative=path.relative(this.home,executable);
        if(path.isAbsolute(relative)||relative.startsWith('..'))throw Error('NATIVE_MANIFEST_PATH_INVALID');
        if(hash(await fs.readFile(executable))!==receipt.executableSha256)throw Error('NATIVE_EXECUTABLE_HASH_MISMATCH');
      }
      await fs.mkdir(this.work,{recursive:true});
      this.client=new NativeStdioClient(executable,['--work',this.workerDirectory()],path.dirname(executable));
    }
    await this.client.start();
  }
  async status(connect=false){if(connect){if(this.closing)throw Error('NATIVE_BRIDGE_CLOSING');await this.connect();}return {...this.configuration(),frontend:this.client?.info()??{connected:false},
    ownedDocument:this.ownedDocument?.absolute??null,loadedDataDocument:this.loadedDataDocument?{source:this.loadedDataDocument.source.absolute,sourceSha256:this.loadedDataDocument.source.sha256,jobId:this.loadedDataDocument.jobId}:null,nativeBackgroundAdmissionUncertain:this.admissionUncertain,
    nativeJobs:[...this.background.values()].map(j=>({id:j.id,state:j.state,operation:j.operation,report:j.lastReport})),
    jobs:[...this.jobs.values()].map(j=>({id:j.id,state:j.state,operation:j.operation,phase:j.phase,report:j.report}))};}
  async tools(name?:string){if(this.closing)throw Error('NATIVE_BRIDGE_CLOSING');await this.connect();const tools=this.client?.describe?.();if(!tools)return {status:'unsupported',reason:'Native client does not publish schemas',frontend:this.client?.info()};if(name){const tool=tools.find(t=>t.name===name);if(!tool)throw Error('NATIVE_TOOL_UNAVAILABLE');return tool;}return tools.map(({name,description})=>({name,description,available:(nativeOperations as readonly string[]).includes(name)&&!!nativeArgumentSchemas[name],documentRequired:name==='sc2_submit_job'?null:!['sc2_modules','sc2_doctor','sc2_query_audit','sc2_find_object_uses','sc2_compare_audits',...nativeJobControls].includes(name),acceptance:'Operation support is separate from native validation'}));}
  async call(method:typeof nativeOperations[number],args:Record<string,unknown>,deadlineSeconds=1200){
    if(!(nativeOperations as readonly string[]).includes(method))throw Error('NATIVE_OPERATION_NOT_ALLOWED');
    if('output' in args||'overwrite' in args)throw Error('NATIVE_OUTPUT_OWNED: artifacts are written inside this job');
    if(Buffer.byteLength(JSON.stringify(args))>4*1024*1024)throw Error('NATIVE_ARGUMENT_SIZE_LIMIT');
    if((nativeJobControls as readonly string[]).includes(method))return this.controlNative(method,args,deadlineSeconds);
    args=parseNativeArguments(method,args);
    if(method==='sc2_submit_job')return this.submitNative(args,deadlineSeconds);
    const sources=await this.inputSources(args);
    if(this.workspace.draftFiles().length||this.workspace.binary.draftFiles().length)throw Error('NATIVE_PENDING_DRAFTS');
    return this.enqueue(method,deadlineSeconds,async job=>{
      const documentFree=nativeDocumentFree(nativeQueuedMethods[method]),rememberedDataDocument=this.loadedDataDocument;if(!documentFree)this.loadedDataDocument=undefined;
      const directory=path.dirname(job.report),input={...args};
      for(const [key,source]of sources){if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');const copy=path.join(directory,key+path.extname(source.absolute));await fs.copyFile(source.absolute,copy);if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');input[key]=copy;}
      const source=sources.get('map')??sources.get('template');
      const readOnly=documentFree||['sc2_modules','sc2_list_map_cameras','sc2_search_objects'].includes(method);
      if(!readOnly&&!source&&!this.ownedDocument)throw Error('NATIVE_OWNED_DOCUMENT_REQUIRED: pass a saved template/map or open one first');
      if(!readOnly&&!source&&this.ownedDocument&&!await this.unchanged(this.ownedDocument)){this.ownedDocument=undefined;throw Error('NATIVE_OWNED_SOURCE_CHANGED: reopen the saved archive');}
      const currentDocument=!readOnly&&!source?this.ownedDocument:undefined;
      const documentSource=source??currentDocument;
      const dataInspection=dataInspectionMethods.has(method)&&Object.keys(args).every(key=>dataInspectionKeys.has(key))&&sources.size<=1&&typeof args.catalog==='string'&&typeof args.object_id==='string';
      const pendingNativeWork=()=>[...this.background.values()].some(binding=>!nativeJobTerminal.has(binding.state));
      const matches=(a:Source|undefined,b:Source|undefined)=>!!a&&!!b&&a.absolute===b.absolute&&a.sha256===b.sha256;
      const reuseDataDocument=dataInspection&&!!rememberedDataDocument&&matches(rememberedDataDocument.source,documentSource)&&matches(this.ownedDocument,documentSource)&&!pendingNativeWork();
      const dataSnapshot=reuseDataDocument?rememberedDataDocument!.snapshot:dataInspection&&source?{absolute:input.map??input.template,sha256:source.sha256} as Source:undefined;
      if(reuseDataDocument){
        if(!await this.unchanged(dataSnapshot!).catch(()=>false)){this.ownedDocument=undefined;throw Error('NATIVE_DATA_SNAPSHOT_CHANGED: loaded input changed or is unavailable; reopen the saved archive explicitly');}
        // Reuse the proven current document, never a cached field/result page.
        delete input.map;delete input.template;
      }
      const outputs:Record<string,string>={sc2_export_galaxy:'Native.galaxy',sc2_capture_frame:'Frame.png',sc2_capture_terrain:'Terrain.png',sc2_export_map_image:'Map.png',sc2_capture_map_region:'Region.png',sc2_export_video:'Cutscene.mp4',sc2_save_reopen:'NativeSaved.SC2Map'};
      if(method==='sc2_search_objects'){
        if(input.limit!==undefined&&(!Number.isInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>500))throw Error('NATIVE_OBJECT_LIMIT_INVALID');
        input.limit=Math.min(Number(input.limit??100),100);
      }
      if(outputs[method])input.output=path.join(directory,outputs[method]);
      job.phase=method;let value:Record<string,any>;const dataDocumentVersion=this.dataDocumentVersion+1;
      try{value=await this.invoke(method,input,directory);}catch(e){if(!readOnly)this.ownedDocument=undefined;throw e;}
      let sourceUnchanged=true;for(const source of sources.values())sourceUnchanged&&=await this.unchanged(source);
      if(currentDocument)sourceUnchanged&&=await this.unchanged(currentDocument);
      const dataSnapshotUnchanged=dataSnapshot?await this.unchanged(dataSnapshot).catch(()=>false):undefined;
      const nativeDataSourceMatched=!!documentSource&&value.sourceSha256===documentSource.sha256&&value.mapRevision===documentSource.sha256&&value.sourceUnchanged===true;
      const documentReuse=dataInspection?{reusedLoadedDocument:reuseDataDocument,omittedExplicitSource:reuseDataDocument&&!!source,expectedSourceSha256:documentSource?.sha256,nativeSourceMatched:nativeDataSourceMatched,...(dataSnapshot?{snapshotUnchanged:dataSnapshotUnchanged}:{}),...(reuseDataDocument?{loadedByJob:rememberedDataDocument!.jobId}:{}),...(reuseDataDocument&&!nativeDataSourceMatched&&!value.isError&&value.status!=='FAILED'?{issue:'NATIVE_DATA_SOURCE_IDENTITY_UNCONFIRMED'}:{}),fieldResultsCached:false}:undefined;
      const capture=value.preview||/\.png$/i.test(value.artifact?.path??'')?await this.assess(value,directory):undefined;
      const failed=['failed','cancelled'].includes(nativeOutcome(value)??'')||value.isError||value.status==='FAILED'||value.status==='failed'||!sourceUnchanged||capture?.artifactOwnershipVerified===false||dataSnapshotUnchanged===false||reuseDataDocument&&!nativeDataSourceMatched;
      if(capture?.artifactOwnershipVerified===true)this.captureDirectories.set(job,directory);
      const reportedOutcome=nativeOutcome(value),incomplete=reportedOutcome==='incomplete'||reportedOutcome==='pending'||documentFree&&reportedOutcome===undefined;
      if(method==='sc2_convert_xml'&&!failed&&!incomplete&&value.nativeGenerationVerified===true&&value.nativeCompilePassed===true&&value.originalGenerator===true&&value.replacementEmitterUsed===false&&(args.scope===undefined||args.scope==='mapRoot')&&!sources.has('trigger_strings')&&!sources.has('game_strings')){
        try{
        const template=sources.get('template'),xmlSha256=typeof args.triggers_xml==='string'?hash(Buffer.from(args.triggers_xml)):sources.get('triggers_file')?.sha256;
        if(template&&xmlSha256&&typeof value.output==='string'){
          const real=await fs.realpath(value.output),root=await fs.realpath(this.workerDirectory()),relative=path.relative(root,real);
          if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||!/\.galaxy$/i.test(real))throw Error('NATIVE_GUI_OUTPUT_OUTSIDE_WORKER');
          const bytes=await this.readWorkerArtifact(real,16*1024*1024);if(hash(bytes)!==value.sourceSha256||bytes.length!==value.sourceBytes)throw Error('NATIVE_GUI_OUTPUT_IDENTITY');
          this.guiEvidence.set(job.id,{jobId:job.id,xmlSha256,template,output:{absolute:real,sha256:hash(bytes)}});
        }
        }catch(error){this.ownedDocument=undefined;this.guiEvidence.delete(job.id);throw error;}
      }
      if((failed||incomplete)&&!readOnly)this.ownedDocument=undefined;else if(source&&!readOnly)this.ownedDocument=source;
      if(dataInspection&&!failed&&!incomplete&&documentSource&&dataSnapshot&&dataSnapshotUnchanged&&nativeDataSourceMatched&&value.complete===true&&value.catalog===args.catalog&&value.objectId===args.object_id&&this.dataDocumentVersion===dataDocumentVersion&&!pendingNativeWork()){
        this.loadedDataDocument={source:documentSource,snapshot:dataSnapshot,jobId:reuseDataDocument?rememberedDataDocument!.jobId:job.id};
      }
      const selected=['status','version','error','nativeConfirmed','nativeCompilePassed','actualTimeMs','time_ms','camera','nativeTimeConfirmed','mapCamera','artifact','preview','audio','video','objects','cameras','total','totalMatches','count','offset','limit','truncated','nextOffset','modules','capabilities','renderBackend','editorRequired','sourceUnchanged','mapSha256','scope','terrain','objectsComponentPresent','coordinateMeaning','nameMeaning','inputAutomation'];
      const response:Record<string,any>={...this.summary(value),...Object.fromEntries(selected.filter(k=>k in value).map(k=>[k,Array.isArray(value[k])?value[k].slice(0,100):value[k]])),
        ...(['sc2_check_map','sc2_read_data','sc2_data_links','sc2_check_resources','sc2_audit_data','sc2_doctor','sc2_query_audit','sc2_find_object_uses','sc2_compare_audits'].includes(method)?{extended:nativeExtendedSummary(value)}:{})};
      const truncatedArrays=selected.filter(k=>Array.isArray(value[k])&&value[k].length>100).map(k=>({field:k,total:value[k].length,returned:100}));
      if(truncatedArrays.length)response.responseTruncation={arrays:truncatedArrays,fullReport:job.report,...(method==='sc2_list_map_cameras'?{pagedTool:'editor.cameras'}:{})};
      await fs.writeFile(job.report,JSON.stringify({method,sourceUnchanged,sources:[...sources].map(([key,s])=>({key,...s})),...(documentReuse?{documentReuse}:{}),native:value},null,2)+'\n');
      return {failed,outcome:reportedOutcome==='cancelled'?'cancelled':failed?'failed':incomplete?'incomplete':'completed',method,sourceUnchanged,response,...(documentReuse?{documentReuse}:{}),nativeGuiImportEligible:this.guiEvidence.has(job.id),...(capture?{capture}:{}),report:job.report,semanticAcceptance:'Inspect native confirmations and artifacts; completion alone is not feature certification'};
    });
  }
  private async inputSources(args:Record<string,unknown>){
    const sources=new Map<string,Source>();
    for(const key of ['template','map','baseline_template','scene','triggers_file','trigger_strings','game_strings'])if(args[key]!==undefined){
      if(typeof args[key]!=='string')throw Error('NATIVE_INPUT_PATH_REQUIRED: '+key);
      if(['template','map','baseline_template'].includes(key))sources.set(key,await this.source(args[key] as string));
      else{const real=await fs.realpath(this.workspace.resolveUserPath(args[key] as string));this.workspace.resolveUserPath(real);if(!(await fs.stat(real)).isFile())throw Error('NATIVE_INPUT_FILE_REQUIRED');
        if(key==='scene'&&!/\.(?:sc2cutscene|stormcutscene)$/i.test(real))throw Error('NATIVE_SCENE_FILE_REQUIRED');
        const bytes=await fs.readFile(real);if(bytes.length>32*1024*1024)throw Error('NATIVE_INPUT_SIZE_LIMIT');sources.set(key,{absolute:real,sha256:hash(bytes)});}
    }
    return sources;
  }
  private async submitNative(args:Record<string,unknown>,deadlineSeconds:number){
    const request=nativeSubmission(args),sources=await this.inputSources(request.input);
    if(this.workspace.draftFiles().length||this.workspace.binary.draftFiles().length)throw Error('NATIVE_PENDING_DRAFTS');
    return this.enqueue('sc2_submit_job',deadlineSeconds,async job=>{
      if(this.admissionUncertain)throw Error('NATIVE_BACKGROUND_ADMISSION_UNCERTAIN: stop the owned frontend before submitting again');
      if([...this.background.values()].filter(j=>!nativeJobTerminal.has(j.state)).length>=32)throw Error('NATIVE_BACKGROUND_QUEUE_FULL');
      const directory=path.dirname(job.report),input={...request.input},snapshots:Source[]=[],bound=[...sources.values()];
      for(const[key,source]of sources){if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');const copy=path.join(directory,key+path.extname(source.absolute));await fs.copyFile(source.absolute,copy);if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');input[key]=copy;snapshots.push({absolute:copy,sha256:source.sha256});}
      const mutatesEditor=!nativeFileOnly(request.operation)&&!nativeDocumentFree(request.operation);
      if(!sources.has('map')&&!sources.has('template')&&request.operation!=='start'&&!nativeDocumentFree(request.operation)){
        if(nativeFileOnly(request.operation)||!this.ownedDocument)throw Error('NATIVE_OWNED_DOCUMENT_REQUIRED: pass a saved template/map or open one first');
        if(!await this.unchanged(this.ownedDocument))throw Error('NATIVE_OWNED_SOURCE_CHANGED: reopen the saved archive');
        bound.push(this.ownedDocument);
      }
      const outputs:Record<string,string>={export_galaxy:'Native.galaxy',capture_frame:'Frame.png',capture_terrain:'Terrain.png',export_map_image:'Map.png',capture_map_region:'Region.png',export_video:'Cutscene.mp4',save_reopen_document:'NativeSaved.SC2Map'};
      if(outputs[request.operation])input.output=path.join(directory,outputs[request.operation]);
      if(mutatesEditor){this.ownedDocument=undefined;this.loadedCaptureSource=undefined;}
      let value:Record<string,any>;
      try{value=await this.invoke('sc2_submit_job',{operation:request.operation,arguments:input,...(request.timeout!==undefined?{timeout_seconds:request.timeout}:{})},directory);}catch(e){this.admissionUncertain=true;throw e;}
      if((value.isError||value.status==='FAILED')&&!Object.hasOwn(value,'jobId')){await fs.writeFile(job.report,JSON.stringify({method:'sc2_submit_job',native:value},null,2)+'\n');return{failed:true,outcome:'failed',response:this.summary(value),report:job.report};}
      let identity:{id:string;state:string};try{identity=nativeJobIdentity(value);if(value.operation!==request.operation||this.background.has(identity.id))throw Error('NATIVE_JOB_RESPONSE_IDENTITY_MISMATCH');}catch(e){this.admissionUncertain=true;throw e;}
      for(const[id,binding]of this.background)if(this.background.size>=256&&nativeJobTerminal.has(binding.state))this.background.delete(id);
      const binding:NativeBackgroundBinding={...identity,operation:request.operation,sources:bound,snapshots,submissionReport:job.report,lastReport:job.report,mutatesEditor};this.background.set(binding.id,binding);
      if(nativeJobTerminal.has(binding.state))binding.terminalReport=job.report;
      return this.backgroundResult(binding,value,job.report,'submission',job);
    });
  }
  private async controlNative(method:string,args:Record<string,unknown>,deadlineSeconds:number){
    const input=nativeControl(method,args),binding=this.background.get(input.job_id);if(!binding)throw Error('NATIVE_BACKGROUND_JOB_UNKNOWN: only jobs admitted by this bridge may be observed or cancelled');
    return this.enqueue(method,deadlineSeconds,async job=>{
      if(method==='sc2_job_cancel'){this.ownedDocument=undefined;this.loadedCaptureSource=undefined;}
      const value=await this.invoke(method,input,path.dirname(job.report),false);observeNativeJob(binding,value,job.report);
      if(binding.mutatesEditor&&(!nativeJobTerminal.has(binding.state)||binding.state!=='SUCCEEDED')){this.ownedDocument=undefined;this.loadedCaptureSource=undefined;}
      return this.backgroundResult(binding,value,job.report,'observation',job);
    },true);
  }
  private async backgroundResult(binding:NativeBackgroundBinding,value:Record<string,any>,report:string,phase:string,job?:Job){
    const matches=async(s:Source)=>{try{return await this.unchanged(s);}catch{return false;}};
    const sourceUnchanged=(await Promise.all(binding.sources.map(matches))).every(Boolean),snapshotsUnchanged=(await Promise.all(binding.snapshots.map(matches))).every(Boolean),terminal=nativeJobTerminal.has(binding.state);
    if(binding.mutatesEditor&&(!sourceUnchanged||!snapshotsUnchanged||terminal&&(binding.state!=='SUCCEEDED'||nativeOutcome(value.result??{})!=='completed'))){this.ownedDocument=undefined;this.loadedCaptureSource=undefined;}
    const observation={method:phase==='submission'?'sc2_submit_job':'native_job_observation',native:value,sources:binding.sources,snapshots:binding.snapshots,sourceUnchanged,snapshotsUnchanged};await fs.writeFile(report,JSON.stringify(observation,null,2)+'\n');
    const operationOutcome=terminal?(nativeOutcome(value.result??{})??'incomplete'):'pending';
    const nativeJob={id:binding.id,operation:binding.operation,state:binding.state,observedState:value.status,terminal,queueSucceeded:binding.state==='SUCCEEDED',operationSucceeded:binding.state==='SUCCEEDED'&&operationOutcome==='completed',operationOutcome,responseError:value.isError===true,progress:value.progress,automaticRetry:false,submissionReport:binding.submissionReport,terminalReport:binding.terminalReport};
    const capture=value.result&&(value.result.preview||/\.png$/i.test(value.result.artifact?.path??''))?await this.assess(value.result,path.dirname(binding.submissionReport)):undefined;
    if(job&&capture?.artifactOwnershipVerified===true)this.captureDirectories.set(job,path.dirname(binding.submissionReport));
    return{failed:!sourceUnchanged||!snapshotsUnchanged||capture?.artifactOwnershipVerified===false,outcome:phase==='submission'?'submitted':'observed',nativeJob,sourceUnchanged,inputSnapshotsUnchanged:snapshotsUnchanged,sourceCheckPhase:terminal?'terminal':phase,evidenceValidForCurrentInputs:terminal&&sourceUnchanged&&snapshotsUnchanged&&capture?.artifactOwnershipVerified!==false,
      ...(capture?{capture}:{}),
      ...(value.result?{operationResult:{...this.summary(value.result),extended:nativeExtendedSummary(value.result)}}:{}),report,semanticAcceptance:'Outer job completion observes/submits a native job. Inspect nativeJob.state and operation confirmations separately; QUEUED is not completed execution.'};
  }
  private async observeBackground(wait:boolean){
    for(const binding of this.background.values())if(!nativeJobTerminal.has(binding.state)){
      const raw=await this.client!.call(wait?'sc2_job_wait':'sc2_job_status',{job_id:binding.id,...(wait?{wait_ms:1000}:{})});
      const value={...(raw.structuredContent??JSON.parse(raw.content?.find(c=>c.type==='text')?.text??'{}')),isError:raw.isError===true};
      const directory=path.join(this.work,'background');await fs.mkdir(directory,{recursive:true});const report=path.join(directory,binding.id+'-'+randomUUID()+'.json');observeNativeJob(binding,value,report);
      await this.backgroundResult(binding,value,report,wait?'drain':'stop_check');
    }
  }
  private async source(file:string):Promise<Source>{
    const absolute=this.workspace.resolveUserPath(file);
    if(!/\.sc2(?:map|mod)$/i.test(absolute))throw Error('NATIVE_SAVED_ARCHIVE_REQUIRED: export components through map.export first');
    if(this.workspace.draftFiles().length)throw Error('NATIVE_PENDING_DRAFTS: save or discard drafts before checking committed archives');
    const real=await fs.realpath(absolute);this.workspace.resolveUserPath(real);
    if(!(await fs.stat(real)).isFile())throw Error('NATIVE_SAVED_ARCHIVE_REQUIRED');
    return {absolute:real,sha256:hash(await fs.readFile(real))};
  }
  private async unchanged(source:Source){return hash(await fs.readFile(source.absolute))===source.sha256;}
  async guiArtifact(id:string){
    const job=this.jobs.get(id),proof=this.guiEvidence.get(id);
    if(!job||job.state!=='completed'||job.result?.failed||!proof)throw Error('NATIVE_GUI_COMPILED_ARTIFACT_REQUIRED');
    for(const input of [proof.template,proof.output])if(!await this.unchanged(input))throw Error('NATIVE_GUI_ARTIFACT_STALE');
    return structuredClone(proof);
  }
  private receipt(job:Job){return {...job,deadlineExceeded:job.state==='running'&&Date.now()-Date.parse(job.startedAt!)>job.deadlineSeconds*1000,
    cancellation:'Outer deadlines are advisory. Explicit sc2_job_cancel applies only to a native job admitted by this bridge; the SDK discards only its owned private Editor when required.'};}
  async details(id:string,pointer='',offset=0,limit=12){
    const j=this.jobs.get(id);if(!j)throw Error('NATIVE_JOB_UNKNOWN');
    if(j.reportPersistence==='memory_only')return {available:false,reason:'No report file was written; inspect the in-memory job error'};
    let file:string;try{file=await fs.realpath(j.report);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {available:false,reason:'The completed report is not available yet'};throw e;}
    const root=await fs.realpath(this.work),relative=path.relative(root,file);
    if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('NATIVE_DETAILS_OUTSIDE_WORKER');
    if((await fs.stat(file)).size>32*1024*1024)throw Error('NATIVE_DETAILS_REPORT_SIZE_LIMIT');
    const result=nativeReportPage(JSON.parse(await fs.readFile(file,'utf8')),pointer,offset,limit);
    if(Buffer.byteLength(JSON.stringify(result))>24000)throw Error('NATIVE_DETAILS_OUTPUT_LIMIT: select a smaller page or deeper path');
    return {available:true,...result};
  }
  private enqueue(operation:string,deadlineSeconds:number,run:(job:Job)=>Promise<Record<string,any>>,outOfBand=false){
    if(this.closing)throw Error('NATIVE_BRIDGE_CLOSING');
    if(outOfBand?this.observers.size>=8:[...this.jobs.values()].filter(j=>(j.state==='queued'||j.state==='running')&&!this.observerJobs.has(j.id)).length>=8)throw Error(outOfBand?'NATIVE_OBSERVATION_QUEUE_FULL':'NATIVE_QUEUE_FULL');
    for(const [id,j] of this.jobs)if(this.jobs.size>=32&&['completed','failed'].includes(j.state)){this.jobs.delete(id);this.guiEvidence.delete(id);}
    const id=randomUUID(),job:Job={id,state:'queued',operation,phase:'queued',createdAt:new Date().toISOString(),deadlineSeconds,report:path.join(this.work,'jobs',id,'result.json'),reportPersistence:'memory_only'};
    this.jobs.set(id,job);
    const task=(outOfBand?Promise.resolve():this.tail).then(async()=>{
      job.state='running';job.startedAt=new Date().toISOString();job.phase='connecting';
      let terminal:'failed'|'completed'='failed';
      try{await this.storage.prepare();await fs.mkdir(path.dirname(job.report),{recursive:true});job.reportPersistence='workspace_file';await this.connect();job.result=await run(job);terminal=job.result.failed?'failed':'completed';}
      catch(error){job.error=error instanceof Error?error.message:String(error);}
      finally{job.finishedAt=new Date().toISOString();job.phase='publishing';if(job.reportPersistence==='workspace_file'){
        if(!existsSync(job.report))await fs.writeFile(job.report,JSON.stringify({state:terminal,error:job.error??null},null,2)+'\n');
        await fs.writeFile(path.join(path.dirname(job.report),'job.json'),JSON.stringify(this.receipt({...job,state:terminal,phase:'finished'}),null,2)+'\n');}
        job.state=terminal;job.phase='finished';}
    }).catch(error=>{job.state='failed';job.error=String(error);});
    if(outOfBand){this.observers.add(task);this.observerJobs.add(job.id);void task.finally(()=>{this.observers.delete(task);this.observerJobs.delete(job.id);});}else this.tail=task;
    return this.receipt(job);
  }
  private async invoke(name:string,args:Record<string,unknown>,directory:string,invalidateCapture=true){
    if(this.admissionUncertain&&!['sc2_modules',...nativeJobControls].includes(name))throw Error('NATIVE_BACKGROUND_ADMISSION_UNCERTAIN: stop the owned frontend before more work');
    const observedOperation=['sc2_job_status','sc2_job_wait'].includes(name)?this.background.get(String(args.job_id))?.operation:undefined;
    const documentFree=nativeDocumentFree(nativeQueuedMethods[name]??(name==='sc2_submit_job'?String(args.operation):observedOperation??''));
    if(!documentFree){if(invalidateCapture)this.loadedCaptureSource=undefined;this.loadedDataDocument=undefined;this.dataDocumentVersion++;}
    const response=await this.client!.call(name,args);
    const text=response.content?.find(item=>item.type==='text')?.text??'';
    let value=response.structuredContent;
    if(!value){try{value=JSON.parse(text);}catch{value={status:'FAILED',error:text};}}
    const evidence={...value,isError:response.isError===true||['failed','cancelled'].includes(nativeOutcome(value??{})??''),...(response.nativeJobReport?{nativeQueueReport:response.nativeJobReport}:{})};
    await fs.writeFile(path.join(directory,name+'.json'),JSON.stringify(evidence,null,2)+'\n');
    return evidence as Record<string,any>;
  }
  private summary(value:Record<string,any>){
    const selected=['outcome','status','error','nativeConfirmed','nativeLoadVerified','nativeDataModuleLoaded','nativeSaveVerified','nativeReopenVerified','componentComparisonVerified','nativeValidationPassed',
      'nativeGenerationVerified','nativeCompilePassed','sourceSha256','sourceUnchanged','componentComparison','desktopObservation','evidenceDirectory','artifact','savedArchive','componentDiffArtifact',
      'requestedTerrainFrameVerified','wholeMapVerified','objectFiltersVerified','coordinateMappingValidated','preview','width','height',
      'failureKind','failureStage','failureEvidence','failureNative','ownedWorkerReset','automaticRetry',
      'mapCamera','cameraReadback','nativeCameraVerified','nativeLoad','controllerExitCode','failure','handlerCompletionKnown','renderBackend','transportJob'];
    const result=Object.fromEntries(selected.filter(k=>k in value).map(k=>[k,value[k]]));
    if(value.errorInfo&&typeof value.errorInfo==='object')result.errorInfo={code:String(value.errorInfo.code??'UNKNOWN').slice(0,128),message:String(value.errorInfo.message??'').slice(0,2000),nextStep:String(value.errorInfo.nextStep??'').slice(0,1000),automaticRetry:typeof value.errorInfo.automaticRetry==='boolean'?value.errorInfo.automaticRetry:null,...value.errorInfo.evidence?{evidence:nativeReportPage(value,'/errorInfo/evidence',0,4)}:{}};
    const diag=value.diagnostics??value.operationDiagnostics??value.loadDiagnostics;
    if(diag){result.diagnostics={newErrorsClear:diag.newErrorsClear??null,inspectionComplete:diag.inspectionComplete??null,
      newErrorCount:Object.hasOwn(diag,'newErrorCount')?diag.newErrorCount:diag.inspectionComplete===false?null:Array.isArray(diag.newErrors)?diag.newErrors.length:null,
      newWarningCount:Object.hasOwn(diag,'newWarningCount')?diag.newWarningCount:diag.inspectionComplete===false?null:Array.isArray(diag.newWarnings)?diag.newWarnings.length:null,
      knownNewErrorCount:diag.knownNewErrorCount??(Array.isArray(diag.newErrors)?diag.newErrors.length:null),
      newErrors:diag.newErrors?.slice(0,8),newWarnings:diag.newWarnings?.slice(0,4),compilerErrors:Array.isArray(diag.compilerErrors)?diag.compilerErrors.slice(0,8):diag.compilerErrors??null};}
    if(Array.isArray(value.phases)){
      result.phaseCount=value.phases.length;
      const failures=value.phases.filter((phase:Record<string,any>)=>phase.nativeConfirmed!==true||phase.error);
      if(failures.length)result.phases=failures.slice(0,8).map((phase:Record<string,any>)=>({
        phase:phase.phase,operation:phase.operation,nativeConfirmed:phase.nativeConfirmed,error:phase.error,
        native:phase.native?this.summary(phase.native):undefined,diagnostics:phase.diagnostics?this.summary({diagnostics:phase.diagnostics}).diagnostics:undefined}));
    }
    if(result.componentComparison){const c=result.componentComparison;result.componentComparison={...c,
      changes:c.changes?.slice(0,12).map((change:Record<string,unknown>)=>({name:change.name,locale:change.locale,change:change.change,archiveMetadata:change.archiveMetadata})),
      changesTruncated:!!c.changesTruncated||(c.changes?.length??0)>12};}
    return result;
  }
  private async assess(value:Record<string,any>,jobDirectory:string){
    const capture=this.summary(value),file=value.preview?.path??value.artifact?.path;
    if(file)try{
      await this.storage.readCaptureArtifact(file,jobDirectory);capture.artifactOwnershipVerified=true;
      capture.contentAssessment=await assessNativeFrame(await fs.realpath(file));
    }catch(e){capture.artifactOwnershipVerified=false;capture.contentAssessment={status:'unavailable',visualAcceptance:'not_checked',reason:String(e)};}
    return capture;
  }
  async check(args:{archive:string;checks:Check[];scope?:string;contextLabel?:string;locale?:string;renderBackend?:'auto'|'legacy'|'vulkan';includeDiffs:boolean;deadlineSeconds:number}){
    const source=await this.source(args.archive);
    const checks=[...new Set(args.checks)];
    return this.enqueue('check',args.deadlineSeconds,async job=>{
      if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');
      const directory=path.dirname(job.report),copy=path.join(directory,'Input'+path.extname(source.absolute));
      await fs.copyFile(source.absolute,copy);if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');
      const evidence:Record<string,any>={source:source.absolute,sourceSha256:source.sha256,renderBackend:args.renderBackend??'auto',checks:{},scope:'Native Editor checks; not gameplay or exhaustive Data validation'};
      let failed=false,incomplete=false;
      for(const check of ['load','save_reopen','compile'] as const){
        if(!checks.includes(check))continue;job.phase=check;
        let value:Record<string,any>;
        if(check==='load')value=await this.invoke('sc2_validate_document',{map:copy,render_backend:args.renderBackend??'auto'},directory);
        else if(check==='save_reopen')value=await this.invoke('sc2_save_reopen',{map:copy,include_diffs:args.includeDiffs,render_backend:args.renderBackend??'auto'},directory);
        else{
          if(!checks.includes('load')&&!checks.includes('save_reopen')){
            const opened=await this.invoke('sc2_open_document',{map:copy,render_backend:args.renderBackend??'auto'},directory);evidence.open=opened;
            if(opened.isError||opened.status==='FAILED'){evidence.checks.open=opened;failed=true;break;}
            if(['incomplete','pending'].includes(nativeOutcome(opened)??''))incomplete=true;
          }
          value=await this.invoke('sc2_compile_all',{...(args.scope?{scope:args.scope}:{}),...(args.contextLabel?{context_label:args.contextLabel}:{}),...(args.locale?{locale:args.locale}:{})},directory);
          if(value.nativeCompilePassed===true){const exported=await this.invoke('sc2_export_galaxy',{output:path.join(directory,'Native.galaxy')},directory);evidence.galaxy=exported;if(exported.isError)failed=true;if(['incomplete','pending'].includes(nativeOutcome(exported)??''))incomplete=true;}
        }
        evidence.checks[check]=value;
        if(value.isError||value.status==='FAILED'||check==='compile'&&value.nativeCompilePassed===false){failed=true;break;}
        if(['incomplete','pending'].includes(nativeOutcome(value)??'')||(check==='compile'?value.nativeCompilePassed!==true:value.nativeValidationPassed!==true))incomplete=true;
      }
      evidence.sourceUnchanged=await this.unchanged(source);failed||=!evidence.sourceUnchanged;
      this.ownedDocument=failed||incomplete?undefined:source;
      await fs.writeFile(job.report,JSON.stringify(evidence,null,2)+'\n');
      return {failed,outcome:failed?'failed':incomplete?'incomplete':'passed',source:source.absolute,sourceSha256:source.sha256,sourceUnchanged:evidence.sourceUnchanged,
        checks:Object.fromEntries(Object.entries(evidence.checks).map(([key,value])=>[key,this.summary(value as Record<string,any>)])),
        ...(evidence.galaxy?{galaxy:this.summary(evidence.galaxy)}:{}),report:job.report,gameplayVerified:false};
    });
  }
  async cameras(args:{archive:string;locale?:string;offset:number;limit:number}){
    const source=await this.source(args.archive);
    if(!/\.sc2map$/i.test(source.absolute))throw Error('NATIVE_MAP_REQUIRED');
    return this.enqueue('cameras',1200,async job=>{
      if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');
      const directory=path.dirname(job.report),copy=path.join(directory,'Input.SC2Map');await fs.copyFile(source.absolute,copy);
      if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');
      job.phase='saved_cameras';
      const value=await this.invoke('sc2_list_map_cameras',{map:copy,...(args.locale?{locale:args.locale}:{})},directory);
      const sourceUnchanged=await this.unchanged(source);
      const rows=Array.isArray(value.cameras)?value.cameras:[];
      const failed=value.isError||value.status==='FAILED'||!sourceUnchanged;
      const result={failed,source:source.absolute,sourceSha256:source.sha256,sourceUnchanged,
        ...this.summary(value),cameras:rows.slice(args.offset,args.offset+args.limit),total:rows.length,
        offset:args.offset,hasMore:args.offset+args.limit<rows.length,editorStarted:false,report:job.report};
      await fs.writeFile(job.report,JSON.stringify(result,null,2)+'\n');return result;
    });
  }
  async capture(args:{archive:string;mode:'viewport'|'map'|'region';cameraId?:string;bounds?:{left:number;bottom:number;right:number;top:number};includeUnits?:boolean;includeDoodads?:boolean;size:number;deadlineSeconds:number;renderBackend?:'auto'|'legacy'|'vulkan'}){
    const source=await this.source(args.archive);
    if(args.mode==='region'&&!args.bounds)throw Error('NATIVE_REGION_BOUNDS_REQUIRED');
    if(args.cameraId&&args.mode!=='viewport')throw Error('NATIVE_CAMERA_REQUIRES_VIEWPORT');
    if(args.mode==='viewport'&&(args.includeUnits!==undefined||args.includeDoodads!==undefined))throw Error('NATIVE_FILTERS_REQUIRE_MAP_EXPORT');
    if(args.cameraId&&!/\.sc2map$/i.test(source.absolute))throw Error('NATIVE_MAP_REQUIRED');
    return this.enqueue('capture',args.deadlineSeconds,async job=>{
      if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');
      const directory=path.dirname(job.report),copy=path.join(directory,'Input'+path.extname(source.absolute));await fs.copyFile(source.absolute,copy);
      if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');
      job.phase=args.mode;
      const tool=args.mode==='viewport'?'sc2_capture_terrain':args.mode==='map'?'sc2_export_map_image':'sc2_capture_map_region';
      const filters={include_units:args.includeUnits??true,include_doodads:args.includeDoodads??true};
      const reusedLoadedMap=this.loadedCaptureSource?.absolute===source.absolute&&this.loadedCaptureSource.sha256===source.sha256&&this.ownedDocument?.sha256===source.sha256;
      const value=await this.invoke(tool,{...(reusedLoadedMap?{}:{map:copy}),render_backend:args.renderBackend??'auto',...(args.cameraId?{map_camera_id:args.cameraId}:{}),...(args.mode==='viewport'?{}:{size:args.size,...filters}),...(args.mode==='region'?{bounds:args.bounds}:{})},directory);
      const readback=value.native?.terrainExport;
      const objectFilters=args.mode==='viewport'?undefined:{requested:{units:filters.include_units,doodads:filters.include_doodads},
        actual:{units:nativeFlag(readback?.actualUnits),doodads:nativeFlag(readback?.actualDoodads)},
        verified:value.objectFiltersVerified===true&&nativeFlag(readback?.filtersConfirmed)===true&&nativeFlag(readback?.customOptions)===true&&nativeFlag(readback?.actualUnits)===filters.include_units&&nativeFlag(readback?.actualDoodads)===filters.include_doodads};
      // Retain the upstream claim in full evidence; compact replies require matching DLL readback.
      const capture=await this.assess({...value,...(objectFilters?{objectFiltersVerified:objectFilters.verified}:{} )},directory);
      const sourceUnchanged=await this.unchanged(source);
      const failed=value.isError||value.status==='FAILED'||!sourceUnchanged||capture.artifactOwnershipVerified===false,incomplete=['incomplete','pending'].includes(nativeOutcome(value)??'');
      this.ownedDocument=failed||incomplete?undefined:source;
      if(capture.artifactOwnershipVerified===true)this.captureDirectories.set(job,directory);
      if(!failed&&!incomplete&&value.wholeMapVerified===true)this.loadedCaptureSource=source;
      await fs.writeFile(job.report,JSON.stringify({source:source.absolute,sourceSha256:source.sha256,sourceUnchanged,reusedLoadedMap,objectFilters,result:value},null,2)+'\n');
      return {failed,outcome:failed?'failed':incomplete||objectFilters&&!objectFilters.verified?'incomplete':'completed',source:source.absolute,sourceSha256:source.sha256,sourceUnchanged,reusedLoadedMap,
        capture,...(objectFilters?{objectFilters}:{}),report:job.report,limitations:['Water coverage requires separate review. Region mode crops a full image. Saved-camera captures show editor placements, not running triggers or gameplay.',...(objectFilters&&!objectFilters.verified?['Requested object filters are not confirmed by matching native readback.']:[])]};
    });
  }
  diagnostics(){return this.enqueue('diagnostics',1200,async job=>{job.phase='diagnostics';const value=await this.invoke('sc2_diagnostics',{},path.dirname(job.report));
    await fs.writeFile(job.report,JSON.stringify(value,null,2)+'\n');return {failed:value.isError||value.status==='FAILED',diagnostics:this.summary(value),report:job.report};});}
  job(id:string){const job=this.jobs.get(id);if(!job)throw Error('NATIVE_JOB_NOT_FOUND');return this.receipt(job);}
  async stop(){if([...this.jobs.values()].some(j=>j.state==='queued'||j.state==='running'))throw Error('NATIVE_JOBS_IN_PROGRESS: wait for completion before editor.stop');
    await this.observeBackground(false);if([...this.background.values()].some(j=>!nativeJobTerminal.has(j.state)))throw Error('NATIVE_BACKGROUND_JOBS_IN_PROGRESS: wait or explicitly cancel the admitted job');
    await this.client?.close();this.connecting=undefined;this.ownedDocument=undefined;this.loadedCaptureSource=undefined;this.loadedDataDocument=undefined;this.dataDocumentVersion++;this.admissionUncertain=false;return {stopped:true};}
  async close(){this.closing=true;await this.tail;await Promise.allSettled([...this.observers]);try{while([...this.background.values()].some(j=>!nativeJobTerminal.has(j.state)))await this.observeBackground(true);}finally{await this.client?.close();}}
}
