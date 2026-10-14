import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Workspace } from "../core/workspace.js";
import { CascWorkspace,parseCascBuildInfo } from "../modules/casc/workspace.js";
import { DocumentWorkspace } from "../modules/document/workspace.js";
import { documentPlanSchema } from "../modules/document/schemas.js";
import { readDocumentHeader,versionMarker,readVersion,documentInfo,readDocumentInfo } from "../modules/document/codecs/metadata.js";
import { createMapInfo,validateEmptyMapInfo } from "../modules/document/codecs/mapInfoFactory.js";
import { validateTerrainLoadContract } from "../modules/document/codecs/terrainLoadContract.js";
import { createFlatTerrain } from "../modules/document/codecs/flatTerrainFactory.js";
import { resolveTerrainCatalogs } from "../modules/document/dependencies.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { inspectArchive,extractArchive,directoryManifest } from "../archive/archiveAdapter.js";
const buildInfo='Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Version!STRING:0\n1|1d231af579faf03e61a364722a3b87b4|00000000000000000000000000000000|5.0.17.98310\n';
const catalog=Buffer.from('<Catalog><CTerrain id="Test"><BlendTextures value="Dirt"/><BlendTextures value="Grass"/><CliffSets value="Cliff"/></CTerrain></Catalog>');
async function fixture(t:{after(fn:()=>Promise<unknown>):void}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-document-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const install=path.join(root,'game');await fs.mkdir(install);await fs.writeFile(path.join(install,'.build.info'),buildInfo);let current=buildInfo;const sourceFiles=new Map([['mods/core.sc2mod/base.sc2data/gamedata/terraindata.xml',catalog]]);
 const fake={install,refreshBuild:async()=>({build:parseCascBuildInfo(current)}),search:async(prefix:string,query:string)=>({build:parseCascBuildInfo(current),total:query==='terraindata.xml'?prefix==='Mods/Core.SC2Mod'?1:0:1,items:query==='terraindata.xml'&&prefix==='Mods/Core.SC2Mod'?[{path:'mods/core.sc2mod/base.sc2data/gamedata/terraindata.xml'}]:[],nextOffset:null}),read:async(file:string)=>({bytes:sourceFiles.get(file)!,metadata:{buildKey:parseCascBuildInfo(current).buildKey,sha256:(await import('../core/binaryTransactions.js')).bytesHash(sourceFiles.get(file)! )}})}as unknown as CascWorkspace;
 const workspace=new Workspace(root),document=new DocumentWorkspace(workspace,fake);
 return{root,workspace,document,sourceFiles,setBuild:(s:string)=>{current=s;}};
}
const mapRequest=(destination='map')=>({kind:'map',destination,map:{width:64,height:48},terrain:{enabled:true,tileSet:'Test',initialTexture:'Grass'},dependencies:{mode:'custom',entries:[]},locales:['ruRU','enUS']});
test('native H2CS reader handles an independently supplied complete Header and rejects every truncation',async()=>{const b=gunzipSync(await fs.readFile('src/tests/fixtures/map-native/nydus/DocumentHeader.gz'));const h=readDocumentHeader(b);assert.equal(h.major,5);assert.equal(h.build,97563);assert.equal(h.dependencies.length,2);assert.ok(h.strings.length>10);for(let n=0;n<b.length;n++)assert.throws(()=>readDocumentHeader(b.subarray(0,n)));});
test('v2 marker matches the native 44-byte build tuple, timestamp and tag order',()=>{const b=versionMarker('info',{major:5,minor:0,patch:17,build:98310},1791718395,1);assert.equal(b.toString('hex'),'636465736f666e6902000000068001000500000000000000110000000680010001000000fb73cb6a01000000');assert.equal(readVersion(b).tag,'info');assert.throws(()=>versionMarker('bad',{major:5,minor:0,patch:17,build:98310},1),/ARGUMENT/);});
test('fresh MapInfo has complete verified core, standard empty players and exactly empty variant/lighting tail',()=>{for(const[w,h]of[[32,32],[64,48],[256,256]]){const b=createMapInfo(w,h,'Test',8,1791718395),d=validateEmptyMapInfo(b);assert.deepEqual(d.core.cells,[w,h]);assert.deepEqual(d.players.map(p=>[p.id,p.control]),[[0,'Neutral'],[1,'User'],[15,'Hostile']]);assert.equal(d.preservedTailBytes,52);assert.equal(d.core.integrityVerified,true);}});
test('DocumentInfo extension flag and dependency text survive XML escaping',()=>{const b=documentInfo(['file:Mods/A&B.SC2Mod'],true),r=readDocumentInfo(b);assert.deepEqual(r.flags,['ExtensionMod']);assert.deepEqual(r.dependencies,['file:Mods/A&B.SC2Mod']);assert.deepEqual(readDocumentInfo(documentInfo([],false)).flags,[]);});
test('flat terrain creates independent rectangular native grids with one texture and no hidden cells',()=>{const set={id:'Test',textures:['Dirt','Grass'],cliffs:['Cliff'],sourcePaths:[]};for(const height of[0,8,12]){const files=createFlatTerrain(64,48,set,'Grass',height);const h=files.get('t3HeightMap')!;assert.equal(h.length,32+65*49*6);const masks=files.get('t3TextureMasks')!;assert.equal(masks.length,64+64*48*256);assert.equal(masks[64],0);assert.equal(masks[64+64*48*32],255);assert.ok(files.get('t3CellFlags')!.subarray(32).every(v=>v===2));assert.equal(files.get('t3Water')!.readUInt32LE(8),0);}assert.throws(()=>createFlatTerrain(64,48,set,'Unknown',8),/INITIAL_TEXTURE/);});
test('bounded CTerrain inheritance keeps the child ID in parent tokens and labels unsupported arrays',()=>{const rows=resolveTerrainCatalogs([{path:'a',bytes:Buffer.from('<Catalog><CTerrain default="1" id="Base"><BlendTextures value="##id##_1"/></CTerrain><CTerrain id="Child" parent="Base"/><CTerrain id="Bad"><BlendTextures index="0" value="Bad"/></CTerrain></Catalog>')}]);assert.deepEqual(rows.find(r=>r.id==='Child')!.textures,['Child_1']);assert.ok(rows.find(r=>r.id==='Bad')!.unsupported!.length);assert.ok(!rows.some(r=>r.id==='Base'));});
test('schemas reject incompatible mod/map parameters, odd sizes, duplicate locales and gameplay requests',()=>{for(const input of [{kind:'mod',destination:'x',map:{width:32,height:32}},{kind:'map',destination:'x',map:{width:33,height:48}},{kind:'map',destination:'x',mapType:'melee',map:{width:32,height:32}},{kind:'mod',destination:'x',locales:['ruRU','ruRU']},{kind:'mod',destination:'x',initialization:'melee'}])assert.equal(documentPlanSchema.safeParse(input).success,false);});
for(const modType of['dependent','extension']as const)test(`create ${modType} mod is fresh, localized and has no MapInfo/Terrain/scripts`,async t=>{const f=await fixture(t),p=await f.document.plan({kind:'mod',modType,destination:'mod',name:'Š¯Š¾Š²Š°Ń¸ & Š¼Š¾Š´ŠøŃ„ŠøŠŗŠ°Ń†ŠøŃ¸',locales:['ruRU'],dependencies:{mode:'custom',entries:[]}});assert.equal(p.valid,true);const dry=await f.document.create(p.id);assert.equal(dry.created,false);await assert.rejects(fs.stat(path.join(f.root,'mod')));const out=await f.document.create(p.id,false);assert.equal(out.created,true);const inspected=await f.document.inspect('mod');assert.equal(inspected.valid,true);assert.ok(!p.foundation.files.some(r=>r.file==='MapInfo'||r.file.startsWith('t3')||r.file.endsWith('.galaxy')));assert.equal(readDocumentInfo(await fs.readFile(path.join(f.root,'mod/DocumentInfo'))).flags.includes('ExtensionMod'),modType==='extension');await assert.rejects(f.document.create(p.id,false),/DESTINATION_EXISTS/);});
test('new map foundation is usable by existing Terrain and Settings codecs without donor content',async t=>{const f=await fixture(t),p=await f.document.plan(mapRequest());await f.document.create(p.id,false);const w=new Workspace(path.join(f.root,'map')),terrain=new TerrainWorkspace(w);assert.equal((await terrain.inspect()).nativeIntegrity?.valid,true);const plan=await terrain.visibilityPlan(true,{cells:[{x:8,y:8}]});assert.equal(plan.changedVisibilityCells,1);const raised=await terrain.plan({operations:[{op:'height.raise',amount:0.5,area:{type:'rectangle',minX:8,minY:8,maxX:12,maxY:12}}]});assert.ok(raised.changedVertices>0);assert.ok((await fs.readFile(path.join(f.root,'map/MapScript.galaxy'),'utf8')).includes('void InitMap'));assert.equal((await f.document.inspect('map')).valid,true);});
test('map without Terrain retains a complete MapInfo and skips all terrain components',async t=>{const f=await fixture(t),p=await f.document.plan({kind:'map',destination:'no-terrain',map:{width:32,height:48},terrain:{enabled:false},dependencies:{mode:'custom',entries:[]}});await f.document.create(p.id,false);assert.equal((await f.document.inspect('no-terrain')).valid,true);assert.ok(!p.foundation.files.some(r=>r.file.startsWith('t3')));});
test('build and source changes invalidate a plan before publication',async t=>{const f=await fixture(t),p=await f.document.plan(mapRequest());f.sourceFiles.set('mods/core.sc2mod/base.sc2data/gamedata/terraindata.xml',Buffer.from('<Catalog/>'));await assert.rejects(f.document.create(p.id,false),/STALE_DOCUMENT_SOURCE/);await assert.rejects(fs.stat(path.join(f.root,'map')));f.sourceFiles.set('mods/core.sc2mod/base.sc2data/gamedata/terraindata.xml',catalog);f.setBuild(buildInfo.replace('98310','98311'));await assert.rejects(f.document.validatePlan(p.id),/STALE_DOCUMENT_BUILD/);});
test('local dependency graph detects cycles, pins all files and refuses pending drafts',async t=>{const f=await fixture(t);for(const name of['A','B']){await fs.mkdir(path.join(f.root,`Mods/${name}.SC2Mod`),{recursive:true});await fs.writeFile(path.join(f.root,`Mods/${name}.SC2Mod/DocumentInfo`),documentInfo([`file:Mods/${name==='A'?'B':'A'}.SC2Mod`],false));}const deps={mode:'custom',entries:[{file:'Mods/A.SC2Mod'}]};await assert.rejects(f.document.plan({kind:'mod',destination:'out',dependencies:deps}),/CYCLE/);await fs.writeFile(path.join(f.root,'Mods/B.SC2Mod/DocumentInfo'),documentInfo([],false));const p=await f.document.plan({kind:'mod',destination:'out',dependencies:deps});await fs.writeFile(path.join(f.root,'Mods/B.SC2Mod/new.bin'),'new');await assert.rejects(f.document.create(p.id,false),/STALE_DOCUMENT_DEPENDENCY/);await fs.unlink(path.join(f.root,'Mods/B.SC2Mod/new.bin'));await f.workspace.applyRawTransaction(['Mods/A.SC2Mod/DocumentInfo'],sources=>new Map([['Mods/A.SC2Mod/DocumentInfo',sources.get('Mods/A.SC2Mod/DocumentInfo')!+'<!-- staged -->']]),{dryRun:false,stage:true});await assert.rejects(f.document.plan({kind:'mod',destination:'other',dependencies:deps}),/DRAFT_PENDING/);});
test('source and destination guards reject overlapping dependency outputs and malformed identities',async t=>{const f=await fixture(t);await fs.mkdir(path.join(f.root,'Mods/A.SC2Mod'),{recursive:true});await fs.writeFile(path.join(f.root,'Mods/A.SC2Mod/DocumentInfo'),documentInfo([],false));await assert.rejects(f.document.plan({kind:'mod',destination:'Mods/A.SC2Mod/new',dependencies:{mode:'custom',entries:[{file:'Mods/A.SC2Mod'}]}}),/OUTPUT_INSIDE_DEPENDENCY/);await assert.rejects(f.document.plan({kind:'mod',destination:'../outside',dependencies:{mode:'custom',entries:[]}}));await assert.rejects(f.document.plan({kind:'mod',destination:'out',dependencies:{mode:'custom',entries:[{file:'Mods/Core.SC2Mod',bnet:'arbitrary'}]}}),/BNET_REFERENCE/);});
test('strict foundation inspect detects an external file and altered version bytes',async t=>{const f=await fixture(t),p=await f.document.plan({kind:'mod',destination:'mod',dependencies:{mode:'custom',entries:[]}});await f.document.create(p.id,false);await fs.writeFile(path.join(f.root,'mod/external.galaxy'),'void Extra() {}');assert.equal((await f.document.inspect('mod')).valid,false);});
test('packed mod is actually reopened by native archive backend with the exact fresh entry manifest',async t=>{const f=await fixture(t),p=await f.document.plan({kind:'mod',modType:'extension',destination:'mod',dependencies:{mode:'custom',entries:[]}});const out=await f.document.create(p.id,false,'packed');assert.equal(out.created,true);const m=await inspectArchive(path.join(f.root,'mod.SC2Mod'));assert.equal(m.entries.filter(e=>!e.internal).length,p.foundation.files.length);await extractArchive(path.join(f.root,'mod.SC2Mod'),path.join(f.root,'reopened'));assert.deepEqual(await directoryManifest(path.join(f.root,'reopened')),p.foundation.files);});

test('real SDK creates an empty document through the registered MCP tools with a supplied local game source', {timeout:30000}, async t=>{
 const f=await fixture(t),install=path.join(f.root,'game'),env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is[string,string]=>entry[1]!==undefined));delete env.SC2_MCP_MODULES;env.SC2_UI_ROOT=f.root;env.SC2_MCP_PROFILE='document';env.SC2_CASC_ROOT=install;
 // This is a real native CASC-reader test when the installed game is available.
 const actual='C:/Program Files (x86)/StarCraft II';try{await fs.stat(path.join(actual,'.build.info'));}catch{t.skip('Installed SC2 is unavailable');return;}env.SC2_CASC_ROOT=actual;
 const client=new Client({name:'document-creation-test',version:'1'});t.after(()=>client.close());await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/index.js'],env,stderr:'pipe'}));
 const call=async(name:string,args:Record<string,unknown>={})=>{const r=await client.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r));if(r.content[0].type!=='text')throw Error('Expected text');return JSON.parse(r.content[0].text);};
 const tools=await client.listTools();assert.equal(tools.tools.filter(t=>t.name.startsWith('document.')).length,11);
 const p=await call('document.plan',{kind:'mod',modType:'extension',destination:'sdk-extension',dependencies:{mode:'standard',expansion:'liberty',campaign:false}});assert.equal(p.valid,true);const created=await call('document.create',{planId:p.id,dryRun:false});assert.equal(created.created,true);assert.equal((await call('document.inspect',{directory:'sdk-extension'})).valid,true);
 const mp=await call('document.plan',{kind:'map',destination:'sdk-map',map:{width:32,height:48},terrain:{enabled:true,tileSet:'Agria'},dependencies:{mode:'standard',expansion:'liberty',campaign:false}});assert.equal(mp.valid,true);const packed=await call('document.create',{planId:mp.id,dryRun:false,output:'packed'});assert.equal(packed.archiveVerification.reopened,true);assert.equal(packed.kind,'map');
});

test('new foundations cannot overwrite a pre-existing component or packed destination',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'existing.SC2Mod'),'original');await assert.rejects(f.document.plan({kind:'mod',destination:'existing',dependencies:{mode:'custom',entries:[]}}),/DESTINATION_EXISTS/);assert.equal(await fs.readFile(path.join(f.root,'existing.SC2Mod'),'utf8'),'original');
});

// These constants come from independently saved native maps, not our generator.
test('native maps independently confirm identity Q12 sync-height geometry', async () => {
 for (const map of ['ant','city','nydus','warships']) {
  const bytes=gunzipSync(await fs.readFile(`src/tests/fixtures/terrain-native/${map}/t3SyncHeightMap.gz`));
  assert.deepEqual([16,20,24].map(o=>bytes.readInt32LE(o)),[0,0,0]);
  assert.deepEqual([28,32,36].map(o=>bytes.readInt32LE(o)),[4096,4096,4096]);
 }
});
test('editor allocation and geometry checks reject the previously generated broken terrain', () => {
 const files=createFlatTerrain(64,48,{id:'Test',textures:['Dirt'],cliffs:['Cliff'],sourcePaths:[]},'Dirt',8);
 assert.equal(validateTerrainLoadContract(files,64,48).cliffCells,768);
 const xml=files.get('t3Terrain.xml')!.toString();
 for (const tag of ['cliffCellList','blockTextureSetList']) {
  const broken=new Map(files);broken.set('t3Terrain.xml',Buffer.from(xml.replace(new RegExp(`<${tag}[^>]*>([\\s\\S]*?</${tag}>)?`),'').replace(new RegExp(`<${tag}[^>]*/>`),'')));
  assert.throws(()=>validateTerrainLoadContract(broken,64,48),/ALLOCATION_REQUIRED/);
 }
 const broken=new Map(files),sync=Buffer.from(files.get('t3SyncHeightMap')!);sync.fill(0,28,40);broken.set('t3SyncHeightMap',sync);
 assert.throws(()=>validateTerrainLoadContract(broken,64,48),/TRANSFORM_INVALID/);
});


test('version writer admits native Objects plob and rejects the erroneous objs tag',()=>{
 const build={major:5,minor:0,patch:17,build:98310};
 assert.equal(versionMarker('plob',build,1791718395).subarray(4,8).toString('ascii'),'bolp');
 assert.throws(()=>versionMarker('objs',build,1791718395),/DOCUMENT_VERSION_ARGUMENT/);
});
