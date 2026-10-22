import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {TerrainWorkspace} from '../modules/terrain/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {BrowseWorkspace} from '../modules/browse/workspace.js';
import {PlacementWorkspace} from '../modules/placement/workspace.js';
import {PlacementDocument} from '../modules/placement/document.js';
import {createFlatTerrain} from '../modules/document/codecs/flatTerrainFactory.js';
import {parseTerrainXml} from '../modules/terrain/surface/format/terrain-params.js';
import {prepareNativeGeometryFoundation} from '../modules/terrain/nativeGeometry.js';
import {restoreTopologyPatch} from '../modules/terrain/nativeTopologyOwnership.js';

async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-owned-native-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
 const flat=createFlatTerrain(64,64,{id:'BelShir',textures:['BelShirDirtLight'],cliffs:['AgriaCliff0'],sourcePaths:[]},'BelShirDirtLight',8);
 for(const [file,bytes]of flat)await fs.writeFile(path.join(root,file),bytes);
 const workspace=new Workspace(root),browse=new BrowseWorkspace(workspace,new DataWorkspace(workspace)),placement=new PlacementWorkspace(workspace,browse),terrain=new TerrainWorkspace(workspace,browse,placement);placement.terrain=terrain;
 const ledger=async()=>JSON.parse(await fs.readFile(path.join(root,'.sc2mcp/locations.json'),'utf8'));
 const apply=async(input:Parameters<TerrainWorkspace['ownedLandscape']>[0])=>{const p=await terrain.ownedLandscape(input);assert.equal(p.valid,true);await terrain.apply(p.id,{dryRun:false,stage:true,backup:false});await terrain.savePlan(p.id,{dryRun:false,backup:false});return p;};
 return {root,workspace,browse,placement,terrain,ledger,apply};
}
const rect=(minX:number,minY:number,maxX:number,maxY:number)=>({type:'rectangle' as const,minX,minY,maxX,maxY});
function zone(id='west',dx=0){return {id,config:{locationType:'custom' as const,area:{...rect(dx,0,dx+30,32),z:0},objectCount:0,terrain:{style:'city' as const,heightMode:'preserve' as const,textureMode:'preserve' as const,relief:0,topology:{cliffs:[{area:rect(dx+8,8,dx+20,24),level:2}],ramps:[{id:'entrance',center:{x:dx+22,y:15},direction:'west' as const}]}}}};}

test('independent native regions own local cells and ramps, prepare once and repeat byte-identically',async t=>{
 const f=await fixture(t),input={zones:[zone(),zone('east',32)]},before=await f.terrain.state(),objects=await fs.readFile(path.join(f.root,'Objects'));
 const p=await f.apply(input);assert.equal(p.ownership.foundationPreparation?.changed,true);assert.deepEqual(p.ownership.topologyZones,['west','east']);
 const state=await f.ledger(),current=await f.terrain.state();assert.equal(parseTerrainXml(current.descriptor.source).ramps!.length,2);assert.deepEqual(await fs.readFile(path.join(f.root,'Objects')),objects);
 assert.ok(Math.abs(current.heights.z(62,62)-before.heights.z(62,62))<current.descriptor.quantizeScale);
 for(const record of state.zones){assert.ok(record.topology.cells.length>0);assert.equal(record.topology.ramps.length,1);assert.ok(record.patches.every((p:any)=>p.file!=='t3Terrain.xml'));assert.ok(record.topology.cells.length<64*64/4/2);}
 const repeated=await new TerrainWorkspace(f.workspace,f.browse,f.placement).ownedLandscape(input);assert.equal(repeated.ownership.rebuilt.length,0);assert.ok(repeated.files.every(p=>p.changedBytes===0));
});

test('moving an owned ramp preserves independent manual rows, objects, heights and high LFCT bits',async t=>{
 const f=await fixture(t),west=zone(),east=zone('east',32);await f.apply({zones:[west,east]});const state=await f.ledger(),eastRecord=structuredClone(state.zones[1]);
 const xmlFile=path.join(f.root,'t3Terrain.xml'),xml=await fs.readFile(xmlFile,'utf8'),eastCell=eastRecord.topology.cells.find((r:any)=>r.after!==null);
 await fs.writeFile(xmlFile,xml.replace(eastCell.after,eastCell.after.replace('<cc ','<cc note="manual-east" ')));
 const hFile=path.join(f.root,'t3HeightMap'),height=await fs.readFile(hFile),far=32+(62*65+62)*6;height.writeUInt16LE(height.readUInt16LE(far)+2,far);await fs.writeFile(hFile,height);
 const flagsFile=path.join(f.root,'t3CellFlags'),flags=await fs.readFile(flagsFile),hidden=32+16*64+18;flags[hidden]|=4;await fs.writeFile(flagsFile,flags);
 const objectsFile=path.join(f.root,'Objects');await fs.appendFile(objectsFile,'\n<!-- manual unrelated object annotation -->');const objects=await fs.readFile(objectsFile);
 const changed={...west,config:{...west.config,terrain:{...west.config.terrain,topology:{...west.config.terrain.topology,ramps:[{...west.config.terrain.topology.ramps[0],center:{x:22,y:19}}]}}}};
 const plan=await f.apply({zones:[changed]});assert.deepEqual(plan.ownership.rebuilt.map(z=>z.id),['west']);
 const after=await f.terrain.state(),ramps=parseTerrainXml(after.descriptor.source).ramps!;assert.ok(ramps.some(r=>r.frames.mid?.center[0]===22&&r.frames.mid.center[1]===19));assert.ok(ramps.some(r=>r.frames.mid?.center[0]===54));
 assert.match(after.descriptor.source,/note="manual-east"/);assert.equal(after.heights.bytes.readUInt16LE(far),height.readUInt16LE(far));assert.equal(after.sources.get('t3CellFlags')![hidden]&4,4);assert.deepEqual(await fs.readFile(objectsFile),objects);assert.deepEqual((await f.ledger()).zones[1],eastRecord);
});

test('manual owned native row, ramp and binary changes block even an equal request without staging',async t=>{
 const f=await fixture(t),input={zones:[zone()]};await f.apply(input);const record=(await f.ledger()).zones[0],xmlFile=path.join(f.root,'t3Terrain.xml'),xml=await fs.readFile(xmlFile,'utf8');
 const cell=record.topology.cells.find((r:any)=>r.after!==null),ramp=record.topology.ramps[0];
 for(const changed of [xml.replace(cell.after,cell.after.replace('cvar="0"','cvar="1"')),xml.replace(ramp.after,ramp.after.replace('dir="2"','dir="3"'))]){
  assert.notEqual(changed,xml);await fs.writeFile(xmlFile,changed);await assert.rejects(f.terrain.ownedLandscape(input),/OWNED_TOPOLOGY_CHANGED/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 }
 await fs.writeFile(xmlFile,xml);const file=path.join(f.root,'t3SyncCliffLevel'),bytes=await fs.readFile(file),run=record.patches.find((p:any)=>p.file==='t3SyncCliffLevel').runs[0];bytes[run.offset]^=1;await fs.writeFile(file,bytes);
 await assert.rejects(f.terrain.ownedLandscape(input),/OWNED_TERRAIN_CHANGED/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('native no-op coverage owns absent cliff rows and validates serialized key/header identities',async t=>{
 const f=await fixture(t),input={zones:[zone()]};await f.apply(input);const state=await f.ledger(),record=state.zones[0],empty=record.topology.cells.find((r:any)=>r.after===null),file=path.join(f.root,'t3Terrain.xml'),xml=await fs.readFile(file,'utf8');assert.ok(empty);
 const parsed=parseTerrainXml(xml);const altered=xml.replace(/numOccupied="\d+"/,`numOccupied="${parsed.cliffCells!.length+1}"`).replace('</cliffCellList>',`<cc i="${empty.key}" f="1" cid="0" cvar="0"/></cliffCellList>`);
 await fs.writeFile(file,altered);await assert.rejects(f.terrain.ownedLandscape(input),/OWNED_TOPOLOGY_CHANGED/);await fs.writeFile(file,xml);
 const sources=new Map((await f.terrain.state()).sources),bad=structuredClone(record.topology);bad.cells[0].before='<cc i="9999" f="1" cid="0" cvar="0"/>';assert.throws(()=>restoreTopologyPatch(sources,bad,'west'),/CELL_KEY_MISMATCH/);
 const flagsFile=path.join(f.root,'t3CellFlags'),flags=await fs.readFile(flagsFile);flags[20]^=1;await fs.writeFile(flagsFile,flags);await assert.rejects(f.terrain.ownedLandscape(input),/LAYOUT_CHANGED/);
});

test('removing a child plateau restores ground and resnaps ancestor groups with stable object IDs',async t=>{
 const f=await fixture(t),child={...zone(),id:'plateau',dependsOn:['camp']},parent={id:'camp',config:{...zone().config,terrain:{style:'city' as const,heightMode:'preserve' as const,textureMode:'preserve' as const,relief:0},groups:[{id:'tree',anchor:{x:12,y:16},maxSlope:.5,members:[{id:'AgriaTree',offset:{x:0,y:0},heightOffset:.4,boundsFrame:'member' as const,horizontalBounds:{minX:-.2,maxX:.2,minY:-.2,maxY:.2}}]}]}};
 await f.apply({zones:[parent,child]});const first=await f.ledger(),id=first.zones[0].objects[0].id,before=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8')).list().find(o=>o.id===id)!;
 const p=await f.apply({zones:[{...child,config:{...child.config,terrain:{...child.config.terrain,topology:{cliffs:[],ramps:[]}}}}]});assert.ok(p.changedVertices>0);assert.ok(p.ownership.resnapped.some(r=>r.id==='camp'&&r.objects===1));
 const after=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8')).list().find(o=>o.id===id)!;assert.notEqual(after.position,before.position);assert.ok(Math.abs(Number(after.position!.split(',')[2])-(await f.terrain.state()).heights.z(12,16)-.4)<1e-6);assert.equal(parseTerrainXml((await f.terrain.state()).descriptor.source).ramps!.length,0);
});

test('native parent changes rebuild dependent surface overlays and stale XML blocks the complete staged group',async t=>{
 const f=await fixture(t),parent=zone(),child={id:'wear',dependsOn:['west'],config:{...zone().config,area:{...rect(10,12,16,20),z:0},terrain:{style:'city' as const,heightMode:'generate' as const,textureMode:'preserve' as const,relief:.1}}};
 await f.apply({zones:[parent,child]});const changed={...parent,config:{...parent.config,terrain:{...parent.config.terrain,topology:{...parent.config.terrain.topology,ramps:[{...parent.config.terrain.topology.ramps[0],center:{x:22,y:19}}]}}}};
 const p=await f.terrain.ownedLandscape({zones:[changed]});assert.deepEqual(p.ownership.rebuilt.map(r=>r.id),['west','wear']);
 const files=['Objects','t3HeightMap','t3SyncHeightMap','.sc2mcp/locations.json'],before=await Promise.all(files.map(file=>fs.readFile(path.join(f.root,file))));
 await f.terrain.apply(p.id,{dryRun:false,stage:true,backup:false});await fs.appendFile(path.join(f.root,'t3Terrain.xml'),'\n<!-- concurrent native edit -->');
 await assert.rejects(f.terrain.savePlan(p.id,{dryRun:false,backup:false}),/STALE/);
 for(const [i,file]of files.entries())assert.deepEqual(await fs.readFile(path.join(f.root,file)),before[i],file);
});

test('native halos, protected regions and undeclared overlaps reject before any source change',async t=>{
 const f=await fixture(t),west=zone(),before=await fs.readFile(path.join(f.root,'t3HeightMap'));
 await assert.rejects(f.terrain.ownedLandscape({zones:[{...west,config:{...west.config,area:{...rect(8,8,20,24),z:0}}}]}),/NATIVE_HALO_OR_PROTECTION_CONFLICT/);
 await assert.rejects(f.terrain.ownedLandscape({zones:[{...west,config:{...west.config,terrain:{...west.config.terrain,protectedAreas:[rect(6,8,10,12)]}}}]}),/NATIVE_HALO_OR_PROTECTION_CONFLICT/);
 assert.deepEqual(await fs.readFile(path.join(f.root,'t3HeightMap')),before);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
 await f.apply({zones:[west]});await assert.rejects(f.terrain.ownedLandscape({zones:[{...zone('overlap'),config:{...zone('overlap').config,terrain:{...zone().config.terrain,topology:{cliffs:[{area:rect(8,8,20,24),level:2}],ramps:[]}}}}]}),/OWNERSHIP_OVERLAP|TOUCHES_EXISTING_RAMP/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});

test('foundation preparation is idempotent and refuses global migration across existing region preimages',async t=>{
 const f=await fixture(t),s=await f.terrain.state(),prepared=prepareNativeGeometryFoundation(s,11),bytes=Buffer.from(s.heights.bytes),again=prepareNativeGeometryFoundation(s,11);assert.equal(prepared.changed,true);assert.equal(again.changed,false);assert.deepEqual(s.heights.bytes,bytes);
 const existing={id:'existing',config:{...zone().config,area:{...rect(40,40,54,54),z:0},terrain:{style:'city' as const,heightMode:'generate' as const,textureMode:'preserve' as const,relief:0}}};await f.apply({zones:[existing]});
 const file=path.join(f.root,'t3HeightMap'),raw=await fs.readFile(file),at=32+(62*65+62)*6;raw.writeUInt16LE(raw.readUInt16LE(at)+1,at);raw.writeUInt16LE(raw.readUInt16LE(at+2)-1,at+2);await fs.writeFile(file,raw);
 await assert.rejects(f.terrain.ownedLandscape({zones:[zone()]}),/FOUNDATION_MIGRATION_REQUIRED/);assert.deepEqual(f.workspace.binary.draftFiles(),[]);
});
