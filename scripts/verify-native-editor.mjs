// Reproduce the public MCP/native acceptance on a caller-supplied private archive.
// No native Editor is started unless --live is explicitly supplied.
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {Buffer} from 'node:buffer';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {setTimeout} from 'node:timers';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),values={},cameraIds=[];let live=false;
for(let i=0;i<args.length;i++){
  const flag=args[i];if(flag==='--live'){live=true;continue;}
  if(!['--workspace','--archive','--camera-id'].includes(flag)||!args[i+1])throw Error('Usage: node scripts/verify-native-editor.mjs [--workspace DIR] [--live --archive MAP [--camera-id ID ...]]');
  if(flag==='--camera-id')cameraIds.push(args[++i]);else values[flag]=args[++i];
}
if(live&&!values['--archive'])throw Error('--live requires a saved --archive');
if(cameraIds.length>3||cameraIds.length&&!live)throw Error('Up to three --camera-id values require --live');
const workspace=path.resolve(values['--workspace']??process.env.SC2_UI_ROOT??project);
const archive=values['--archive'],input=archive?path.resolve(workspace,archive):undefined;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const before=input?sha(await fs.readFile(input)):undefined;
const output=path.join(project,'work/native-verification',randomUUID());await fs.mkdir(output,{recursive:true});
const env={...process.env,SC2_UI_ROOT:workspace,SC2_MCP_PROFILE:'editor'};delete env.SC2_MCP_MODULES;
const child=spawn(process.execPath,[path.join(project,'dist/index.js')],{cwd:project,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const pending=new Map(),transcript=[],jobs=[];let sequence=0,buffer='',stderr='',stopped=false;
const exited=new Promise(resolve=>child.once('close',resolve));
child.stderr.on('data',data=>{stderr=(stderr+data).slice(-65536);});
child.on('error',error=>{for(const p of pending.values())p.reject(error);pending.clear();});
child.on('exit',code=>{for(const p of pending.values())p.reject(Error('MCP exited '+code));pending.clear();});
child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{
  buffer+=data;let end;
  while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
    const response=JSON.parse(line),p=pending.get(response.id);if(!p)continue;pending.delete(response.id);
    if(response.error)p.reject(Error(JSON.stringify(response.error)));else p.resolve(response.result);
  }
});
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
const call=async(name,args={})=>{
  const raw=await rpc('tools/call',{name,arguments:args}),text=raw.content?.find(c=>c.type==='text')?.text;
  let value;try{value=JSON.parse(text);}catch{value={message:text};}
  transcript.push({tool:name,args,isError:raw.isError===true,value});assert.ok(!raw.isError,JSON.stringify(value));return {value,raw};
};
const run=async(name,args)=>{
  let {value:job}=await call(name,args);
  while(!['completed','failed'].includes(job.state)){await new Promise(r=>setTimeout(r,1500));job=(await call('editor.job',{jobId:job.id})).value;}
  jobs.push(job);assert.equal(job.state,'completed',JSON.stringify(job));assert.notEqual(job.result?.failed,true,JSON.stringify(job));return job;
};
const image=async job=>{
  const {raw}=await call('editor.job',{jobId:job.id,includeImage:true}),item=raw.content?.find(c=>c.type==='image');assert.ok(item,'MCP image payload missing');
  const bytes=Buffer.from(item.data,'base64'),capture=job.result.capture,expected=capture.preview??capture.artifact;
  assert.equal(item.mimeType,'image/png');assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(sha(bytes),expected.sha256);
  job.mcpImage={mimeType:item.mimeType,bytes:bytes.length,sha256:sha(bytes),matchesArtifact:true};
};
const record={mode:live?'live_native':'frontend_only',startedAt:new Date().toISOString(),workspace,archive,sourceSha256:before,output};
try{
  record.initialize=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'SC2EditorToolkit acceptance',version:'1'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  record.tools=(await rpc('tools/list',{})).tools.map(t=>t.name).filter(n=>n.startsWith('editor.'));assert.equal(record.tools.length,7);
  record.status=(await call('editor.status',{connect:true})).value;
  assert.equal(record.status.frontend.server.version,record.status.expectedVersion);assert.equal(record.status.frontend.tools.length,18);
  if(live){
    const checked=await run('editor.check',{archive,checks:['load','save_reopen','compile'],includeDiffs:true});
    assert.equal(checked.result.outcome,'passed');assert.equal(checked.result.checks.compile.nativeCompilePassed,true);
    assert.equal(checked.result.checks.save_reopen.componentComparison.savedToReopenedEqual,true);
    if(/\.sc2map$/i.test(archive)){
      await run('editor.cameras',{archive,limit:100});
      const map=await run('editor.capture',{archive,mode:'map',size:1024});await image(map);
      for(const cameraId of cameraIds){const frame=await run('editor.capture',{archive,mode:'viewport',cameraId});assert.equal(frame.result.capture.mapCamera.nativeSelectionVerified,true);await image(frame);}
    }
    await run('editor.diagnostics',{});assert.equal(sha(await fs.readFile(input)),before);record.sourceUnchanged=true;
  }
  assert.equal((await call('editor.stop')).value.stopped,true);stopped=true;
  assert.equal((await call('editor.status')).value.frontend.connected,false);record.outcome='passed';
}catch(error){record.outcome='failed';record.error=String(error);process.exitCode=1;}
finally{
  if(!stopped){try{await call('editor.stop');}catch{/* Active handlers are drained by EOF, never force-killed. */}}
  child.stdin.end();await exited;
  record.finishedAt=new Date().toISOString();record.jobs=jobs;record.stopped=stopped;
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(record,null,2)+'\n');
  await fs.writeFile(path.join(output,'transcript.json'),JSON.stringify(transcript,null,2)+'\n');await fs.writeFile(path.join(output,'stderr.log'),stderr);
  process.stdout.write(JSON.stringify({outcome:record.outcome,mode:record.mode,toolkit:record.status?.expectedVersion,nativeProtocol:record.status?.nativeProtocol,
    jobs:jobs.map(j=>({operation:j.operation,state:j.state,mcpImage:j.mcpImage})),report:path.join(output,'result.json'),error:record.error})+'\n');
}
