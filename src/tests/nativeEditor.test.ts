import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {NativeEditorBridge} from '../integrations/native/bridge.js';
import {NativeStdioClient,type NativeClient} from '../integrations/native/transport.js';
import {registerNativeEditorTools} from '../integrations/native/tools.js';
import type {McpServer} from '@modelcontextprotocol/server';
import {compactResult} from '../app/mcpBatch.js';

async function fixture(t:test.TestContext,call?:NativeClient['call']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-editor-bridge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'Test.SC2Map'),'saved archive');
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];
  let active=0,maxActive=0,closed=0;
  const client:NativeClient={start:async()=>{},info:()=>({connected:true}),close:async()=>{closed++;},call:async(name,args)=>{
    calls.push({name,args});active++;maxActive=Math.max(maxActive,active);
    try{return call?await call(name,args):{structuredContent:{status:'OK',nativeCompilePassed:true,diagnostics:{newErrorsClear:null,newErrors:[],newWarnings:[],inspectionComplete:false}},isError:false};}
    finally{active--;}
  }};
  const workspace=new Workspace(root),bridge=new NativeEditorBridge(workspace,{client});t.after(()=>bridge.close());
  return {root,calls,bridge,workspace,counts:()=>({maxActive,closed})};
}
async function finished(bridge:NativeEditorBridge,id:string){
  for(let i=0;i<500;i++){const job=bridge.job(id);if(['completed','failed'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}
  throw Error('Fixture job did not finish');
}
const check={archive:'Test.SC2Map',checks:['load','save_reopen','compile'] as Array<'load'|'save_reopen'|'compile'>,includeDiffs:true,deadlineSeconds:1200};

test('native jobs serialize, snapshot source, retain unknown diagnostics and export exact compiler output',async t=>{
  const {bridge,calls,counts,root}=await fixture(t);
  const first=await bridge.check(check),second=await bridge.check({...check,checks:['compile']});
  const a=await finished(bridge,first.id),b=await finished(bridge,second.id);
  assert.equal(a.state,'completed');assert.equal(b.state,'completed');assert.equal(counts().maxActive,1);
  assert.deepEqual(calls.map(c=>c.name),['sc2_validate_document','sc2_save_reopen','sc2_compile_all','sc2_export_galaxy','sc2_open_document','sc2_compile_all','sc2_export_galaxy']);
  assert.notEqual(calls[0].args.map,path.join(root,'Test.SC2Map'));
  assert.equal(await fs.readFile(path.join(root,'Test.SC2Map'),'utf8'),'saved archive');
  assert.equal(a.result?.checks.load.diagnostics.newErrorsClear,null);
  assert.equal(a.result?.checks.load.diagnostics.inspectionComplete,false);
  assert.equal(a.result?.sourceUnchanged,true);
  assert.equal(JSON.parse(await fs.readFile(a.report,'utf8')).checks.compile.nativeCompilePassed,true);
});
test('a native error stops subsequent checks, preserves full evidence and fails the job',async t=>{
  const {bridge,calls}=await fixture(t,async()=>({structuredContent:{status:'FAILED',error:'Malformed XML',diagnostics:{newErrorsClear:false,newErrors:[{message:'Bad XML',relatedId:'Example'}]}},isError:true}));
  const job=await finished(bridge,(await bridge.check(check)).id);
  assert.equal(job.state,'failed');assert.equal(calls.length,1);assert.equal(job.result?.checks.load.diagnostics.newErrorCount,1);
  assert.match(await fs.readFile(job.report,'utf8'),/Bad XML/);
});
test('queued source changes and workspace escapes fail before native access; active stop is refused',async t=>{
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});
  const {bridge,root,calls}=await fixture(t,async()=>{entered();await gate;return {structuredContent:{status:'OK'}};});
  await assert.rejects(bridge.check({...check,archive:'../Outside.SC2Map'}),/escapes/);
  await assert.rejects(bridge.check({...check,archive:'.'}),/SAVED_ARCHIVE_REQUIRED/);
  const a=await bridge.check({...check,checks:['load']});await reached;
  const b=await bridge.check({...check,checks:['load']});
  await assert.rejects(bridge.stop(),/JOBS_IN_PROGRESS/);
  await fs.writeFile(path.join(root,'Test.SC2Map'),'changed while queued');release();
  const first=await finished(bridge,a.id),next=await finished(bridge,b.id);
  assert.equal(first.state,'failed');assert.equal(first.result?.sourceUnchanged,false);
  assert.equal(next.state,'failed');assert.match(next.error??'',/SOURCE_CHANGED_WHILE_QUEUED/);assert.equal(calls.length,1);
  assert.match(await fs.readFile(next.report,'utf8'),/SOURCE_CHANGED_WHILE_QUEUED/);
});
test('native tool schemas expose six focused tools and reject invalid regions',async t=>{
  const {bridge}=await fixture(t),tools=new Map<string,any>();
  registerNativeEditorTools({registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer,bridge);
  assert.equal(tools.size,6);
  assert.throws(()=>tools.get('editor.capture').config.inputSchema.parse({archive:'Test.SC2Map',mode:'region',bounds:{left:5,right:1,bottom:0,top:1}}));
  const missing=await tools.get('editor.job').callback({jobId:'00000000-0000-4000-8000-000000000000',includeImage:false});
  assert.equal(missing.isError,true);
});
test('workflow compaction keeps native progress, uncertain outcomes and evidence paths',()=>{
  const receipt={id:'job',state:'completed',operation:'check',phase:'finished',report:'result.json',result:{outcome:'incomplete',failed:false}};
  assert.deepEqual(compactResult(receipt),receipt);
  const status={transport:'retained stdio MCP',expectedVersion:'0.8.x',frontend:{connected:false},jobs:[]};
  assert.deepEqual(compactResult(status),status);
  assert.deepEqual(compactResult({stopped:true}),{stopped:true});
});
test('shutdown drains already accepted queued jobs before closing the frontend',async t=>{
  const {bridge,counts}=await fixture(t);
  const first=await bridge.check({...check,checks:['load']}),second=await bridge.check({...check,checks:['load']});
  await bridge.close();
  assert.equal(bridge.job(first.id).state,'completed');assert.equal(bridge.job(second.id).state,'completed');
  assert.equal(counts().closed,1);await assert.rejects(bridge.check(check),/CLOSING/);
});
test('native stdio handshake, fragmented responses, tool errors and safe EOF work without an Editor',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-stdio-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(!('id' in r))return;let result=r.method==='initialize'?{serverInfo:{name:'sc2-native-toolkit',version:'0.8.0-rc.1'}}:r.method==='tools/list'?{tools:[{name:'test'}]}:{content:[{type:'text',text:'native failure'}],isError:true};const out=JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n';process.stdout.write(out.slice(0,9));process.stdout.write(out.slice(9));});`;
  const client=new NativeStdioClient(process.execPath,['-e',source],root);t.after(()=>client.close());
  await client.start();assert.equal((client.info() as any).server.version,'0.8.0-rc.1');
  assert.equal((await client.call('test',{})).isError,true);await assert.rejects(client.call('missing',{}),/UNAVAILABLE/);
  await client.close();assert.equal((client.info() as any).connected,false);
});
