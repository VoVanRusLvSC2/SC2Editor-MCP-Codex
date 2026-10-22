import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
