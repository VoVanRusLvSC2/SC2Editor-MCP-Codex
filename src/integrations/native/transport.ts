import {nativeOutcome} from './outcome.js';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {nativeRelease} from './release.js';
import {nativeQueuedMethods,nativeJobIdentity,nativeJobTerminal} from './background.js';

export interface NativeResult {content?:Array<{type:string;text?:string;data?:string;mimeType?:string}>;structuredContent?:Record<string,any>;isError?:boolean;nativeJobReport?:Record<string,any>}
export interface NativeTool {name:string;description:string;inputSchema:Record<string,unknown>}
export interface NativeClient {start():Promise<void>;call(name:string,args:Record<string,unknown>):Promise<NativeResult>;close():Promise<void>;info():unknown;describe?():NativeTool[]}

/** A retained stdio frontend; native requests are serialized by NativeEditorBridge. */
export class NativeStdioClient implements NativeClient {
  private child?:ChildProcessWithoutNullStreams;
  private starting?:Promise<void>;
  private next=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  private buffer='';
  private serverInfo?:Record<string,unknown>;
  private tools=new Set<string>();
  private definitions:NativeTool[]=[];
  private queuedCalls=0;
  private uncertainJob?:{stage:string;jobId?:string;reason:string};
  constructor(private command:string,private args:string[],private cwd:string){}
  info(){return {connected:!!this.child&&!this.child.killed,server:this.serverInfo,tools:[...this.tools],queueRecoveryRequired:!!this.uncertainJob,...(this.uncertainJob?{uncertainJob:this.uncertainJob}:{})};}
  describe(){return this.definitions;}
  start():Promise<void>{return this.starting??=this.connect().catch(error=>{this.starting=undefined;throw error;});}
  private async connect(){
    this.buffer='';this.tools.clear();this.definitions=[];this.serverInfo=undefined;
    const child=spawn(this.command,this.args,{cwd:this.cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
    child.stderr.resume(); // Native evidence is retained by the Toolkit, not mixed into MCP stdout.
    const fail=(error:Error)=>{for(const p of this.pending.values())p.reject(error);this.pending.clear();this.starting=undefined;if(this.child===child)this.child=undefined;};
    child.on('error',fail);child.on('exit',code=>fail(Error('NATIVE_FRONTEND_EXIT_'+code)));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(part:string)=>{
      this.buffer+=part;
      if(this.buffer.length>64*1024*1024){fail(Error('NATIVE_PROTOCOL_RESPONSE_TOO_LARGE'));return;}
      let end:number;
      while((end=this.buffer.indexOf('\n'))>=0){
        const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;
        try{const response=JSON.parse(line),p=this.pending.get(response.id);if(!p)continue;this.pending.delete(response.id);
          if(response.error)p.reject(Error('NATIVE_RPC: '+JSON.stringify(response.error)));else p.resolve(response.result);
        }catch{fail(Error('NATIVE_PROTOCOL_INVALID_JSON'));}
      }
    });
    const initialized=await this.rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'SC2EditorToolkit',version:'1'}});
    this.serverInfo=initialized.serverInfo;
    if(initialized.serverInfo?.name!=='sc2-native-toolkit'||initialized.serverInfo?.version!==nativeRelease.version){
      await this.close();throw Error('NATIVE_TOOLKIT_VERSION_MISMATCH: expected '+nativeRelease.version);
    }
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed=await this.rpc('tools/list',{});this.definitions=listed.tools;this.tools=new Set(listed.tools.map((tool:{name:string})=>tool.name));
  }
  private rpc(method:string,params:unknown):Promise<any>{
    const child=this.child;if(!child)return Promise.reject(Error('NATIVE_NOT_CONNECTED'));
    const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{if(error){this.pending.delete(id);reject(error);}});
    });
  }
  async call(name:string,args:Record<string,unknown>){
    const operation=nativeQueuedMethods[name];
    if((operation||name==='sc2_submit_job')&&this.uncertainJob)throw Error('NATIVE_QUEUE_RECOVERY_REQUIRED: stop the owned frontend before more work');
    await this.start();if(!this.tools.has(name))throw Error('NATIVE_TOOL_UNAVAILABLE: '+name);
    // A synchronous SDK stdio handler blocks later control requests. Keep its
    // original operation and result, but use bounded queue observations instead.
    if(operation&&this.tools.has('sc2_submit_job')&&this.tools.has('sc2_job_wait'))return this.queuedCall(operation,args);
    return this.rpc('tools/call',{name,arguments:args}) as Promise<NativeResult>;
  }
  private value(raw:NativeResult){
    if(raw.structuredContent)return raw.structuredContent;
    return JSON.parse(raw.content?.find(c=>c.type==='text')?.text??'{}') as Record<string,any>;
  }
  private async queuedCall(operation:string,args:Record<string,unknown>):Promise<NativeResult>{
    this.queuedCalls++;let id:string|undefined,stage='submission';
    try{
      const admission=await this.rpc('tools/call',{name:'sc2_submit_job',arguments:{operation,arguments:args}}) as NativeResult;
      let value=this.value(admission);
      if(admission.isError&&!Object.hasOwn(value,'jobId'))return admission;
      let identity=nativeJobIdentity(value);id=identity.id;let responseError=admission.isError===true;
      if(value.operation!==operation)throw Error('NATIVE_JOB_RESPONSE_IDENTITY_MISMATCH');
      stage='observation';
      while(!nativeJobTerminal.has(identity.state)){
        const raw=await this.rpc('tools/call',{name:'sc2_job_wait',arguments:{job_id:id,wait_ms:500}}) as NativeResult;
        value=this.value(raw);identity=nativeJobIdentity(value);
        if(identity.id!==id||value.operation!==operation)throw Error('NATIVE_JOB_RESPONSE_IDENTITY_MISMATCH');
        responseError=raw.isError===true;
      }
      const result=value.result;
      if(identity.state==='SUCCEEDED'&&(!result||typeof result!=='object'||Array.isArray(result)))throw Error('NATIVE_JOB_RESULT_UNCONFIRMED');
      const failed=identity.state!=='SUCCEEDED',structuredContent={...(result??{}),...(failed?{status:'FAILED',error:result?.error??value.error??'Native operation '+identity.state}:{}),transportJob:{id,operation,state:identity.state,responseError,automaticRetry:false}};
      return{isError:failed||responseError||['failed','cancelled'].includes(nativeOutcome(structuredContent)??''),structuredContent,nativeJobReport:value,content:[{type:'text',text:JSON.stringify(structuredContent)}]};
    }catch(error){this.uncertainJob={stage,...(id?{jobId:id}:{}),reason:String(error).slice(0,1000)};throw error;}
    finally{this.queuedCalls--;}
  }
  async close(){
    if(this.pending.size||this.queuedCalls)throw Error('NATIVE_REQUEST_IN_PROGRESS: cannot abort an active native handler');
    const child=this.child;if(!child){this.uncertainJob=undefined;return;}
    // EOF lets the Toolkit safely close its owned Editor. Never terminate its native handler.
    await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.stdin.end();});
    this.child=undefined;this.starting=undefined;this.tools.clear();this.serverInfo=undefined;this.buffer='';this.uncertainJob=undefined;
  }
}
