#!/usr/bin/env node
/* global process, Buffer, setTimeout */
/** Keep one workflow-profile MCP process alive for a sequence of JSONL requests.
 * Usage: node scripts/mcp-session.mjs --root <map components directory>
 * stdin: {"id":"inspect","tool":"terrain.inspect","args":{}}
 *    or: {"id":"build","steps":[{"id":"plan",...}]}
 * stdout: one compact JSON result per input line. All map operations use MCP.
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {compactResult} from '../dist/app/mcpBatch.js';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const at=process.argv.indexOf('--root');
if(at<0||!process.argv[at+1]){process.stderr.write('Usage: node scripts/mcp-session.mjs --root <map directory>\n');process.exit(2);}
const root=path.resolve(process.argv[at+1]);
const metricsFile=process.env.SC2_MCP_SESSION_METRICS?path.resolve(process.env.SC2_MCP_SESSION_METRICS):undefined;
const tokenCounter=metricsFile?(await import('../dist/app/textTokens.js')).countTextTokens:undefined;
const child=spawn(process.execPath,[path.join(project,'dist/index.js')],{cwd:project,env:{...process.env,SC2_UI_ROOT:root,SC2_MCP_PROFILE:'workflow'},windowsHide:true,stdio:['pipe','pipe','inherit']});
let sequence=0,buffer='';const pending=new Map();
child.stdout.on('data',bytes=>{buffer+=bytes.toString();let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;let result;try{result=JSON.parse(line);}catch{continue;}const entry=pending.get(result.id);if(entry){pending.delete(result.id);if(result.error)entry.reject(Error(JSON.stringify(result.error)));else entry.resolve(result.result);}}});
child.on('exit',code=>{for(const entry of pending.values())entry.reject(Error('MCP exited '+code));pending.clear();});
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
function body(result){const text=result?.content?.find(item=>item.type==='text')?.text;try{return JSON.parse(text);}catch{return {message:String(text??'').slice(0,1000)};}}
try{
 await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'SC2 MCP persistent workflow',version:'1'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 process.stdout.write(JSON.stringify({ready:true,root,profile:'workflow',transport:'MCP stdio'})+'\n');
 for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  if(!line.trim())continue;let request;
  try{request=JSON.parse(line);if(!request||typeof request!=='object'||Array.isArray(request))throw Error('JSON object required');
   if(request.command==='close')break;
   const multi=Array.isArray(request.steps),name=multi?'modkit.batch':request.tool;
   if(typeof name!=='string'||!name)throw Error('tool or steps required');
   const wrapped=!multi&&name!=='modkit.batch',route=wrapped?'modkit.batch':name;
   const selection=Array.isArray(request.select)?request.select:name==='data.report.page'?['total','items','nextOffset']:undefined;
   const args=multi?{steps:request.steps}:wrapped?{steps:[{id:'call',tool:name,args:request.args??{},...(selection?{select:selection}:{})}]}:request.args??{};
   const started=performance.now(),result=await rpc('tools/call',{name:route,arguments:args}),value=body(result);
   const payload=wrapped?value.steps?.[0]?.result??value:value;
   const response=JSON.stringify({id:request.id??null,tool:name,via:route,ok:!result.isError,ms:Math.round(performance.now()-started),result:request.full===true||route==='modkit.batch'?payload:compactResult(payload)});
   process.stdout.write(response+'\n');
   if(metricsFile){await fs.mkdir(path.dirname(metricsFile),{recursive:true});await fs.appendFile(metricsFile,JSON.stringify({at:new Date().toISOString(),tool:name,ms:Math.round(performance.now()-started),requestBytes:Buffer.byteLength(line),clientEmittedBytes:Buffer.byteLength(response),clientEmittedTextTokens:tokenCounter(response),scope:'Client-emitted response text only; actual model context/billing is unknown.'})+'\n');}
  }catch(error){process.stdout.write(JSON.stringify({id:request?.id??null,ok:false,error:error instanceof Error?error.message:String(error)})+'\n');}
 }
}finally{child.stdin.end();setTimeout(()=>child.kill(),3000).unref();}
