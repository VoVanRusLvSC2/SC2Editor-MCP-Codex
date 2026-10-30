import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Workspace} from '../../core/workspace.js';
import {GameStdioClient,type GameClient,type GameResult} from './transport.js';
import {verifyGameRuntime,type GameRuntimeIdentity} from './runtime.js';
import {observeActionEvents,type ActionEventsRequest,type EventContinuation} from './actionEvents.js';
import {gameMpqCompatibilityBootstrap} from './mpqCompatibility.js';

const operations=new Set(['game.status','game.debug.inspect','game.diagnostics','game.units.find','game.units.inspect','game.selection.set','game.camera.set','game.capture','game.order','game.wait','game.events','game.record','game.fixture','game.ui.inspect','game.ui.activate','game.test.run']);
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const contains=(root:string,file:string)=>{const relative=path.relative(root,file);return !relative||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
async function privateDirectoryChain(file:string){
 const absolute=path.resolve(file);let current=path.parse(absolute).root;
 for(const part of path.relative(current,absolute).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  const stat=await fs.lstat(current).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
  if(!stat)return;
  if(stat.isSymbolicLink())throw Error('GAME_WORK_ROOT_REPARSE_REFUSED');
  if(!stat.isDirectory())throw Error('GAME_WORK_ROOT_NOT_DIRECTORY');
 }
}
async function canonicalDirectoryTarget(file:string){
 let existing=path.resolve(file);const missing:string[]=[];
 while(true){
  try{return path.join(await fs.realpath(existing),...missing);}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const parent=path.dirname(existing);if(parent===existing)throw e;missing.unshift(path.basename(existing));existing=parent;}
 }
}
/** Tokens remain in private upstream session files, never in public MCP replies. */
export function redactGameSecrets(value:any):any {
  if(Array.isArray(value))return value.map(redactGameSecrets);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/token|secret|nonce/i.test(k)?'[redacted]':redactGameSecrets(v)]));
  return value;
}
export class NativeGameBridge {
  private client?:GameClient;
  private tail:Promise<unknown>=Promise.resolve();
  private count=0;
  private closing=false;
  private source?:{file:string;sha256:string};
  private runtimeIdentity?:GameRuntimeIdentity;
  private eventContinuation?:EventContinuation;
  readonly work:string;
  private env:NodeJS.ProcessEnv;
  private externalWorkRoot?:string;
  private externalWorkPrepared=false;
  constructor(private workspace:Workspace,options:{client?:GameClient;env?:NodeJS.ProcessEnv}={}){this.client=options.client;this.env=options.env??process.env;this.externalWorkRoot=this.env.SC2_GAME_WORK_ROOT||undefined;this.work=path.join(this.externalWorkRoot?path.resolve(this.externalWorkRoot):path.join(workspace.root,'.sc2mcp-output','native-game'),randomUUID());}
  configuration(){return {configured:!!this.env.SC2_GAME_TOOLKIT_HOME,launchEnabled:this.env.SC2_GAME_ALLOW_LAUNCH==='1',expectedVersion:'0.1.0-dev',externalRuntime:true,sourceBundled:false,runtimeIdentity:this.runtimeIdentity??null,work:this.work,artifactStorage:this.externalWorkRoot?'configured_external':'workspace_default'};}
  private async prepareExternalWork(home?:string){
    if(!this.externalWorkRoot)return;
    const raw=this.externalWorkRoot,base=path.dirname(this.work);
    if(!path.isAbsolute(raw)||base===path.parse(base).root||raw.startsWith('\\\\')||raw.startsWith('//'))throw Error('GAME_WORK_ROOT_INVALID: use an absolute local directory, not a volume/share root');
    if(contains(this.workspace.root,base))throw Error('GAME_WORK_ROOT_NOT_EXTERNAL: configured artifacts must stay outside the map workspace');
    if(home&&(contains(home,base)||contains(base,home)))throw Error('GAME_WORK_ROOT_RUNTIME_OVERLAP');
    await privateDirectoryChain(base);
    const canonical=await canonicalDirectoryTarget(base),workspace=await fs.realpath(this.workspace.root);
    if(contains(workspace,canonical))throw Error('GAME_WORK_ROOT_NOT_EXTERNAL');
    if(home&&(contains(home,canonical)||contains(canonical,home)))throw Error('GAME_WORK_ROOT_RUNTIME_OVERLAP');
    if(this.externalWorkPrepared){
      await privateDirectoryChain(this.work);
      if(!(await fs.stat(this.work).catch(()=>undefined))?.isDirectory())throw Error('GAME_WORK_ROOT_CHANGED');
      return;
    }
    await fs.mkdir(base,{recursive:true});
    await fs.mkdir(this.work);
    this.externalWorkPrepared=true;
  }
  private async connect(){
    if(!this.client){
      if(!this.env.SC2_GAME_TOOLKIT_HOME)throw Error('GAME_TOOLKIT_NOT_CONFIGURED: set SC2_GAME_TOOLKIT_HOME to the private external installation');
      const home=await fs.realpath(this.env.SC2_GAME_TOOLKIT_HOME),script=path.join(home,'app','mcp_server.py');await fs.access(script);
      this.runtimeIdentity=await verifyGameRuntime(home,this.env.SC2_GAME_BINARIES,{requiredRelease:this.env.SC2_GAME_REQUIRED_RELEASE});
      await this.prepareExternalWork(home);
      if(!this.externalWorkRoot)await fs.mkdir(this.work,{recursive:true});
      this.client=new GameStdioClient(this.env.SC2_GAME_PYTHON??'python',['-c',gameMpqCompatibilityBootstrap,script,'--work',this.work,'--binaries',this.env.SC2_GAME_BINARIES??path.join(home,'bin')],home);
    }else if(this.externalWorkRoot){
      await this.prepareExternalWork(this.env.SC2_GAME_TOOLKIT_HOME?await fs.realpath(this.env.SC2_GAME_TOOLKIT_HOME):undefined);
    }
    await this.client.start();
  }
  private serial<T>(fn:()=>Promise<T>):Promise<T>{
    if(this.closing)return Promise.reject(Error('GAME_BRIDGE_CLOSING'));
    if(this.count>=8)return Promise.reject(Error('GAME_QUEUE_FULL'));
    this.count++;const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next.finally(()=>{this.count--;});
  }
  async status(connect=false){return this.serial(async()=>{
    if(connect)await this.connect();
    return {...this.configuration(),frontend:this.client?.info()??{connected:false},source:this.source??null,pending:this.count-1,...(connect?{runtime:await this.invoke('game.status',{})}:{})};
  });}
  async tools(name?:string){return this.serial(async()=>{await this.connect();const tools=this.client!.tools().filter(t=>t.name==='game.attach'||t.name==='game.detach'||operations.has(t.name));if(name){const found=tools.find(t=>t.name===name);if(!found)throw Error('GAME_TOOL_UNAVAILABLE');return found;}return tools.map(t=>({name:t.name,description:t.description}));});}
  private async invoke(method:string,args:Record<string,unknown>):Promise<GameResult>{
    const result=await this.client!.call(method,args);
    return {...result,structuredContent:result.structuredContent?redactGameSecrets(result.structuredContent):undefined,content:result.content.map(item=>{
      if(item.type!=='text'||!item.text)return item;
      try{return {...item,text:JSON.stringify(redactGameSecrets(JSON.parse(item.text)))};}catch{return item;}
    })};
  }
  async attach(file:string,timeout=120,renderBackend:'auto'|'legacy'|'vulkan'='auto'){return this.serial(async()=>{
    if(!['auto','legacy','vulkan'].includes(renderBackend))throw Error('GAME_RENDER_BACKEND_INVALID');
    if(this.env.SC2_GAME_ALLOW_LAUNCH!=='1')throw Error('GAME_LAUNCH_DISABLED: enable SC2_GAME_ALLOW_LAUNCH=1 for explicitly authorized local tests');
    if(this.source)throw Error('GAME_SESSION_ALREADY_OWNED: detach first');
    if(this.workspace.draftFiles().length)throw Error('GAME_PENDING_DRAFTS');
    const real=await fs.realpath(this.workspace.resolveUserPath(file));this.workspace.resolveUserPath(real);
    if(!/\.sc2map$/i.test(real)||!(await fs.stat(real)).isFile())throw Error('GAME_SAVED_MAP_REQUIRED');
    const before=sha(await fs.readFile(real));await this.connect();
    this.source={file:real,sha256:before};
    this.eventContinuation=undefined;
    const result=await this.invoke('game.attach',{map:real,timeout,render_backend:renderBackend});
    const unchanged=sha(await fs.readFile(real))===before;
    return {...result,isError:result.isError||!unchanged,content:[...result.content,{type:'text' as const,text:JSON.stringify({sourceUnchanged:unchanged,sourceSha256:before})}]};
  });}
  private validateNested(method:string,args:Record<string,unknown>,depth=0){
    if(depth>8||!operations.has(method))throw Error('GAME_OPERATION_NOT_ALLOWED: '+method);
    if(method==='game.record'&&args.action){const a=args.action as any;this.validateNested(a.method,a.arguments??{},depth+1);}
    if(method==='game.test.run'){
      if(!Array.isArray(args.steps)||args.steps.length<1||args.steps.length>64)throw Error('GAME_INVALID_STEPS');
      for(const step of args.steps)this.validateNested(step.method,step.arguments??{},depth+1);
    }
  }
  async call(method:string,args:Record<string,unknown>){return this.serial(async()=>{
    this.validateNested(method,args);
    if(method!=='game.status'&&!this.source)throw Error('GAME_OWNED_SESSION_REQUIRED');
    await this.connect();return this.invoke(method,args);
  });}
  async action(request:ActionEventsRequest){return this.serial(async()=>{
    if(!this.source)throw Error('GAME_OWNED_SESSION_REQUIRED');
    await this.connect();
    const directory=path.join(this.work,'action-'+randomUUID());await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,'request.json'),JSON.stringify(redactGameSecrets(request),null,2)+'\n');
    const report=await observeActionEvents(request,{call:(method,args)=>this.invoke(method,args),continuation:this.eventContinuation,record:async(name,result)=>{await fs.writeFile(path.join(directory,name+'.json'),JSON.stringify(result,null,2)+'\n');}});
    this.eventContinuation=report.continuation;
    try{await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2)+'\n');}
    catch{return {...report,status:'inconclusive' as const,reason:'Private action result could not be persisted; the action was not retried',report:path.join(directory,'result.json')};}
    return {...report,report:path.join(directory,'result.json')};
  });}
  async detach(){return this.serial(async()=>{
    if(!this.client||!this.source)return {stopped:true,sourceUnchanged:null};
    const status=await this.invoke('game.status',{});
    let idle=false;
    for(const item of status.content)if(item.type==='text'){try{idle=JSON.parse(item.text).attached===false;}catch{/* Unknown state requires an actual detach. */}}
    const result=idle?status:await this.invoke('game.detach',{});
    let unchanged:boolean|null=null;
    try{unchanged=sha(await fs.readFile(this.source.file))===this.source.sha256;}catch{/* Deleted/unreadable source is unknown. */}
    const stopped=result.isError!==true;if(stopped){this.source=undefined;this.eventContinuation=undefined;}
    return {result,stopped,sourceUnchanged:unchanged};
  });}
  async close(){this.closing=true;await this.tail;await this.client?.close();this.source=undefined;}
}
