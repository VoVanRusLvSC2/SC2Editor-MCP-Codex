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

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const nativeHome=()=>fileURLToPath(new URL(`../../../.native-toolkit-runtime/${nativeRelease.version}/`,import.meta.url));
type Check='load'|'compile'|'save_reopen';
interface Job {id:string;state:'queued'|'running'|'completed'|'failed';operation:string;phase:string;createdAt:string;startedAt?:string;finishedAt?:string;deadlineSeconds:number;report:string;result?:Record<string,any>;error?:string}
interface Source {absolute:string;sha256:string}
interface Options {client?:NativeClient;home?:string}
export const nativeOperations=['sc2_modules','sc2_editor_start','sc2_open_document','sc2_convert_xml','sc2_compile_all','sc2_export_galaxy','sc2_diagnostics','sc2_cutscene_open','sc2_cutscene_seek','sc2_capture_frame','sc2_capture_terrain','sc2_list_map_cameras','sc2_export_map_image','sc2_export_video','sc2_search_objects','sc2_capture_map_region','sc2_validate_document','sc2_save_reopen'] as const;

/** Optional native oracle. All map authoring remains in the existing modules. */
export class NativeEditorBridge {
  private client?:NativeClient;
  private jobs=new Map<string,Job>();
  private tail:Promise<void>=Promise.resolve();
  private closing=false;
  private connecting?:Promise<void>;
  private home:string;
  private ownedDocument?:Source;
  private readonly workerId=randomUUID().replaceAll('-','');
  private guiEvidence=new Map<string,NativeGuiEvidence>();
  readonly work:string;
  constructor(readonly workspace:Workspace,options:Options={}){
    this.client=options.client;this.home=options.home??nativeHome();
    // The upstream Windows archive extractor still has MAX_PATH-bound operations.
    // Keep the owned prefix compact; preserve the full UUID entropy and guards.
    this.work=workspace.resolveUserPath('.sc2mcp-output/ne');
  }
  private workerDirectory(){return path.join(this.work,'w',this.workerId);}
  configuration(){return {available:!!this.client||existsSync(path.join(this.home,'sc2-mcp-runtime.json'))||!!process.env.SC2_NATIVE_MCP_PATH,
    expectedVersion:nativeRelease.version,nativeProtocol:nativeRelease.nativeProtocol,runtimeHome:this.home,transport:'retained stdio MCP',launchPolicy:'Explicit editor.check/editor.capture may start an owned hidden Editor on private map copies',
    stability:'Prerelease; native startup, compilation and rendering require local evidence',updatePolicy:'Pinned complete release; setup does not auto-upgrade or start an Editor',workerDirectory:this.workerDirectory(),storageLayout:'compact-owned-v1',
    setup:'npm run native:setup',gameplayValidation:false,fastMapPreview:'map.preview (ModKit)',terrainCameraControl:'Saved map cameras only; native readback required'};}
  private async connect(){
    return this.connecting??=this.connectImpl().catch(error=>{this.connecting=undefined;throw error;});
  }
  private async connectImpl(){
    if(!this.client){
      const configured=process.env.SC2_NATIVE_MCP_PATH;
      let executable:string;
      if(configured)executable=path.resolve(configured);
      else{
        let receipt:{version:string;nativeProtocol:number;executable:string;executableSha256:string};
        try{receipt=JSON.parse(await fs.readFile(path.join(this.home,'sc2-mcp-runtime.json'),'utf8'));}
        catch{throw Error('NATIVE_TOOLKIT_NOT_INSTALLED: npm run native:setup');}
        if(receipt.version!==nativeRelease.version||receipt.nativeProtocol!==nativeRelease.nativeProtocol)throw Error('NATIVE_RUNTIME_PROTOCOL_MISMATCH: install the complete pinned package');
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
    ownedDocument:this.ownedDocument?.absolute??null,jobs:[...this.jobs.values()].map(j=>({id:j.id,state:j.state,operation:j.operation,phase:j.phase,report:j.report}))};}
  async tools(name?:string){if(this.closing)throw Error('NATIVE_BRIDGE_CLOSING');await this.connect();const tools=this.client?.describe?.();if(!tools)return {status:'unsupported',reason:'Native client does not publish schemas',frontend:this.client?.info()};if(name){const tool=tools.find(t=>t.name===name);if(!tool)throw Error('NATIVE_TOOL_UNAVAILABLE');return tool;}return tools.map(({name,description})=>({name,description,available:(nativeOperations as readonly string[]).includes(name)}));}
  async call(method:typeof nativeOperations[number],args:Record<string,unknown>,deadlineSeconds=1200){
    if(!(nativeOperations as readonly string[]).includes(method))throw Error('NATIVE_OPERATION_NOT_ALLOWED');
    if('output' in args||'overwrite' in args)throw Error('NATIVE_OUTPUT_OWNED: artifacts are written inside this job');
    if(Buffer.byteLength(JSON.stringify(args))>4*1024*1024)throw Error('NATIVE_ARGUMENT_SIZE_LIMIT');
    const sources=new Map<string,Source>();
    for(const key of ['template','map','baseline_template','scene','triggers_file','trigger_strings','game_strings'])if(args[key]!==undefined){
      if(typeof args[key]!=='string')throw Error('NATIVE_INPUT_PATH_REQUIRED: '+key);
      if(['template','map','baseline_template'].includes(key))sources.set(key,await this.source(args[key] as string));
      else{const real=await fs.realpath(this.workspace.resolveUserPath(args[key] as string));this.workspace.resolveUserPath(real);if(!(await fs.stat(real)).isFile())throw Error('NATIVE_INPUT_FILE_REQUIRED');
        if(key==='scene'&&!/\.(?:sc2cutscene|stormcutscene)$/i.test(real))throw Error('NATIVE_SCENE_FILE_REQUIRED');
        const bytes=await fs.readFile(real);if(bytes.length>32*1024*1024)throw Error('NATIVE_INPUT_SIZE_LIMIT');sources.set(key,{absolute:real,sha256:hash(bytes)});}
    }
    if(this.workspace.draftFiles().length||this.workspace.binary.draftFiles().length)throw Error('NATIVE_PENDING_DRAFTS');
    return this.enqueue(method,deadlineSeconds,async job=>{
      const directory=path.dirname(job.report),input={...args};
      for(const [key,source]of sources){if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');const copy=path.join(directory,key+path.extname(source.absolute));await fs.copyFile(source.absolute,copy);if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');input[key]=copy;}
      const source=sources.get('map')??sources.get('template');
      const readOnly=['sc2_modules','sc2_list_map_cameras','sc2_search_objects'].includes(method);
      if(!readOnly&&!source&&!this.ownedDocument)throw Error('NATIVE_OWNED_DOCUMENT_REQUIRED: pass a saved template/map or open one first');
      if(!readOnly&&!source&&this.ownedDocument&&!await this.unchanged(this.ownedDocument)){this.ownedDocument=undefined;throw Error('NATIVE_OWNED_SOURCE_CHANGED: reopen the saved archive');}
      const outputs:Record<string,string>={sc2_export_galaxy:'Native.galaxy',sc2_capture_frame:'Frame.png',sc2_capture_terrain:'Terrain.png',sc2_export_map_image:'Map.png',sc2_capture_map_region:'Region.png',sc2_export_video:'Cutscene.mp4',sc2_save_reopen:'NativeSaved.SC2Map'};
      if(method==='sc2_search_objects'){
        if(input.limit!==undefined&&(!Number.isInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>500))throw Error('NATIVE_OBJECT_LIMIT_INVALID');
        input.limit=Math.min(Number(input.limit??100),100);
      }
      if(outputs[method])input.output=path.join(directory,outputs[method]);
      job.phase=method;let value:Record<string,any>;
      try{value=await this.invoke(method,input,directory);}catch(e){if(!readOnly)this.ownedDocument=undefined;throw e;}
      let sourceUnchanged=true;for(const source of sources.values())sourceUnchanged&&=await this.unchanged(source);
      const failed=value.isError||value.status==='FAILED'||value.status==='failed'||!sourceUnchanged;
      const incomplete=value.status==='NOT_CONFIRMED'||value.nativeConfirmed===false;
      if(method==='sc2_convert_xml'&&!failed&&!incomplete&&value.nativeGenerationVerified===true&&value.nativeCompilePassed===true&&value.originalGenerator===true&&value.replacementEmitterUsed===false&&(args.scope===undefined||args.scope==='mapRoot')&&!sources.has('trigger_strings')&&!sources.has('game_strings')){
        try{
        const template=sources.get('template'),xmlSha256=typeof args.triggers_xml==='string'?hash(Buffer.from(args.triggers_xml)):sources.get('triggers_file')?.sha256;
        if(template&&xmlSha256&&typeof value.output==='string'){
          const real=await fs.realpath(value.output),root=await fs.realpath(this.workerDirectory()),relative=path.relative(root,real);
          if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep)||!/\.galaxy$/i.test(real))throw Error('NATIVE_GUI_OUTPUT_OUTSIDE_WORKER');
          if((await fs.stat(real)).size>16*1024*1024)throw Error('NATIVE_GUI_OUTPUT_SIZE_LIMIT');
          const bytes=await fs.readFile(real);if(hash(bytes)!==value.sourceSha256||bytes.length!==value.sourceBytes)throw Error('NATIVE_GUI_OUTPUT_IDENTITY');
          this.guiEvidence.set(job.id,{jobId:job.id,xmlSha256,template,output:{absolute:real,sha256:hash(bytes)}});
        }
        }catch(error){this.ownedDocument=undefined;this.guiEvidence.delete(job.id);throw error;}
      }
      if((failed||incomplete)&&!readOnly)this.ownedDocument=undefined;else if(source&&!readOnly)this.ownedDocument=source;
      const selected=['status','version','error','nativeConfirmed','nativeCompilePassed','actualTimeMs','time_ms','camera','nativeTimeConfirmed','mapCamera','artifact','preview','audio','video','objects','cameras','total','totalMatches','count','offset','limit','truncated','nextOffset','modules','capabilities','renderBackend','editorRequired','sourceUnchanged','mapSha256','scope','terrain','objectsComponentPresent','coordinateMeaning','nameMeaning','inputAutomation'];
      const response={...this.summary(value),...Object.fromEntries(selected.filter(k=>k in value).map(k=>[k,Array.isArray(value[k])?value[k].slice(0,100):value[k]]))};
      const truncatedArrays=selected.filter(k=>Array.isArray(value[k])&&value[k].length>100).map(k=>({field:k,total:value[k].length,returned:100}));
      if(truncatedArrays.length)response.responseTruncation={arrays:truncatedArrays,fullReport:job.report,...(method==='sc2_list_map_cameras'?{pagedTool:'editor.cameras'}:{})};
      await fs.writeFile(job.report,JSON.stringify({method,sourceUnchanged,sources:[...sources].map(([key,s])=>({key,...s})),native:value},null,2)+'\n');
      return {failed,outcome:failed?'failed':incomplete?'incomplete':'completed',method,sourceUnchanged,response,nativeGuiImportEligible:this.guiEvidence.has(job.id),...(value.preview||/\.png$/i.test(value.artifact?.path??'')?{capture:await this.assess(value)}:{}),report:job.report,semanticAcceptance:'Inspect native confirmations and artifacts; completion alone is not feature certification'};
    });
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
    cancellation:'No forced cancellation of active native handlers; wait for completion, then editor.stop.'};}
  async details(id:string,pointer='',offset=0,limit=12){
    const j=this.jobs.get(id);if(!j)throw Error('NATIVE_JOB_UNKNOWN');
    let file:string;try{file=await fs.realpath(j.report);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {available:false,reason:'The completed report is not available yet'};throw e;}
    const root=await fs.realpath(this.work),relative=path.relative(root,file);
    if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('NATIVE_DETAILS_OUTSIDE_WORKER');
    if((await fs.stat(file)).size>32*1024*1024)throw Error('NATIVE_DETAILS_REPORT_SIZE_LIMIT');
    const result=nativeReportPage(JSON.parse(await fs.readFile(file,'utf8')),pointer,offset,limit);
    if(Buffer.byteLength(JSON.stringify(result))>24000)throw Error('NATIVE_DETAILS_OUTPUT_LIMIT: select a smaller page or deeper path');
    return {available:true,...result};
  }
  private enqueue(operation:string,deadlineSeconds:number,run:(job:Job)=>Promise<Record<string,any>>){
    if(this.closing)throw Error('NATIVE_BRIDGE_CLOSING');
    if([...this.jobs.values()].filter(j=>j.state==='queued'||j.state==='running').length>=8)throw Error('NATIVE_QUEUE_FULL');
    for(const [id,j] of this.jobs)if(this.jobs.size>=32&&['completed','failed'].includes(j.state)){this.jobs.delete(id);this.guiEvidence.delete(id);}
    const id=randomUUID(),job:Job={id,state:'queued',operation,phase:'queued',createdAt:new Date().toISOString(),deadlineSeconds,report:path.join(this.work,'jobs',id,'result.json')};
    this.jobs.set(id,job);
    this.tail=this.tail.then(async()=>{
      job.state='running';job.startedAt=new Date().toISOString();job.phase='connecting';
      let terminal:'failed'|'completed'='failed';
      try{await fs.mkdir(path.dirname(job.report),{recursive:true});await this.connect();job.result=await run(job);terminal=job.result.failed?'failed':'completed';}
      catch(error){job.error=error instanceof Error?error.message:String(error);}
      finally{job.finishedAt=new Date().toISOString();job.phase='publishing';await fs.mkdir(path.dirname(job.report),{recursive:true});
        if(!existsSync(job.report))await fs.writeFile(job.report,JSON.stringify({state:terminal,error:job.error??null},null,2)+'\n');
        await fs.writeFile(path.join(path.dirname(job.report),'job.json'),JSON.stringify(this.receipt({...job,state:terminal,phase:'finished'}),null,2)+'\n');
        job.state=terminal;job.phase='finished';}
    }).catch(error=>{job.state='failed';job.error=String(error);});
    return this.receipt(job);
  }
  private async invoke(name:string,args:Record<string,unknown>,directory:string){
    const response=await this.client!.call(name,args);
    const text=response.content?.find(item=>item.type==='text')?.text??'';
    let value=response.structuredContent;
    if(!value){try{value=JSON.parse(text);}catch{value={status:'FAILED',error:text};}}
    const evidence={...value,isError:response.isError===true};
    await fs.writeFile(path.join(directory,name+'.json'),JSON.stringify(evidence,null,2)+'\n');
    return evidence as Record<string,any>;
  }
  private summary(value:Record<string,any>){
    const selected=['status','error','nativeLoadVerified','nativeDataModuleLoaded','nativeSaveVerified','nativeReopenVerified','componentComparisonVerified','nativeValidationPassed',
      'nativeGenerationVerified','nativeCompilePassed','sourceSha256','sourceUnchanged','componentComparison','desktopObservation','evidenceDirectory','artifact','savedArchive','componentDiffArtifact',
      'requestedTerrainFrameVerified','wholeMapVerified','coordinateMappingValidated','preview','width','height',
      'failureKind','failureStage','failureEvidence','failureNative','ownedWorkerReset','automaticRetry',
      'mapCamera','cameraReadback','nativeCameraVerified','nativeLoad','controllerExitCode','failure','handlerCompletionKnown','renderBackend'];
    const result=Object.fromEntries(selected.filter(k=>k in value).map(k=>[k,value[k]]));
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
  private async assess(value:Record<string,any>){
    const capture=this.summary(value),file=value.preview?.path??value.artifact?.path;
    if(file)try{
      const real=await fs.realpath(file),root=await fs.realpath(this.work),relative=path.relative(root,real);
      if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('NATIVE_FRAME_OUTSIDE_WORKER');
      capture.contentAssessment=await assessNativeFrame(real);
    }catch(e){capture.contentAssessment={status:'unavailable',visualAcceptance:'not_checked',reason:String(e)};}
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
          }
          value=await this.invoke('sc2_compile_all',{...(args.scope?{scope:args.scope}:{}),...(args.contextLabel?{context_label:args.contextLabel}:{}),...(args.locale?{locale:args.locale}:{})},directory);
          if(value.nativeCompilePassed===true){const exported=await this.invoke('sc2_export_galaxy',{output:path.join(directory,'Native.galaxy')},directory);evidence.galaxy=exported;if(exported.isError)failed=true;}
        }
        evidence.checks[check]=value;
        if(value.isError||value.status==='FAILED'||check==='compile'&&value.nativeCompilePassed===false){failed=true;break;}
        if(check==='compile'?value.nativeCompilePassed!==true:value.nativeValidationPassed!==true)incomplete=true;
      }
      evidence.sourceUnchanged=await this.unchanged(source);failed||=!evidence.sourceUnchanged;
      this.ownedDocument=failed?undefined:source;
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
  async capture(args:{archive:string;mode:'viewport'|'map'|'region';cameraId?:string;bounds?:{left:number;bottom:number;right:number;top:number};size:number;deadlineSeconds:number;renderBackend?:'auto'|'legacy'|'vulkan'}){
    const source=await this.source(args.archive);
    if(args.mode==='region'&&!args.bounds)throw Error('NATIVE_REGION_BOUNDS_REQUIRED');
    if(args.cameraId&&args.mode!=='viewport')throw Error('NATIVE_CAMERA_REQUIRES_VIEWPORT');
    if(args.cameraId&&!/\.sc2map$/i.test(source.absolute))throw Error('NATIVE_MAP_REQUIRED');
    return this.enqueue('capture',args.deadlineSeconds,async job=>{
      if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');
      const directory=path.dirname(job.report),copy=path.join(directory,'Input'+path.extname(source.absolute));await fs.copyFile(source.absolute,copy);
      if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');
      job.phase=args.mode;
      const tool=args.mode==='viewport'?'sc2_capture_terrain':args.mode==='map'?'sc2_export_map_image':'sc2_capture_map_region';
      const value=await this.invoke(tool,{map:copy,render_backend:args.renderBackend??'auto',...(args.cameraId?{map_camera_id:args.cameraId}:{}),...(args.mode==='viewport'?{}:{size:args.size}),...(args.mode==='region'?{bounds:args.bounds}:{})},directory);
      const sourceUnchanged=await this.unchanged(source);this.ownedDocument=value.isError||value.status==='FAILED'||!sourceUnchanged?undefined:source;
      await fs.writeFile(job.report,JSON.stringify({source:source.absolute,sourceSha256:source.sha256,sourceUnchanged,result:value},null,2)+'\n');
      return {failed:value.isError||value.status==='FAILED'||!sourceUnchanged,source:source.absolute,sourceSha256:source.sha256,sourceUnchanged,
        capture:await this.assess(value),report:job.report,limitations:['Native water/category exclusion coverage is incomplete. Region mode crops a full image. Saved-camera captures show editor placements, not running triggers or gameplay.']};
    });
  }
  diagnostics(){return this.enqueue('diagnostics',1200,async job=>{job.phase='diagnostics';const value=await this.invoke('sc2_diagnostics',{},path.dirname(job.report));
    await fs.writeFile(job.report,JSON.stringify(value,null,2)+'\n');return {failed:value.isError||value.status==='FAILED',diagnostics:this.summary(value),report:job.report};});}
  job(id:string){const job=this.jobs.get(id);if(!job)throw Error('NATIVE_JOB_NOT_FOUND');return this.receipt(job);}
  async stop(){if([...this.jobs.values()].some(j=>j.state==='queued'||j.state==='running'))throw Error('NATIVE_JOBS_IN_PROGRESS: wait for completion before editor.stop');
    await this.client?.close();this.connecting=undefined;this.ownedDocument=undefined;return {stopped:true};}
  async close(){this.closing=true;await this.tail;await this.client?.close();}
}
