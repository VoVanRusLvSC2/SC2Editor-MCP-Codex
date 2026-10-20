import {existsSync,promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import type {Workspace} from '../../core/workspace.js';
import {NativeStdioClient,type NativeClient} from './transport.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const nativeHome=()=>fileURLToPath(new URL('../../../.native-toolkit-runtime/0.8.0-rc.1/',import.meta.url));
type Check='load'|'compile'|'save_reopen';
interface Job {id:string;state:'queued'|'running'|'completed'|'failed';operation:string;phase:string;createdAt:string;startedAt?:string;finishedAt?:string;deadlineSeconds:number;report:string;result?:Record<string,any>;error?:string}
interface Source {absolute:string;sha256:string}
interface Options {client?:NativeClient;home?:string}

/** Optional native oracle. All map authoring remains in the existing modules. */
export class NativeEditorBridge {
  private client?:NativeClient;
  private jobs=new Map<string,Job>();
  private tail:Promise<void>=Promise.resolve();
  private closing=false;
  private connecting?:Promise<void>;
  private home:string;
  private ownedDocument?:string;
  readonly work:string;
  constructor(readonly workspace:Workspace,options:Options={}){
    this.client=options.client;this.home=options.home??nativeHome();
    this.work=workspace.resolveUserPath('.sc2mcp-output/native-editor');
  }
  configuration(){return {available:!!this.client||existsSync(path.join(this.home,'sc2-mcp-runtime.json'))||!!process.env.SC2_NATIVE_MCP_PATH,
    expectedVersion:'0.8.x',runtimeHome:this.home,transport:'retained stdio MCP',launchPolicy:'Explicit editor.check/editor.capture may start an owned hidden Editor on private map copies',
    setup:'npm run native:setup',gameplayValidation:false,fastMapPreview:'map.preview (ModKit)',terrainCameraControl:false};}
  private async connect(){
    return this.connecting??=this.connectImpl().catch(error=>{this.connecting=undefined;throw error;});
  }
  private async connectImpl(){
    if(!this.client){
      const configured=process.env.SC2_NATIVE_MCP_PATH;
      let executable:string;
      if(configured)executable=path.resolve(configured);
      else{
        let receipt:{executable:string;executableSha256:string};
        try{receipt=JSON.parse(await fs.readFile(path.join(this.home,'sc2-mcp-runtime.json'),'utf8'));}
        catch{throw Error('NATIVE_TOOLKIT_NOT_INSTALLED: npm run native:setup');}
        executable=path.resolve(this.home,receipt.executable);
        const relative=path.relative(this.home,executable);
        if(path.isAbsolute(relative)||relative.startsWith('..'))throw Error('NATIVE_MANIFEST_PATH_INVALID');
        if(hash(await fs.readFile(executable))!==receipt.executableSha256)throw Error('NATIVE_EXECUTABLE_HASH_MISMATCH');
      }
      await fs.mkdir(this.work,{recursive:true});
      this.client=new NativeStdioClient(executable,['--work',path.join(this.work,'worker')],path.dirname(executable));
    }
    await this.client.start();
  }
  async status(connect=false){if(connect){if(this.closing)throw Error('NATIVE_BRIDGE_CLOSING');await this.connect();}return {...this.configuration(),frontend:this.client?.info()??{connected:false},
    ownedDocument:this.ownedDocument??null,jobs:[...this.jobs.values()].map(j=>({id:j.id,state:j.state,operation:j.operation,phase:j.phase,report:j.report}))};}
  private async source(file:string):Promise<Source>{
    const absolute=this.workspace.resolveUserPath(file);
    if(!/\.sc2(?:map|mod)$/i.test(absolute))throw Error('NATIVE_SAVED_ARCHIVE_REQUIRED: export components through map.export first');
    if(this.workspace.draftFiles().length)throw Error('NATIVE_PENDING_DRAFTS: save or discard drafts before checking committed archives');
    const real=await fs.realpath(absolute);this.workspace.resolveUserPath(real);
    if(!(await fs.stat(real)).isFile())throw Error('NATIVE_SAVED_ARCHIVE_REQUIRED');
    return {absolute:real,sha256:hash(await fs.readFile(real))};
  }
  private async unchanged(source:Source){return hash(await fs.readFile(source.absolute))===source.sha256;}
  private receipt(job:Job){return {...job,deadlineExceeded:job.state==='running'&&Date.now()-Date.parse(job.startedAt!)>job.deadlineSeconds*1000,
    cancellation:'No forced cancellation of active native handlers; wait for completion, then editor.stop.'};}
  private enqueue(operation:string,deadlineSeconds:number,run:(job:Job)=>Promise<Record<string,any>>){
    if(this.closing)throw Error('NATIVE_BRIDGE_CLOSING');
    if([...this.jobs.values()].filter(j=>j.state==='queued'||j.state==='running').length>=8)throw Error('NATIVE_QUEUE_FULL');
    for(const [id,j] of this.jobs)if(this.jobs.size>=32&&['completed','failed'].includes(j.state))this.jobs.delete(id);
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
      'requestedTerrainFrameVerified','wholeMapVerified','coordinateMappingValidated','preview','width','height'];
    const result=Object.fromEntries(selected.filter(k=>k in value).map(k=>[k,value[k]]));
    const diag=value.diagnostics??value.operationDiagnostics;
    if(diag){result.diagnostics={newErrorsClear:diag.newErrorsClear??null,inspectionComplete:diag.inspectionComplete??null,
      newErrorCount:Array.isArray(diag.newErrors)?diag.newErrors.length:diag.newErrorCount??null,
      newWarningCount:Array.isArray(diag.newWarnings)?diag.newWarnings.length:diag.newWarningCount??null,
      newErrors:diag.newErrors?.slice(0,8),newWarnings:diag.newWarnings?.slice(0,4),compilerErrors:Array.isArray(diag.compilerErrors)?diag.compilerErrors.slice(0,8):diag.compilerErrors??null};}
    if(result.componentComparison){const c=result.componentComparison;result.componentComparison={...c,
      changes:c.changes?.slice(0,12).map((change:Record<string,unknown>)=>({name:change.name,locale:change.locale,change:change.change,archiveMetadata:change.archiveMetadata})),
      changesTruncated:!!c.changesTruncated||(c.changes?.length??0)>12};}
    return result;
  }
  async check(args:{archive:string;checks:Check[];scope?:string;contextLabel?:string;locale?:string;includeDiffs:boolean;deadlineSeconds:number}){
    const source=await this.source(args.archive);
    const checks=[...new Set(args.checks)];
    return this.enqueue('check',args.deadlineSeconds,async job=>{
      if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');
      const directory=path.dirname(job.report),copy=path.join(directory,'Input'+path.extname(source.absolute));
      await fs.copyFile(source.absolute,copy);if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');
      const evidence:Record<string,any>={source:source.absolute,sourceSha256:source.sha256,checks:{},scope:'Native Editor checks; not gameplay or exhaustive Data validation'};
      let failed=false,incomplete=false;
      for(const check of ['load','save_reopen','compile'] as const){
        if(!checks.includes(check))continue;job.phase=check;
        let value:Record<string,any>;
        if(check==='load')value=await this.invoke('sc2_validate_document',{map:copy},directory);
        else if(check==='save_reopen')value=await this.invoke('sc2_save_reopen',{map:copy,include_diffs:args.includeDiffs},directory);
        else{
          if(!checks.includes('load')&&!checks.includes('save_reopen')){
            const opened=await this.invoke('sc2_open_document',{map:copy},directory);evidence.open=opened;
            if(opened.isError||opened.status==='FAILED'){failed=true;break;}
          }
          value=await this.invoke('sc2_compile_all',{...(args.scope?{scope:args.scope}:{}),...(args.contextLabel?{context_label:args.contextLabel}:{}),...(args.locale?{locale:args.locale}:{})},directory);
          if(value.nativeCompilePassed===true){const exported=await this.invoke('sc2_export_galaxy',{output:path.join(directory,'Native.galaxy')},directory);evidence.galaxy=exported;if(exported.isError)failed=true;}
        }
        evidence.checks[check]=value;
        if(value.isError||value.status==='FAILED'||check==='compile'&&value.nativeCompilePassed===false){failed=true;break;}
        if(check==='compile'?value.nativeCompilePassed!==true:value.nativeValidationPassed!==true)incomplete=true;
      }
      evidence.sourceUnchanged=await this.unchanged(source);failed||=!evidence.sourceUnchanged;
      this.ownedDocument=source.absolute;
      await fs.writeFile(job.report,JSON.stringify(evidence,null,2)+'\n');
      return {failed,outcome:failed?'failed':incomplete?'incomplete':'passed',source:source.absolute,sourceSha256:source.sha256,sourceUnchanged:evidence.sourceUnchanged,
        checks:Object.fromEntries(Object.entries(evidence.checks).map(([key,value])=>[key,this.summary(value as Record<string,any>)])),
        ...(evidence.galaxy?{galaxy:this.summary(evidence.galaxy)}:{}),report:job.report,gameplayVerified:false};
    });
  }
  async capture(args:{archive:string;mode:'viewport'|'map'|'region';bounds?:{left:number;bottom:number;right:number;top:number};size:number;deadlineSeconds:number}){
    const source=await this.source(args.archive);
    if(args.mode==='region'&&!args.bounds)throw Error('NATIVE_REGION_BOUNDS_REQUIRED');
    return this.enqueue('capture',args.deadlineSeconds,async job=>{
      if(!await this.unchanged(source))throw Error('NATIVE_SOURCE_CHANGED_WHILE_QUEUED');
      const directory=path.dirname(job.report),copy=path.join(directory,'Input'+path.extname(source.absolute));await fs.copyFile(source.absolute,copy);
      if(hash(await fs.readFile(copy))!==source.sha256)throw Error('NATIVE_SNAPSHOT_CHANGED');
      job.phase=args.mode;
      const tool=args.mode==='viewport'?'sc2_capture_terrain':args.mode==='map'?'sc2_export_map_image':'sc2_capture_map_region';
      const value=await this.invoke(tool,{map:copy,...(args.mode==='viewport'?{}:{size:args.size}),...(args.mode==='region'?{bounds:args.bounds}:{})},directory);
      const sourceUnchanged=await this.unchanged(source);this.ownedDocument=source.absolute;
      await fs.writeFile(job.report,JSON.stringify({source:source.absolute,sourceSha256:source.sha256,sourceUnchanged,result:value},null,2)+'\n');
      return {failed:value.isError||value.status==='FAILED'||!sourceUnchanged,source:source.absolute,sourceSha256:source.sha256,sourceUnchanged,
        capture:this.summary(value),report:job.report,limitations:['Native water/category exclusion coverage is incomplete. Region mode crops a full image; it is not a camera-controlled close-up.']};
    });
  }
  diagnostics(){return this.enqueue('diagnostics',1200,async job=>{job.phase='diagnostics';const value=await this.invoke('sc2_diagnostics',{},path.dirname(job.report));
    await fs.writeFile(job.report,JSON.stringify(value,null,2)+'\n');return {failed:value.isError||value.status==='FAILED',diagnostics:this.summary(value),report:job.report};});}
  job(id:string){const job=this.jobs.get(id);if(!job)throw Error('NATIVE_JOB_NOT_FOUND');return this.receipt(job);}
  async stop(){if([...this.jobs.values()].some(j=>j.state==='queued'||j.state==='running'))throw Error('NATIVE_JOBS_IN_PROGRESS: wait for completion before editor.stop');
    await this.client?.close();this.connecting=undefined;this.ownedDocument=undefined;return {stopped:true};}
  async close(){this.closing=true;await this.tail;await this.client?.close();}
}
