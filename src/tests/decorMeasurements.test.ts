import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {ModelMeasurements,measureGeometry,type Geometry,type MeasuredModel} from '../modules/assets/measurement.js';
import {attachmentMeasurements} from '../modules/assets/attachmentMeasurements.js';
import {modelSheetSvg,modelSheetPng} from '../modules/assets/measurementRender.js';
import {layoutPrefab,overlaps,type Slot} from '../modules/placement/decorPrefabs.js';
import {DecorPalette,catalogScale,type DecorModel} from '../modules/placement/decorPalette.js';
import {BrowseWorkspace} from '../modules/browse/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {DataSchemaRegistry} from '../modules/data/schemaRegistry.js';
import type {CascWorkspace} from '../modules/casc/workspace.js';
import {compileAuthorScript} from '../app/authoringScript.js';

function m3(){const b=Buffer.alloc(600),sections=[['MODL',24,1,23],['U8__',160,96,0],['DIV_',256,1,2],['U16_',308,3,0],['REGN',320,1,3]] as const;const tag=(s:string,at:number)=>b.write(s.split('').reverse().join(''),at);tag('MD34',0);b.writeUInt32LE(512,4);b.writeUInt32LE(sections.length,8);const ref=(at:number,n:number,index:number)=>{b.writeUInt32LE(n,at);b.writeUInt32LE(index,at+4);};ref(12,1,0);b.writeUInt32LE(0x182007d,120);ref(124,96,1);ref(136,1,2);ref(256,3,3);ref(268,1,4);b.writeFloatLE(1,192);b.writeFloatLE(1,228);b.writeUInt16LE(1,310);b.writeUInt16LE(2,312);b.writeUInt32LE(3,332);b.writeUInt32LE(3,340);sections.forEach(([s,off,n,v],i)=>{const at=512+i*16;tag(s,at);b.writeUInt32LE(off,at+4);b.writeUInt32LE(n,at+8);b.writeUInt32LE(v,at+12);});return b;}
function box(width:number,depth:number,height:number,offset=[0,0,0]):MeasuredModel{
 const positions=[];for(const x of [0,width])for(const y of [0,depth])for(const z of [0,height])positions.push(x+offset[0],y+offset[1],z+offset[2]);
 const indices=[0,2,6,0,6,4,1,5,7,1,7,3,0,1,3,0,3,2,4,6,7,4,7,5,0,4,5,0,5,1,2,3,7,2,7,6];
 const geometry={positions,indices,vertexCount:8,triangleCount:12,regions:1,stride:12,bounds:{min:offset,max:[width,depth,height]},pose:'raw-rest-geometry',materials:false,animations:false} as Geometry;
 return {file:'box.m3',sha256:createHash('sha256').update(JSON.stringify(positions)).digest('hex'),build:'test',geometry,transform:{},measurement:measureGeometry(geometry),attachmentNames:[],cacheHit:false};
}
function slots():Slot[]{return [['fence',box(4,.5,2,[3,-2,-.3])],['light',box(.5,.5,4)],['prop',box(1.5,2,2)],['tree',box(3,4,7)]] .map(([name,measured])=>({name:name as string,decor:{actor:{id:name+'Actor',key:'Actor:'+name},measured,variation:0,scales:{combined:[1,1,1]}} as DecorModel}));}

test('geometry dimensions use referenced vertices and full nonuniform rotated transform, preserving source',()=>{
 const g=box(2,3,4,[1,-2,-1]).geometry;g.positions.push(999,999,999);const before=JSON.stringify(g),m=measureGeometry(g,{scale:[2,3,4],rotation:Math.PI/2,position:[10,20,30]});
 assert.deepEqual(m.dimensions,{width:9,depth:4,height:16});assert.deepEqual(m.bounds,{min:[7,22,26],max:[16,26,42]});assert.deepEqual(m.pivot,[10,20,30]);assert.equal(m.groundOffset,4);assert.equal(JSON.stringify(g),before);
 assert.throws(()=>measureGeometry({positions:[0,0,0],indices:[1]}),/VERTEX_INDEX/);assert.throws(()=>measureGeometry({positions:[NaN,0,0],indices:[0]}),/NONFINITE/);
 assert.deepEqual(catalogScale('1,2,3'),[1,2,3]);assert.throws(()=>catalogScale('0,1,1'),/SCALE_UNSUPPORTED/);
});
test('authored attachment position is recovered from its actual inverse bind, not AABB endpoints',()=>{
 const b=Buffer.alloc(300);b.write('43DM');b.writeUInt32LE(240,4);b.writeUInt32LE(3,8);
 [['ATT_',32,1,1],['CHAR',60,6,0],['IREF',80,1,0]].forEach(([tag,off,n,v],i)=>{const at=240+i*16;b.write((tag as string).split('').reverse().join(''),at);b.writeUInt32LE(off as number,at+4);b.writeUInt32LE(n as number,at+8);b.writeUInt32LE(v as number,at+12);});
 b.writeUInt32LE(6,36);b.writeUInt32LE(1,40);b.write('Origin',60);[1,0,0,0,0,1,0,0,0,0,1,0,-2,-3,-4,1].forEach((v,i)=>b.writeFloatLE(v,80+i*4));
 const a=attachmentMeasurements(b,{scale:2,position:[1,0,0]});assert.deepEqual(a.issues,[]);assert.deepEqual(a.attachments[0].position,[5,6,8]);assert.equal(a.attachments[0].name,'Origin');
 b.writeUInt32LE(99,48);assert.match(attachmentMeasurements(b).issues[0],/BIND_UNAVAILABLE/);
});
test('contact sheet retains shared units, escapes labels, fits Marine reference and produces deterministic PNG',async()=>{
 const small=box(1,1,2),large=box(8,4,5),cards=[{id:'<small>',model:small},{id:'large',model:large}],r=modelSheetSvg(cards,{view:'side',reference:box(1,1,2)});
 assert.equal(r.reference,true);assert.match(r.svg,/&lt;small&gt;/);assert.equal((r.svg.match(/stroke="#f2df94"/g)??[]).length,2);assert.ok(r.pixelsPerUnit<30);
 const first=await modelSheetPng(cards),second=await modelSheetPng(cards);assert.deepEqual(first.bytes,second.bytes);assert.equal(first.bytes.readUInt32BE(16),720);assert.throws(()=>modelSheetSvg([]),/1_TO_12/);
});
test('all ready groups preserve a measured corridor and actual noncentral pivot offsets',()=>{
 for(const recipe of ['base_entrance','service_yard','landing_pad','forest_edge'] as const){const r=layoutPrefab(recipe,slots(),6,42);assert.ok(r.members.length>=5);for(const b of r.bounds)assert.equal(overlaps(b,r.reserved[0]),false);assert.deepEqual(r,layoutPrefab(recipe,slots(),6,42));}
 const gate=layoutPrefab('base_entrance',slots(),6,42);assert.equal(gate.members[0].heightOffset,.3);assert.notEqual(gate.members[0].offset.x,-5);assert.match(String(gate.connections[0].evidence),/not verified sockets/);
 assert.throws(()=>layoutPrefab('base_entrance',[],6,42),/SLOT_REQUIRED/);
});
test('Actor -> Model -> CASC passport composes scales; palette joins original catalog and reuses derived image cache',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'decor-measure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
 const actors=path.join(root,'Base.SC2Data/GameData/ActorData.xml'),models=path.join(root,'Base.SC2Data/GameData/ModelData.xml');
 await fs.writeFile(actors,(await fs.readFile(actors,'utf8')).replace('<Model value="AgriaTreeModel"/>','<Model value="AgriaTreeModel"/><Scale value="2,3,4"/>'));
 await fs.writeFile(models,(await fs.readFile(models,'utf8')).replace('<CModel id="AgriaTreeModel" parent="Doodad">','<CModel id="AgriaTreeModel" parent="Doodad"><ScaleMin value="1.25,1.25,1.25"/><ScaleMax value="1.25,1.25,1.25"/>'));
 const bytes=m3(),file='mods/liberty.sc2mod/base.sc2assets/assets/doodads/agria/tree/agriatree.m3';let paths=[file];
 const casc={read:async()=>({bytes,metadata:{sha256:createHash('sha256').update(bytes).digest('hex'),buildKey:'test'},cacheHit:true}),search:async(_prefix:string,query:string,_offset:number,limit:number)=>{assert.ok(query.includes('assets/doodads/agria/tree/'));assert.equal(limit,100);return {items:paths.map(path=>({path})),nextOffset:null};}} as unknown as CascWorkspace;
 const ws=new Workspace(root),browse=new BrowseWorkspace(ws,new DataWorkspace(ws,new DataSchemaRegistry())),measurements=new ModelMeasurements(ws,casc),palette=new DecorPalette(browse,measurements);
 const d=await palette.measure({id:'AgriaTree',scale:2,preview:false});assert.deepEqual(d.scales.combined,[5,7.5,10]);assert.equal(d.footprint.status,'not_evaluated');assert.equal(d.connectors.evidence.includes('candidates only'),true);
 const first=await palette.palette({tileset:'Agria',ids:['AgriaTree'],reference:false}),second=await palette.palette({tileset:'Agria',ids:['AgriaTree'],reference:false});assert.ok(first.pngFile);assert.equal(second.cacheHit,true);assert.equal(first.pngFile,second.pngFile);assert.ok((await fs.stat(first.pngFile!)).size>1000);
 const failed=await palette.palette({tileset:'Agria',ids:['DefinitelyMissing'],reference:false});assert.equal(failed.pngFile,undefined);assert.equal(failed.items[0].status,'unavailable');
 paths=[file.replace('.m3','_00.m3'),file.replace('.m3','_02.m3')];await fs.writeFile(models,(await fs.readFile(models,'utf8')).replace('<CModel id="AgriaTreeModel" parent="Doodad">','<CModel id="AgriaTreeModel" parent="Doodad"><VariationCount value="3"/>'));
 await assert.rejects(palette.measure({id:'AgriaTree',preview:false}),/VARIATION_REQUIRED/);
 const variant=await palette.measure({id:'AgriaTree',variation:2,preview:false});assert.match(variant.file,/_02\.m3$/);
 await assert.rejects(palette.measure({id:'AgriaTree',variation:1,preview:false}),/VARIATION_OUT_OF_RANGE/);
 const placed=await palette.measure({objectId:101,variation:0,preview:false});assert.deepEqual(placed.scales.placement,[1.0583,1.0583,1.0583]);
});
test('short author commands support measurement/palette and owned assembly save lifecycle',()=>{
 const result=compileAuthorScript('terrain assemble zone=gate tileset=Agria recipe=base_entrance at=40,50 clearance=6 includeImage=false','save');
 assert.equal(result[0].tool,'terrain.assemble');assert.deepEqual(result[0].args.anchor,{x:40,y:50});assert.equal(result[0].args.dryRun,false);assert.equal(result[1].tool,'modkit.save');
 const read=compileAuthorScript('terrain measure id=ChainLinkFenceStraight\nterrain palette_preview tileset=Agria limit=6','plan');assert.equal(read.length,2);
});
