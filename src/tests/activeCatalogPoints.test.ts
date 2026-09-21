import assert from "node:assert/strict";
import test from "node:test";
import {promises as fs} from "node:fs";
import path from "node:path";
import os from "node:os";
import {catalogActivation} from "../modules/data/activation.js";
import {Workspace} from "../core/workspace.js";
import {DataWorkspace} from "../modules/data/workspace.js";
import {BrowseWorkspace} from "../modules/browse/workspace.js";
import {PointWorkspace} from "../modules/placement/points.js";
import {PlacementDocument} from "../modules/placement/document.js";
test("explicit Includes activity, cycles and path escapes are distinct from loose search",async()=>{
 const files=new Map([['Base.SC2Data/GameData.xml','<Includes><Catalog path="GameData/Active.xml"/></Includes>'],['Base.SC2Data/GameData/Active.xml','<Catalog><CUnit id="A"/></Catalog>']]);assert.equal((await catalogActivation(async f=>files.get(f))).files.has('base.sc2data/gamedata/active.xml'),true);
 files.set('Base.SC2Data/GameData/Active.xml','<Includes><Catalog path="../GameData.xml"/></Includes>');await assert.rejects(catalogActivation(async f=>files.get(f)),/INCLUDE_CYCLE/);
 files.set('Base.SC2Data/GameData.xml','<Includes><Catalog path="../../other.xml"/></Includes>');await assert.rejects(catalogActivation(async f=>files.get(f)),/PATH_ESCAPE/);
});
test("inactive loose catalog can be researched but cannot pass dependency readiness",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-active-'));try{await fs.mkdir(path.join(root,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Active.xml"/></Includes>');await fs.writeFile(path.join(root,'Base.SC2Data/GameData/Active.xml'),'<Catalog><CUnit id="A"/></Catalog>');await fs.writeFile(path.join(root,'Base.SC2Data/GameData/Inactive.xml'),'<Catalog><CUnit id="B"/></Catalog>');const w=new Workspace(root),data=new DataWorkspace(w),browse=new BrowseWorkspace(w,data);assert.equal((await browse.resolve({id:'A',catalogType:'Unit'})).dependencyReady,true);assert.equal((await browse.resolve({id:'B',catalogType:'Unit'})).dependencyReady,false);assert.deepEqual((await data.context({activeOnly:true})).objects.map(o=>o.id),['A']);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test("native points share IDs with units, preserve unknown XML and stage/save together with manifest",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-points-'));try{const original='<PlacedObjects Version="27"><!--keep--><ObjectUnit Id="8" UnitType="Marine" Position="0,0,0"/><ObjectPoint Id="2" Name="Old" Position="1,2,3" Unknown="retain"/></PlacedObjects>';await fs.writeFile(path.join(root,'Objects'),original);const w=new Workspace(root),points=new PointWorkspace(w);const plan=await points.plan({operations:[{op:'create',name:"Spawn's & Start",position:{x:10,y:12,z:0},type:'StartLoc'},{op:'update',id:2,name:'Renamed'}]});assert.deepEqual(plan.createdIds,[9]);await points.apply(plan.planId,false);assert.equal(await fs.readFile(path.join(root,'Objects'),'utf8'),original);await w.save('Objects',{backup:false});const final=await fs.readFile(path.join(root,'Objects'),'utf8');assert.match(final,/Unknown="retain"/);assert.match(final,/ObjectUnit Id="8" UnitType="Marine" Position="0,0,0"/);assert.equal((await points.inspect()).points.length,2);assert.match(await fs.readFile(path.join(root,'ComponentList.SC2Components'),'utf8'),/Type="plob"/);assert.throws(()=>new PlacementDocument(final).addPoint({objectId:8,name:'Duplicate',position:{x:0,y:0,z:0}}),/DUPLICATE_POINT_ID/);}finally{await fs.rm(root,{recursive:true,force:true});}
});
