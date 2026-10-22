/* global process, Buffer, setTimeout */
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolveSuiteReferences,resolveSuiteToolArguments,suiteNeedsLive} from './toolkit-suite-references.mjs';
import {assertSuiteResult,validateSuiteAssertion} from './toolkit-suite-assertions.mjs';
import {createSuiteJournal} from './toolkit-suite-journal.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=key=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const root=path.resolve(option('--workspace')??project),suiteFile=option('--suite'),live=process.argv.includes('--live');
if(!suiteFile)throw Error('--suite <workspace JSON> is required; --live authorizes original Editor/game operations');
const inside=file=>{const p=path.resolve(root,file),r=path.relative(root,p);if(path.isAbsolute(r)||r==='..'||r.startsWith('..'+path.sep))throw Error('Suite path outside workspace');return p;};
const suite=JSON.parse(await fs.readFile(inside(suiteFile),'utf8'));
if(!Array.isArray(suite.cases)||suite.cases.length<1||suite.cases.length>64)throw Error('Suite requires 1..64 cases');
const ids=new Set();
for(const c of suite.cases){
 if(typeof c.id!=='string'||!/^[-_a-zA-Z0-9]+$/.test(c.id)||ids.has(c.id))throw Error('Cases require distinct simple IDs');
 if(typeof c.tool!=='string'||!Array.isArray(c.expect)||!c.expect.length)throw Error('Every case requires a tool and semantic assertions');
 for(const e of c.expect)validateSuiteAssertion(e);
 if((c.requires??[]).some(id=>!ids.has(id)))throw Error('Case dependencies must precede their consumer: '+c.id);
 ids.add(c.id);
}
const output=path.join(project,'work/toolkit-verification',randomUUID());await fs.mkdir(output,{recursive:true});
const journal=await createSuiteJournal(output);
const hash=b=>createHash('sha256').update(b).digest('hex');
const sources=await Promise.all((suite.sources??[]).map(async file=>({file,sha256:hash(await fs.readFile(inside(file)))})));
const child=spawn(process.execPath,[path.join(project,'dist/index.js')],{cwd:project,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SC2_UI_ROOT:root,SC2_MCP_PROFILE:option('--profile')??'workflow',SC2_GAME_ALLOW_LAUNCH:live?'1':'0'}});
let next=0,buffer='',stderr='';const pending=new Map(),results=new Map(),records=[],transcript=[];
const exited=new Promise(resolve=>child.once('exit',resolve));
child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-16384);});
child.on('exit',code=>{for(const p of pending.values())p.reject(Error('MCP exited '+code));pending.clear();});
child.on('error',e=>{for(const p of pending.values())p.reject(e);pending.clear();});
child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{buffer+=b;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;const r=JSON.parse(line),p=pending.get(r.id);if(p){pending.delete(r.id);if(r.error)p.reject(Error(JSON.stringify(r.error)));else p.resolve(r.result);}}});
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
const resolve=value=>resolveSuiteReferences(value,results);
async function call(tool,args){
 if(!live&&suiteNeedsLive(tool,args))throw Error('--live required for native operations');
 let raw;try{raw=await rpc('tools/call',{name:tool,arguments:args});}catch(error){await journal.tool({tool,args,transportError:String(error)});throw error;}
 const payload=raw.content?.find(c=>c.type==='text')?.text??'{}';
 let body;try{body=JSON.parse(payload);}catch{body={error:payload};}
 const record={tool,args,isError:raw.isError===true,body,images:[]};
 for(const c of raw.content??[])if(c.type==='image'){const b=Buffer.from(c.data,'base64');assert.deepEqual([...b.subarray(0,8)],[137,80,78,71,13,10,26,10]);const name='Image-'+transcript.length+'-'+record.images.length+'.png';await fs.writeFile(path.join(output,name),b);record.images.push({file:name,sha256:hash(b),bytes:b.length});}
 transcript.push(record);await journal.tool(record);if(raw.isError)throw Error('Tool error: '+JSON.stringify(body));return body;
}
try{
 const initialized=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'toolkit-suite-verifier',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const names=new Set((await rpc('tools/list',{})).tools.map(t=>t.name));
 if(names.has('modkit.enable_tools')){
  const wanted=[...new Set(suite.cases.map(c=>c.tool).concat(suite.cases.some(c=>c.job)?['editor.job']:[]))];
  for(let offset=0;offset<wanted.length;offset+=40)await call('modkit.enable_tools',{names:wanted.slice(offset,offset+40)});
  for(const t of (await rpc('tools/list',{})).tools)names.add(t.name);
 }
 await fs.writeFile(path.join(output,'discovery.json'),JSON.stringify({initialized,tools:[...names]},null,2)+'\n');
 for(const c of suite.cases){
  const start=Date.now(),record={id:c.id,tool:c.tool,status:'not_checked'};records.push(record);
  await journal.startCase(c.id,c.tool);
  if((c.requires??[]).some(id=>records.find(r=>r.id===id)?.status!=='passed')){record.status='not_checked';record.reason='A required preceding case did not pass';await journal.case(record);continue;}
  if(!names.has(c.tool)){record.status='unsupported';record.reason='Tool not registered in this profile';await journal.case(record);continue;}
  try{
   let result=await call(c.tool,resolveSuiteToolArguments(c.tool,c.arguments??{},results));
   if(c.job){assert.ok(result.id,'Native job ID missing');do{result=await call('editor.job',{jobId:result.id});if(result.state==='queued'||result.state==='running')await new Promise(r=>setTimeout(r,1000));}while(result.state==='queued'||result.state==='running');assert.equal(result.state,'completed',JSON.stringify(result));assert.notEqual(result.result?.failed,true);}
   assertSuiteResult(result,c.expect??[],resolve);
   if(c.image){const r=await call('editor.job',{jobId:result.id,includeImage:true});assert.ok(transcript.at(-1).images.length);result=r;}
   results.set(c.id,result);record.status='passed';
  }catch(e){record.status='failed';record.error=String(e);}
  record.elapsedMs=Date.now()-start;await journal.case(record);process.stdout.write(JSON.stringify(record)+'\n');
 }
}catch(e){records.push({id:'runner',status:'failed',error:String(e)});}
finally{
 // EOF drains owned operations and gracefully closes their workers; never kill a handler.
 child.stdin.end();await exited;
 let sourceUnchanged=true;for(const s of sources){const current=hash(await fs.readFile(inside(s.file)));if(current!==s.sha256)sourceUnchanged=false;}
 const outcome=sourceUnchanged&&records.every(r=>r.status==='passed')?'passed':'incomplete_or_failed';
 await fs.writeFile(path.join(output,'transcript.json'),JSON.stringify(transcript,null,2)+'\n');
 await fs.writeFile(path.join(output,'stderr.log'),stderr);
 const report={outcome,finishedAt:new Date().toISOString(),sourceUnchanged,sources,cases:records,scope:'Only the manifest cases and assertions; image capture is separate from visual review'};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');await journal.finish(outcome);process.stdout.write(JSON.stringify({outcome,report:path.join(output,'result.json')})+'\n');if(outcome!=='passed')process.exitCode=1;
}
