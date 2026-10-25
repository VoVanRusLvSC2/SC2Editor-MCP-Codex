import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {Workspace} from '../core/workspace.js';
import {TerrainWorkspace} from '../modules/terrain/workspace.js';
import {BrowseWorkspace} from '../modules/browse/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {PlacementWorkspace} from '../modules/placement/workspace.js';
import {PlacementDocument} from '../modules/placement/document.js';
import {LandscapeTouches,restoreLandscapePatch,landscapeOrder,landscapeIntentSchema} from '../modules/terrain/landscapeOwnership.js';

async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-owned-landscape-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of await fs.readdir('src/tests/fixtures/terrain-native/nydus'))await fs.writeFile(path.join(root,name.slice(0,-3)),gunzipSync(await fs.readFile(path.join('src/tests/fixtures/terrain-native/nydus',name))));
 await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
 const workspace=new Workspace(root),browse=new BrowseWorkspace(workspace,new DataWorkspace(workspace)),placement=new PlacementWorkspace(workspace,browse),terrain=new TerrainWorkspace(workspace,browse,placement);placement.terrain=terrain;
 const ledger=async()=>JSON.parse(await fs.readFile(path.join(root,'.sc2mcp/locations.json'),'utf8'));
 const apply=async(input:Parameters<TerrainWorkspace['ownedLandscape']>[0])=>{const plan=await terrain.ownedLandscape(input);assert.equal(plan.valid,true);await terrain.apply(plan.id,{dryRun:false,stage:true,backup:false});await terrain.savePlan(plan.id,{dryRun:false,backup:false});return plan;};
 return {root,workspace,placement,terrain,ledger,apply};
}
const zone=(id:string,minX=4,minY=4,maxX=14,maxY=14)=>({id,config:{locationType:'forest' as const,area:{type:'rectangle' as const,minX,minY,maxX,maxY,z:0},objectCount:4,minimumDistance:1,seed:42,terrain:{style:'forest' as const,relief:.3,edgeBlend:0,materials:{base:'BelShirDirtLight'}}}});
const group=(id='gate',x=10,y=10)=>({id,anchor:{x,y},maxSlope:100,members:[{id:'AgriaTree',offset:{x:0,y:0},heightOffset:.4,boundsFrame:'member' as const,horizontalBounds:{minX:-.2,maxX:.2,minY:-.2,maxY:.2}}]});

const decorZone=(id:string,x:number,y:number)=>({id,config:{locationType:'custom' as const,area:{type:'rectangle' as const,minX:x-2,minY:y-2,maxX:x+2,maxY:y+2,z:0},objectCount:0,terrain:{style:'forest' as const,heightMode:'preserve' as const,textureMode:'preserve' as const},groups:[group(id+'Marker',x,y)]}});
const routeManifest=(y=10,label='Landscape reservations')=>({version:1,map:'Future.SC2Map',label,game:{points:{a:{x:3,y},b:{x:17,y}},routes:[{id:'lane',from:'a',to:'b',type:'Marine',mobility:'ground',maxDeviation:20}]}});
const padManifest=(x=10,y=10,label='Pad reservations')=>({version:1,map:'Future.SC2Map',label,game:{points:{pad:{x,y},probe:{x:3,y:3}},pads:[{id:'base',at:'pad',type:'SupplyDepot'}],padProbe:{origin:'probe'},capture:false}});
const padSource={file:'pads.json',pads:[{id:'base',clearWidth:4,clearHeight:4}]};

test('pad reservations resolve selected exact checks and explicit dimensions without guessing native footprints',async t=>{
 const f=await fixture(t),file=path.join(f.root,'pads.json'),{resolveLandscapePadSource,padReservationAreas,addedPadReservations}=await import('../modules/terrain/landscapePadSource.js');
 const text=JSON.stringify(padManifest());await fs.writeFile(file,text);const resolved=await resolveLandscapePadSource(f.workspace,padSource);
 assert.equal(resolved.binding.sha256,createHash('sha256').update(text).digest('hex'));assert.equal(resolved.manifestMap,'Future.SC2Map');assert.deepEqual(resolved.binding.reservations,[{id:'base',type:'SupplyDepot',owner:1,area:{type:'rectangle',minX:8,maxX:12,minY:8,maxY:12}}]);
 const areas=padReservationAreas(resolved.binding);assert.deepEqual(addedPadReservations(areas,[{type:'rectangle',minX:9,maxX:11,minY:9,maxY:11}]),[]);assert.equal(addedPadReservations(areas,[{...areas[0],maxX:13}]).length,1);
 for(const expected of ['blocked','candidate']){const input=padManifest();await fs.writeFile(file,JSON.stringify({...input,game:{...input.game,pads:[{...input.game.pads[0],expected}]}}));await assert.rejects(resolveLandscapePadSource(f.workspace,padSource),/EXACT_EXPECTATION_REQUIRED/);}
 await fs.writeFile(file,text);await assert.rejects(resolveLandscapePadSource(f.workspace,{...padSource,pads:[{...padSource.pads[0],id:'absent'}]}),/CHECK_REQUIRED/);
 for(const pads of [[padSource.pads[0],padSource.pads[0]],[{...padSource.pads[0],clearWidth:0}],[{id:'base'}]])assert.equal(landscapeIntentSchema.safeParse({zones:[decorZone('camp',15,15)],padSource:{file:'pads.json',pads}}).success,false);
 assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('pad reservations check measured edges and are inherited across no-op and fresh workspace plans',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'pads.json'),JSON.stringify(padManifest()));
 const edge=decorZone('edge',12.15,10),clear=decorZone('clear',15,15),before=await fs.readFile(path.join(f.root,'Objects'));
 await assert.rejects(f.terrain.ownedLandscape({zones:[edge],padSource}),/IN_EXCLUSION/);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),before);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const p=await f.apply({zones:[clear],padSource});assert.equal(p.ownership.padSource?.reservations.length,1);assert.equal(p.ownership.padSource?.mapIdentity,'not_verified');assert.equal(p.ownership.padSource?.disabled,false);
 const first=await fs.readFile(path.join(f.root,'Objects'));for(const terrain of [f.terrain,new TerrainWorkspace(f.workspace,f.placement.browse,f.placement)]){const repeated=await terrain.ownedLandscape({zones:[clear],padSource:undefined});assert.equal(repeated.ownership.rebuilt.length,0);assert.ok(repeated.files.every(file=>file.changedBytes===0));}
 assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),first);
});

test('new pad bindings preserve surface bytes and reject conflicts with independent measured groups at actual transforms',async t=>{
 const f=await fixture(t),west=decorZone('west',10,10),east=decorZone('east',25,25),manual=decorZone('manual',18,18);await f.apply({zones:[west,east,manual]});
 const state=await f.terrain.state(),surface=new Map([...state.sources].map(([file,b])=>[file,Buffer.from(b)])),objectsFile=path.join(f.root,'Objects'),ledger=await f.ledger(),manualRecord=ledger.zones.find((z:any)=>z.id==='manual'),manualId=manualRecord.objects[0].id,doc=new PlacementDocument(await fs.readFile(objectsFile,'utf8'));
 doc.rotate(manualId,.37);doc.scale(manualId,{x:1.3,y:.7,z:1});await fs.writeFile(objectsFile,doc.source);const edited=doc.list().find(o=>o.id===manualId)!;
 await fs.writeFile(path.join(f.root,'pads.json'),JSON.stringify(padManifest(25,25)));await assert.rejects(f.terrain.ownedLandscape({zones:[west],padSource}),/PAD_SOURCE_CONFLICT: include east/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const reviewed={...east,config:{...east.config,area:{...east.config.area,maxY:30},groups:[group('eastMarker',25,27.5)]}},p=await f.apply({zones:[west,reviewed],padSource});assert.deepEqual(p.ownership.rebuilt.map(z=>z.id),['east']);
 const after=new PlacementDocument(await fs.readFile(objectsFile,'utf8')).list().find(o=>o.id===manualId)!;assert.deepEqual({...after,nodeId:undefined},{...edited,nodeId:undefined});assert.deepEqual((await f.ledger()).zones.find((z:any)=>z.id==='manual'),manualRecord);
 const afterState=await f.terrain.state();for(const [file,b]of surface)assert.deepEqual(afterState.sources.get(file),b,'Pad reservation must not paint/flatten: '+file);
});

test('reviewed scatter escapes a new pad while retaining IDs and unrelated zones',async t=>{
 const f=await fixture(t),base=zone('trees',20,20,28,28),trees={...base,config:{...base.config,terrain:{style:'forest' as const,heightMode:'preserve' as const,textureMode:'preserve' as const}}},other=decorZone('other',10,24),file=path.join(f.root,'pads.json');
 await fs.writeFile(file,JSON.stringify(padManifest(10,10)));await f.apply({zones:[trees,other],padSource});const old=await f.ledger(),ids=old.zones.find((z:any)=>z.id==='trees').objects.map((o:any)=>o.id),doc=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8')),first=doc.list().find(o=>o.id===ids[0])!,[x,y]=first.position!.split(',').map(Number),cx=Math.round(x*4096)/4096,cy=Math.round(y*4096)/4096;
 await fs.writeFile(file,JSON.stringify(padManifest(cx,cy)));await assert.rejects(f.terrain.ownedLandscape({zones:[other]}),/PAD_SOURCE_CONFLICT: include trees/);
 const p=await f.apply({zones:[trees]});assert.deepEqual(p.ownership.rebuilt.map(z=>z.id),['trees']);assert.equal(p.ownership.rebuilt[0].reusedObjectIds,4);const next=await f.ledger();assert.deepEqual(next.zones.find((z:any)=>z.id==='trees').objects.map((o:any)=>o.id),ids);assert.deepEqual(next.zones.find((z:any)=>z.id==='other'),old.zones.find((z:any)=>z.id==='other'));
 const current=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8')).list();for(const id of ids){const [px,py]=current.find(o=>o.id===id)!.position!.split(',').map(Number);assert.ok(Math.abs(px-cx)>2||Math.abs(py-cy)>2);}
});

test('pad metadata changes remain guarded through apply and staged save, with explicit null removal',async t=>{
 const f=await fixture(t),file=path.join(f.root,'pads.json'),camp=decorZone('camp',15,15);await fs.writeFile(file,JSON.stringify(padManifest()));await f.apply({zones:[camp],padSource});const beforeObjects=await fs.readFile(path.join(f.root,'Objects')),beforeLedger=await fs.readFile(path.join(f.root,'.sc2mcp/locations.json'));
 await fs.writeFile(file,JSON.stringify(padManifest(10,10,'B')));const p=await f.terrain.ownedLandscape({zones:[camp]});assert.equal(p.ownership.rebuilt.length,0);assert.equal(p.ownership.padSource?.metadataOnly,true);assert.ok(p.files.filter(f=>f.changedBytes).every(f=>f.file==='.sc2mcp/locations.json'));
 await fs.writeFile(file,JSON.stringify(padManifest(10,10,'C')));await assert.rejects(f.terrain.apply(p.id,{dryRun:false,stage:true}),/STALE_LANDSCAPE_PAD_SOURCE/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const fresh=await f.terrain.ownedLandscape({zones:[camp]}),staged=await f.terrain.apply(fresh.id,{dryRun:false,stage:true});await fs.writeFile(file,JSON.stringify(padManifest(10,10,'D')));await assert.rejects(f.workspace.binary.saveContaining('.sc2mcp/locations.json',{dryRun:false,backup:false}),/STALE_LANDSCAPE_PAD_SOURCE/);await assert.rejects(f.terrain.savePlan(fresh.id,{dryRun:false,backup:false}),/STALE_LANDSCAPE_PAD_SOURCE/);
 assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),beforeObjects);assert.deepEqual(await fs.readFile(path.join(f.root,'.sc2mcp/locations.json')),beforeLedger);await f.terrain.rollback(staged.transactionId!,false);
 await fs.unlink(file);await assert.rejects(f.terrain.ownedLandscape({zones:[camp]}),/PLAN_FILE_MISSING/);const removed=await f.apply({zones:[camp],padSource:null});assert.equal(removed.ownership.padSource?.disabled,true);assert.equal((await f.ledger()).padSource,undefined);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),beforeObjects);
});

test('pad clearance must fit the full terrain rectangle, including corners beyond a valid anchor',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'pads.json'),JSON.stringify(padManifest(.5,10)));await assert.rejects(f.terrain.ownedLandscape({zones:[decorZone('camp',15,15)],padSource}),/PAD_SOURCE_OUTSIDE_TERRAIN/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('pad review uses an unselected group actual manual transform and refuses a changed measured model',async t=>{
 const f=await fixture(t),moved=decorZone('moved',10,10),other=decorZone('other',25,25);await f.apply({zones:[moved,other]});const file=path.join(f.root,'Objects'),id=(await f.ledger()).zones.find((z:any)=>z.id==='moved').objects[0].id,doc=new PlacementDocument(await fs.readFile(file,'utf8'));
 doc.moveMany([{objectId:id,position:{x:16,y:16,z:9}}]);doc.rotate(id,.6);doc.scale(id,{x:1.4,y:.7,z:1});await fs.writeFile(file,doc.source);const before=await fs.readFile(file);
 await fs.writeFile(path.join(f.root,'pads.json'),JSON.stringify(padManifest()));const adopted=await f.apply({zones:[other],padSource});assert.equal(adopted.ownership.rebuilt.length,0);assert.deepEqual(await fs.readFile(file),before);
 await fs.writeFile(path.join(f.root,'pads.json'),JSON.stringify(padManifest(16,16)));await assert.rejects(f.terrain.ownedLandscape({zones:[other]}),/PAD_SOURCE_CONFLICT: include moved/);assert.deepEqual(await fs.readFile(file),before);
 const changed=new PlacementDocument(await fs.readFile(file,'utf8'));changed.setVariations([{objectId:id,variation:1}]);await fs.writeFile(file,changed.source);await assert.rejects(f.terrain.ownedLandscape({zones:[other]}),/MANUAL_MODEL_REVIEW/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('route source deduplicates reverse paths, keeps blocked routes blocked and reserves each formation member',async t=>{
 const f=await fixture(t),manifest=routeManifest(),file=path.join(f.root,'acceptance.json');
 manifest.game.routes.push({id:'reverse',from:'b',to:'a',type:'Marauder',mobility:'ground',maxDeviation:2});
 const input={...manifest,game:{...manifest.game,routes:[...manifest.game.routes,{...manifest.game.routes[0],id:'obstruction',expected:'blocked'}],formations:[{id:'pair',from:'a',to:'b',type:'Marine',mobility:'ground',offsets:[{x:0,y:4},{x:0,y:6}]}]}};
 const text=JSON.stringify(input);await fs.writeFile(file,text);
 const {resolveLandscapeRouteSource}=await import('../modules/terrain/landscapeRouteSource.js');
 const resolved=await resolveLandscapeRouteSource(f.workspace,{file:'acceptance.json',clearWidth:2});
 assert.equal(resolved.binding.corridors.length,3);assert.ok(resolved.binding.corridors.every(route=>route.width===2));assert.deepEqual(resolved.binding.blockedRouteIds,['obstruction']);
 assert.deepEqual(new Set(resolved.binding.corridors.map(route=>route.points[0].y)),new Set([10,14,16]));
 assert.equal(resolved.binding.sha256,createHash('sha256').update(text).digest('hex'));assert.equal(await fs.readFile(file,'utf8'),text);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('bound positive routes reject measured props before staging and allow an explicitly clear layout',async t=>{
 const f=await fixture(t),file=path.join(f.root,'acceptance.json');await fs.writeFile(file,JSON.stringify(routeManifest()));
 const before=await fs.readFile(path.join(f.root,'Objects')),blocked=decorZone('camp',10,10),routeSource={file:'acceptance.json',clearWidth:2};
 assert.equal((await f.terrain.ownedLandscape({zones:[blocked]})).valid,true);
 await assert.rejects(f.terrain.ownedLandscape({zones:[blocked],routeSource}),/RESERVED_ROUTE/);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),before);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const clear=decorZone('camp',10,14),plan=await f.apply({zones:[clear],routeSource});assert.equal(plan.ownership.routeSource?.corridors,1);
 const ledger=await f.ledger();assert.equal(ledger.routeSource.clearWidth,2);assert.equal(ledger.routeSource.corridors[0].width,2);
 const first=await fs.readFile(path.join(f.root,'Objects')),again=await f.terrain.ownedLandscape({zones:[clear]});assert.equal(again.ownership.rebuilt.length,0);assert.ok(again.files.every(file=>file.changedBytes===0));assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),first);
 const explicitUndefined=await f.terrain.ownedLandscape({zones:[clear],routeSource:undefined});assert.equal(explicitUndefined.ownership.routeSource?.disabled,false);assert.ok(explicitUndefined.files.every(file=>file.changedBytes===0));
});

test('route metadata refresh preserves objects and stale manifests block both apply and staged save',async t=>{
 const f=await fixture(t),file=path.join(f.root,'acceptance.json'),camp=decorZone('camp',10,14);await fs.writeFile(file,JSON.stringify(routeManifest()));
 await f.apply({zones:[camp],routeSource:{file:'acceptance.json',clearWidth:2}});
 const beforeObjects=await fs.readFile(path.join(f.root,'Objects')),beforeLedger=await fs.readFile(path.join(f.root,'.sc2mcp/locations.json'));
 await fs.writeFile(file,JSON.stringify(routeManifest(10,'Metadata B')));const p=await f.terrain.ownedLandscape({zones:[camp]});assert.equal(p.ownership.rebuilt.length,0);assert.equal(p.ownership.routeSource?.metadataOnly,true);assert.ok(p.files.filter(file=>file.changedBytes).every(file=>file.file==='.sc2mcp/locations.json'));
 await fs.writeFile(file,JSON.stringify(routeManifest(10,'Metadata C')));await assert.rejects(f.terrain.apply(p.id,{dryRun:false,stage:true}),/STALE_LANDSCAPE_ROUTE_SOURCE/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const fresh=await f.terrain.ownedLandscape({zones:[camp]});assert.notEqual(fresh.id,p.id);const staged=await f.terrain.apply(fresh.id,{dryRun:false,stage:true});assert.ok(staged.transactionId);
 await fs.writeFile(file,JSON.stringify(routeManifest(10,'Metadata D')));await assert.rejects(f.workspace.binary.saveContaining('.sc2mcp/locations.json',{dryRun:false,backup:false}),/STALE_LANDSCAPE_ROUTE_SOURCE/);await assert.rejects(f.terrain.savePlan(fresh.id,{dryRun:false,backup:false}),/STALE_LANDSCAPE_ROUTE_SOURCE/);
 assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),beforeObjects);assert.deepEqual(await fs.readFile(path.join(f.root,'.sc2mcp/locations.json')),beforeLedger);
 await f.terrain.rollback(staged.transactionId!,false);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const accepted=await f.apply({zones:[camp]});assert.equal(accepted.ownership.rebuilt.length,0);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),beforeObjects);assert.notDeepEqual(await fs.readFile(path.join(f.root,'.sc2mcp/locations.json')),beforeLedger);
});

test('changed route sources require review of a conflicting independent zone and preserve unrelated manual transforms',async t=>{
 const f=await fixture(t),file=path.join(f.root,'acceptance.json'),west=decorZone('west',8,8),east=decorZone('east',25,25),manual=decorZone('manual',18,18);
 await fs.writeFile(file,JSON.stringify(routeManifest(12)));await f.apply({zones:[west,east,manual],routeSource:{file:'acceptance.json',clearWidth:1.5}});
 const ledger=await f.ledger(),manualRecord=ledger.zones.find((zone:any)=>zone.id==='manual'),id=manualRecord.objects[0].id,objectsFile=path.join(f.root,'Objects'),document=new PlacementDocument(await fs.readFile(objectsFile,'utf8'));
 document.rotate(id,.37);document.scale(id,{x:1.3,y:.7,z:1});await fs.writeFile(objectsFile,document.source);const edited=document.list().find(object=>object.id===id)!;
 const changed=routeManifest(25);changed.game.points={a:{x:21,y:25},b:{x:29,y:25}};await fs.writeFile(file,JSON.stringify(changed));
 await assert.rejects(f.terrain.ownedLandscape({zones:[west]}),/LANDSCAPE_ROUTE_SOURCE_CONFLICT: include east/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const reviewed={...east,config:{...east.config,groups:[group('eastMarker',25,26.5)]}},p=await f.apply({zones:[west,reviewed]});assert.deepEqual(p.ownership.rebuilt.map(zone=>zone.id),['east']);
 const after=new PlacementDocument(await fs.readFile(objectsFile,'utf8')).list().find(object=>object.id===id)!;assert.deepEqual({...after,nodeId:undefined},{...edited,nodeId:undefined});assert.deepEqual((await f.ledger()).zones.find((zone:any)=>zone.id==='manual'),manualRecord);
});

test('a reviewed scatter zone reuses IDs while moving centers out of a newly reserved corridor',async t=>{
 const f=await fixture(t),file=path.join(f.root,'acceptance.json'),base=zone('trees',20,20,28,28),trees={...base,config:{...base.config,terrain:{style:'forest' as const,heightMode:'preserve' as const,textureMode:'preserve' as const}}};
 await fs.writeFile(file,JSON.stringify(routeManifest(3)));await f.apply({zones:[trees],routeSource:{file:'acceptance.json',clearWidth:1}});
 const before=await f.ledger(),ids=before.zones[0].objects.map((object:any)=>object.id),objectsFile=path.join(f.root,'Objects'),first=new PlacementDocument(await fs.readFile(objectsFile,'utf8')).list().find(object=>object.id===ids[0])!;
 const y=Number(first.position!.split(',')[1]),changed=routeManifest(y);changed.game.points={a:{x:19,y},b:{x:29,y}};await fs.writeFile(file,JSON.stringify(changed));
 const p=await f.apply({zones:[trees]});assert.deepEqual(p.ownership.rebuilt.map(zone=>zone.id),['trees']);assert.equal(p.ownership.rebuilt[0].reusedObjectIds,4);
 assert.deepEqual((await f.ledger()).zones[0].objects.map((object:any)=>object.id),ids);
 const current=new PlacementDocument(await fs.readFile(objectsFile,'utf8')).list();for(const id of ids)assert.ok(Math.abs(Number(current.find(object=>object.id===id)!.position!.split(',')[1])-y)>.5);
});

test('missing or out-of-terrain route sources reject without mutation, and explicit null removes only the binding',async t=>{
 const f=await fixture(t),file=path.join(f.root,'acceptance.json'),camp=decorZone('camp',10,14);await fs.writeFile(file,JSON.stringify(routeManifest()));
 await f.apply({zones:[camp],routeSource:{file:'acceptance.json',clearWidth:2}});const before=await fs.readFile(path.join(f.root,'Objects'));
 await fs.unlink(file);await assert.rejects(f.terrain.ownedLandscape({zones:[camp]}),/PLAN_FILE_MISSING/);
 await fs.writeFile(file,JSON.stringify(routeManifest(200)));await assert.rejects(f.terrain.ownedLandscape({zones:[camp]}),/OUTSIDE_TERRAIN/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 await fs.unlink(file);const cleared=await f.apply({zones:[camp],routeSource:null});assert.equal(cleared.ownership.routeSource?.disabled,true);assert.equal((await f.ledger()).routeSource,undefined);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),before);
 const repeated=await f.terrain.ownedLandscape({zones:[camp]});assert.ok(repeated.files.every(file=>file.changedBytes===0));
});

test('route source refuses empty/oversized corridor sets and inherited prototype endpoints',async t=>{
 const f=await fixture(t),file=path.join(f.root,'acceptance.json'),{resolveLandscapeRouteSource}=await import('../modules/terrain/landscapeRouteSource.js');
 const resolve=()=>resolveLandscapeRouteSource(f.workspace,{file:'acceptance.json',clearWidth:2});
 await fs.writeFile(file,JSON.stringify({version:1,map:'Future.SC2Map',game:{}}));await assert.rejects(resolve(),/ROUTE_SOURCE_EMPTY/);
 const base=routeManifest();await fs.writeFile(file,JSON.stringify({...base,game:{...base.game,routes:[{...base.game.routes[0],from:'constructor'}]}}));await assert.rejects(resolve(),/ROUTE_SOURCE_ENDPOINT_REQUIRED/);
 const formations=Array.from({length:8},(_,index)=>({id:'team'+index,from:'a',to:'b',type:'Marine',mobility:'ground',offsets:Array.from({length:8},(_,member)=>({x:member/10,y:index*8+member+1}))}));
 await fs.writeFile(file,JSON.stringify({...base,game:{points:base.game.points,formations}}));await assert.rejects(resolve(),/ROUTE_SOURCE_LIMIT/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('owned target-height clearing resnaps its measured group and preserves another zone through reconnect',async t=>{
 const f=await fixture(t),area={type:'polygon' as const,points:[{x:3,y:3},{x:19,y:4},{x:21,y:12},{x:17,y:20},{x:5,y:18}],z:0};
 const clearing={id:'clearing',config:{locationType:'custom' as const,area,objectCount:0,seed:42,terrain:{style:'forest' as const,baseHeight:5,relief:0,textureMode:'preserve' as const,edgeBlend:2},groups:[group('marker',11,11)]}};
 const other={...zone('other',24,24,30,30),config:{...zone('other',24,24,30,30).config,terrain:{style:'forest' as const,heightMode:'preserve' as const,textureMode:'preserve' as const}}};
 await f.apply({zones:[clearing,other]});
 const first=await f.ledger(),record=first.zones.find((z:any)=>z.id==='clearing'),east=first.zones.find((z:any)=>z.id==='other');
 const file=path.join(f.root,'Objects'),doc=new PlacementDocument(await fs.readFile(file,'utf8')),eastId=east.objects[0].id;doc.rotate(eastId,.8123);await fs.writeFile(file,doc.source);
 const manual=doc.list().find(o=>o.id===eastId)!,changed={...clearing,config:{...clearing.config,terrain:{...clearing.config.terrain,baseHeight:6}}};
 const plan=await f.apply({zones:[changed]});assert.deepEqual(plan.ownership.rebuilt.map(z=>z.id),['clearing']);
 const after=await f.ledger(),owned=after.zones.find((z:any)=>z.id==='clearing'),objects=new PlacementDocument(await fs.readFile(file,'utf8')).list();
 assert.deepEqual(owned.objects.map((o:any)=>o.id),record.objects.map((o:any)=>o.id));
 assert.ok(Math.abs(Number(objects.find(o=>o.id===record.objects[0].id)!.position!.split(',')[2])-6.4)<.001);
 assert.deepEqual({...objects.find(o=>o.id===eastId)!,nodeId:undefined},{...manual,nodeId:undefined});assert.deepEqual(after.zones.find((z:any)=>z.id==='other'),east);
 const reconnected=new TerrainWorkspace(f.workspace,f.placement.browse,f.placement),repeat=await reconnected.ownedLandscape({zones:[changed]});assert.equal(repeat.ownership.rebuilt.length,0);assert.ok(repeat.files.every(x=>x.changedBytes===0));
});

test('clustered owned decoration preserves terrain, stable slots, unrelated edits and reconnect no-ops',async t=>{
 const f=await fixture(t),west=zone('west',3,3,21,21),east=zone('east',24,24,30,30),input={zones:[{...west,config:{...west.config,candidateIds:['AgriaTree'],objectCount:12,clusterCount:3,clusterRadius:4,terrain:{style:'forest' as const,heightMode:'preserve' as const,textureMode:'preserve' as const,relief:0}}},east]};
 await f.apply(input);const first=await f.ledger(),westIds=first.zones.find((z:any)=>z.id==='west').objects.map((o:any)=>o.id),eastRecord=first.zones.find((z:any)=>z.id==='east'),file=path.join(f.root,'Objects'),doc=new PlacementDocument(await fs.readFile(file,'utf8')),manualId=eastRecord.objects[0].id;doc.rotate(manualId,.8123);await fs.writeFile(file,doc.source);
 const native=['t3HeightMap','t3SyncHeightMap','t3TextureMasks','t3SyncTextureInfo'],before=new Map(await Promise.all(native.map(async name=>[name,await fs.readFile(path.join(f.root,name))] as const))),manual=doc.list().find(o=>o.id===manualId)!;
 const changed=await f.apply({zones:[{...input.zones[0],config:{...input.zones[0].config,seed:291}}]});assert.deepEqual(changed.ownership.rebuilt.map(z=>z.id),['west']);const after=await f.ledger();assert.deepEqual(after.zones.find((z:any)=>z.id==='west').objects.map((o:any)=>o.id),westIds);assert.deepEqual(after.zones.find((z:any)=>z.id==='east'),eastRecord);
 const current=new PlacementDocument(await fs.readFile(file,'utf8'));assert.deepEqual({...current.list().find(o=>o.id===manualId)!,nodeId:undefined},{...manual,nodeId:undefined});for(const name of native)assert.deepEqual(await fs.readFile(path.join(f.root,name)),before.get(name));
 const reconnect=new TerrainWorkspace(f.workspace,f.placement.browse,f.placement),repeat=await reconnect.ownedLandscape({zones:[{...input.zones[0],config:{...input.zones[0].config,seed:291}}]});assert.equal(repeat.ownership.rebuilt.length,0);assert.ok(repeat.files.every(file=>file.changedBytes===0));
 const ownedId=westIds[0],manualWest=new PlacementDocument(await fs.readFile(file,'utf8'));manualWest.rotate(ownedId,.4);await fs.writeFile(file,manualWest.source);await assert.rejects(reconnect.ownedLandscape({zones:[{...input.zones[0],config:{...input.zones[0].config,clusterRadius:5}}]}),/OWNED_OBJECT_CHANGED/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('later owned material patterns preserve declared roads and follow a changed road reservation',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.root,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(f.root,'Base.SC2Data/GameData/TerrainTextureData.xml'),'<Catalog><CTerrainTexture id="PatternRoad"><Texture value="Assets\\Textures\\PatternRoad.dds"/></CTerrainTexture></Catalog>');const palette=await f.terrain.plan({operations:[{op:'palette.update',replacements:[{slot:1,texture:'PatternRoad'}]}]});await f.terrain.apply(palette.id,{dryRun:false,stage:false,backup:false});const ids=(await f.terrain.state()).descriptor.textures.filter(t=>t.id).map(t=>t.id!);
 const parent={...zone('ground',4,4,28,28),config:{...zone('ground',4,4,28,28).config,objectCount:0,terrain:{style:'forest' as const,heightMode:'preserve' as const,edgeBlend:0,materials:{base:ids[0]},routes:[{points:[{x:16,y:8},{x:16,y:24}],width:4,texture:ids[1],edgeBlend:0}]}}};await f.apply({zones:[parent]});const before=await f.terrain.state(),road=before.masks!.weights(128,128);assert.equal(road[1],15);
 const pattern={seed:3,wavelength:8,threshold:-.99,transition:.01},control=await f.terrain.plan({operations:[{op:'texture.paint',area:{type:'rectangle',minX:4,minY:4,maxX:28,maxY:28},texture:ids[0],pattern}]});assert.equal((await f.terrain.state('',control.id)).masks!.get(128,128,1),0,'Unprotected control must actually overwrite the road');
 const child={...zone('litter',4,4,28,28),dependsOn:['ground'],config:{...zone('litter',4,4,28,28).config,objectCount:0,terrain:{style:'forest' as const,heightMode:'preserve' as const,edgeBlend:0,materials:{patches:[{texture:ids[0],...pattern,strength:1}]}}}};await f.apply({zones:[child]});assert.deepEqual((await f.terrain.state()).masks!.weights(128,128),road);
 const widened={...parent,config:{...parent.config,terrain:{...parent.config.terrain,routes:[{...parent.config.terrain.routes[0],width:6}]}}},plan=await f.apply({zones:[widened]});assert.deepEqual(plan.ownership.rebuilt.map(z=>z.id),['ground','litter']);const state=await f.terrain.state();for(const x of [104,120,128,143,151])assert.equal(state.masks!.get(x,128,1),15,'The child pattern must honor the new six-unit road');
});

test('owned patterned materials regenerate atomically, preserve unrelated manual work and reconnect unchanged',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.root,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(f.root,'Base.SC2Data/GameData/TerrainTextureData.xml'),'<Catalog><CTerrainTexture id="OwnedPatternAccent"><Texture value="Assets\\Textures\\OwnedPatternAccent.dds"/></CTerrainTexture></Catalog>');const palette=await f.terrain.plan({operations:[{op:'palette.update',replacements:[{slot:1,texture:'OwnedPatternAccent'}]}]});await f.terrain.apply(palette.id,{dryRun:false,stage:false,backup:false});const state=await f.terrain.state(),ids=state.descriptor.textures.filter(t=>t.id).map(t=>t.id!);assert.ok(ids.length>=2);
 const soil={...zone('soil',4,4,18,18),config:{...zone('soil',4,4,18,18).config,objectCount:0,terrain:{style:'forest' as const,heightMode:'preserve' as const,seed:42,materials:{base:ids[0],patches:[{texture:ids[1],wavelength:6,strength:.7}]}}}},other={...zone('other',24,24,30,30),config:{...zone('other',24,24,30,30).config,terrain:{style:'forest' as const,heightMode:'preserve' as const,textureMode:'preserve' as const}}};
 const geometry=['t3HeightMap','t3SyncHeightMap','t3SyncCliffLevel','t3CellFlags'],before=await Promise.all(geometry.map(n=>fs.readFile(path.join(f.root,n))));await f.apply({zones:[soil,other]});
 const records=await f.ledger(),otherRecord=records.zones.find((z:any)=>z.id==='other'),objectsFile=path.join(f.root,'Objects'),doc=new PlacementDocument(await fs.readFile(objectsFile,'utf8'));doc.rotate(otherRecord.objects[0].id,.491);await fs.writeFile(objectsFile,doc.source);const manualObjects=await fs.readFile(objectsFile);
 const changed={...soil,config:{...soil.config,terrain:{...soil.config.terrain,seed:619}}},plan=await f.apply({zones:[changed]});assert.deepEqual(plan.ownership.rebuilt.map(z=>z.id),['soil']);assert.deepEqual(await fs.readFile(objectsFile),manualObjects);assert.deepEqual((await f.ledger()).zones.find((z:any)=>z.id==='other'),otherRecord);
 for(let i=0;i<geometry.length;i++)assert.deepEqual(await fs.readFile(path.join(f.root,geometry[i])),before[i]);const repeated=await new TerrainWorkspace(f.workspace,f.placement.browse,f.placement).ownedLandscape({zones:[changed]});assert.equal(repeated.ownership.rebuilt.length,0);assert.ok(repeated.files.every(p=>p.changedBytes===0));
 const manualPaint=await f.terrain.plan({operations:[{op:'texture.paint',area:{type:'circle',center:{x:9,y:9},radius:1},texture:ids[1]}]});await f.terrain.apply(manualPaint.id,{dryRun:false,stage:false,backup:false});await assert.rejects(f.terrain.ownedLandscape({zones:[{...changed,config:{...changed.config,terrain:{...changed.config.terrain,seed:91}}}]}),/OWNED_TERRAIN_CHANGED/);
});

test('terrain-only locations paint functional regions without inserting dummy decoration',async t=>{
 const f=await fixture(t),base=zone('ground'),before=await fs.readFile(path.join(f.root,'Objects')),input={zones:[{...base,config:{...base.config,objectCount:0,terrain:{...base.config.terrain,heightMode:'preserve' as const,relief:0}}}]};
 const plan=await f.apply(input);assert.equal(plan.ownership.rebuilt[0].objects,0);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),before);assert.equal((await f.ledger()).zones[0].objects.length,0);
 const repeated=await f.terrain.ownedLandscape(input);assert.ok(repeated.files.every(file=>file.changedBytes===0));
});

test('round owned regions normalize the placement center to a strict two-dimensional terrain center',async t=>{
 const f=await fixture(t),base=zone('round'),input={zones:[{...base,config:{...base.config,area:{type:'circle' as const,center:{x:10,y:10,z:0},radius:4},objectCount:0,terrain:{...base.config.terrain,heightMode:'preserve' as const,relief:0}}}]};
 const plan=await f.apply(input);assert.equal(plan.valid,true);assert.equal((await f.ledger()).zones[0].config.area.type,'circle');assert.equal((await f.terrain.ownedLandscape(input)).ownership.rebuilt.length,0);
});

test('measured location groups own stable slots, retain offsets and commit without random scatter',async t=>{
 const f=await fixture(t),base=zone('base',2,2,18,18),input={zones:[{...base,config:{...base.config,objectCount:0,groups:[group()],terrain:{...base.config.terrain,heightMode:'preserve' as const,relief:0}}}]};
 const first=await f.apply(input);assert.equal(first.ownership.rebuilt[0].reusedObjectIds,0);const record=(await f.ledger()).zones[0];assert.equal(record.objects.length,1);assert.equal(record.objects[0].slot,'group:gate:0');const id=record.objects[0].id;
 let object=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8')).list().find(o=>o.id===id)!;const initialPosition=object.position;assert.ok(Math.abs(Number(object.position!.split(',')[2])-(await f.terrain.surface()).sampleGround({x:10,y:10}).height-.4)<1e-6);
 const changed=await f.apply({zones:[{...input.zones[0],config:{...input.zones[0].config,objectCount:7,candidateIds:['AgriaTree']}}]});assert.equal(changed.ownership.rebuilt[0].reusedObjectIds,1);assert.equal((await f.ledger()).zones[0].objects.find((o:any)=>o.slot==='group:gate:0').id,id);
 object=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8')).list().find(o=>o.id===id)!;assert.equal(object.position,initialPosition);
});

test('placements use final overlay heights, and later child changes resnap guarded parent groups',async t=>{
 const f=await fixture(t),parent=zone('parent',2,2,22,22),child={...zone('clearing',6,6,16,16),dependsOn:['parent']},input={zones:[{...parent,config:{...parent.config,objectCount:0,groups:[group()],terrain:{...parent.config.terrain,heightMode:'preserve' as const,relief:0}}},{...child,config:{...child.config,seed:77,terrain:{...child.config.terrain,relief:1}}}]};
 await f.apply(input);const state=await f.ledger(),id=state.zones.find((z:any)=>z.id==='parent').objects[0].id,file=path.join(f.root,'Objects');
 const before=new PlacementDocument(await fs.readFile(file,'utf8')).list().find(o=>o.id===id)!;assert.ok(Math.abs(Number(before.position!.split(',')[2])-(await f.terrain.surface()).sampleGround({x:10,y:10}).height-.4)<1e-6);
 const changed=await f.apply({zones:[{...input.zones[1],config:{...input.zones[1].config,seed:913}}]});assert.ok(changed.ownership.resnapped.some(r=>r.id==='parent'&&r.objects===1));const after=new PlacementDocument(await fs.readFile(file,'utf8')).list().find(o=>o.id===id)!;assert.notEqual(after.position,before.position);assert.ok(Math.abs(Number(after.position!.split(',')[2])-(await f.terrain.surface()).sampleGround({x:10,y:10}).height-.4)<1e-6);
 const doc=new PlacementDocument(await fs.readFile(file,'utf8'));doc.rotate(id,.1);await fs.writeFile(file,doc.source);await assert.rejects(f.terrain.ownedLandscape({zones:[{...input.zones[1],config:{...input.zones[1].config,seed:421}}]}),/OWNED_OBJECT_CHANGED/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('measured groups cannot cross routes, zone boundaries or accept unmeasured members',async t=>{
 const f=await fixture(t),base=zone('base',2,2,18,18),config={...base.config,objectCount:0,groups:[group()],terrain:{...base.config.terrain,heightMode:'preserve' as const,relief:0,routes:[{points:[{x:10,y:4},{x:10,y:16}],width:2}]}};
 await assert.rejects(f.terrain.ownedLandscape({zones:[{...base,config}]}),/RESERVED_ROUTE/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 await assert.rejects(f.terrain.ownedLandscape({zones:[{...base,config:{...config,terrain:{...config.terrain,routes:[]},groups:[group('outside',1,1)]}}]}),/OUTSIDE_ZONE/);
 assert.throws(()=>landscapeIntentSchema.parse({zones:[{...base,config:{...config,groups:[{...group(),members:[{id:'AgriaTree',offset:{x:0,y:0},boundsFrame:'member'}]}]}}]}));
 assert.throws(()=>landscapeIntentSchema.parse({zones:[{...base,config:{...config,includeUnits:true}}]}));
});

test('parent growth cannot consume reserved descendant IDs and partial migration preserves untouched records',async t=>{
 const f=await fixture(t),base=zone('base',2,2,22,22),child={...zone('child',12,12,20,20),dependsOn:['base']},east=zone('east',24,24,30,30),input={zones:[{...base,config:{...base.config,objectCount:2,terrain:{...base.config.terrain,heightMode:'preserve' as const,relief:0}}},{...child,config:{...child.config,objectCount:0,groups:[group('trees',16,16)],terrain:{...child.config.terrain,heightMode:'preserve' as const,relief:0}}},east]};
 await f.apply(input);const ledger=await f.ledger(),childId=ledger.zones.find((z:any)=>z.id==='child').objects[0].id;
 for(const z of ledger.zones){z.generatorRevision=1;delete z.config.groups;}
 // The real child is measured; retain its explicit group input while simulating
 // an older untouched eastern definition which omitted newly defaulted fields.
 ledger.zones.find((z:any)=>z.id==='child').config.groups=[group('trees',16,16)];
 const untouched=structuredClone(ledger.zones.find((z:any)=>z.id==='east'));await fs.writeFile(path.join(f.root,'.sc2mcp/locations.json'),JSON.stringify(ledger));
 await f.apply({zones:[{...input.zones[0],config:{...input.zones[0].config,objectCount:25}}]});const after=await f.ledger();assert.equal(after.zones.find((z:any)=>z.id==='child').objects[0].id,childId);assert.deepEqual(after.zones.find((z:any)=>z.id==='east'),untouched);
});

test('owned locations plan without writes, commit one group and repeat byte-identically across reconnects',async t=>{
 const f=await fixture(t),input={zones:[zone('west'),zone('east',20,20,28,28)]},before=await fs.readFile(path.join(f.root,'Objects'));
 const p=await f.terrain.ownedLandscape(input);assert.equal(p.ownership.rebuilt.length,2);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),before);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 const applied=await f.terrain.apply(p.id,{dryRun:false,stage:true,backup:false});assert.ok(applied.transactionId);await assert.rejects(f.workspace.save('Objects'),/BINARY_TRANSACTION_STAGED/);await f.terrain.savePlan(p.id,{dryRun:false,backup:false});
 const first=await fs.readFile(path.join(f.root,'Objects')),state=await f.ledger(),heights=await fs.readFile(path.join(f.root,'t3HeightMap'));assert.equal(state.zones.length,2);assert.equal(new PlacementDocument(first.toString()).list().length,new PlacementDocument(before.toString()).list().length+8);
 const reconnect=new TerrainWorkspace(f.workspace,f.placement.browse,f.placement),again=await reconnect.ownedLandscape(input);assert.equal(again.ownership.rebuilt.length,0);assert.ok(again.files.every(file=>file.changedBytes===0));await reconnect.apply(again.id,{dryRun:false,stage:true});assert.deepEqual(await reconnect.savePlan(again.id,{dryRun:false}),{saved:false,unchanged:true,planId:again.id});assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),first);assert.deepEqual(await fs.readFile(path.join(f.root,'t3HeightMap')),heights);
});

test('changing a zone rebuilds its declared overlays while preserving unrelated manual terrain and objects',async t=>{
 const f=await fixture(t),parent=zone('forest'),child={...zone('gate',8,8,12,12),dependsOn:['forest']},other=zone('east',20,20,28,28);await f.apply({zones:[parent,child,other]});const saved=await f.ledger(),east=saved.zones.find((z:any)=>z.id==='east');
 const objectsPath=path.join(f.root,'Objects'),doc=new PlacementDocument(await fs.readFile(objectsPath,'utf8')),id=east.objects[0].id;doc.move(id,{x:25,y:25,z:9});await fs.writeFile(objectsPath,doc.source);const manual=doc.list().find(o=>o.id===id)!;
 const heightsPath=path.join(f.root,'t3HeightMap'),heights=await fs.readFile(heightsPath),offset=32+(30*33+30)*6;heights.writeUInt16LE(heights.readUInt16LE(offset)+5,offset);await fs.writeFile(heightsPath,heights);
 const changed=await f.apply({zones:[{...parent,config:{...parent.config,seed:91}}]});assert.deepEqual(changed.ownership.rebuilt.map(z=>z.id),['forest','gate']);
 const after=new PlacementDocument(await fs.readFile(objectsPath,'utf8'));assert.deepEqual({...after.list().find(o=>o.id===id)!,nodeId:undefined},{...manual,nodeId:undefined});assert.equal((await fs.readFile(heightsPath)).readUInt16LE(offset),heights.readUInt16LE(offset));assert.deepEqual((await f.ledger()).zones.find((z:any)=>z.id==='east'),east);
});

test('manual edits to owned objects or no-op written terrain stop replacement before staging',async t=>{
 const f=await fixture(t),input={zones:[zone('west')]};await f.apply(input);const state=await f.ledger(),object=state.zones[0].objects[0],file=path.join(f.root,'Objects'),original=await fs.readFile(file,'utf8'),doc=new PlacementDocument(original);doc.rotate(object.id,.75);await fs.writeFile(file,doc.source);
 await assert.rejects(f.terrain.ownedLandscape(input),/OWNED_OBJECT_CHANGED/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);await fs.writeFile(file,original);
 const hm=path.join(f.root,'t3HeightMap'),bytes=await fs.readFile(hm),offset=32+(6*33+6)*6;bytes[offset]^=1;await fs.writeFile(hm,bytes);await assert.rejects(f.terrain.ownedLandscape(input),/OWNED_TERRAIN_CHANGED/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('a brush that writes the same height still owns its covered vertices',async t=>{
 const f=await fixture(t),base=zone('flat'),input={zones:[{...base,config:{...base.config,terrain:{...base.config.terrain,style:'city' as const,relief:0}}}]},before=await fs.readFile(path.join(f.root,'t3HeightMap'));await f.apply(input);
 assert.deepEqual(await fs.readFile(path.join(f.root,'t3HeightMap')),before);
 const bytes=Buffer.from(before);bytes[32+(6*33+6)*6]^=1;await fs.writeFile(path.join(f.root,'t3HeightMap'),bytes);await assert.rejects(f.terrain.ownedLandscape(input),/OWNED_TERRAIN_CHANGED/);
});

test('decoration-only locations retain authored textures and heights across regeneration',async t=>{
 const f=await fixture(t),base=zone('decor'),terrain={...base.config.terrain,heightMode:'preserve' as const,textureMode:'preserve' as const,materials:undefined,relief:0},input={zones:[{...base,config:{...base.config,terrain}}]};
 const files=['t3HeightMap','t3SyncHeightMap','t3TextureMasks','t3SyncTextureInfo'];
 const before=await Promise.all(files.map(file=>fs.readFile(path.join(f.root,file))));
 await f.apply(input);
 assert.deepEqual((await f.ledger()).zones[0].patches,[]);
 for(let i=0;i<files.length;i++)assert.deepEqual(await fs.readFile(path.join(f.root,files[i])),before[i],files[i]);
 const repeat=await f.terrain.ownedLandscape(input);assert.equal(repeat.files.filter(f=>f.changedBytes).length,0);
 const paint=await f.terrain.plan({operations:[{op:'texture.paint',area:{type:'circle',center:{x:10,y:10},radius:2},texture:'BelShirDirtLight'}]});
 await f.terrain.apply(paint.id,{dryRun:false,stage:false,backup:false});
 const manual=await fs.readFile(path.join(f.root,'t3TextureMasks'));
 await f.apply({zones:[{...input.zones[0],config:{...input.zones[0].config,seed:91}}]});
 assert.deepEqual(await fs.readFile(path.join(f.root,'t3TextureMasks')),manual);
 await assert.rejects(f.terrain.ownedLandscape({zones:[{...base,config:{...base.config,terrain:{...terrain,materials:{base:'BelShirDirtLight'}}}}]}),/PRESERVE_TEXTURE_MATERIAL_CONFLICT/);
});
test('preserved texture passes still honor explicit route paint and plain empty plans are no-ops',async t=>{
 const f=await fixture(t),base=zone('route'),plan=await f.terrain.plan({operations:[]});
 assert.ok(plan.files.every(f=>f.changedBytes===0));
 const terrain={...base.config.terrain,heightMode:'preserve' as const,textureMode:'preserve' as const,materials:undefined,relief:0,routes:[{points:[{x:7,y:8},{x:11,y:8}],width:1,texture:'BelShirDirtLight'}]};
 await f.apply({zones:[{...base,config:{...base.config,terrain}}]});
 assert.ok((await f.ledger()).zones[0].patches.some((p:any)=>p.file==='t3TextureMasks'));
 assert.ok((await f.ledger()).zones[0].patches.every((p:any)=>!p.file.includes('Height')));
});
test('preserve-height locations paint and decorate without claiming or modifying existing height channels',async t=>{
 const f=await fixture(t),base=zone('existing'),terrain={...base.config.terrain,heightMode:'preserve' as const,relief:0},input={zones:[{...base,config:{...base.config,terrain}}]};
 const height=await fs.readFile(path.join(f.root,'t3HeightMap')),sync=await fs.readFile(path.join(f.root,'t3SyncHeightMap'));await f.apply(input);
 assert.deepEqual(await fs.readFile(path.join(f.root,'t3HeightMap')),height);assert.deepEqual(await fs.readFile(path.join(f.root,'t3SyncHeightMap')),sync);
 assert.ok((await f.ledger()).zones[0].patches.every((p:any)=>!['t3HeightMap','t3SyncHeightMap'].includes(p.file)));
 const edited=Buffer.from(height);edited[32+(6*33+6)*6]^=1;await fs.writeFile(path.join(f.root,'t3HeightMap'),edited);
 await f.apply({zones:[{...input.zones[0],config:{...input.zones[0].config,seed:92}}]});assert.deepEqual(await fs.readFile(path.join(f.root,'t3HeightMap')),edited);
 await assert.rejects(f.terrain.ownedLandscape({zones:[{...base,config:{...base.config,terrain:{...terrain,relief:1}}}]}),/PRESERVE_HEIGHT_RELIEF_CONFLICT/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('exact location palettes do not add fuzzy search candidates and reject Unit actors',async t=>{
 const f=await fixture(t),base=zone('palette'),input={zones:[{...base,config:{...base.config,candidateIds:['AgriaTree']}}]};await f.apply(input);const owned=(await f.ledger()).zones[0].objects.map((o:any)=>o.id),doc=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8'));
 assert.ok(doc.list().filter(o=>owned.includes(o.id)).every(o=>o.catalogId==='AgriaTree'));
 await assert.rejects(f.placement.createLocation({...base.config,candidateIds:['Marine']}),/not an indexed placeable Doodad/);
});

test('overlapping ownership requires a real dependency; cycles and stale atomic saves reject',async t=>{
 const f=await fixture(t);await f.apply({zones:[zone('parent')]});await assert.rejects(f.terrain.ownedLandscape({zones:[zone('unrelated',10,10,18,18)]}),/OWNERSHIP_OVERLAP/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 assert.throws(()=>landscapeOrder([{id:'a',dependsOn:['b']},{id:'b',dependsOn:['a']}]),/DEPENDENCY_CYCLE/);
 const plan=await f.terrain.ownedLandscape({zones:[{...zone('parent'),config:{...zone('parent').config,seed:53}}]});await f.terrain.apply(plan.id,{dryRun:false,stage:true,backup:false});const objects=await fs.readFile(path.join(f.root,'Objects'));await fs.appendFile(path.join(f.root,'ComponentList.SC2Components'),'\n<!-- manual -->');await assert.rejects(f.terrain.savePlan(plan.id,{dryRun:false,backup:false}),/STALE/);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),objects);
});

test('same-size catalog edits with restored timestamps invalidate an unapplied landscape plan',async t=>{
 const f=await fixture(t),file=path.join(f.root,'Base.SC2Data/GameData/ActorData.xml'),stamp=new Date('2020-01-01T00:00:00Z');await fs.utimes(file,stamp,stamp);
 const plan=await f.terrain.ownedLandscape({zones:[zone('west')]}),text=await fs.readFile(file,'utf8');await fs.writeFile(file,text.replace('AgriaTreeModel','OtherTreeModel'));await fs.utimes(file,stamp,stamp);
 await assert.rejects(f.terrain.apply(plan.id,{dryRun:false,stage:true}),/STALE_TERRAIN_ASSET_INDEX/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('texture ownership masks preserve the other half byte and merge both touched nibbles',async t=>{
 const f=await fixture(t),state=await f.terrain.state(),before=new Map([...state.sources].map(([name,b])=>[name,Buffer.from(b)])),touches=new LandscapeTouches(state),masks=state.masks!;
 touches.texture(40,40);masks.set(40,40,0,3);const after=new Map([...state.sources].map(([name,b])=>[name,Buffer.from(b)])),patches=touches.patches(before,after),offset=masks.byteIndex(40,40,0),current=after.get('t3TextureMasks')!;current[offset]=(current[offset]&240)|7;restoreLandscapePatch(after,patches,'test');assert.equal(current[offset]&15,7);assert.equal(current[offset]&240,before.get('t3TextureMasks')![offset]&240);
 touches.texture(41,40);assert.equal(touches.masks.get('t3TextureMasks')![offset],255);
});
