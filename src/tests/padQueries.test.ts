import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {padSchema,padProbeSchema,padQuerySource,decodePadChannel,type PadChannel} from '../modules/testing/padQueries.js';
import {testManifestSchema} from '../modules/testing/schemas.js';
import {preparePadProbe} from '../modules/testing/padPreparation.js';
import {packArchive,extractArchive,archiveBackendAvailable} from '../archive/archiveAdapter.js';
import {observePadQueries} from '../modules/testing/padChecks.js';
import {ProjectTestWorkspace} from '../modules/testing/workspace.js';
import {Workspace} from '../core/workspace.js';
import {NativeWorkflowGate} from '../modules/testing/gate.js';
import {createMapInfo} from '../modules/document/codecs/mapInfoFactory.js';
import {routeBoundsCheck} from '../modules/testing/playableBounds.js';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function channel():PadChannel{const prefix='MCPPad0123456789abcdef';return{version:2,prefix,unitType:prefix+'Carrier',init:prefix+'_Init',queryScript:`Scripts/${prefix}.galaxy`,slots:5,pads:[padSchema.parse({id:'clear',at:'clear',type:'SupplyDepot'}),padSchema.parse({id:'blocked',at:'occupied',type:'SupplyDepot',expected:'blocked'})],points:{clear:{x:32,y:44},occupied:{x:32,y:32},origin:{x:8,y:8}},probe:padProbeSchema.parse({origin:'origin'})};}
function packet(c:PadChannel){return{truncated:false,units:Array.from({length:c.slots},(_,slot)=>({id:'unit'+slot,type:c.unitType,owner:0,valid:true,alive:true,invulnerable:true,life:2*slot+(slot===4?1:2),energy:slot===2?32:1000,shields:slot===2?44:1000,position:{x:100+slot,y:2}}))};}
test('pad manifest requires named exact native points and explicit mask overrides',()=>{
 const c=channel(),base={version:1,map:'A.SC2Map',game:{points:c.points,pads:c.pads,padProbe:c.probe}};
 assert.equal(testManifestSchema.parse(base).game!.pads.length,2);
 for(const game of [{points:c.points,pads:c.pads},{points:c.points,pads:c.pads,padProbe:{origin:'missing'}},{points:{...c.points,clear:{x:32.1,y:44}},pads:c.pads,padProbe:c.probe},{points:c.points,pads:[{id:'one',at:'clear',type:'Gateway',tests:0}],padProbe:c.probe}])assert.equal(testManifestSchema.safeParse({...base,game}).success,false);
 assert.equal(padSchema.parse({id:'one',at:'clear',type:'Gateway',tests:0,overrideReason:'Isolated mask counterexample'}).tests,0);
 assert.equal(padSchema.safeParse({id:'one',at:'clear',type:'Gateway',range:.1}).success,false);
});
test('private pad source preserves default predicates and collects before emitting any result unit',()=>{
 const c=channel(),source=padQuerySource(c);assert.ok(source.includes('UnitTypePlacementFromPoint("SupplyDepot", 1, Point(32.0, 44.0), 0.0)'));assert.equal(source.includes('UnitTypePlacementTestsFromPoint'),false);
 assert.ok(source.includes(`bool[${c.slots}] ${c.prefix}_flags;`),'Galaxy array dimensions follow the type');assert.ok(source.includes(`point[${c.slots}] ${c.prefix}_points;`));assert.doesNotMatch(source,/^(?:bool|point)\s+\w+\[\d+\];/m,'C-style array declarations fail the original game compiler');
 const collect=source.slice(source.indexOf('bool '+c.prefix+'_Collect'));assert.ok(collect.lastIndexOf('UnitTypePlacementFromPoint')<collect.indexOf(c.prefix+'_Emit(slot)'));
 c.pads[0]=padSchema.parse({...c.pads[0],tests:0,overrideReason:'Explicit isolated test'});assert.ok(padQuerySource(c).includes('UnitTypePlacementTestsFromPoint("SupplyDepot", 1, Point(32.0, 44.0), 0.0, 0)'));
 assert.throws(()=>padQuerySource({...c,init:'Other'}),/IDENTITY/);
});

test('placement and private probe anchors use the original playable interval',()=>{
 const c=channel(),bytes=createMapInfo(64,64,'Pad bounds',6,0),manifest=()=>testManifestSchema.parse({version:1,map:'A.SC2Map',game:{points:c.points,pads:c.pads,padProbe:c.probe}});
 assert.equal(routeBoundsCheck(manifest(),bytes).status,'passed');
 c.points.origin={x:56,y:8};let result=routeBoundsCheck(manifest(),bytes);assert.equal(result.status,'failed');assert.deepEqual(result.evidence?.outside,['origin']);assert.match(result.reason!,/TEST_POINT_OUTSIDE/);
 c.points.origin={x:8,y:8};c.points.clear={x:8,y:56};result=routeBoundsCheck(manifest(),bytes);assert.equal(result.status,'failed');assert.deepEqual(result.evidence?.outside,['clear']);
});
test('pad decoder uses exact slots, retains snapping and ignores unused null-point channels',()=>{
 const c=channel(),body=packet(c);body.units.reverse();let values=decodePadChannel(c,body);assert.ok(values.every(v=>v.matched));assert.equal(values[1].candidate,null);
 const candidate=body.units.find(u=>u.life===6)!;candidate.energy=32.5;values=decodePadChannel(c,body);assert.equal(values[0].matched,false);assert.equal(values[0].exact,false);assert.equal(values[0].offset,.5);
 c.pads[0]=padSchema.parse({...c.pads[0],expected:'candidate',maxOffset:.5});assert.equal(decodePadChannel(c,body)[0].matched,true);
 body.units.find(u=>u.life===8)!.life=7;const invalid=decodePadChannel(c,body)[1];assert.equal(invalid.catalogValid,false);assert.equal(invalid.matched,false,'An invalid catalog is not a proven blocked pad');
});
test('ambiguous pages, duplicate identities/slots and invalid native candidate coordinates refuse decoding',()=>{
 const c=channel();for(const mutate of [(p:any)=>p.truncated=true,(p:any)=>p.units.pop(),(p:any)=>p.units[1].id=p.units[0].id,(p:any)=>p.units[1].life=p.units[0].life,(p:any)=>p.units[2].energy=1000,(p:any)=>p.units[2].energy=32.1,(p:any)=>p.units[0].owner=1]){const p=packet(c);mutate(p);assert.throws(()=>decodePadChannel(c,p));}
});
test('private probe preparation reuses Data/Script transactions and preserves unrelated archive payloads',{skip:!archiveBackendAvailable()},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-pad-prepare-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'Source');await fs.mkdir(source);
 const entry='include "TriggerLibs/NativeLib"\nvoid Existing () { }\nvoid InitMap () {\n    Existing();\n}\n';await fs.writeFile(path.join(source,'MapScript.galaxy'),entry);await fs.writeFile(path.join(source,'ComponentList.SC2Components'),'<Components/>');await fs.writeFile(path.join(source,'Objects'),'<PlacedObjects version="27"/>');
 const archive=path.join(root,'Source.SC2Map');await packArchive(source,archive,{backup:false});const sourceSha256=sha(await fs.readFile(archive)),c=channel(),directory=path.join(root,'Job');await fs.mkdir(directory);
 const prepared=await preparePadProbe({source:archive,sourceSha256,directory,pads:c.pads,points:c.points,probe:c.probe});assert.equal(sha(await fs.readFile(archive)),sourceSha256);assert.equal(prepared.sourceSha256,sourceSha256);assert.equal(prepared.channel.version,2);
 const output=path.join(root,'Readback');await extractArchive(prepared.archive,output);assert.equal(await fs.readFile(path.join(output,'Objects'),'utf8'),'<PlacedObjects version="27"/>');const script=await fs.readFile(path.join(output,'MapScript.galaxy'),'utf8');assert.ok(script.includes('    Existing();'));assert.ok(script.includes(prepared.channel.init+'();'));assert.ok((await fs.readFile(path.join(output,'Base.SC2Data/GameData.xml'),'utf8')).includes(prepared.channel.prefix+'.xml'));
 await assert.rejects(preparePadProbe({source:archive,sourceSha256:'0'.repeat(64),directory:path.join(root,'Stale'),pads:c.pads,points:c.points,probe:c.probe}),/SOURCE_STALE/);
 const insufficient=path.join(root,'Low');await fs.mkdir(insufficient);await assert.rejects(preparePadProbe({source:archive,sourceSha256,directory:insufficient,pads:c.pads,points:c.points,probe:c.probe,storageProbe:async()=>({volume:'v',directory:insufficient,availableBytes:0})}),/STORAGE_INSUFFICIENT/);assert.deepEqual(await fs.readdir(insufficient),[]);
});

test('pad observation retains native expectations while late and unconfirmed reads remain inconclusive',async()=>{
 const c=channel(),body=packet(c),host={call:async()=>({content:[],structuredContent:body}),body:(r:any)=>r.structuredContent,state:()=> 'passed' as const,record:async()=> 'private-page.json',checkCancel:()=>{}};
 const passed=await observePadQueries(c,host);assert.equal(passed.complete,true);assert.ok(passed.checks.every(c=>c.status==='passed'));
 const missing=await observePadQueries(c,{...host,state:()=> 'unsupported' as const});assert.ok(missing.checks.every(c=>c.status==='unsupported'));
 c.probe.timeout=1;const late=await observePadQueries(c,{...host,call:async()=>{await new Promise(r=>setTimeout(r,1050));return {content:[],structuredContent:body};}});assert.equal(late.complete,false);assert.ok(late.checks.every(c=>c.status==='inconclusive'&&c.reason==='PAD_OBSERVATION_DEADLINE_EXCEEDED'));
});

test('pad-only and combined suites close the probe before ordinary gameplay and retain original artifact identity',{skip:!archiveBackendAvailable()},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-pad-suite-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const components=path.join(root,'Source');await fs.mkdir(components);await fs.writeFile(path.join(components,'MapScript.galaxy'),'include "TriggerLibs/NativeLib"\nvoid InitMap () {}\n');await fs.writeFile(path.join(components,'ComponentList.SC2Components'),'<Components/>');const map=path.join(root,'Map.SC2Map');await packArchive(components,map,{backup:false});const original=sha(await fs.readFile(map)),calls:string[]=[];let current:PadChannel|undefined;
 const body=(v:Record<string,unknown>)=>({content:[],structuredContent:{status:'ok',...v}});
 const game={configuration:()=>({configured:true,launchEnabled:true}),status:async()=>({source:null}),attach:async(file:string)=>{calls.push(file.endsWith('PadProbe.SC2Map')?'probe-attach':'main-attach');current=file.endsWith('PadProbe.SC2Map')?JSON.parse(await fs.readFile(path.join(root,path.dirname(file),'PadProbe.json'),'utf8')).channel:undefined;return body({mapConfirmed:true,hidden:true});},call:async(method:string)=>{calls.push(method);if(method==='game.units.find')return body(packet(current!));if(method==='game.status')return body({versionSupport:{observedVersion:'5.0.17.98310'}});return body({});},detach:async()=>{calls.push('detach');return {stopped:true,sourceUnchanged:true};}};
 const runtime={game,editor:{status:async()=>({jobs:[]})}} as any;
 const workspace=new ProjectTestWorkspace(new Workspace(root),{runtime,gate:new NativeWorkflowGate(),inspect:async()=>({}),mapInfo:async()=>createMapInfo(64,64,'Pad bounds',6,0),pollMs:1});t.after(()=>workspace.close());
 for(const combined of [false,true]){
  calls.length=0;const c=channel(),plan=await workspace.plan({version:1,map:'Map.SC2Map',expectedGameBuild:'5.0.17.98310',game:{points:c.points,pads:c.pads,padProbe:c.probe,capture:false,launchDiagnostics:false,...(combined?{scenarios:[{id:'ordinary',steps:[{method:'game.status'}]}]}:{})}});assert.equal(plan.ready,true);
  let job=await workspace.run(plan.planId);for(let i=0;i<2000&&job.state!=='completed';i++){await new Promise(r=>setTimeout(r,5));job=workspace.status(job.jobId);}assert.equal(job.state,'completed');assert.equal(job.outcome,'passed',JSON.stringify(job));assert.equal(job.testedArtifact!.sha256,original);assert.equal(job.testedArtifact!.origin,'source');assert.equal(sha(await fs.readFile(map)),original);
  assert.equal(calls[0],'probe-attach');assert.equal(calls.filter(c=>c==='detach').length,combined?2:1);assert.equal(calls.filter(c=>c==='main-attach').length,combined?1:0);if(combined)assert.ok(calls.indexOf('detach')<calls.indexOf('main-attach'));
 }
});
