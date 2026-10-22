import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
export interface GameResult {[key:string]:unknown;content:Array<{type:'text';text:string}|{type:'image';data:string;mimeType:string}>;structuredContent?:Record<string,any>;isError?:boolean}

export interface GameTool {name:string;description:string;inputSchema:Record<string,unknown>}
export interface GameClient {start():Promise<void>;call(name:string,args:Record<string,unknown>):Promise<GameResult>;close():Promise<void>;tools():GameTool[];info():unknown}

/** Private external runtime: no upstream source or binaries are bundled here. */
export class GameStdioClient implements GameClient {
  private child?:ChildProcessWithoutNullStreams;
  private starting?:Promise<void>;
  private next=0;
  private buffer='';
  private listed:GameTool[]=[];
  private server?:Record<string,unknown>;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  constructor(private command:string,private args:string[],private cwd:string){}
  tools(){return this.listed;}
  info(){return {connected:!!this.child,server:this.server,toolCount:this.listed.length};}
  start(){return this.starting??=this.connect().catch(e=>{this.starting=undefined;throw e;});}
  private async connect(){
    this.buffer='';this.listed=[];this.server=undefined;
    const child=spawn(this.command,this.args,{cwd:this.cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
    child.stderr.resume();
    const fail=(e:Error)=>{for(const p of this.pending.values())p.reject(e);this.pending.clear();if(this.child===child){this.child=undefined;this.starting=undefined;}};
    child.on('error',fail);child.on('exit',code=>fail(Error('GAME_FRONTEND_EXIT_'+code)));
    child.stdout.setEncoding('utf8');child.stdout.on('data',(part:string)=>{
      this.buffer+=part;if(this.buffer.length>32*1024*1024){fail(Error('GAME_RESPONSE_TOO_LARGE'));child.stdin.end();return;}
      let end:number;
      while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;
        try{const r=JSON.parse(line),p=this.pending.get(r.id);if(!p)continue;this.pending.delete(r.id);if(r.error)p.reject(Error('GAME_RPC: '+JSON.stringify(r.error)));else p.resolve(r.result);}
        catch{fail(Error('GAME_INVALID_JSON'));child.stdin.end();}
      }
    });
    const initialized=await this.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'SC2EditorToolkit-game',version:'1'}});
    this.server=initialized.serverInfo;
    if(this.server?.name!=='sc2-game-toolkit'||this.server?.version!=='0.1.0-dev'){await this.close();throw Error('GAME_TOOLKIT_VERSION_MISMATCH');}
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const result=await this.rpc('tools/list',{});this.listed=result.tools;
    if(!Array.isArray(this.listed)||!this.listed.some(t=>t.name==='game.attach')){await this.close();throw Error('GAME_TOOLKIT_CONTRACT_MISMATCH');}
  }
  private rpc(method:string,params:unknown):Promise<any>{
    const child=this.child;if(!child)return Promise.reject(Error('GAME_NOT_CONNECTED'));
    const id=++this.next,line=JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';
    // Upstream silently drops oversized lines. Reject before sending any action.
    if(Buffer.byteLength(line)>1024*1024)return Promise.reject(Error('GAME_REQUEST_TOO_LARGE'));
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});
      child.stdin.write(line,e=>{if(e){this.pending.delete(id);reject(e);}});
    });
  }
  async call(name:string,args:Record<string,unknown>){await this.start();if(!this.listed.some(t=>t.name===name))throw Error('GAME_TOOL_UNAVAILABLE: '+name);return this.rpc('tools/call',{name,arguments:args});}
  async close(){
    if(this.pending.size)throw Error('GAME_REQUEST_IN_PROGRESS');
    const child=this.child;if(!child)return;
    await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.stdin.end();});
    this.child=undefined;this.starting=undefined;this.listed=[];this.server=undefined;
  }
}
