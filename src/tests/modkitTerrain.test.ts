import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {ModkitIntegration,modkitAvailable,modkitHome} from '../integrations/modkit/runtime.js';
import {ModkitTerrainWorkspace} from '../modules/terrain/modkitWorkspace.js';
import {modkitTerrainPlanSchema} from '../modules/terrain/modkitSchemas.js';
const optional={skip:!modkitAvailable()};
let held:Promise<any>|undefined;
async function runtime(){return held??= (async()=>{
  const req=createRequire(path.join(modkitHome(),'package.json')),load=(n:string)=>import(pathToFileURL(req.resolve(n)).href);
  const [f,n,o,{createTerrainApi}]=await Promise.all([load('@modkit/blizzard-starcraft2/map/format'),load('@modkit/blizzard-starcraft2/map/navigation'),load('@modkit/blizzard-starcraft2/map/overview'),import(new URL('../../scripts/modkit/terrain-api.mjs',import.meta.url).href)]);
  return {f,n,o,api:createTerrainApi(f,n,o)};
})();}
function fixture(f:any,size=8){
  const files=new Map<string,Uint8Array>(),tail=new Uint8Array([201,202,203]);
  files.set('t3Terrain.xml',Buffer.from(`<terrain version="115"><heightMap dim="${size+1} ${size+1}" scale="1 1 1" offset="0 0 0" tileSet="Agria"><vertData name="t3HeightMap" quantizeScale="0.1" quantizeBias="0" standardHeight="8"/><cliffSetList num="1"><cliffSet i="0" name="AgriaCliff0"/></cliffSetList><cliffCellList num="${size*size/4}" numOccupied="0"/><rampList num="0"/><unknown keep="yes"/></heightMap></terrain>`));
  files.set('t3HeightMap',f.writeHeightMap({sizeX:size+1,sizeY:size+1,version:101,cells:Array.from({length:(size+1)**2},()=>({heightBase:80,heightAdjustments:0,mask:1})),_raw:{padding:new Uint8Array(16).fill(71),trailing:tail}}));
  files.set('t3SyncHeightMap',f.writeSyncHeightMap({sizeX:size+1,sizeY:size+1,version:100,cells:Array.from({length:(size+1)**2},()=>({height:2048,mask:1})),_raw:{headerExtra:new Uint8Array(48).fill(17),trailing:tail}}));
  files.set('t3SyncCliffLevel',f.writeSyncCliffLevel({sizeX:size,sizeY:size,version:100,heights:Array(size**2).fill(64),_raw:{padding:new Uint8Array(16).fill(18),trailing:tail}}));
  files.set('t3CellFlags',f.writeCellFlags({sizeX:size,sizeY:size,version:102,types:new Uint8Array(size**2).fill(128),_raw:{zero:new Uint8Array(16).fill(19),trailing:tail}}));
  for(const name of ['CellAttribute_Pnp','CellAttribute_Pnb','CellAttribute_Pcl'])files.set(name,f.writeCellAttribute({sizeX:size,sizeY:size,cells:new Uint8Array(size**2),_raw:{header:new Uint8Array([11,22,33,44]),trailing:tail}}));
  files.set('t3FluffDoodad',f.writeFluffDoodad({version:100,doodads:[{x:1.25,y:2.5,type:2}],_raw:{zero:new Uint8Array(16).fill(20),trailing:tail}}));
  files.set('t3SyncPathingInfo',f.writePathingInfo({sizeX:size,sizeY:size,version:100,blocks:Array(size**2).fill(0),_raw:{padding:new Uint8Array(16).fill(21),trailing:tail}}));
  const raw=new Uint8Array(32),view=new DataView(raw.buffer);view.setInt32(4,1,true);view.setFloat32(16,2,true);view.setFloat32(20,2,true);view.setInt32(24,1,true);
  files.set('t3VertCol',f.writeVertexColor({version:104,prologue:new Uint8Array(16).fill(31),entries:[{header:{raw},data:new Uint8Array(9).fill(255)}]}));
  files.set('t3HardTile',f.writeHardTile102({version:102,unk:[1,2,3,4],blocks:[{name:'A',flags:[1,2,3],tailWord:4,subs:[]},{name:'B',flags:[4,5,6],tailWord:8,subs:[]}]},{maxBytes:1024*1024,maxGroups:100,maxRecords:100}));
  const painted=new Uint8Array(16+512*512*2),pv=new DataView(painted.buffer);pv.setInt32(8,512,true);pv.setInt32(12,512,true);files.set('PaintedPathingLayer',painted);files.set('PaintedCreepLayer',painted.slice());
  return files;
}
test('ModKit terrain schemas reject accidental unknown operations and oversized byte values',()=>{
  assert.throws(()=>modkitTerrainPlanSchema.parse({operations:[{op:'pathing.paint',layer:'noPathing',value:256,area:{type:'circle',center:{x:1,y:1},radius:1}}]}));
  assert.throws(()=>modkitTerrainPlanSchema.parse({operations:[{op:'run.code'}]}));
});
test('Original ModKit pathing paint/fill preserves opaque headers, tails and source data',optional,async()=>{
  const {f,api}=await runtime(),files=fixture(f),original=Buffer.from(files.get('CellAttribute_Pnp')!);
  const first=api.plan(files,[{op:'pathing.paint',layer:'noPathing',value:255,area:{type:'rectangle',minX:4,minY:0,maxX:5,maxY:8}}]);
  const painted=f.readCellAttribute(first.next.get('CellAttribute_Pnp'),{sizeX:8,sizeY:8});
  assert.equal(painted.cells.filter((v:number)=>v===255).length,8);assert.deepEqual(Buffer.from(files.get('CellAttribute_Pnp')!),original);
  assert.deepEqual([...painted._raw.header],[11,22,33,44]);assert.deepEqual([...painted._raw.trailing],[201,202,203]);
  const filled=api.plan(first.next,[{op:'pathing.fill',layer:'noPathing',value:255,seed:{x:0,y:0}}]);
  const grid=f.readCellAttribute(filled.next.get('CellAttribute_Pnp'),{sizeX:8,sizeY:8});
  assert.equal(filled.reports[0].changed,32);assert.equal(grid.cells[7],0);assert.equal(grid.cells[0],255);
});
test('A missing pathing mask uses the supplied native header without inheriting donor cells',optional,async()=>{
  const {f,api}=await runtime(),files=fixture(f,8);
  files.set('CellAttribute_Pnp',f.writeCellAttribute({sizeX:4,sizeY:4,cells:new Uint8Array(16).fill(255),_raw:{header:new Uint8Array([4,3,2,1]),trailing:new Uint8Array()}}));
  const result=api.plan(files,{templateComponents:['CellAttribute_Pnp'],operations:[{op:'pathing.paint',layer:'noPathing',value:255,area:{type:'rectangle',minX:0,minY:0,maxX:1,maxY:1}}]});
  const data=f.readCellAttribute(result.next.get('CellAttribute_Pnp'),{sizeX:8,sizeY:8});assert.equal(data.cells.length,64);assert.equal(data.cells.filter((v:number)=>v===255).length,1);assert.deepEqual([...data._raw.header],[4,3,2,1]);
});
test('Raw painted channels, scalar vertex values, fluff and PATH hints reuse ModKit writers',optional,async()=>{
  const {f,api}=await runtime(),files=fixture(f);
  const result=api.plan(files,[{op:'painted.set',layer:'PaintedPathingLayer',channel:'secondary',cells:[{x:2,y:3,value:77}]},{op:'painted.set',layer:'PaintedCreepLayer',channel:'primary',cells:[{x:4,y:5,value:5}]},{op:'vertexColor.set',values:[{entry:0,index:4,value:99}]},{op:'fluff.add',doodads:[{x:3,y:4,type:7}]},{op:'fluff.set',doodads:[{index:0,x:5,y:6,type:4}]},{op:'fluff.remove',indices:[1]},{op:'pathing.hints',cells:[{x:2,y:2,value:35}]}]);
  assert.equal(f.paintedValueAt(f.readPaintedPathing(result.next.get('PaintedPathingLayer')),2,3,true),77);
  assert.equal(f.paintedValueAt(f.readPaintedPathing(result.next.get('PaintedCreepLayer')),4,5),5);
  assert.equal(f.readVertexColor(result.next.get('t3VertCol')).entries[0].data[4],99);
  const fluff=f.readFluffDoodad(result.next.get('t3FluffDoodad'));assert.deepEqual(fluff.doodads,[{x:5,y:6,type:4}]);assert.deepEqual([...fluff._raw.trailing],[201,202,203]);
  assert.equal(f.readPathingInfo(result.next.get('t3SyncPathingInfo')).blocks[18],35);
});
test('Native road repair changes duplicate keys only; partial roads and opaque VTCL suffix refuse writes',optional,async()=>{
  const {f,api}=await runtime(),files=fixture(f),road=files.get('t3HardTile')!;
  const decoded=f.readHardTile(road);new DataView(road.buffer,road.byteOffset).setUint32(decoded.blocks[1].tailWordOffset,4,true);
  const repaired=api.plan(files,[{op:'hardTile.repair'}]);assert.equal(new Set(f.readHardTile(repaired.next.get('t3HardTile')).blocks.map((b:any)=>b.tailWord)).size,2);
  files.set('t3HardTile',road.slice(0,-1));assert.throws(()=>api.plan(files,[{op:'hardTile.repair'}]));
  const vt=Buffer.concat([files.get('t3VertCol')!,Buffer.from([5])]);files.set('t3VertCol',vt);
  assert.throws(()=>api.plan(files,[{op:'vertexColor.set',values:[{entry:0,index:0,value:5}]}]),/OPAQUE_BYTES_REFUSED/);
});
test('Navigation preview sees a newly painted barrier and does not claim catalog or engine footprints',optional,async()=>{
  const {f,api}=await runtime(),files=fixture(f),before=api.navigation(files,{maxSize:128});
  const modified=api.plan(files,[{op:'pathing.paint',layer:'noPathing',value:255,area:{type:'rectangle',minX:4,minY:0,maxX:5,maxY:8}}]);
  const after=api.navigation(modified.next,{maxSize:128,route:{from:{x:1,y:3},to:{x:7,y:3}}});
  assert.ok(after.summary.counts.walkable<before.summary.counts.walkable);assert.equal(after.summary.route,null);
  assert.equal(after.summary.catalogFootprints,false);assert.equal(after.summary.engineValidated,false);assert.deepEqual([...after.png.slice(0,8)],[137,80,78,71,13,10,26,10]);
});
test('Terrain palette registers native bindings while preserving geometry and mask bytes',optional,async()=>{
  const {f,api}=await runtime(),files=fixture(f),hmap=Buffer.from(files.get('t3HeightMap')!);
  const result=api.plan(files,[{op:'palette.author',terrainId:'CustomTerrain',textures:[{id:'AgriaDirt'}],uvTiling:[1,1,0,0]}]);
  assert.match(Buffer.from(result.next.get('t3Terrain.xml')).toString(),/tileSet="CustomTerrain"/);
  assert.match(Buffer.from(result.next.get('t3Terrain.xml')).toString(),/unknown keep="yes"/);
  assert.deepEqual(Buffer.from(result.next.get('t3HeightMap')),hmap);
});

test('Catalog closure and original footprints affect placed buildings, resources and doodads',optional,async()=>{
  const {f,api}=await runtime(),files=fixture(f,12);
  files.set('Objects',Buffer.from('<PlacedObjects Version="28"><ObjectUnit Id="1" UnitType="Building" Position="3,3,0" Scale="1,1,1" Player="1"/><ObjectUnit Id="2" UnitType="Mineral" Position="7,3,0" Scale="1,1,1" Player="0"/><ObjectDoodad Id="3" Type="Rock" Position="3,8,0" Scale="1,1,1"/></PlacedObjects>'));
  const catalog={entities:[
    {namespace:'Unit',entityId:'Building',fields:{Footprint:'Square'}},
    {namespace:'Unit',entityId:'Mineral',fields:{Footprint:'Square',EditorCategories:'ObjectType:Resource',ResourceType:'Minerals',BehaviorArray:[{index:'0',value:{Link:'Resource'}}]}},
    {namespace:'Actor',entityId:'Rock',fields:{Footprint:'Square'}},
    {namespace:'Footprint',entityId:'Square',fields:{Layers:[{index:'Place',value:{Area:'-1,-1,1,1',Rows:[{index:'0',value:'xx'},{index:'1',value:'xx'}],Sets:[{index:'0',value:{Character:'x',Positive:[{index:'GroundNoSpawn',value:'1'},{index:'NoBuild',value:'1'}]}}]}}]}},
    {namespace:'Behavior',entityId:'Resource',fields:{Contents:'1500'}}
  ]};
  const refs=api.catalogQueries(files,catalog).map((r:any)=>r.namespace+'/'+r.entityId);
  for(const key of ['Unit/Building','Unit/Mineral','Actor/Rock','Footprint/Square','Behavior/Resource'])assert.ok(refs.includes(key));
  const bare=api.navigation(files,{maxSize:128}),withCatalog=api.navigation(files,{maxSize:128,catalogSnapshot:catalog});
  assert.equal(withCatalog.summary.catalogFootprints,true);assert.equal(withCatalog.summary.counts.blockers,2);
  assert.ok(withCatalog.summary.counts.walkable<=bare.summary.counts.walkable-12);
  assert.ok(withCatalog.summary.counts.buildable<bare.summary.counts.buildable);
  assert.equal(withCatalog.summary.engineValidated,false);
  const ignored=new Map(files);ignored.set('Objects',Buffer.from(Buffer.from(files.get('Objects')!).toString().replace('/></PlacedObjects>','><Flag Index="NoDoodadFootprint" Value="1"/></ObjectDoodad></PlacedObjects>')));
  assert.ok(api.navigation(ignored,{maxSize:128,catalogSnapshot:catalog}).summary.counts.walkable>withCatalog.summary.counts.walkable);
});
test('Native ramp transfer keeps donor SMAP samples, CLIF samples and unrelated LFCT bits',optional,async()=>{
  const {f,api}=await runtime(),target=fixture(f,8),donor=fixture(f,4);
  const h=f.readHeightMap(donor.get('t3HeightMap'));h.cells[6].heightAdjustments=10;donor.set('t3HeightMap',f.writeHeightMap(h));
  const sync=f.readSyncHeightMap(donor.get('t3SyncHeightMap'));sync.cells[6].height=2304;sync.cells[6].mask=37;donor.set('t3SyncHeightMap',f.writeSyncHeightMap(sync));
  const clif=f.readSyncCliffLevel(donor.get('t3SyncCliffLevel'));clif.heights[5]=88;donor.set('t3SyncCliffLevel',f.writeSyncCliffLevel(clif));
  const ramp={dir:3,lo:1,hi:2,cliffSetIndex:0,frames:{mid:{up:[1,0],right:[0,-1],center:[2,2],width:1,height:2}},variations:{leftLo:0,rightLo:0}};
  const xml=Buffer.from(donor.get('t3Terrain.xml')!).toString().replace(/<cliffCellList[^>]*\/>/,`<cliffCellList num="4" numOccupied="4">${[0,1,2,3].map(i=>`<cc i="${i}" f="2" cid="0" cvar="0"/>`).join('')}</cliffCellList>`).replace('<rampList num="0"/>',f.writeTerrainRampList([ramp]));
  donor.set('t3Terrain.xml',Buffer.from(xml));
  for(const[name,bytes]of donor)target.set('@donor:Donor:'+name,bytes);
  const op={op:'ramp.template',donorDirectory:'Donor',rampIndex:0,bounds:{minX:0,minY:0,maxX:4,maxY:4},offsetX:2,offsetY:2,levelOffset:0,cliffSetIndex:0,extraHalfWidth:0};
  target.set('t3Terrain.xml',Buffer.from(Buffer.from(target.get('t3Terrain.xml')!).toString().replace('<rampList num="0"/>','<rampList num="0" custom="keep"/>').replace('<cliffCellList ','<cliffCellList custom="keep" ')));
  const result=api.plan(target,[op]),after=f.readHeightMap(result.next.get('t3HeightMap'));
  assert.equal(after.cells[3*9+3].heightAdjustments,10);
  assert.equal(f.readSyncHeightMap(result.next.get('t3SyncHeightMap')).cells[3*9+3].height,2304);
  assert.equal(f.readSyncHeightMap(result.next.get('t3SyncHeightMap')).cells[3*9+3].mask,37);
  assert.equal(f.readSyncCliffLevel(result.next.get('t3SyncCliffLevel')).heights[3*8+3],88);
  assert.ok(f.readCellFlags(result.next.get('t3CellFlags')).types.every((v:number)=>(v&128)===128));
  assert.equal(f.parseTerrainXml(Buffer.from(result.next.get('t3Terrain.xml')).toString()).ramps.length,1);
  assert.match(Buffer.from(result.next.get('t3Terrain.xml')).toString(),/<rampList [^>]*custom="keep"/);
  assert.match(Buffer.from(result.next.get('t3Terrain.xml')).toString(),/<cliffCellList [^>]*custom="keep"/);
  assert.throws(()=>api.plan(target,[{...op,offsetX:1}]),/lattice/);
});

test('Diagonal ramp fitting and widening keep all native height channels aligned',optional,async()=>{
  const {f,api}=await runtime(),donor=fixture(f,12),target=fixture(f,16),ramp={dir:5,lo:1,hi:2,cliffSetIndex:0,
    frames:{mid:{up:[Math.SQRT1_2,-Math.SQRT1_2],right:[-Math.SQRT1_2,-Math.SQRT1_2],center:[6,6],width:2*Math.SQRT2,height:2*Math.SQRT2},
      leftLo:{up:[1,0],right:[0,-1],center:[8,8],width:2,height:2},rightLo:{up:[1,0],right:[0,-1],center:[4,4],width:2,height:2}},variations:{leftLo:0,rightLo:0}};
  const h=f.readHeightMap(donor.get('t3HeightMap'));h.cells[6*13+6].heightAdjustments=Math.round(f.cliffLevelOffsetZ(6)/0.1);donor.set('t3HeightMap',f.writeHeightMap(h));
  const sync=f.readSyncHeightMap(donor.get('t3SyncHeightMap'));sync.cells[6*13+6].height=2304;donor.set('t3SyncHeightMap',f.writeSyncHeightMap(sync));
  const clif=f.readSyncCliffLevel(donor.get('t3SyncCliffLevel'));clif.heights[6*12+6]=88;donor.set('t3SyncCliffLevel',f.writeSyncCliffLevel(clif));
  donor.set('t3Terrain.xml',Buffer.from(Buffer.from(donor.get('t3Terrain.xml')!).toString().replace(/<cliffCellList[^>]*\/>/,`<cliffCellList num="36" numOccupied="36">${Array.from({length:36},(_,i)=>`<cc i="${i}" f="2" cid="0" cvar="0"/>`).join('')}</cliffCellList>`).replace('<rampList num="0"/>',f.writeTerrainRampList([ramp]))));
  const bounds={minX:2,minY:2,maxX:10,maxY:10},fit=api.fit(donor,{rampIndex:0,bounds,crossings:Array.from({length:7},(_,i)=>({x:3+i,y:3+i})),uphill:{x:Math.SQRT1_2,y:-Math.SQRT1_2}});
  assert.equal(fit.candidates[0].extraHalfWidth,2);
  for(const[name,bytes]of donor)target.set('@donor:Donor:'+name,bytes);
  const op={op:'ramp.template',donorDirectory:'Donor',rampIndex:0,bounds,offsetX:2,offsetY:2,levelOffset:0,cliffSetIndex:0,extraHalfWidth:2},result=api.plan(target,[op]);
  const params=f.parseTerrainXml(Buffer.from(result.next.get('t3Terrain.xml')).toString()),after=f.readHeightMap(result.next.get('t3HeightMap'));
  assert.equal(f.cliffVertexLevels(after,params).levels[10*17+10],6);
  assert.equal(f.readSyncHeightMap(result.next.get('t3SyncHeightMap')).cells[10*17+10].height,2304);
  assert.equal(f.readSyncCliffLevel(result.next.get('t3SyncCliffLevel')).heights[10*16+10],88);
  assert.ok(Math.abs(params.ramps[0].frames.mid.width-4*Math.SQRT2)<1e-5);
  assert.throws(()=>api.plan(target,[{...op,extraHalfWidth:1}]),/two-cell/);
});
test('Shared terrain plans remain dry until apply/save and guard unrelated dependencies',optional,async t=>{
  const {f,api}=await runtime(),root=await fs.mkdtemp(path.join(os.tmpdir(),'modkit-terrain-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'Map'));for(const[name,bytes]of fixture(f))await fs.writeFile(path.join(root,'Map',name),bytes);
  const workspace=new Workspace(root),integration=new ModkitIntegration(workspace,path.join(root,'missing'));
  integration.port=async()=>({terrain:async(view:string,files:any,args:any)=>api[view](files,args)}) as any;
  const terrain=new ModkitTerrainWorkspace(integration),before=await fs.readFile(path.join(root,'Map','CellAttribute_Pnp'));
  const p=await terrain.plan({directory:'Map',operations:[{op:'pathing.paint',layer:'noPathing',value:255,area:{type:'circle',center:{x:2,y:2},radius:1}}]});
  await terrain.apply(p.planId);assert.deepEqual(await fs.readFile(path.join(root,'Map','CellAttribute_Pnp')),before);
  await terrain.apply(p.planId,false);assert.deepEqual(await fs.readFile(path.join(root,'Map','CellAttribute_Pnp')),before);
  assert.ok((await terrain.apply(p.planId,false)).alreadyApplied);
  await workspace.binary.saveContaining('Map/CellAttribute_Pnp',{dryRun:false});assert.notDeepEqual(await fs.readFile(path.join(root,'Map','CellAttribute_Pnp')),before);
  const palette=await terrain.plan({directory:'Map',operations:[{op:'palette.author',terrainId:'Custom',textures:[{id:'AgriaDirt'}],uvTiling:[1,1,0,0]}]});
  assert.ok(palette.files.some((v:any)=>v.file.endsWith('Base.SC2Data/GameData.xml')));
  const nav={directory:'Map',planId:palette.planId,profile:'NORMAL_GROUND',maxSize:128};
  await assert.rejects(terrain.navigation(nav),/CATALOG_PLAN/);
  assert.equal((await terrain.navigation({...nav,catalog:false})).catalogFootprints,false);
  const stale=await terrain.plan({directory:'Map',operations:[{op:'fluff.remove',indices:[0]}]});await fs.writeFile(path.join(root,'Map','Objects'),'changed');
  await assert.rejects(terrain.apply(stale.planId,false),/STALE/);
  await assert.rejects(terrain.inspect({directory:'Map',component:'../outside',offset:0,limit:1}),/REFUSED/);
});
