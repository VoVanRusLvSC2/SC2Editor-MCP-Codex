import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {NativeGameBridge} from '../integrations/game/bridge.js';
import {GameStdioClient,type GameClient,type GameResult} from '../integrations/game/transport.js';
import {registerNativeGameTools} from '../integrations/game/tools.js';
import type {McpServer} from '@modelcontextprotocol/server';
import {createHash} from 'node:crypto';
import {verifyGameRuntime} from '../integrations/game/runtime.js';
import {actionEventsSchema} from '../integrations/game/actionEvents.js';
import {NativeWorkflowGate} from '../modules/testing/gate.js';
const ok=(data:unknown):GameResult=>({content:[{type:'text',text:JSON.stringify(data)}]});
async function fixture(t:test.TestContext,env:NodeJS.ProcessEnv={SC2_GAME_ALLOW_LAUNCH:'1'},handler?:GameClient['call']){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-game-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'Map.SC2Map'),'saved source');
  const calls:Array<{name:string;args:Record<string,unknown>}>=[];let closed=0;
  const client:GameClient={start:async()=>{},close:async()=>{closed++;},info:()=>({connected:true}),tools:()=>[{name:'game.attach',description:'launch',inputSchema:{type:'object'}}],call:async(name,args)=>{calls.push({name,args});return handler?handler(name,args):ok({status:'ok',attached:name==='game.attach'});}};
  const bridge=new NativeGameBridge(new Workspace(root),{client,env});t.after(()=>bridge.close());return {bridge,root,calls,closed:()=>closed};
}
test('launch is explicit, map is workspace-contained and drafts block game launch',async t=>{
  const f=await fixture(t,{});assert.equal(f.bridge.configuration().launchEnabled,false);
  await assert.rejects(f.bridge.attach('Map.SC2Map'),/LAUNCH_DISABLED/);assert.equal(f.calls.length,0);
  const g=await fixture(t);await assert.rejects(g.bridge.attach('../outside.SC2Map'));assert.equal(g.calls.length,0);
  await fs.writeFile(path.join(g.root,'Text.txt'),'not map');await assert.rejects(g.bridge.attach('Text.txt'),/SAVED_MAP_REQUIRED/);
  const w=new Workspace(g.root);await w.applyRawTransaction(['New.txt'],()=>new Map([['New.txt','pending']]),{dryRun:false,stage:true});
  const b=new NativeGameBridge(w,{env:{SC2_GAME_ALLOW_LAUNCH:'1'}});await assert.rejects(b.attach('Map.SC2Map'),/PENDING_DRAFTS/);
});

test('external private artifact storage is lazy, per bridge, retained across operations and separate from saved maps',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-game-external-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const env={SC2_GAME_ALLOW_LAUNCH:'1',SC2_GAME_WORK_ROOT:path.join(base,'private')},a=await fixture(t,env),b=await fixture(t,env);
 assert.equal(a.bridge.configuration().artifactStorage,'configured_external');assert.equal(path.dirname(a.bridge.work),env.SC2_GAME_WORK_ROOT);assert.notEqual(a.bridge.work,b.bridge.work);
 await a.bridge.status();await assert.rejects(fs.access(env.SC2_GAME_WORK_ROOT),/ENOENT/);
 await a.bridge.attach('Map.SC2Map');const work=a.bridge.work;await a.bridge.call('game.status',{});await a.bridge.detach();await a.bridge.attach('Map.SC2Map');assert.equal(a.bridge.work,work);await b.bridge.status(true);
 assert.deepEqual((await fs.readdir(env.SC2_GAME_WORK_ROOT)).sort(),[path.basename(work),path.basename(b.bridge.work)].sort());assert.equal(await fs.readFile(path.join(a.root,'Map.SC2Map'),'utf8'),'saved source');assert.equal(a.calls.filter(c=>c.name==='game.attach').length,2);
});

test('invalid or workspace/runtime-overlapping artifact roots fail before any upstream call or directory write',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-game-root-policy-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const home=path.join(base,'runtime');await fs.mkdir(home);
 for(const root of ['relative-private',path.parse(base).root,'\\\\host\\share\\private',home,path.join(home,'private'),base]){
  const f=await fixture(t,{SC2_GAME_ALLOW_LAUNCH:'1',SC2_GAME_WORK_ROOT:root,SC2_GAME_TOOLKIT_HOME:home});await assert.rejects(f.bridge.status(true),/GAME_WORK_ROOT_/);assert.equal(f.calls.length,0);
 }
 const f=await fixture(t),client:GameClient={start:async()=>{throw Error('must not start');},close:async()=>{},info:()=>({}),tools:()=>[],call:async()=>ok({})};
 for(const root of [f.root,path.join(f.root,'Base.SC2Data/private')]){
  const b=new NativeGameBridge(new Workspace(f.root),{client,env:{SC2_GAME_WORK_ROOT:root}});await assert.rejects(b.status(true),/NOT_EXTERNAL/);await b.close();
 }
 assert.deepEqual(await fs.readdir(home),[]);assert.equal(await fs.readFile(path.join(f.root,'Map.SC2Map'),'utf8'),'saved source');
});

test('external artifact junctions and a replaced retained work directory are refused without touching their targets',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-game-root-links-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const target=path.join(base,'target'),link=path.join(base,'link');await fs.mkdir(target);await fs.writeFile(path.join(target,'sentinel'),'keep');
 try{await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');}catch(e){if((e as NodeJS.ErrnoException).code==='EPERM'){t.skip('Symbolic link unavailable');return;}throw e;}
 const f=await fixture(t,{SC2_GAME_WORK_ROOT:path.join(link,'nested')});await assert.rejects(f.bridge.status(true),/REPARSE_REFUSED/);assert.equal(f.calls.length,0);assert.deepEqual(await fs.readdir(target),['sentinel']);
 const g=await fixture(t,{SC2_GAME_WORK_ROOT:path.join(base,'valid')});await g.bridge.status(true);const calls=g.calls.length;await fs.rename(g.bridge.work,g.bridge.work+'.original');await fs.symlink(target,g.bridge.work,process.platform==='win32'?'junction':'dir');await assert.rejects(g.bridge.status(true),/REPARSE_REFUSED/);assert.equal(g.calls.length,calls);assert.equal(await fs.readFile(path.join(target,'sentinel'),'utf8'),'keep');
});
test('owned attachment checks source, redacts structured secrets and preserves PNG/uncertain results',async t=>{
  const f=await fixture(t,undefined,async name=>name==='game.capture'?{isError:true,content:[{type:'text',text:JSON.stringify({status:'inconclusive',coverage:null,token:'private',nested:{nonce:'private'}})},{type:'image',data:'cG5n',mimeType:'image/png'}]}:ok({status:'ok'}));
  await assert.rejects(f.bridge.call('game.order',{}),/OWNED_SESSION_REQUIRED/);
  const attach=await f.bridge.attach('Map.SC2Map');assert.equal(JSON.parse((attach.content.at(-1) as any).text).sourceUnchanged,true);
  assert.equal(f.calls[0].args.map,path.join(f.root,'Map.SC2Map'));
  const result=await f.bridge.call('game.capture',{});assert.equal(result.isError,true);assert.equal(result.content[1].type,'image');
  const body=JSON.parse((result.content[0] as any).text);assert.equal(body.coverage,null);assert.equal(body.token,'[redacted]');assert.equal(body.nested.nonce,'[redacted]');
  await fs.writeFile(path.join(f.root,'Map.SC2Map'),'user edit');const detached=await f.bridge.detach();assert.equal(detached.sourceUnchanged,false);
  assert.equal(await fs.readFile(path.join(f.root,'Map.SC2Map'),'utf8'),'user edit');
});

test('new renderer and native UI arguments reach the retained upstream without being dropped',async t=>{
 const f=await fixture(t);await f.bridge.attach('Map.SC2Map',180,'vulkan');
 assert.equal(f.calls[0].args.render_backend,'vulkan');
 const args={scope:'native',name:'Menu',path:'GameUI',text:'Menu',visible_only:true,offset:0,limit:8};
 await f.bridge.call('game.ui.inspect',args);assert.deepEqual(f.calls[1].args,args);
});

test('pinned private runtime checks complete manifest, code additions and binary overrides before launch',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-game-pin-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const digest=(b:string)=>createHash('sha256').update(b).digest('hex');
 await fs.mkdir(path.join(root,'app'));await fs.mkdir(path.join(root,'bin'));
 const manifest=JSON.stringify({'app/mcp_server.py':digest('private frontend'),'bin/SC2GameHost.exe':digest('binary')});
 const pin={version:'0.1.0-dev.11',archiveSha256:'a'.repeat(64),manifestSha256:digest(manifest)},options={pin,requiredRelease:'v'+pin.version};
 assert.equal((await verifyGameRuntime(root)).provenance,'external_unpinned');
 await assert.rejects(verifyGameRuntime(root,undefined,options),/RECEIPT_REQUIRED/);
 await fs.writeFile(path.join(root,'sc2-game-runtime.json'),JSON.stringify({releaseTag:'v'+pin.version,zipSha256:pin.archiveSha256}));
 await fs.writeFile(path.join(root,'SHA256SUMS.json'),manifest);await fs.writeFile(path.join(root,'app/mcp_server.py'),'private frontend');await fs.writeFile(path.join(root,'bin/SC2GameHost.exe'),'binary');
 assert.equal((await verifyGameRuntime(root,undefined,options)).verifiedFiles,2);
 await fs.writeFile(path.join(root,'app/extra.py'),'unexpected');await assert.rejects(verifyGameRuntime(root,undefined,options),/UNLISTED_CODE/);await fs.unlink(path.join(root,'app/extra.py'));
 await assert.rejects(verifyGameRuntime(root,root,options),/BINARY_OVERRIDE/);
 await fs.writeFile(path.join(root,'app/mcp_server.py'),'changed');await assert.rejects(verifyGameRuntime(root,undefined,options),/FILE_CHANGED/);
 await fs.writeFile(path.join(root,'SHA256SUMS.json'),'{}');await assert.rejects(verifyGameRuntime(root,undefined,options),/MANIFEST_CHANGED/);
});
test('nested record and scenario actions cannot bypass attach or detach policy',async t=>{
  const f=await fixture(t);await f.bridge.attach('Map.SC2Map');
  for(const method of ['game.attach','game.detach','native.memory']){
    await assert.rejects(f.bridge.call('game.record',{action:{method,arguments:{map:'elsewhere'}}}),/NOT_ALLOWED/);
    await assert.rejects(f.bridge.call('game.test.run',{steps:[{method:'game.record',arguments:{action:{method}}}]}),/NOT_ALLOWED/);
  }
  assert.equal(f.calls.length,1);await f.bridge.call('game.test.run',{steps:[{method:'game.order',arguments:{unit:{$ref:'spawn.unit.id'},action:'stop'}}]});assert.equal(f.calls.length,2);
});
test('shutdown drains accepted requests, closes only its client and refuses later work',async t=>{
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const f=await fixture(t,undefined,async()=>{await gate;return ok({status:'ok'});});
  const first=f.bridge.status(true),next=f.bridge.tools();const close=f.bridge.close();release();await Promise.all([first,next,close]);
  assert.equal(f.closed(),1);await assert.rejects(f.bridge.status(),/CLOSING/);
});
test('idle detach is idempotent; failed detach stays an MCP error and can be retried',async t=>{
  let fail=true;const f=await fixture(t,undefined,async name=>name==='game.detach'&&fail?{...ok({status:'failed',error:'still running'}),isError:true}:ok({status:'ok'}));
  await f.bridge.status(true);const count=f.calls.length;assert.equal((await f.bridge.detach()).stopped,true);assert.equal(f.calls.length,count);
  await f.bridge.attach('Map.SC2Map');
  const tools=new Map<string,any>();registerNativeGameTools({registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer,f.bridge);
  const result=await tools.get('game.detach').callback({});assert.equal(result.isError,true);
  await assert.rejects(f.bridge.attach('Map.SC2Map'),/ALREADY_OWNED/);fail=false;assert.equal((await f.bridge.detach()).stopped,true);
});
test('compact game tools expose strict launch, action and operation contracts',async t=>{
  const {bridge}=await fixture(t),tools=new Map<string,any>();
  registerNativeGameTools({registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer,bridge);
  assert.equal(tools.size,6);assert.throws(()=>tools.get('game.attach').config.inputSchema.parse({map:'M.SC2Map',pid:123}));
  assert.throws(()=>tools.get('game.attach').config.inputSchema.parse({map:'M.SC2Map',timeout:301}));
  const response=await tools.get('game.call').callback({method:'game.order',arguments:{}});assert.equal(response.isError,true);
});
test('action observation owns the complete bridge queue, retains receipts and reuses only returned cursors',async t=>{
 const identity={session:'s',runtimeEpoch:'e',mapLoadSerial:1},request=actionEventsSchema.parse({action:{method:'game.order',arguments:{unit:'caster',action:'ability',ability:'Pulse'}},events:[{id:'hit',match:{kind:'damage',source:'galaxy',unit:'victim',amount:40}}]});
 let release!:()=>void,submitted!:()=>void,orderCount=0,pages=0;
 const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{submitted=r;});
 const f=await fixture(t,undefined,async(name)=>{
  if(name==='game.order'){orderCount++;submitted();if(orderCount===1)await held;return ok({status:'ok',...identity,gameTime:7+orderCount*3,accepted:true});}
  // Keep each drained baseline, submitted action and returned events in time order.
  if(name==='game.events')return ok({status:'ok',...identity,gameTime:9+orderCount*3,events:++pages%2===0?[{kind:'damage',source:'galaxy',sourceUnit:'caster',unit:'victim',amount:40,gameTime:8+orderCount*3},{kind:'ability',source:'galaxy',unit:'caster',ability:'Pulse',stageName:'complete',gameTime:9+orderCount*3}]:[],cursor:'tail-'+pages,hasMore:false,dropped:false});
  return ok({status:'ok'});
 });
 await f.bridge.attach('Map.SC2Map');const action=f.bridge.action(request);await started;const queued=f.bridge.call('game.status',{});await new Promise(r=>setImmediate(r));assert.equal(f.calls.some(c=>c.name==='game.status'),false);release();const report=await action;await queued;
 assert.equal(report.status,'passed');assert.deepEqual(f.calls.slice(1).map(c=>c.name),['game.events','game.order','game.events','game.status']);
 const saved=JSON.parse(await fs.readFile(report.report,'utf8'));assert.equal(saved.status,'passed');assert.equal(saved.actionSubmitted,true);assert.equal(await fs.readFile(path.join(f.root,'Map.SC2Map'),'utf8'),'saved source');
 const second=await f.bridge.action(request);assert.equal(second.status,'passed');assert.deepEqual(f.calls.filter(c=>c.name==='game.events').map(c=>c.args),[{}, {cursor:'tail-1'},{cursor:'tail-2'},{cursor:'tail-3'}]);
 const gate=new NativeWorkflowGate(),free=gate.acquire('other-suite');assert.throws(()=>gate.protect(f.bridge).action(request),/NATIVE_WORKFLOW_BUSY/);free();
 await f.bridge.detach();await assert.rejects(f.bridge.action(request),/OWNED_SESSION_REQUIRED/);
});
test('action tools expose explicit runtime refusal as an error and retain inconclusive observation as unknown',async t=>{
 const identity={session:'s',runtimeEpoch:'e',mapLoadSerial:1};
 const f=await fixture(t,undefined,async name=>name==='game.events'?ok({status:'ok',...identity,gameTime:10,events:[],cursor:'tail',hasMore:false,dropped:false}):ok({status:'ok',...identity,gameTime:10,accepted:false}));await f.bridge.attach('Map.SC2Map');
 const tools=new Map<string,any>();registerNativeGameTools({registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer,f.bridge);
 const request=tools.get('game.action').config.inputSchema.parse({action:{method:'game.order',arguments:{unit:'caster',action:'stop'}},events:[{id:'event',match:{kind:'unit_order',source:'galaxy'}}]});
 const result=await tools.get('game.action').callback(request);assert.equal(result.isError,true);const body=JSON.parse(result.content[0].text);assert.equal(body.status,'failed');assert.equal(body.actionSubmitted,true);
});
test('game stdio fragmented protocol, advertised version, errors and graceful EOF',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-game-stdio-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const script=`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(!('id' in r))return;const result=r.method==='initialize'?{serverInfo:{name:'sc2-game-toolkit',version:'0.1.0-dev'}}:r.method==='tools/list'?{tools:[{name:'game.attach',description:'test',inputSchema:{}}]}:{content:[{type:'text',text:'failed'}],isError:true};const out=JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n';process.stdout.write(out.slice(0,8));process.stdout.write(out.slice(8));});`;
  const client=new GameStdioClient(process.execPath,['-e',script],root);t.after(()=>client.close());await client.start();
  assert.equal((client.info() as any).server.version,'0.1.0-dev');assert.equal((await client.call('game.attach',{})).isError,true);
  await assert.rejects(client.call('not.advertised',{}),/UNAVAILABLE/);
  await assert.rejects(client.call('game.attach',{map:'x'.repeat(1024*1024)}),/REQUEST_TOO_LARGE/);
  assert.equal((await client.call('game.attach',{})).isError,true);await client.close();assert.equal((client.info() as any).connected,false);
  const bad=new GameStdioClient(process.execPath,['-e',script.replace("version:'0.1.0-dev'","version:'wrong'")],root);
  await assert.rejects(bad.start(),/VERSION_MISMATCH/);
});
