import test from 'node:test';import assert from 'node:assert/strict';import{promises as fs}from'node:fs';import path from'node:path';import os from'node:os';
import{Workspace}from'../core/workspace.js';import{BrowseWorkspace}from'../modules/browse/workspace.js';import{DataWorkspace}from'../modules/data/workspace.js';import{PlacementWorkspace}from'../modules/placement/workspace.js';
test('Mass decoration removal rejects missing/duplicate IDs and retains stale source guards',async t=>{
const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-remove-batch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
const workspace=new Workspace(root),placement=new PlacementWorkspace(workspace,new BrowseWorkspace(workspace,new DataWorkspace(workspace)));
const scan=await placement.scan(),ids=scan.objects.map(o=>o.id!).slice(0,2);assert.equal(ids.length,2);
await assert.rejects(()=>placement.removeBatch({objectIds:[ids[0],ids[0]]}),/INVALID_REMOVE_BATCH/);await assert.rejects(()=>placement.removeBatch({objectIds:[9999999]}),/REMOVE_OBJECT_MISSING/);
const p=await placement.removeBatch({objectIds:ids});assert.equal(p.operations.length,2);
await fs.appendFile(path.join(root,'Objects'),'\n<!-- concurrent edit -->');await assert.rejects(()=>placement.apply(p.id,{dryRun:false,stage:false}),/STALE|changed/i);
assert.match(await fs.readFile(path.join(root,'Objects'),'utf8'),/concurrent edit/);
});
test('placement validation distinguishes stored objects from SC2 Editor layer visibility',async t=>{
const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-layer-diagnostic-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
const workspace=new Workspace(root),placement=new PlacementWorkspace(workspace,new BrowseWorkspace(workspace,new DataWorkspace(workspace)));
const report=await placement.validate();
assert.ok(report.editorVisibility.placedObjects>0);
assert.equal(report.editorVisibility.editorLayerState,'UNOBSERVABLE');
assert.match(report.editorVisibility.hint,/Show Layer/);
});
