import type {Readable,Writable} from 'node:stream';

/** CDP's NUL-delimited pipe transport: no listening port or browser profile reuse. */
export function createCaptureProtocol(input:Writable,output:Readable,timeoutMs=15000){
 let sequence=0,buffer=Buffer.alloc(0),closed:Error|undefined;
 const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const fail=(error:Error)=>{closed??=error;for(const p of pending.values()){clearTimeout(p.timer);p.reject(closed);}pending.clear();};
 const data=(chunk:Buffer)=>{
  if(closed)return;
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>16*1024*1024){fail(Error('CUTSCENE_CAPTURE_PROTOCOL_BUDGET'));return;}
  let end:number;while((end=buffer.indexOf(0))>=0){const body=buffer.subarray(0,end);buffer=buffer.subarray(end+1);if(!body.length)continue;
   try{const message=JSON.parse(body.toString()),p=pending.get(message.id);if(!p)continue;pending.delete(message.id);clearTimeout(p.timer);if(message.error)p.reject(Error('CUTSCENE_CAPTURE_PROTOCOL: '+String(message.error.message).slice(0,400)));else p.resolve(message.result);}
   catch{fail(Error('CUTSCENE_CAPTURE_PROTOCOL_JSON'));}
  }
 };
 const ended=()=>fail(Error('CUTSCENE_CAPTURE_PIPE_CLOSED')),error=(e:Error)=>fail(e);
 output.on('data',data);output.on('end',ended);output.on('error',error);input.on('error',error);
 function command(method:string,params:Record<string,unknown>={},sessionId?:string,waitMs=timeoutMs):Promise<any>{
  if(closed)return Promise.reject(closed);const id=++sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CUTSCENE_CAPTURE_COMMAND_TIMEOUT: '+method));},waitMs);pending.set(id,{resolve,reject,timer});try{input.write(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}})+'\0');}catch(e){fail(e instanceof Error?e:Error(String(e)));}});
 }
 return {command,fail,close(){fail(Error('CUTSCENE_CAPTURE_CLOSED'));buffer=Buffer.alloc(0);output.off('data',data);output.off('end',ended);}};
}
