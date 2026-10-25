import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs}from'node:fs';import os from'node:os';import path from'node:path';
import {PlacementDocument}from'../modules/placement/document.js';import {Workspace}from'../core/workspace.js';import {BrowseWorkspace}from'../modules/browse/workspace.js';import {DataWorkspace}from'../modules/data/workspace.js';import {PlacementWorkspace}from'../modules/placement/workspace.js';

const source=`<?xml version="1.0"?>\r\n<PlacedObjects Version="27" Unknown="keep">\r\n<!-- authored -->\r\n<ObjectUnit Id="1" Position="2,3,4" Rotation=".5" UnitType="ColonistHut" Player="3"><Note Keep="yes"/></ObjectUnit>\r\n<ObjectDoodad Id="2" Position="7,8,9" Variation='3' Type="AgriaTree"><Flag Index="HeightAbsolute" Value="1"/></ObjectDoodad>\r\n</PlacedObjects>\r\n`;
test('variation batches preserve exact IDs, authored XML, single quotes and idempotent source spans',()=>{
 const d=new PlacementDocument(source);d.setVariations([{objectId:1,variation:0},{objectId:2,variation:5}]);
 assert.equal(d.source,source.replace('Player="3">','Player="3" Variation="0">').replace("Variation='3'","Variation='5'"));
 const committed=d.source;d.setVariations([{objectId:1,variation:0},{objectId:2,variation:5}]);assert.equal(d.source,committed);
 const applied=new PlacementDocument(source);assert.deepEqual(applied.apply([{op:'variation',objectId:1,variation:0},{op:'variation',objectId:2,variation:5}]),[{index:0,op:'variation',objectId:1},{index:1,op:'variation',objectId:2}]);assert.equal(applied.source,committed);
});
test('invalid variation assignments reject every edit before changing XML',()=>{
 for(const assignment of [{objectId:99,variation:1},{objectId:2,variation:-1},{objectId:2,variation:NaN},{objectId:2,variation:1.5},{objectId:2,variation:Number.MAX_SAFE_INTEGER+1}]){const d=new PlacementDocument(source);assert.throws(()=>d.setVariations([{objectId:1,variation:3},assignment]));assert.equal(d.source,source);}
 const d=new PlacementDocument(source);assert.throws(()=>d.setVariations([{objectId:1,variation:2},{objectId:1,variation:3}]),/DUPLICATE_VARIATION/);assert.equal(d.source,source);
});
test('bulk variation editing preserves a thousand objects without sequential XML rewriting',()=>{
 const d=PlacementDocument.create();d.addMany(Array.from({length:1000},(_,i)=>({kind:'Doodad' as const,catalogId:'AgriaTree',position:{x:i,y:2,z:0}})));
 const count={value:0},original=(d as any).reparse.bind(d);(d as any).reparse=()=>{count.value++;return original();};
 d.setVariations(Array.from({length:1000},(_,i)=>({objectId:i+1,variation:i%8})));assert.equal(count.value,1);assert.equal(d.list().length,1000);assert.equal(d.list().at(-1)!.variation,'7');
});
test('variation planning stages no bytes, commits coherently and refuses stale external edits',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-variants-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
 const workspace=new Workspace(root),placement=new PlacementWorkspace(workspace,new BrowseWorkspace(workspace,new DataWorkspace(workspace))),file=path.join(root,'Objects'),before=await fs.readFile(file,'utf8'),ids=new PlacementDocument(before).list().slice(0,2).map(o=>o.id!);
 await assert.rejects(()=>placement.setVariations({assignments:[{objectId:ids[0],variation:1},{objectId:ids[0],variation:2}]}),/DUPLICATE_VARIATION/);
 await assert.rejects(()=>placement.setVariations({assignments:[{objectId:9999999,variation:1}]}),/not found/);
 const plan=await placement.setVariations({assignments:ids.map((objectId,i)=>({objectId,variation:i}))});assert.equal(await fs.readFile(file,'utf8'),before);assert.deepEqual(workspace.draftFiles(),[]);
 await placement.apply(plan.id,{dryRun:false,stage:true});const commit=await workspace.save('Objects',{backup:false});assert.ok(commit.savedFiles.includes('Objects'));
 const objects=new PlacementDocument(await fs.readFile(file,'utf8')).list();for(const [i,id]of ids.entries())assert.equal(objects.find(o=>o.id===id)?.variation,String(i));
 const committed=await fs.readFile(file,'utf8'),repeat=await placement.setVariations({assignments:ids.map((objectId,i)=>({objectId,variation:i}))});assert.equal(repeat.id,plan.id);assert.equal(repeat.applied,true);const repeated=await placement.apply(repeat.id,{dryRun:false,stage:true});assert.equal(repeated.alreadyApplied,true);await workspace.save('Objects',{backup:false});assert.equal(await fs.readFile(file,'utf8'),committed);
 const stale=await placement.setVariations({assignments:[{objectId:ids[0],variation:2}]});await fs.appendFile(file,'\r\n<!-- concurrent -->');await assert.rejects(()=>placement.apply(stale.id,{dryRun:false,stage:false}),/STALE|changed/i);assert.match(await fs.readFile(file,'utf8'),/concurrent/);
});
