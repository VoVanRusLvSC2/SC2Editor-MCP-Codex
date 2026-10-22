import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {ProjectTestWorkspace,gameLaunchCheck} from '../modules/testing/workspace.js';
import {testManifestSchema,testVerdict} from '../modules/testing/schemas.js';
import type {GameResult} from '../integrations/game/transport.js';
import {NativeWorkflowGate} from '../modules/testing/gate.js';
import {NativeGameBridge} from '../integrations/game/bridge.js';
import {createMapInfo} from '../modules/document/codecs/mapInfoFactory.js';
import {routeDeviation} from '../modules/testing/routeGeometry.js';
import type {readArchiveTerrainLoadContract} from '../archive/terrainLoadContract.js';

const ok=(body:Record<string,unknown>):GameResult=>({content:[{type:'text',text:JSON.stringify({status:'ok',...body})}]});
test('launch checks preserve bounded upstream reasons and distinguish unconfirmed maps from explicit errors',()=>{
 const timeout={...ok({status:'inconclusive',mapConfirmed:false,reason:'No live Galaxy handshake within the real-time timeout'}),isError:true};
 const check=gameLaunchCheck(timeout,true);assert.equal(check.status,'inconclusive');assert.equal(check.reason,'No live Galaxy handshake within the real-time timeout');assert.equal(check.evidence?.nativeStatus,'inconclusive');assert.equal(check.evidence?.runtimeError,true);assert.equal(check.evidence?.confirmation,'unconfirmed');
 assert.equal(gameLaunchCheck({...ok({status:'unsupported',reason:'Backend unavailable'}),isError:true},true).status,'unsupported');
 assert.equal(gameLaunchCheck({...ok({status:'failed',reason:'Process launch failed'}),isError:true},true).status,'failed');
 assert.equal(gameLaunchCheck(ok({mapConfirmed:false}),true).status,'inconclusive');
 const passed=gameLaunchCheck(ok({mapConfirmed:true,hidden:true}),true);assert.equal(passed.status,'passed');assert.equal(passed.reason,undefined);
 const bounded=gameLaunchCheck(ok({status:'failed',reason:'broken\u001b\n\u0085'+'.'.repeat(1000)}),true);assert.equal(bounded.reason!.length,640);assert.ok(!/\p{Cc}/u.test(bounded.reason!));
 const compiler=gameLaunchCheck({...ok({status:'failed',error:'map_compile_failed',details:'Script compile error: Scripts/Probe.galaxy (12), Unknown native function\nScript code: PrivateSdkSecret();\nFull injected source follows'}),isError:true},true);
 assert.deepEqual(compiler.evidence?.compilerDiagnostics,['Script compile error: Scripts/Probe.galaxy (12), Unknown native function']);assert.ok(!JSON.stringify(compiler).includes('PrivateSdkSecret'));
});
test('separate retained game bridges isolate their private session storage',()=>{
 const workspace=new Workspace(path.resolve('work'));
 const a=new NativeGameBridge(workspace),b=new NativeGameBridge(workspace);
 assert.notEqual(a.work,b.work);assert.equal(a.configuration().work,a.work);
});
async function fixture(t:test.TestContext,options:{blocked?:boolean;detour?:boolean;failAttach?:boolean;compileFailure?:boolean;detachFailure?:boolean;terrainLoad?:(file:string)=>Promise<Awaited<ReturnType<typeof readArchiveTerrainLoadContract>>>}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-project-tests-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Map.SC2Map'),'saved map');
 const calls:Array<{method:string;args:any}>=[];let owned=false;const units=new Map<string,any>(),pending=new Map<string,Array<{x:number;y:number}>>();let count=0,closes=0;
 const factory=(workspace:Workspace)=>({game:{configuration:()=>({configured:true,launchEnabled:true}),status:async()=>({source:owned?{}:null}),attach:async(map:string,timeout=120,renderBackend='auto')=>{calls.push({method:'attach',args:{map,root:workspace.root,timeout,renderBackend}});owned=true;return options.failAttach?{...ok({status:'failed'}),isError:true}:ok({mapConfirmed:true,hidden:true});},call:async(method:string,args:any)=>{
  calls.push({method,args});if(method==='game.status')return ok({versionSupport:{observedVersion:'5.0.17.98310'}});
  if(method==='game.fixture'&&!args.action){const id=String(++count),u={id,type:args.type,owner:args.owner,valid:true,alive:true,position:{x:args.x,y:args.y},life:45};units.set(id,u);return ok({unit:u});}
  if(method==='game.fixture'&&args.action==='cleanup'){for(const u of units.values())u.valid=false;return ok({removed:count});}
  if(method==='game.order'){const u=units.get(args.unit);if(!options.blocked){if(options.detour)pending.set(args.unit,[{x:(u.position.x+args.x)/2,y:(u.position.y+args.y)/2+8},{x:args.x,y:args.y}]);else u.position={x:args.x,y:args.y};}return ok({accepted:true});}
  if(method==='game.units.inspect'){const u=units.get(args.unit),position=pending.get(args.unit)?.shift();if(position)u.position=position;return ok({unit:u});}
  if(method==='game.units.find')return ok({units:[{valid:true,alive:true}]});
  if(method==='game.diagnostics')return ok({messages:[],cursor:'next',sources:[{access:'partial'}]});
  if(method==='game.test.run')return ok({status:'passed'});return ok({});
 },detach:async()=>{calls.push({method:'detach',args:{}});owned=false;return {stopped:!options.detachFailure,sourceUnchanged:true};},close:async()=>{owned=false;closes++;}},editor:{status:async()=>({jobs:[]}),check:async()=>({id:'native'} as any),job:()=>({state:'completed',report:'native.json',result:{outcome:options.compileFailure?'failed':'passed',checks:options.compileFailure?{compile:{nativeCompilePassed:false,error:'Expected syntax error'}}:{}}} as any),close:async()=>{closes++;}}});
 let mapInfo:Buffer=createMapInfo(64,64,'Bounds fixture',6,0),mapInfoReads=0;
 const ws=new Workspace(root),runtime=factory(ws),gate=new NativeWorkflowGate(),tests=new ProjectTestWorkspace(ws,{runtime:runtime as any,gate,inspect:async()=>({entries:[]}),mapInfo:async()=>{mapInfoReads++;return mapInfo;},terrainLoad:options.terrainLoad,pollMs:1});t.after(()=>tests.close());
 return {root,ws,tests,calls,runtime,gate,owned:()=>owned,closes:()=>closes,mapInfoReads:()=>mapInfoReads,setMapInfo:(bytes:Buffer)=>{mapInfo=bytes;}};
}
const manifest={version:1,map:'Map.SC2Map',expectedGameBuild:'5.0.17.98310',game:{capture:false,points:{start:{x:12,y:20},end:{x:19,y:22}},routes:[{id:'gate',from:'start',to:'end',type:'Marine',mobility:'ground',timeout:1}]}};
async function finished(tests:ProjectTestWorkspace,id:string){for(let i=0;i<2000;i++){const s=tests.status(id);if(s.state==='completed'||s.state==='cancelled')return tests.report(id,0,32);await new Promise(r=>setTimeout(r,2));}throw Error('Test runner did not finish');}

const overview={id:'overview',camera:{x:16,y:20,distance:40,pitch:55,yaw:180}};
test('readiness observes exact native marker vitals and rechecks identity/area before reading startup history',async t=>{
 const f=await fixture(t),call=f.runtime.game.call;let attempts=0;
 f.runtime.game.call=async(method,args)=>{
  if(method==='game.units.find'){f.calls.push({method,args});return ok({units:[{id:'dead',valid:true,alive:false},{id:'outside',valid:true,alive:true},{id:'marker',valid:true,alive:true}]});}
  if(method==='game.units.inspect'){f.calls.push({method,args});return ok({unit:{valid:true,alive:true,type:'Marine',owner:1,position:args.unit==='outside'?{x:90,y:90}:{x:32,y:16.8},life:args.unit==='outside'?44:++attempts===1?43:44}});}
  return call(method,args);
 };
 const ready={type:'Marine',owner:1,area:{xmin:31.7,ymin:16.5,xmax:32.3,ymax:17.1},state:{life:44},timeout:1};
 const p=await f.tests.plan({version:1,map:'Map.SC2Map',game:{capture:false,ready}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'passed');assert.equal(attempts,2);
 assert.ok(f.calls.filter(c=>c.method==='game.units.find').every(c=>c.args.limit===16&&c.args.area.xmin===31.7));
 assert.equal(f.calls.some(c=>c.method==='game.units.inspect'&&c.args.unit==='dead'),false);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.tests.work,r.jobId,'readiness_state.json'),'utf8')).content[0].type,'text');
 assert.throws(()=>testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{ready:{...ready,state:{}}}}));
 assert.throws(()=>testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{ready:{...ready,area:{...ready.area,xmin:99}}}}));
});
test('map suite checks retained startup events and then executes independent callback assertions',async t=>{
 const f=await fixture(t),call=f.runtime.game.call;
 f.runtime.game.call=async(method,args)=>{if(method==='game.events'){f.calls.push({method,args});return ok({events:[{kind:'unit_died',source:'galaxy',unitType:'Marine',owner:1}],cursor:'retained-event',hasMore:false,dropped:false,session:'session',runtimeEpoch:'epoch',mapLoadSerial:1});}return call(method,args);};
 const p=await f.tests.plan({version:1,map:'Map.SC2Map',game:{capture:false,startupEvents:[{id:'startupDeath',match:{kind:'unit_died',source:'galaxy',unitType:'Marine',owner:1}}],scenarios:[{id:'callbackState',steps:[{method:'game.units.inspect',arguments:{unit:'returned-marker'},expect:{'unit.life':44}}]}]}});
 const r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'passed');assert.equal(r.checks.find(c=>c.id==='startup_event:startupDeath')?.status,'passed');
 assert.ok(f.calls.findIndex(c=>c.method==='game.events')<f.calls.findIndex(c=>c.method==='game.test.run'));
 const evidence=r.checks.find(c=>c.id==='startup_event:startupDeath')!.evidence!;
 assert.equal(JSON.parse(await fs.readFile(String(evidence.report),'utf8')).content[0].type,'text');
 assert.equal(f.calls.some(c=>c.method==='game.wait'),false);assert.equal(f.owned(),false);
});
const nativePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7sAAAAASUVORK5CYII=','base64');
function viewRuntime(f:Awaited<ReturnType<typeof fixture>>,options:{mismatch?:boolean;missing?:boolean}={}){
 const call=f.runtime.game.call;
 f.runtime.game.call=async(method,args)=>{
  if(method==='game.camera.set'){f.calls.push({method,args});return ok({camera:{target:{x:args.x+(options.mismatch?1:0),y:args.y},distance:args.distance,pitch:args.pitch-0.15,yaw:args.yaw-360}});}
  if(method==='game.capture'){f.calls.push({method,args});return {...ok({}),content:[...ok({}).content,...options.missing?[]:[{type:'image' as const,mimeType:'image/png',data:nativePng.toString('base64')}]]};}
  return call(method,args);
 };
}

test('named native views verify camera readback, capture UI-free PNGs and guard image delivery',async t=>{
 const f=await fixture(t);viewRuntime(f);
 const p=await f.tests.plan({version:1,map:'Map.SC2Map',game:{capture:false,views:[overview]}});
 assert.equal(p.suites.views,1);const j=await f.tests.run(p.planId),r=await finished(f.tests,j.jobId),check=r.checks.find(c=>c.id==='view:overview')!;
 assert.equal(r.outcome,'passed');assert.equal(check.status,'passed');assert.equal(check.evidence?.visualReview,'not_checked');
 assert.deepEqual(f.calls.filter(c=>c.method==='game.capture').map(c=>c.args),[{include_ui:false}]);
 assert.equal((await f.tests.image(j.jobId,'overview')).data,nativePng.toString('base64'));
 await assert.rejects(f.tests.image(j.jobId,'../outside'),/VIEW_UNKNOWN/);
 await fs.appendFile(String(check.evidence?.file),'changed');await assert.rejects(f.tests.image(j.jobId,'overview'),/IMAGE_INVALID/);
 assert.equal(f.owned(),false);
});

test('viewpoint mismatch and missing native PNG cannot pass a required view',async t=>{
 for(const options of [{mismatch:true},{missing:true}]){
  const f=await fixture(t);viewRuntime(f,options);const p=await f.tests.plan({version:1,map:'Map.SC2Map',game:{capture:false,views:[overview]}}),j=await f.tests.run(p.planId),r=await finished(f.tests,j.jobId);
  assert.equal(r.outcome,options.mismatch?'failed':'inconclusive');assert.notEqual(r.checks.find(c=>c.id==='view:overview')?.status,'passed');
  if(options.mismatch)assert.equal(f.calls.some(c=>c.method==='game.capture'),false);
  await assert.rejects(f.tests.image(j.jobId,'overview'),/IMAGE_UNCONFIRMED/);assert.equal(f.owned(),false);
 }
 assert.throws(()=>testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{views:[overview,overview]}}));
 assert.throws(()=>testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{views:[{...overview,id:'../outside'}]}}));
});

test('map test manifest rejects unknown endpoints, unsafe operations and flight substitution',()=>{
 assert.throws(()=>testManifestSchema.parse({...manifest,game:{...manifest.game,routes:[{...manifest.game.routes[0],from:'missing'}]}}));
 assert.throws(()=>testManifestSchema.parse({...manifest,game:{...manifest.game,routes:[{...manifest.game.routes[0],mobility:'air'}]}}));
 assert.throws(()=>testManifestSchema.parse({version:1,map:'Map.SC2Map',game:{scenarios:[{id:'bad',steps:[{method:'game.attach'}]}]}}));
 assert.throws(()=>testManifestSchema.parse({version:1,map:'Map.SC2Map'}));
});
test('suite creates a private copy, observes both directions, verifies cleanup and fingerprints reports',async t=>{
 const f=await fixture(t),p=await f.tests.plan(manifest),j=await f.tests.run(p.planId),r=await finished(f.tests,j.jobId);
 assert.equal(r.outcome,'passed');assert.equal(r.current,true);assert.equal(f.owned(),false);assert.equal(f.closes(),0);
 assert.equal(r.checks.filter(c=>c.id.startsWith('route:')&&c.status==='passed').length,2);
 assert.deepEqual(f.calls.filter(c=>c.method==='game.order').map(c=>[c.args.x,c.args.y]),[[19,22],[12,20]]);
 assert.equal(f.calls[0].args.root,f.root);assert.match(f.calls[0].args.map,/project-tests/);assert.equal(await fs.readFile(path.join(f.root,'Map.SC2Map'),'utf8'),'saved map');
 await fs.writeFile(path.join(f.root,'Map.SC2Map'),'edited map');assert.equal((await f.tests.report(j.jobId)).evidenceValidForCurrentInputs,false);
 await assert.rejects(f.tests.run(p.planId),/STALE/);
});
test('dependency changes and binary drafts prevent reuse before workers start',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'Dependency.SC2Mod'),'first');
 const p=await f.tests.plan({...manifest,dependencies:[{id:'MyMod',file:'Dependency.SC2Mod'}]});await fs.writeFile(path.join(f.root,'Dependency.SC2Mod'),'changed');
 await assert.rejects(f.tests.run(p.planId),/STALE/);assert.equal(f.calls.length,0);
 await f.ws.binary.apply(['Terrain'],files=>new Map([...files,['Terrain',Buffer.from('draft')]]),{dryRun:false,stage:true});
 await assert.rejects(f.tests.plan(manifest),/PENDING_DRAFTS/);
});

test('map suites preserve the selected game render backend on launch',async t=>{
 const f=await fixture(t),identity={provenance:'pinned_release' as const,releaseTag:'v0.1.0-dev.11',binaryOverride:false};
 Object.assign(f.runtime.game,{configuration:()=>({configured:true,launchEnabled:true,runtimeIdentity:identity})});
 const p=await f.tests.plan({...manifest,game:{...manifest.game,renderBackend:'legacy'}});
 const r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(f.calls.find(c=>c.method==='attach')?.args.renderBackend,'legacy');
 assert.deepEqual(r.gameRuntime,identity);
});
test('changing a manifest file invalidates its resolved plan',async t=>{
 const f=await fixture(t),file=path.join(f.root,'tests.json');await fs.writeFile(file,JSON.stringify(manifest));const p=await f.tests.planFile('tests.json');
 await fs.writeFile(file,JSON.stringify({...manifest,label:'changed'}));await assert.rejects(f.tests.run(p.planId),/STALE/);assert.equal(f.calls.length,0);
});

test('outside route centers fail before game launch; unsupported metadata cannot become a route pass',async t=>{
 const f=await fixture(t),p=await f.tests.plan({...manifest,game:{...manifest.game,points:{...manifest.game.points,start:{x:6,y:20}}}});
 const r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'failed');assert.match(r.checks.find(c=>c.id==='map.playable_bounds')?.reason??'',/OUTSIDE.*start/);assert.equal(f.calls.length,0);
 const g=await fixture(t);g.setMapInfo(Buffer.from('unknown profile'));const q=await g.tests.plan(manifest),u=await finished(g.tests,(await g.tests.run(q.planId)).jobId);
 assert.equal(u.outcome,'unsupported');assert.equal(g.calls.length,0);
});

test('MapInfo cache follows exact archive identity across retained runs',async t=>{
 const f=await fixture(t),p=await f.tests.plan(manifest);
 await finished(f.tests,(await f.tests.run(p.planId)).jobId);await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(f.mapInfoReads(),1);
 await fs.writeFile(path.join(f.root,'Map.SC2Map'),'different revision');const q=await f.tests.plan(manifest);
 await finished(f.tests,(await f.tests.run(q.planId)).jobId);assert.equal(f.mapInfoReads(),2);
});
const loadResult=(valid:boolean)=>({kind:'checked' as const,result:{supported:true,valid,issues:valid?[]:[{severity:'error' as const,code:'TERRAIN_LOAD_SYNC_TRANSFORM_SINGULAR',message:'SMAP has an all-zero scale'}]}});
test('known invalid terrain is rejected before either native bridge starts; load cache follows archive digest',async t=>{
 let reads=0,valid=false;
 const f=await fixture(t,{terrainLoad:async()=>{reads++;return loadResult(valid);}});
 const p=await f.tests.plan({...manifest,editor:{checks:['load','compile']}});
 assert.equal(p.ready,false);assert.equal(p.issues.find(c=>c.id==='map.terrain_load')?.status,'failed');
 await assert.rejects(f.tests.run(p.planId),/PLAN_BLOCKED/);assert.equal(f.calls.length,0);
 await f.tests.plan(manifest);assert.equal(reads,1);
 valid=true;await fs.writeFile(path.join(f.root,'Map.SC2Map'),'repaired archive');
 const q=await f.tests.plan(manifest);assert.equal(q.ready,true);assert.equal(reads,2);
 const r=await finished(f.tests,(await f.tests.run(q.planId)).jobId);assert.equal(r.outcome,'passed');assert.equal(reads,2);
 assert.equal(r.checks.find(c=>c.id==='map.terrain_load')?.evidence?.sha256,q.sourceSha256);
});
test('terrain inspection cannot bless an archive changed during the read',async t=>{
 const f=await fixture(t,{terrainLoad:async file=>{await fs.appendFile(file,'changed during inspection');return loadResult(true);}});
 await assert.rejects(f.tests.plan(manifest),/STALE_DURING_TERRAIN_LOAD/);assert.equal(f.calls.length,0);
});
test('failed attach still detaches and reports launch failure without running routes',async t=>{
 const f=await fixture(t,{failAttach:true}),p=await f.tests.plan(manifest),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'failed');assert.ok(f.calls.some(c=>c.method==='detach'));assert.ok(!f.calls.some(c=>c.method==='game.order'));assert.equal(f.owned(),false);
});
test('an unconfirmed handshake remains inconclusive, retains its reason and cleans up without gameplay',async t=>{
 const f=await fixture(t),attach=f.runtime.game.attach;
 f.runtime.game.attach=async(...args)=>{await attach(...args);return {...ok({status:'inconclusive',mapConfirmed:false,reason:'No live Galaxy handshake within the real-time timeout'}),isError:true};};
 const p=await f.tests.plan(manifest),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'inconclusive');assert.match(r.checks.find(c=>c.id==='game.launch')!.reason!,/Galaxy handshake/);
 assert.equal(r.checks.find(c=>c.id==='game.cleanup')!.status,'passed');assert.equal(f.calls.some(c=>c.method==='game.order'),false);assert.equal(f.owned(),false);
 assert.deepEqual(f.calls.find(c=>c.method==='game.debug.inspect')!.args,{open:false,offset:0,limit:16,text_offset:0,text_limit:2048});
 assert.equal(r.checks.find(c=>c.id==='game.launch_diagnostics')!.status,'inconclusive');
});
test('optional debugger failures and an explicit opt-out cannot hide the launch outcome or skip cleanup',async t=>{
 for(const enabled of [true,false]){
  const f=await fixture(t,{failAttach:true}),call=f.runtime.game.call;
  f.runtime.game.call=async(method,args)=>{if(method==='game.debug.inspect'){f.calls.push({method,args});throw Error('Debugger unavailable');}return call(method,args);};
  const p=await f.tests.plan({...manifest,game:{...manifest.game,launchDiagnostics:enabled}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
  assert.equal(r.outcome,'failed');assert.equal(r.checks.find(c=>c.id==='game.cleanup')!.status,'passed');assert.equal(f.calls.some(c=>c.method==='game.debug.inspect'),enabled);
  if(enabled)assert.match(r.checks.find(c=>c.id==='game.launch_diagnostics')!.reason!,/Debugger unavailable/);
 }
});
test('a diagnostic frame cannot turn an unconfirmed map into a passing gameplay run',async t=>{
 const f=await fixture(t),attach=f.runtime.game.attach;viewRuntime(f);
 f.runtime.game.attach=async(...args)=>{await attach(...args);return {...ok({status:'inconclusive',mapConfirmed:false,reason:'No handshake'}),isError:true};};
 const p=await f.tests.plan(manifest),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId),capture=r.checks.find(c=>c.id==='game.launch_capture')!;
 assert.equal(r.outcome,'inconclusive');assert.equal(capture.status,'passed');assert.equal(capture.evidence?.mapConfirmed,false);assert.equal(capture.evidence?.purpose,'launch_diagnostics');
 assert.deepEqual(await fs.readFile(String(capture.evidence?.file)),nativePng);assert.deepEqual(f.calls.find(c=>c.method==='game.capture')?.args,{include_ui:true});
 assert.equal(r.checks.find(c=>c.id==='game.cleanup')?.status,'passed');assert.equal(f.calls.some(c=>c.method==='game.order'),false);
});
test('diagnostic capture errors stay visible without replacing the launch result',async t=>{
 const f=await fixture(t,{failAttach:true}),call=f.runtime.game.call;
 f.runtime.game.call=async(method,args)=>method==='game.capture'?{...ok({status:'failed',error:"'NoneType' object has no attribute 'read_bytes'"}),isError:true}:call(method,args);
 const p=await f.tests.plan(manifest),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId),capture=r.checks.find(c=>c.id==='game.launch_capture')!;
 assert.equal(r.outcome,'failed');assert.equal(capture.status,'inconclusive');assert.match(capture.reason!,/NoneType/);assert.equal(capture.evidence?.nativeStatus,'failed');
 assert.ok((await fs.readFile(String(capture.evidence?.report),'utf8')).includes('read_bytes'));assert.equal(r.checks.find(c=>c.id==='game.cleanup')?.status,'passed');
});
test('movement timeout never passes a blocked-crossing assertion',async t=>{
 const f=await fixture(t,{blocked:true}),p=await f.tests.plan({...manifest,game:{...manifest.game,routes:[{...manifest.game.routes[0],expected:'blocked',bidirectional:false}]}});
 const r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);assert.equal(r.outcome,'inconclusive');assert.equal(r.checks.find(c=>c.id==='route:gate:forward')?.status,'inconclusive');
});

test('route corridors reject an observed detour even when the unit reaches its destination',async t=>{
 const f=await fixture(t,{detour:true}),p=await f.tests.plan({...manifest,game:{...manifest.game,routes:[{...manifest.game.routes[0],maxDeviation:2}]}});
 const r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'failed');const routes=r.checks.filter(c=>c.id.startsWith('route:')&&!c.id.endsWith(':cleanup'));
 assert.equal(routes.length,2);for(const c of routes){assert.equal(c.status,'failed');assert.equal(c.evidence?.arrived,true);assert.ok(Number(c.evidence?.maxObservedDeviation)>2);assert.equal(c.evidence?.corridorScope,'sampled_unit_centers');}
 assert.equal(f.owned(),false);
});

test('route distance includes endpoint overshoot and supports diagonal segments',()=>{
 assert.equal(routeDeviation({x:5,y:2},{x:0,y:0},{x:10,y:0}),2);
 assert.equal(routeDeviation({x:13,y:4},{x:0,y:0},{x:10,y:0}),5);
 assert.equal(routeDeviation({x:3,y:3},{x:0,y:0},{x:6,y:6}),0);
 assert.equal(routeDeviation({x:3,y:4},{x:0,y:0},{x:0,y:0}),5);
 assert.throws(()=>testManifestSchema.parse({...manifest,game:{...manifest.game,routes:[{...manifest.game.routes[0],maxDeviation:-1}]}}));
});
test('expected compilation failure passes its negative fixture and never launches a game',async t=>{
 const f=await fixture(t,{compileFailure:true}),p=await f.tests.plan({...manifest,editor:{checks:['compile'],expected:'compile_failed',diagnosticIncludes:'Expected syntax error'}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'passed');assert.equal(f.calls.length,0);
});
test('an unrelated native failure cannot satisfy an expected negative fixture',async t=>{
 const f=await fixture(t,{compileFailure:true}),p=await f.tests.plan({...manifest,editor:{checks:['compile'],expected:'compile_failed',diagnosticIncludes:'Different error'}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'failed');assert.equal(f.calls.length,0);
});

test('a native context failure exposes its bounded reason and never starts gameplay',async t=>{
 const f=await fixture(t);
 f.runtime.editor.job=()=>({state:'failed',report:'native.json',result:{outcome:'failed',checks:{load:{nativeValidationPassed:true},compile:{status:'FAILED',error:'Supply context_label\nfor the authored root/library'+'x'.repeat(1000)}}}} as any);
 const p=await f.tests.plan({...manifest,editor:{checks:['load','compile']}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 const check=r.checks.find(c=>c.id==='editor');assert.equal(r.outcome,'failed');assert.match(check?.reason??'',/^Supply context_label for the authored root\/library/);assert.equal(check?.reason?.length,640);assert.ok(!/\p{Cc}/u.test(check?.reason??''));assert.ok(!f.calls.some(c=>c.method==='attach'));
 assert.equal(check?.evidence?.report,'native.json');assert.equal(f.gate.busy,null);
});

test('native library context is forwarded without changing default scope selection',async t=>{
 const f=await fixture(t),seen:any[]=[];
 Object.assign(f.runtime.editor,{check:async(args:Record<string,unknown>)=>{seen.push(args);return {id:'native'};}});
 for(const context of [{},{scope:'library:ABCD1234',contextLabel:'Shared systems',locale:'ruRU'}]){
  const p=await f.tests.plan({...manifest,editor:{checks:['compile'],...context}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);assert.equal(r.outcome,'passed');
 }
 for(const key of ['scope','contextLabel','locale'])assert.ok(!Object.hasOwn(seen[0],key));
 assert.equal(seen[1].scope,'library:ABCD1234');assert.equal(seen[1].contextLabel,'Shared systems');assert.equal(seen[1].locale,'ruRU');
 assert.throws(()=>testManifestSchema.parse({...manifest,editor:{scope:'',locale:'Russian'}}));
});
test('cancelling a queued run never launches its workers and shutdown drains accepted work',async t=>{
 const f=await fixture(t),p=await f.tests.plan(manifest),j=await f.tests.run(p.planId);f.tests.cancel(j.jobId);await f.tests.close();assert.equal(f.tests.status(j.jobId).state,'cancelled');assert.equal(f.calls.length,0);await assert.rejects(f.tests.run(p.planId),/CLOSING/);
});
test('unsupported and incomplete required checks cannot produce acceptance',()=>{
 assert.equal(testVerdict([{id:'archive',status:'passed',required:true},{id:'path',status:'unsupported',required:true}]),'unsupported');
 assert.equal(testVerdict([{id:'path',status:'not_checked',required:true}]),'inconclusive');
});
test('retained bridges are reused across runs; lease blocks conflicting tools without blocking local status',async t=>{
 const f=await fixture(t),proxy=f.gate.protect(f.runtime.game),release=f.gate.acquire('test-owner');
 assert.throws(()=>proxy.attach('Map.SC2Map'),/WORKFLOW_BUSY/);await proxy.status();release();
 const p=await f.tests.plan(manifest);await finished(f.tests,(await f.tests.run(p.planId)).jobId);await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(f.calls.filter(c=>c.method==='attach').length,2);assert.equal(f.calls.filter(c=>c.method==='detach').length,2);assert.equal(f.closes(),0);assert.equal(f.gate.busy,null);
});

test('native artifact selection requires successful save/reopen and gameplay',()=>{
 assert.throws(()=>testManifestSchema.parse({...manifest,editor:{checks:['compile'],gameArtifact:'native_saved'}}));
 assert.throws(()=>testManifestSchema.parse({version:1,map:'Map.SC2Map',editor:{checks:['save_reopen'],gameArtifact:'native_saved'}}));
});

test('route preflight checks the selected native-saved artifact before launching it',async t=>{
 const f=await fixture(t);await savedArtifact(f);f.setMapInfo(createMapInfo(24,24,'Native changed bounds',6,0));
 const p=await f.tests.plan({...manifest,editor:{checks:['load','save_reopen'],gameArtifact:'native_saved'}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.testedArtifact?.origin,'native_saved');assert.equal(r.outcome,'failed');assert.equal(f.calls.filter(c=>c.method==='attach').length,0);
 assert.match(r.checks.find(c=>c.id==='map.playable_bounds')?.reason??'',/OUTSIDE/);
});
test('terrain load preflight rechecks a native-saved archive instead of transferring source acceptance',async t=>{
 let reads=0;
 const f=await fixture(t,{terrainLoad:async file=>{reads++;return loadResult(!file.endsWith('Final.SC2Map'));}});
 const saved=await savedArtifact(f),p=await f.tests.plan({...manifest,editor:{checks:['save_reopen'],gameArtifact:'native_saved'}});
 assert.equal(p.ready,true);const r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(reads,2);assert.equal(saved.checks(),2);assert.equal(r.outcome,'failed');
 assert.equal(r.checks.find(c=>c.id==='map.terrain_load')?.status,'failed');assert.equal(f.calls.some(c=>c.method==='attach'),false);assert.equal(f.gate.busy,null);
});

test('long native phases expose progress without treating an advisory deadline as completion',async t=>{
 const f=await fixture(t);let active=true;
 f.runtime.editor.job=()=>({state:active?'running':'completed',phase:active?'save_reopen':'finished',startedAt:new Date(Date.now()-65000).toISOString(),deadlineExceeded:active,report:'native.json',result:active?undefined:{outcome:'passed',checks:{}}} as any);
 const p=await f.tests.plan({version:1,map:'Map.SC2Map',editor:{checks:['compile']}}),j=await f.tests.run(p.planId);
 for(let i=0;i<100&&!f.tests.status(j.jobId).nativeProgress;i++)await new Promise(r=>setTimeout(r,2));
 const status=f.tests.status(j.jobId);assert.equal(status.state,'running');assert.equal(status.nativeProgress?.phase,'save_reopen');assert.equal(status.nativeProgress?.deadlineExceeded,true);assert.ok((status.nativeProgress?.elapsedSeconds??0)>=65);
 f.tests.cancel(j.jobId);assert.equal(f.tests.status(j.jobId).state,'running');active=false;await finished(f.tests,j.jobId);
 assert.equal(f.calls.length,0);assert.equal(f.gate.busy,null);
});

async function savedArtifact(f:Awaited<ReturnType<typeof fixture>>,options:{outside?:boolean;foreignWorker?:boolean;compact?:boolean;badHash?:boolean;recheckFails?:boolean}={}){
 const bytes=Buffer.from('native serialized archive'),sha256=createHash('sha256').update(bytes).digest('hex');
 const worker=path.join(f.root,options.compact?'.sc2mcp-output/ne/w/owned':'.sc2mcp-output/native-editor/worker');
 const directory=path.join(options.foreignWorker?path.join(path.dirname(worker),'foreign'):worker,'exports');await fs.mkdir(directory,{recursive:true});await fs.mkdir(worker,{recursive:true});
 const file=path.join(options.outside?f.root:directory,'Native.SC2Map');await fs.writeFile(file,bytes);
 let args:any,checks=0;
 Object.assign(f.runtime.editor,{
  status:async()=>({jobs:[],workerDirectory:worker}),
  check:async(a:any)=>{args=a;checks++;return {id:String(checks)};},
  job:()=>({state:'completed',report:'native.json',result:checks===1?{outcome:'passed',checks:{save_reopen:{nativeSaveVerified:true,nativeReopenVerified:true,componentComparison:{savedToReopenedEqual:true},savedArchive:{path:file,bytes:bytes.length,sha256:options.badHash?'0'.repeat(64):sha256}}}}:{outcome:options.recheckFails?'failed':'passed',sourceSha256:sha256,sourceUnchanged:true,checks:{}}})
 });
 return {sha256,bytes,checks:()=>checks,lastArgs:()=>args};
}

test('native saved archive is copied, revalidated and launched with its own identity',async t=>{
 const f=await fixture(t),saved=await savedArtifact(f),p=await f.tests.plan({...manifest,editor:{checks:['save_reopen'],gameArtifact:'native_saved',scope:'mapRoot',contextLabel:'MAIN',locale:'enUS'}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'passed');assert.equal(saved.checks(),2);assert.deepEqual(saved.lastArgs().checks,['load','compile']);
 assert.equal(saved.lastArgs().scope,'mapRoot');assert.equal(saved.lastArgs().contextLabel,'MAIN');assert.equal(saved.lastArgs().locale,'enUS');
 assert.equal(r.testedArtifact?.sha256,saved.sha256);assert.equal(r.testedArtifact?.origin,'native_saved');assert.match(f.calls.find(c=>c.method==='attach')?.args.map,/Final.SC2Map$/);
 assert.equal(await fs.readFile(path.join(f.root,'Map.SC2Map'),'utf8'),'saved map');
 await fs.writeFile(r.testedArtifact!.file,'tampered');assert.equal((await f.tests.report(r.jobId)).evidenceValidForCurrentInputs,false);
});

test('native artifact selection follows the retained bridge compact worker identity',async t=>{
 const f=await fixture(t),saved=await savedArtifact(f,{compact:true});
 const p=await f.tests.plan({...manifest,editor:{checks:['save_reopen'],gameArtifact:'native_saved'}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
 assert.equal(r.outcome,'passed');assert.equal(saved.checks(),2);assert.equal(r.testedArtifact?.sha256,saved.sha256);
});

for(const [name,options] of [['foreign output',{outside:true}],['another worker output',{foreignWorker:true,compact:true}],['incorrect digest',{badHash:true}],['failed exact-artifact revalidation',{recheckFails:true}]] as const){
 test('native artifact rejects '+name+' before game launch',async t=>{
  const f=await fixture(t);await savedArtifact(f,options);
  const p=await f.tests.plan({...manifest,editor:{checks:['save_reopen'],gameArtifact:'native_saved'}}),r=await finished(f.tests,(await f.tests.run(p.planId)).jobId);
  assert.equal(r.outcome,'failed');assert.ok(!f.calls.some(c=>c.method==='attach'));assert.equal(f.gate.busy,null);
 });
}
