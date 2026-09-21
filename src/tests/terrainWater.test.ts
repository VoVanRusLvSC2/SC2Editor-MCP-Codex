import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { Workspace } from "../core/workspace.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { WaterEntries } from "../modules/terrain/document.js";
import { WaterCatalog } from "../modules/terrain/waterCatalog.js";
import { parseTerrainRecipe } from "../modules/terrain/xmlRecipe.js";
import { packArchive, extractArchive } from "../archive/archiveAdapter.js";
const area = {type:"rectangle" as const,minX:8,minY:8,maxX:16,maxY:16};
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"sc2-water-"));
  for(const name of await fs.readdir("src/tests/fixtures/terrain-native/nydus"))
    await fs.writeFile(path.join(root,name.slice(0,-3)),gunzipSync(await fs.readFile(path.join("src/tests/fixtures/terrain-native/nydus",name))));
  const catalog = path.join(root,"Base.SC2Data/GameData/WaterData.xml");await fs.mkdir(path.dirname(catalog),{recursive:true});
  await fs.writeFile(catalog,'<?xml version="1.0" encoding="us-ascii"?><Catalog><!--keep--><CWater id="BaseWater"><State index="0" Height="2"><Color value="0,0,1,0.3"/><Unknown value="retain"/></State><State index="1" Height="9"/></CWater></Catalog>');
  const workspace = new Workspace(root);return {root,catalog,workspace,terrain:new TerrainWorkspace(workspace),cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test("GitHub native water profile: 18 grid rectangles, lossless untouched rows and header",async()=>{
 const bytes=gunzipSync(await fs.readFile("src/tests/fixtures/water-native/github-t3Water.gz"));const w=new WaterEntries(bytes);
 assert.equal(w.count,18);assert.equal(w.coverageKnown,true);assert.equal(w.at({x:196,y:236})[0].template,"BraxisAlpha");
 const changed=w.edit("update",0,{...area,minX:200,maxX:208});assert.deepEqual(changed.subarray(88),bytes.subarray(88));assert.deepEqual(changed.subarray(0,32),bytes.subarray(0,32));
 assert.throws(()=>w.edit("create",0,{...area,minX:9}),/8_CELL_GRID/);
 assert.throws(()=>w.edit("create",0,{type:"rectangle",minX:192,minY:232,maxX:200,maxY:240}),/OVERLAP/);
 const opaque=Buffer.from(bytes);opaque.writeUInt32LE(1,12);assert.equal(new WaterEntries(opaque).coverageKnown,false);assert.throws(()=>new WaterEntries(opaque).edit("remove",0),/WRITER_UNAVAILABLE/);
});
test("water material preserves native attribute and child fields, comments, unknown fields and other states",async()=>{
 const f=await fixture();try {
  const old=await fs.readFile(f.catalog,"utf8");const next=new WaterCatalog(old).patch({id:"BaseWater",height:6,color:[0.2,0.4,0.6,0.8],isLava:true});
  assert.match(next,/Height="6.000000"/);assert.match(next,/<Color value="0.200000,0.400000,0.600000,0.800000"/);assert.match(next,/<!--keep-->/);assert.match(next,/<Unknown value="retain"\/>/);assert.match(next,/<State index="1" Height="9"\/>/);assert.match(next,/<IsLava value="1"\/>/);
  const unicode=new WaterCatalog(old).patch({id:"Вода",parent:"BaseWater",height:3});assert.match(unicode,/encoding="utf-8"/);assert.match(unicode,/id="Вода" parent="BaseWater"/);
  assert.throws(()=>new WaterCatalog(old).patch({id:"New",height:1}),/REQUIRES_PARENT/);
 }finally{await f.cleanup();}
});
test("water rectangle and isolated CWater state commit together, stage leaves disk intact and MPQ preserves both",async()=>{
 const f=await fixture();const out=await fs.mkdtemp(path.join(os.tmpdir(),"sc2-water-pack-"));try{
  const original=await fs.readFile(f.catalog);const plan=await f.terrain.plan({operations:[{op:"water.material",id:"Lake",parent:"BaseWater",height:6,color:[0.1,0.3,0.5,0.4]},{op:"water.create",template:"Lake",area}]});
  const planned=await f.terrain.state("",plan.id);assert.equal(planned.water?.count,1);assert.equal(planned.waterCatalog?.list().find(x=>x.id==="Lake")?.states[0].fields.Height,"6.000000");
  const applied=await f.terrain.apply(plan.id,{dryRun:false,stage:true});assert.equal(new WaterEntries(await fs.readFile(path.join(f.root,"t3Water"))).count,0);assert.deepEqual(await fs.readFile(f.catalog),original);
  await f.terrain.save(applied.transaction!.transactionId!,{dryRun:false,backup:false});assert.equal((await f.terrain.surface()).sampleGround({x:12,y:12}).water?.[0].template,"Lake");
  const archive=path.join(out,"Water.SC2Map");await packArchive(f.root,archive,{backup:false});await extractArchive(archive,path.join(out,"reopened"));
  assert.deepEqual(await fs.readFile(path.join(out,"reopened/t3Water")),await fs.readFile(path.join(f.root,"t3Water")));assert.deepEqual(await fs.readFile(path.join(out,"reopened/Base.SC2Data/GameData/WaterData.xml")),await fs.readFile(f.catalog));
 }finally{await f.cleanup();await fs.rm(out,{recursive:true,force:true});}
});
test("water plan guards catalog external changes and unresolved templates before publication",async()=>{
 const f=await fixture();try{
  await assert.rejects(f.terrain.plan({operations:[{op:"water.create",template:"Missing",area}]}),/DEPENDENCY_UNAVAILABLE/);
  const p=await f.terrain.plan({operations:[{op:"water.create",template:"BaseWater",area}]});await fs.appendFile(f.catalog,"<!--external-->");await assert.rejects(f.terrain.apply(p.id,{dryRun:false}),/STALE_TERRAIN_PLAN/);
  assert.equal(new WaterEntries(await fs.readFile(path.join(f.root,"t3Water"))).count,0);
 }finally{await f.cleanup();}
});
test("XML water DSL supports material, create, update and remove with strict attributes",()=>{
 const p=parseTerrainRecipe('<TerrainRecipe version="1"><Area id="lake" shape="rectangle" min="8,8" max="16,16"/><WaterMaterial id="Lake" parent="BaseWater" height="6" color="0.1,0.3,0.5,0.4"/><Water area="lake" template="Lake"/><UpdateWater area="lake" index="0"/><RemoveWater index="0"/></TerrainRecipe>');assert.deepEqual(p.operations.map(o=>o.op),["water.material","water.create","water.update","water.remove"]);
 assert.throws(()=>parseTerrainRecipe('<TerrainRecipe version="1"><WaterMaterial id="x" parent="y" wrong="1"/></TerrainRecipe>'),/UNKNOWN_RECIPE_ATTRIBUTE/);
});

test("staged water settings keep complete catalog read guards without rejecting their own Includes/manifest writes",async()=>{
 const f=await fixture();try{
  const {BrowseWorkspace}=await import("../modules/browse/workspace.js");const {DataWorkspace}=await import("../modules/data/workspace.js");
  const terrain=new TerrainWorkspace(f.workspace,new BrowseWorkspace(f.workspace,new DataWorkspace(f.workspace)));
  const p=await terrain.plan({operations:[{op:"water.material",id:"Lake",parent:"BaseWater",height:5},{op:"water.create",template:"Lake",area}]});
  const a=await terrain.apply(p.id,{dryRun:false,stage:true});
  const external=path.join(f.root,"Base.SC2Data/GameData/OtherWater.xml");await fs.writeFile(external,'<Catalog><CWater id="External"/></Catalog>');
  await assert.rejects(terrain.save(a.transaction!.transactionId!,{dryRun:false,backup:false}),/STALE_WATER_DEPENDENCIES/);
  assert.equal(new WaterEntries(await fs.readFile(path.join(f.root,"t3Water"))).count,0);
  await fs.unlink(external);await terrain.save(a.transaction!.transactionId!,{dryRun:false,backup:false});
  assert.match(await fs.readFile(path.join(f.root,"Base.SC2Data/GameData.xml"),"utf8"),/GameData\/WaterData.xml/);
  assert.match(await fs.readFile(path.join(f.root,"ComponentList.SC2Components"),"utf8"),/Type="gada"/);
 }finally{await f.cleanup();}
});

test("nine native Nova campaign water tables preserve all 175 grid assignments in no-op writes",async()=>{
 let count=0;
 for(let i=1;i<=9;i++) {
  const name=`nova0${i}.sc2map-t3Water.gz`;const bytes=gunzipSync(await fs.readFile(path.join("src/tests/fixtures/water-native",name)));const w=new WaterEntries(bytes);assert.equal(w.coverageKnown,true,name);count+=w.count;
  for(const record of w.list().entries) {
   assert.ok(record.area,name);assert.deepEqual(w.edit("update",record.index,record.area!),bytes,`${name}:${record.index}`);
  }
 }
 assert.equal(count,175);
});

test("local water inheritance rejects missing parents and cycles before editing terrain",async()=>{
 const f=await fixture();try {
  await fs.writeFile(f.catalog,'<Catalog><CWater id="Broken" parent="Missing"/><CWater id="A" parent="B"/><CWater id="B" parent="A"/></Catalog>');
  await assert.rejects(f.terrain.plan({operations:[{op:"water.create",template:"Broken",area}]}),/DEPENDENCY_UNAVAILABLE/);
  await assert.rejects(f.terrain.plan({operations:[{op:"water.create",template:"A",area}]}),/PARENT_CYCLE/);
  assert.equal(new WaterEntries(await fs.readFile(path.join(f.root,"t3Water"))).count,0);
 }finally {await f.cleanup();}
});
