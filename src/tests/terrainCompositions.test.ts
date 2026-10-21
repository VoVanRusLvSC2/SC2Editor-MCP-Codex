import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {BrowseWorkspace} from '../modules/browse/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {DataSchemaRegistry} from '../modules/data/schemaRegistry.js';
import {PlacementWorkspace} from '../modules/placement/workspace.js';
import {PlacementDocument} from '../modules/placement/document.js';
import {CompositionWorkspace} from '../modules/placement/compositions.js';
import type {TerrainWorkspace} from '../modules/terrain/workspace.js';
import {createHash} from 'node:crypto';

test('composition writes one owned group, repeats without duplicates, protects manual edits and terrain dependencies',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-composition-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(path.resolve('src/tests/fixtures/browse-placement-map'),root,{recursive:true});
 const ws=new Workspace(root),browse=new BrowseWorkspace(ws,new DataWorkspace(ws,new DataSchemaRegistry())),placement=new PlacementWorkspace(ws,browse);
 // A controlled terrain sampler isolates placement/transaction behavior; it does not certify SC2 pathing.
 await fs.writeFile(path.join(root,'TerrainProbe'),Buffer.from([0xff,0x80,0x0,0x21]));
 const sha=createHash('sha256').update(await fs.readFile(path.join(root,'TerrainProbe'))).digest('hex');
 const terrain={surface:async()=>({waterCoverageKnown:true,texturesKnown:true,bounds:{minX:0,minY:0,maxX:64,maxY:64},sourceSha256:{TerrainProbe:sha},diskSha256:{TerrainProbe:sha},sampleGround:({x,y}:{x:number;y:number})=>({height:x*0.01+y*0.01,slope:0.01,hidden:false,protected:false,mask:1,water:[]})})} as unknown as TerrainWorkspace;
 placement.terrain=terrain;const composition=new CompositionWorkspace(ws,placement,browse,terrain);
 const args={zone:'forest',tileset:'Agria',profile:'forest',objects:['AgriaTree'],area:{type:'rectangle' as const,minX:20,minY:20,maxX:40,maxY:40,z:0},count:12,minimumDistance:1,seed:42};
 const before=await fs.readFile(path.join(root,'Objects'),'utf8');
 await composition.compose(args);assert.equal(await fs.readFile(path.join(root,'Objects'),'utf8'),before);assert.equal(ws.draftFiles().length,0);
 await composition.compose({...args,dryRun:false});await ws.save('.sc2mcp/compositions/forest.json');const first=await fs.readFile(path.join(root,'Objects'),'utf8');assert.equal(new PlacementDocument(first).list().length,new PlacementDocument(before).list().length+12);
 await composition.compose({...args,dryRun:false});await ws.save('.sc2mcp/compositions/forest.json');assert.equal(await fs.readFile(path.join(root,'Objects'),'utf8'),first);
 const state=JSON.parse(await fs.readFile(path.join(root,'.sc2mcp/compositions/forest.json'),'utf8'));const doc=new PlacementDocument(first);doc.move(state.objects[0].id,{x:50,y:50,z:1});await fs.writeFile(path.join(root,'Objects'),doc.source);
 await assert.rejects(composition.compose(args),/OWNED_OBJECT_CHANGED/);await fs.writeFile(path.join(root,'Objects'),first);
 await composition.compose({...args,count:14,dryRun:false});await fs.appendFile(path.join(root,'TerrainProbe'),Buffer.from([1]));await assert.rejects(ws.save('.sc2mcp/compositions/forest.json'),/STALE_/);
});

test('constructed recipes require explicit measured members and keep reserved paths clear',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-compose-reserved-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(path.resolve('src/tests/fixtures/browse-placement-map'),root,{recursive:true});
 const ws=new Workspace(root),browse=new BrowseWorkspace(ws,new DataWorkspace(ws,new DataSchemaRegistry())),placement=new PlacementWorkspace(ws,browse),terrain={surface:async()=>({waterCoverageKnown:true,sampleGround:()=>({height:0,slope:0,mask:1,water:[],hidden:false,protected:false})})} as unknown as TerrainWorkspace;
 const composition=new CompositionWorkspace(ws,placement,browse,terrain),base={zone:'gate',tileset:'Agria',profile:'terran_fortified',recipe:'base_entrance' as const};
 await assert.rejects(composition.compose(base),/MEASURED_MEMBERS_REQUIRED/);
 await assert.rejects(composition.compose({...base,anchor:{x:10,y:10},members:[{id:'AgriaTree',offset:{x:0,y:0}}],exclusionZones:[{type:'circle',center:{x:10,y:10},radius:3}]}),/RESERVED_PATH/);
 await assert.rejects(composition.compose({...base,recipe:'ruined_structure'}),/DAMAGE_STATE/);
 assert.equal(ws.draftFiles().length,0);
});

test('measured prefab members preserve exact Actor key, variant and ground offset, and reject a wet corner',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-compose-measured-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(path.resolve('src/tests/fixtures/browse-placement-map'),root,{recursive:true});
 const ws=new Workspace(root),browse=new BrowseWorkspace(ws,new DataWorkspace(ws,new DataSchemaRegistry())),placement=new PlacementWorkspace(ws,browse);let wet=false;
 const terrain={surface:async()=>({waterCoverageKnown:true,sourceSha256:{},diskSha256:{},sampleGround:({x,y}:{x:number;y:number})=>({height:3,slope:0,mask:1,water:wet&&x>10&&y>10?[{}]:[],hidden:false,protected:false})})} as unknown as TerrainWorkspace;
 const composition=new CompositionWorkspace(ws,placement,browse,terrain),resolved=await browse.resolve({id:'AgriaTree',catalogType:'Actor'});assert.ok(resolved.object);
 const args={zone:'measured',tileset:'Agria',profile:'forest',recipe:'measured_group' as const,prefabRecipe:'forest_edge' as const,anchor:{x:10,y:10},members:[{id:'AgriaTree',key:resolved.object.key,offset:{x:0,y:0},heightOffset:.4,variation:2,horizontalBounds:{minX:-1,minY:-1,maxX:1,maxY:1}}]};
 wet=true;await assert.rejects(composition.compose(args),/BOUNDS_UNSUITABLE_GROUND/);assert.equal(ws.draftFiles().length,0);
 wet=false;await composition.compose({...args,dryRun:false});await ws.save('.sc2mcp/compositions/measured.json');
 const added=new PlacementDocument(await fs.readFile(path.join(root,'Objects'),'utf8')).list().at(-1)!;
 assert.equal(added.catalogId,'AgriaTree');assert.equal(added.position,'10,10,3.4');assert.equal(added.variation,'2');assert.equal(added.flags.HeightAbsolute,'1');
 const saved=await fs.readFile(path.join(root,'Objects'),'utf8');await composition.compose({...args,dryRun:false});await ws.save('.sc2mcp/compositions/measured.json');assert.equal(await fs.readFile(path.join(root,'Objects'),'utf8'),saved);
});
