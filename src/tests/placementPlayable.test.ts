import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {BrowseWorkspace} from '../modules/browse/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {PlacementWorkspace} from '../modules/placement/workspace.js';
import {PlacementDocument} from '../modules/placement/document.js';
import {createMapInfo} from '../modules/document/codecs/mapInfoFactory.js';

async function fixture(t:test.TestContext){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-playable-placement-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(path.resolve('src/tests/fixtures/browse-placement-map'),root,{recursive:true});await fs.writeFile(path.join(root,'MapInfo'),createMapInfo(64,64,'Playable fixture',6,0));const workspace=new Workspace(root),placement=new PlacementWorkspace(workspace,new BrowseWorkspace(workspace,new DataWorkspace(workspace)));return {root,workspace,placement};}
test('default unit add/batch/move reject nonplayable pivots even when full terrain bounds would accept them',async t=>{
 const f=await fixture(t);for(const position of [{x:1,y:20,z:0},{x:63,y:20,z:0},{x:20,y:64,z:0}]){
  await assert.rejects(f.placement.addUnit({id:'Marine',position}),/UNIT_OUTSIDE_PLAYABLE_BOUNDS/);
  await assert.rejects(f.placement.addBatch({objects:[{kind:'Unit',id:'Marine',position}]}),/UNIT_OUTSIDE_PLAYABLE_BOUNDS/);
 }
 await assert.rejects(f.placement.addUnit({id:'Marine',position:{x:63,y:20,z:0},bounds:{minX:0,minY:0,maxX:64,maxY:64}}),/UNIT_OUTSIDE_PLAYABLE_BOUNDS/);
 const doc=new PlacementDocument(await fs.readFile(path.join(f.root,'Objects'),'utf8')),unit=doc.list().find(o=>o.kind==='ObjectUnit')!;
 await assert.rejects(f.placement.mutate({op:'move',objectId:unit.id!,position:{x:63,y:20,z:0}}),/UNIT_OUTSIDE_PLAYABLE_BOUNDS/);assert.deepEqual(f.workspace.draftFiles(),[]);
 const exception=await f.placement.addUnit({id:'Marine',position:{x:63,y:20,z:0},outsidePlayableReason:'Intentional cinematic staging'});assert.ok(exception.warnings.some(w=>w.includes('cinematic staging')));
 await f.placement.addDoodad({id:'AgriaTree',position:{x:63,y:20,z:0}});
});
test('MapInfo is a plan and staged-save dependency; missing metadata stays explicitly unknown',async t=>{
 const f=await fixture(t),position={x:20,y:20,z:0};const p=await f.placement.addUnit({id:'Marine',position});assert.ok(p.sourceSha256.MapInfo);
 await fs.writeFile(path.join(f.root,'MapInfo'),createMapInfo(64,64,'Changed fixture',6,0));await assert.rejects(f.placement.apply(p.id,{dryRun:false}),/STALE_PLACEMENT_PLAN/);
 const q=await f.placement.addUnit({id:'Marine',position});await f.placement.apply(q.id,{dryRun:false});
 await fs.writeFile(path.join(f.root,'MapInfo'),createMapInfo(64,64,'Changed after stage',6,0));await assert.rejects(f.workspace.save('Objects',{backup:false}),/READ_SET|STALE|changed/i);
 const g=await fixture(t);await fs.unlink(path.join(g.root,'MapInfo'));const unknown=await g.placement.addUnit({id:'Marine',position});assert.ok(unknown.warnings.some(w=>w.includes('playable-bound check unavailable')));
});
