import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {nativeRelease} from './release.js';

export interface NativeResult {content?:Array<{type:string;text?:string;data?:string;mimeType?:string}>;structuredContent?:Record<string,any>;isError?:boolean}
export interface NativeClient {start():Promise<void>;call(name:string,args:Record<string,unknown>):Promise<NativeResult>;close():Promise<void>;info():unknown}

/** A retained stdio frontend; native requests are serialized by NativeEditorBridge. */
export class NativeStdioClient implements NativeClient {
  private child?:ChildProcessWithoutNullStreams;
  private starting?:Promise<void>;
  private next=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  private buffer='';
  private serverInfo?:Record<string,unknown>;
  private tools=new Set<string>();
  constructor(private command:string,private args:string[],private cwd:string){}
  info(){return {connected:!!this.child&&!this.child.killed,server:this.serverInfo,tools:[...this.tools]};}
  start():Promise<void>{return this.starting??=this.connect().catch(error=>{this.starting=undefined;throw error;});}
  private async connect(){
    this.buffer='';this.tools.clear();this.serverInfo=undefined;
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
    const listed=await this.rpc('tools/list',{});this.tools=new Set(listed.tools.map((tool:{name:string})=>tool.name));
  }
  private rpc(method:string,params:unknown):Promise<any>{
    const child=this.child;if(!child)return Promise.reject(Error('NATIVE_NOT_CONNECTED'));
    const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{if(error){this.pending.delete(id);reject(error);}});
    });
  }
  async call(name:string,args:Record<string,unknown>){await this.start();if(!this.tools.has(name))throw Error('NATIVE_TOOL_UNAVAILABLE: '+name);
    return this.rpc('tools/call',{name,arguments:args}) as Promise<NativeResult>;
  }
  async close(){
    if(this.pending.size)throw Error('NATIVE_REQUEST_IN_PROGRESS: cannot abort an active native handler');
    const child=this.child;if(!child)return;
    // EOF lets the Toolkit safely close its owned Editor. Never terminate its native handler.
    await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.stdin.end();});
    this.child=undefined;this.starting=undefined;this.tools.clear();this.serverInfo=undefined;this.buffer='';
  }
}
