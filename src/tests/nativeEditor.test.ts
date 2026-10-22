import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {NativeEditorBridge,nativeOperations} from '../integrations/native/bridge.js';
import {NativeStdioClient,type NativeClient} from '../integrations/native/transport.js';
import {registerNativeEditorTools} from '../integrations/native/tools.js';
import type {McpServer} from '@modelcontextprotocol/server';
import {compactResult} from '../app/mcpBatch.js';
import {nativeRelease} from '../integrations/native/release.js';

async function fixture(t:test.TestContext,call?:NativeClient['call']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-editor-bridge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'Test.SC2Map'),'saved archive');
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];
  let active=0,maxActive=0,closed=0;
  const client:NativeClient={start:async()=>{},describe:()=>nativeOperations.map(name=>({name,description:'fixture',inputSchema:{type:'object'}})),info:()=>({connected:true}),close:async()=>{closed++;},call:async(name,args)=>{
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

test('native GUI adoption requires original compile proof and unchanged template/output',async t=>{
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),xml='<TriggerData><Root/></TriggerData>',galaxy='void InitMap() {}';
 let output='';const f=await fixture(t,async()=>({structuredContent:{status:'OK',nativeGenerationVerified:true,nativeCompilePassed:true,originalGenerator:true,replacementEmitterUsed:false,output,sourceSha256:hash(galaxy),sourceBytes:Buffer.byteLength(galaxy)}}));
 output=path.join(f.bridge.configuration().workerDirectory,'requests','test','Native.galaxy');await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,galaxy);
 const job=await finished(f.bridge,(await f.bridge.call('sc2_convert_xml',{template:'Test.SC2Map',triggers_xml:xml})).id);
 assert.equal(job.state,'completed');assert.equal(job.result?.nativeGuiImportEligible,true);
 const proof=await f.bridge.guiArtifact(job.id);assert.equal(proof.xmlSha256,hash(xml));assert.equal(proof.output.sha256,hash(galaxy));
 proof.template.sha256='edited clone';assert.notEqual((await f.bridge.guiArtifact(job.id)).template.sha256,'edited clone');
 await assert.rejects(f.bridge.guiArtifact('unrelated'),/COMPILED_ARTIFACT_REQUIRED/);
 const scoped=await finished(f.bridge,(await f.bridge.call('sc2_convert_xml',{template:'Test.SC2Map',triggers_xml:xml,scope:'library:ABCD'})).id);
 assert.equal(scoped.state,'completed');assert.equal(scoped.result?.nativeGuiImportEligible,false);await assert.rejects(f.bridge.guiArtifact(scoped.id),/COMPILED_ARTIFACT_REQUIRED/);
 await fs.writeFile(path.join(f.root,'Strings.txt'),'Category/Name/ABCD=Example');
 const localized=await finished(f.bridge,(await f.bridge.call('sc2_convert_xml',{template:'Test.SC2Map',triggers_xml:xml,trigger_strings:'Strings.txt'})).id);
 assert.equal(localized.result?.nativeGuiImportEligible,false);assert.notEqual(f.calls.at(-1)?.args.trigger_strings,path.join(f.root,'Strings.txt'));
 await fs.writeFile(path.join(f.root,'Other.xml'),'<TriggerData><Root/></TriggerData>\n');
 const inline=await finished(f.bridge,(await f.bridge.call('sc2_convert_xml',{template:'Test.SC2Map',triggers_xml:xml,triggers_file:'Other.xml'})).id);
 assert.equal((await f.bridge.guiArtifact(inline.id)).xmlSha256,hash(xml));
 await fs.appendFile(output,'\n');await assert.rejects(f.bridge.guiArtifact(job.id),/ARTIFACT_STALE/);
 await fs.writeFile(output,galaxy);await fs.appendFile(path.join(f.root,'Test.SC2Map'),'changed');await assert.rejects(f.bridge.guiArtifact(job.id),/ARTIFACT_STALE/);
});

test('invalid native GUI output cannot be adopted or retain a document after failure',async t=>{
 const f=await fixture(t,async()=>({structuredContent:{status:'OK',nativeGenerationVerified:true,nativeCompilePassed:true,originalGenerator:true,replacementEmitterUsed:false,output:path.join(f.root,'Other.galaxy'),sourceSha256:'invalid',sourceBytes:1}}));
 await fs.mkdir(f.bridge.configuration().workerDirectory,{recursive:true});await fs.writeFile(path.join(f.root,'Other.galaxy'),'x');
 const job=await finished(f.bridge,(await f.bridge.call('sc2_convert_xml',{template:'Test.SC2Map',triggers_xml:'<TriggerData><Root/></TriggerData>'})).id);
 assert.equal(job.state,'failed');assert.match(job.error??'',/OUTSIDE_WORKER/);assert.equal((await f.bridge.status()).ownedDocument,null);
 await assert.rejects(f.bridge.guiArtifact(job.id),/COMPILED_ARTIFACT_REQUIRED/);
});

test('retained Editor bridges in separate MCP sessions use distinct stable worker directories',async t=>{
 const f=await fixture(t),other=new NativeEditorBridge(f.workspace);
 const first=f.bridge.configuration().workerDirectory;
 assert.notEqual(first,other.configuration().workerDirectory);assert.equal(first,f.bridge.configuration().workerDirectory);
 assert.ok(first.startsWith(f.bridge.work+path.sep));await other.close();
});

test('compact native storage leaves room for upstream Windows extraction paths',async t=>{
 const f=await fixture(t),config=f.bridge.configuration();
 const relative=path.relative(f.root,config.workerDirectory);
 assert.equal(config.storageLayout,'compact-owned-v1');
 assert.match(path.basename(config.workerDirectory),/^[0-9a-f]{32}$/);
 assert.ok(relative.length<=52,'Preserve room for upstream request IDs and asset names');
 const extracted=path.win32.join('K:\\SC2_MAP_Workspace\\SC2Editor-MCP-Codex\\work\\r430',
  relative,'requests','a'.repeat(32),'job','components','Assets','Textures',
  'ui_gamemenu_achievementbutton_normaloverpressedover_protoss.dds');
 assert.ok(extracted.length<260,extracted);
});
test('all native operations are discoverable and generic calls use guarded private inputs and owned outputs',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const tools=await f.bridge.tools();assert.ok(Array.isArray(tools));assert.equal(tools.length,18);
 assert.deepEqual((await f.bridge.tools('sc2_export_video') as any).inputSchema,{type:'object'});
 const job=await finished(f.bridge,(await f.bridge.call('sc2_convert_xml',{template:'Test.SC2Map',triggers_file:'Triggers'})).id);
 assert.equal(job.state,'completed');assert.equal(job.result?.sourceUnchanged,true);
 assert.notEqual(f.calls[0].args.template,path.join(f.root,'Test.SC2Map'));assert.notEqual(f.calls[0].args.triggers_file,path.join(f.root,'Triggers'));
 assert.equal(await fs.readFile(path.join(f.root,'Triggers'),'utf8'),'<TriggerData><Root/></TriggerData>');
 const detail=await f.bridge.details(job.id,'/native/status');assert.equal((detail as any).value,'OK');
 await assert.rejects(f.bridge.details(job.id,'/native/__proto__'),/PATH_MISSING/);
 const exported=await finished(f.bridge,(await f.bridge.call('sc2_export_galaxy',{})).id);assert.equal(exported.state,'completed');assert.match(String(f.calls.at(-1)?.args.output),/Native\.galaxy$/);
 await assert.rejects(f.bridge.call('sc2_export_galaxy',{output:'../../leak.galaxy'}),/OUTPUT_OWNED/);
 await assert.rejects(f.bridge.call('arbitrary' as any,{}),/OPERATION_NOT_ALLOWED/);
});
test('generic native operations cannot use an unowned document or keep stale state after failure',async t=>{
 let fail=false;const f=await fixture(t,async()=>({structuredContent:{status:fail?'FAILED':'OK'},isError:fail}));
 const missing=await finished(f.bridge,(await f.bridge.call('sc2_compile_all',{})).id);assert.match(missing.error??'',/OWNED_DOCUMENT_REQUIRED/);assert.equal(f.calls.length,0);
 await finished(f.bridge,(await f.bridge.call('sc2_open_document',{map:'Test.SC2Map'})).id);fail=true;
 await finished(f.bridge,(await f.bridge.call('sc2_compile_all',{})).id);assert.equal((await f.bridge.status()).ownedDocument,null);
 const count=f.calls.length;await finished(f.bridge,(await f.bridge.call('sc2_export_galaxy',{})).id);assert.equal(f.calls.length,count);
});

test('generic calls reject stale owned sources and retain incomplete native confirmations',async t=>{
 let uncertain=false;const f=await fixture(t,async()=>({structuredContent:{status:uncertain?'NOT_CONFIRMED':'OK',nativeConfirmed:!uncertain,nativeLoadVerified:true,diagnostics:{inspectionComplete:false,newErrorsClear:null}},isError:false}));
 const opened=await finished(f.bridge,(await f.bridge.call('sc2_open_document',{map:'Test.SC2Map'})).id);
 assert.equal(opened.result?.response.nativeLoadVerified,true);assert.equal(opened.result?.response.diagnostics.inspectionComplete,false);
 await fs.writeFile(path.join(f.root,'Test.SC2Map'),'changed source');const count=f.calls.length;
 const stale=await finished(f.bridge,(await f.bridge.call('sc2_compile_all',{})).id);assert.match(stale.error??'',/OWNED_SOURCE_CHANGED/);assert.equal(f.calls.length,count);
 uncertain=true;const unknown=await finished(f.bridge,(await f.bridge.call('sc2_open_document',{map:'Test.SC2Map'})).id);
 assert.equal(unknown.result?.outcome,'incomplete');assert.equal((await f.bridge.status()).ownedDocument,null);
});

test('generic metadata preserves page totals and makes array truncation explicit',async t=>{
 const f=await fixture(t,async(name,args)=>({structuredContent:name==='sc2_search_objects'?{status:'MAP_OBJECTS_FOUND',editorRequired:false,totalMatches:500,limit:args.limit,offset:0,nextOffset:args.limit,objects:Array.from({length:Number(args.limit)},(_,i)=>({id:i}))}:{status:'MAP_CAMERAS_LISTED',editorRequired:false,count:150,cameras:Array.from({length:150},(_,i)=>({id:i}))}}));
 const objects=await finished(f.bridge,(await f.bridge.call('sc2_search_objects',{map:'Test.SC2Map',limit:500})).id);
 assert.equal(f.calls[0].args.limit,100);assert.equal(objects.result?.response.totalMatches,500);assert.equal(objects.result?.response.nextOffset,100);assert.equal(objects.result?.response.editorRequired,false);
 const cameras=await finished(f.bridge,(await f.bridge.call('sc2_list_map_cameras',{map:'Test.SC2Map'})).id);
 assert.equal(cameras.result?.response.cameras.length,100);assert.equal(cameras.result?.response.responseTruncation.arrays[0].total,150);assert.equal(cameras.result?.response.responseTruncation.pagedTool,'editor.cameras');
});
const check={archive:'Test.SC2Map',checks:['load','save_reopen','compile'] as Array<'load'|'save_reopen'|'compile'>,includeDiffs:true,deadlineSeconds:1200};

test('native jobs serialize, snapshot source, retain unknown diagnostics and export exact compiler output',async t=>{
  const {bridge,calls,counts,root}=await fixture(t);
  const first=await bridge.check({...check,renderBackend:'vulkan'}),second=await bridge.check({...check,checks:['compile']});
  const a=await finished(bridge,first.id),b=await finished(bridge,second.id);
  assert.equal(a.state,'completed');assert.equal(b.state,'completed');assert.equal(counts().maxActive,1);
  assert.deepEqual(calls.map(c=>c.name),['sc2_validate_document','sc2_save_reopen','sc2_compile_all','sc2_export_galaxy','sc2_open_document','sc2_compile_all','sc2_export_galaxy']);
  assert.notEqual(calls[0].args.map,path.join(root,'Test.SC2Map'));
  assert.equal(calls[0].args.render_backend,'vulkan');assert.equal(calls[1].args.render_backend,'vulkan');
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
test('native tool schemas expose nine tools and reject invalid regions and camera modes',async t=>{
  const {bridge}=await fixture(t),tools=new Map<string,any>();
  registerNativeEditorTools({registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer,bridge);
  assert.equal(tools.size,9);
  assert.throws(()=>tools.get('editor.capture').config.inputSchema.parse({archive:'Test.SC2Map',mode:'region',bounds:{left:5,right:1,bottom:0,top:1}}));
  assert.throws(()=>tools.get('editor.capture').config.inputSchema.parse({archive:'Test.SC2Map',mode:'map',cameraId:'1'}));
  assert.throws(()=>tools.get('editor.cameras').config.inputSchema.parse({archive:'Test.SC2Map',limit:101}));
  const missing=await tools.get('editor.job').callback({jobId:'00000000-0000-4000-8000-000000000000',includeImage:false});
  assert.equal(missing.isError,true);
});
test('workflow compaction keeps native progress, uncertain outcomes and evidence paths',()=>{
  const receipt={id:'job',state:'completed',operation:'check',phase:'finished',report:'result.json',result:{outcome:'incomplete',failed:false}};
  assert.deepEqual(compactResult(receipt),receipt);
  assert.deepEqual(compactResult({...receipt,operation:'cameras'}),{...receipt,operation:'cameras'});
  const status={transport:'retained stdio MCP',expectedVersion:nativeRelease.version,frontend:{connected:false},jobs:[]};
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
  const source=`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(!('id' in r))return;let result=r.method==='initialize'?{serverInfo:{name:'sc2-native-toolkit',version:${JSON.stringify(nativeRelease.version)}}}:r.method==='tools/list'?{tools:[{name:'test'}]}:{content:[{type:'text',text:'native failure'}],isError:true};const out=JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n';process.stdout.write(out.slice(0,9));process.stdout.write(out.slice(9));});`;
  const client=new NativeStdioClient(process.execPath,['-e',source],root);t.after(()=>client.close());
  await client.start();assert.equal((client.info() as any).server.version,nativeRelease.version);
  assert.equal((await client.call('test',{})).isError,true);await assert.rejects(client.call('missing',{}),/UNAVAILABLE/);
  await client.close();assert.equal((client.info() as any).connected,false);
});

test('saved camera listing is paginated, uses a verified snapshot and never starts an Editor',async t=>{
  const {bridge,calls,root}=await fixture(t,async()=>({structuredContent:{status:'MAP_CAMERAS_LISTED',cameras:[{cameraId:'1'},{cameraId:'2'},{cameraId:'3'}]}}));
  const job=await finished(bridge,(await bridge.cameras({archive:'Test.SC2Map',locale:'ruRU',offset:1,limit:1})).id);
  assert.equal(job.state,'completed');assert.deepEqual(job.result?.cameras,[{cameraId:'2'}]);
  assert.equal(job.result?.total,3);assert.equal(job.result?.hasMore,true);assert.equal(job.result?.editorStarted,false);
  assert.equal(job.result?.sourceUnchanged,true);assert.equal(calls[0].name,'sc2_list_map_cameras');
  assert.equal(calls[0].args.locale,'ruRU');assert.notEqual(calls[0].args.map,path.join(root,'Test.SC2Map'));
  assert.equal((await bridge.status()).ownedDocument,null);
});

test('named native capture forwards exact camera ID and preserves readback, not a cutscene argument',async t=>{
  const mapCamera={saved:{cameraId:'2001'},actual:{yaw:90},nativeSelectionVerified:true,verification:{checked:['yaw']},triggerExecution:false};
  const {bridge,calls}=await fixture(t,async()=>({structuredContent:{status:'TERRAIN_FRAME_CAPTURED',mapCamera}}));
  const job=await finished(bridge,(await bridge.capture({archive:'Test.SC2Map',mode:'viewport',cameraId:'2001',size:1024,deadlineSeconds:1200})).id);
  assert.equal(job.state,'completed');assert.equal(calls[0].name,'sc2_capture_terrain');assert.equal(calls[0].args.map_camera_id,'2001');
  assert.equal(calls[0].args.camera,undefined);assert.deepEqual(job.result?.capture.mapCamera,mapCamera);
  await assert.rejects(bridge.capture({archive:'Test.SC2Map',mode:'map',cameraId:'2001',size:1024,deadlineSeconds:1200}),/REQUIRES_VIEWPORT/);
});

test('Win32 startup failure preserves actionable diagnostics; next job can recover without stale Galaxy export',async t=>{
  let attempt=0;
  const failure={status:'FAILED',failureKind:'NATIVE_CONTROLLER_FAILED',failureStage:'startup',failureEvidence:'private/evidence',
    failureNative:{controllerExitCode:2,controllerStderr:'SetWindowsHookExW failed: Win32=126'},ownedWorkerReset:true,automaticRetry:false};
  const {bridge,calls}=await fixture(t,async()=>++attempt===1?{isError:true,structuredContent:failure}:{structuredContent:{status:'OK',nativeCompilePassed:true}});
  const first=await finished(bridge,(await bridge.check({...check,checks:['load','compile']})).id);
  assert.equal(first.state,'failed');assert.deepEqual(first.result?.checks.load.failureNative,failure.failureNative);
  assert.equal(first.result?.checks.load.ownedWorkerReset,true);assert.equal((await bridge.status()).ownedDocument,null);
  assert.deepEqual(calls.map(c=>c.name),['sc2_validate_document']);
  const next=await finished(bridge,(await bridge.check({...check,checks:['compile']})).id);
  assert.equal(next.state,'completed');assert.equal(next.result?.checks.compile.nativeCompilePassed,true);
  assert.deepEqual(calls.map(c=>c.name),['sc2_validate_document','sc2_open_document','sc2_compile_all','sc2_export_galaxy']);
});

test('compile-only startup failure remains in the compact check result and cannot export old Galaxy',async t=>{
  const {bridge,calls}=await fixture(t,async()=>({isError:true,structuredContent:{status:'FAILED',failureKind:'NATIVE_CONTROLLER_FAILED',failureStage:'startup'}}));
  const job=await finished(bridge,(await bridge.check({...check,checks:['compile']})).id);
  assert.equal(job.state,'failed');assert.equal(job.result?.checks.open.failureKind,'NATIVE_CONTROLLER_FAILED');
  assert.deepEqual(calls.map(c=>c.name),['sc2_open_document']);
});

test('old or unrelated native frontends are rejected before using incompatible DLL protocols',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-version-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const version of ['0.8.0-rc.1','0.9.0-rc.1','0.9.1-rc.1','1.0.0']){
    const source=`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if('id' in r)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{serverInfo:{name:'sc2-native-toolkit',version:${JSON.stringify(version)}}}})+'\\n');});`;
    const client=new NativeStdioClient(process.execPath,['-e',source],root);t.after(()=>client.close());
    await assert.rejects(client.start(),/VERSION_MISMATCH/);assert.equal((client.info() as any).connected,false);
  }
});

test('an old or mixed installed package is rejected before starting its executable',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-protocol-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const workspace=new Workspace(root);
  for(const receipt of [{version:'0.9.1-rc.1',nativeProtocol:10},{version:nativeRelease.version,nativeProtocol:10}]){
    await fs.writeFile(path.join(root,'sc2-mcp-runtime.json'),JSON.stringify({...receipt,executable:'does-not-exist.exe'}));
    const bridge=new NativeEditorBridge(workspace,{home:root});t.after(()=>bridge.close());
    await assert.rejects(bridge.status(true),/RUNTIME_PROTOCOL_MISMATCH/);
    assert.equal(((await bridge.status()).frontend as {connected:boolean}).connected,false);
  }
});

test('unreadable phase logs stay unknown and retain the actual native controller failure',async t=>{
  const diagnostics={inspectionComplete:false,newErrors:[],newWarnings:[],newErrorCount:null,newErrorsClear:null};
  const native={status:'NATIVE_CONTROLLER_FAILED',controllerExitCode:2,failure:'Win32=126',handlerCompletionKnown:false};
  const {bridge}=await fixture(t,async()=>({isError:true,structuredContent:{status:'FAILED',diagnostics,
    phases:[{phase:'00-startup',operation:'diagnostics',nativeConfirmed:false,native,diagnostics}]}}));
  const job=await finished(bridge,(await bridge.check({...check,checks:['load']})).id),result=job.result?.checks.load;
  assert.equal(result.diagnostics.newErrorCount,null);assert.equal(result.diagnostics.newWarningCount,null);
  assert.equal(result.diagnostics.knownNewErrorCount,0);assert.equal(result.phases[0].diagnostics.newErrorCount,null);
  assert.deepEqual(result.phases[0].native,native);
});

test('successful native phases stay in full evidence without bloating compact MCP replies',async t=>{
  const {bridge}=await fixture(t,async()=>({structuredContent:{status:'OK',nativeValidationPassed:true,
    phases:[{phase:'load',nativeConfirmed:true,native:{status:'NATIVE_DLL_REQUEST_COMPLETED'}},{phase:'data',nativeConfirmed:true}]}}));
  const job=await finished(bridge,(await bridge.check({...check,checks:['load']})).id);
  assert.equal(job.result?.checks.load.phaseCount,2);assert.equal(job.result?.checks.load.phases,undefined);
  assert.equal(JSON.parse(await fs.readFile(job.report,'utf8')).checks.load.phases.length,2);
});

test('failed camera capture cannot publish an old image or claim a loaded document',async t=>{
  const {bridge}=await fixture(t,async()=>({isError:true,structuredContent:{status:'FAILED',error:'Camera readback mismatch',artifact:{path:'old.png'}}}));
  const job=await finished(bridge,(await bridge.capture({archive:'Test.SC2Map',mode:'viewport',cameraId:'2001',size:1024,deadlineSeconds:1200})).id);
  const tools=new Map<string,any>();registerNativeEditorTools({registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer,bridge);
  const reply=await tools.get('editor.job').callback({jobId:job.id,includeImage:true});
  assert.equal(job.state,'failed');assert.ok(reply.content.every((c:{type:string})=>c.type!=='image'));
  assert.equal((await bridge.status()).ownedDocument,null);
});

test('saved camera requests reject mods and detect queued archive changes before querying the backend',async t=>{
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});
  const {bridge,root,calls}=await fixture(t,async()=>{entered();await gate;return {structuredContent:{status:'OK'}};});
  await fs.writeFile(path.join(root,'Test.SC2Mod'),'saved mod');
  await assert.rejects(bridge.cameras({archive:'Test.SC2Mod',offset:0,limit:1}),/MAP_REQUIRED/);
  const active=await bridge.check({...check,checks:['load']});await reached;
  const queued=await bridge.cameras({archive:'Test.SC2Map',offset:0,limit:1});
  await fs.writeFile(path.join(root,'Test.SC2Map'),'changed');release();await finished(bridge,active.id);
  const job=await finished(bridge,queued.id);assert.match(job.error??'',/SOURCE_CHANGED_WHILE_QUEUED/);
  assert.equal(calls.length,1);
});
