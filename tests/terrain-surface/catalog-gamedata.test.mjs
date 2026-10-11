import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import * as api from '../../dist/modules/terrain/surface/core/index.js';
import {parseStrictXml} from '../../dist/modules/terrain/surface/format/xml.js';
const observations=JSON.parse(readFileSync(new URL('./observations.json',import.meta.url),'utf8'));
// Deliberately reconstructed excerpts: original-byte hashes and full XML snapshots are NOT claimed.
const esc=v=>v.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const attrs=a=>Object.entries(a).map(([k,v])=>` ${k}="${esc(v)}"`).join('');
const element=n=>`<${n.name}${attrs(n.attributes)}>${n.children.map(element).join('')}</${n.name}>`;
const excerpt=r=>`<Catalog><${r.type}${attrs(r.attributes)}>${(r.processingInstructions??[]).map(pi=>`<?${pi.target} ${pi.data}?>`).join('')}${r.fields.map(element).join('')}</${r.type}></Catalog>`;
const record=(source,id=null)=>{const r=observations.records.find(r=>r.source===source&&(r.attributes.id??null)===id);assert.ok(r);return api.inspectSurfaceCatalog(excerpt(r)).entries[0];};
const one=xml=>api.inspectSurfaceCatalog(xml).entries[0];

test('PI regression: real CModel Unit template declarations are now preserved',()=>{
 const e=record('core.model','Unit');assert.equal(e.processingInstructions.length,2);
 const d=api.catalogTokenDeclarations(e);assert.deepEqual(d.map(x=>[x.id,x.attributes.value]),[['Race','Neutral'],['Prefix','Units\\']]);
 assert.ok(d.every(x=>x.diagnostic===null));
});
test('PI order around element siblings and unknown PI data are retained',()=>{
 const root=parseStrictXml('<Catalog><Probe><?token id="a" value="1"?><F/><?other opaque?><G/><?token id="b" type="CModelLink"?></Probe></Catalog>');
 assert.deepEqual(root.children[0].processingInstructions.map(x=>[x.target,x.beforeChildIndex]),[['token',0],['other',1],['token',2]]);
});
test('nested token declarations retain owner path and missing value',()=>{
 const e=one('<Catalog><Probe><F><?token id="x" type="CModelLink"?></F></Probe></Catalog>');
 const d=api.catalogTokenDeclarations(e)[0];assert.equal(d.id,'x');assert.equal(d.attributes.value,undefined);assert.equal(d.ownerPath,'/F[ordinal=0]');
});
test('unknown processing instructions are not treated as tokens or executed',()=>{
 const e=one('<Catalog><Probe><?exec touch-file?><F value="x"/></Probe></Catalog>');
 assert.equal(e.processingInstructions[0].target,'exec');assert.equal(api.catalogTokenDeclarations(e).length,0);
});
test('malformed token metadata gets explicit diagnostic',()=>{
 const e=one('<Catalog><Probe><?token not an attribute?></Probe></Catalog>');
 assert.ok(api.catalogTokenDeclarations(e)[0].diagnostic);
});
test('named defaults are not merged into type-wide defaults',()=>{
 assert.equal(api.catalogRecordKind(record('core.terraintex')),'type-default');
 assert.equal(api.catalogRecordKind(record('lib.terraintex','WizSimpleTerrainTex')),'named-default');
 assert.equal(api.catalogRecordKind(record('lib.terraintex','AgriaDirt')),'record');
});
test('template expansion has explicit owning id and preserves raw input',()=>{
 const raw=String.raw`Assets\Cliffs\##id##_Material\##id##_Material.m3`;
 const out=api.previewCatalogTemplate(raw,{id:'AgriaCliff0'});
 assert.equal(out.value,String.raw`Assets\Cliffs\AgriaCliff0_Material\AgriaCliff0_Material.m3`);assert.equal(out.raw,raw);assert.equal(out.status,'expanded-once');
});
test('missing token remains unresolved; no filename fabrication',()=>{
 const out=api.previewCatalogTemplate('Assets/##texId##.dds',{id:'AgriaDirt'});
 assert.deepEqual(out.missing,['texId']);assert.equal(out.value,'Assets/##texId##.dds');assert.equal(out.status,'unresolved');
});
test('token preview is deliberately single-pass and cycle-safe',()=>{
 const out=api.previewCatalogTemplate('##a##',{a:'##b##',b:'##a##'});assert.equal(out.value,'##b##');assert.equal(out.status,'unresolved');
});
test('token prototype properties are not used as bindings',()=>{
 const out=api.previewCatalogTemplate('##toString##',{});assert.equal(out.status,'unresolved');
});
test('token output budget rejects exponential-sized concatenation before allocation',()=>{
 assert.throws(()=>api.previewCatalogTemplate('##x##'.repeat(1000),{x:'a'.repeat(8192)}),/BUDGET/);
});
test('catalog four-vector uses comma delimiters and retains negative zero',()=>{
 assert.deepEqual(api.parseCatalogVector('0.03,0.03,-0.03,-0.03',4),[.03,.03,-.03,-.03]);
 assert.ok(Object.is(api.parseCatalogVector('-0.000000,1',2)[0],-0));
});
test('catalog vector rejects blank components, extra components, and non-finite values',()=>{
 for(const [v,n] of [['1,,3',3],['1,2,3',2],['NaN,2',2],['1 2',2],['Infinity,2',2]])assert.throws(()=>api.parseCatalogVector(v,n));
});
test('sparse cliff heights: index 1 is unspecified, not fabricated as zero',()=>{
 const h=api.inspectAuthoredCliffHeights(record('core.cliffmesh'));
 assert.equal(h.entries.length,15);assert.equal(h.entries.find(x=>x.index===0).value,-4);assert.equal(h.entries.find(x=>x.index===1),undefined);assert.equal(h.entries.find(x=>x.index===15).value,28);
});
test('actual named cliff tables differ: -8, -7, -20 at index 0',()=>{
 assert.deepEqual(['CliffNatural0','CliffMade6','CliffMade7'].map(id=>api.inspectAuthoredCliffHeights(record('lib.cliffmesh',id)).entries[0].value),[-8,-7,-20]);
});
test('duplicate authored cliff indices are rejected instead of silently overwritten',()=>{
 const e=one('<Catalog><CCliffMesh id="p"><CliffHeights index="0" value="1"/><CliffHeights index="0" value="2"/></CCliffMesh></Catalog>');
 assert.throws(()=>api.inspectAuthoredCliffHeights(e),/DUPLICATE/);
});
test('terrain links target three distinct catalogs and keep eight unindexed textures',()=>{
 const refs=api.inspectCatalogReferences(record('lib.terrain','Agria'));
 assert.equal(refs.filter(x=>x.targetCatalog==='TerrainTex').length,8);assert.equal(refs.filter(x=>x.targetCatalog==='Cliff').length,2);
 assert.equal(refs.find(x=>x.targetCatalog==='Tile').raw,'KorhalTile');assert.equal(new Set(refs.map(x=>x.path)).size,11);
});
test('cliff geometry id is not confused with cliff material identity',()=>{
 const ref=api.inspectCatalogReferences(record('lib.cliff','AgriaCliff0'))[0];assert.equal(ref.raw,'CliffNatural0');assert.equal(ref.targetCatalog,'CliffMesh');
 const defs=api.inspectCatalogReferences(record('core.cliff'));assert.ok(defs.some(x=>x.template&&x.raw.includes('##id##_Material')));
});
test('cliff model directory templates are retained as directories, not absent files',()=>{
 const refs=api.inspectCatalogReferences(record('core.cliffmesh'));assert.equal(refs[0].kind,'directory-path');assert.equal(refs[0].template,true);
});
test('CTile Korhal points to the actual road material path',()=>{
 const refs=api.inspectCatalogReferences(record('lib.tile','KorhalTile'));assert.equal(refs[0].raw,'Assets/HardTiles/KorhalRoad/KorhalRoad.m3');assert.equal(refs[0].existence,'not-checked');
});
test('terrain texture material contains model links and direct DDS paths',()=>{
 const refs=api.inspectCatalogReferences(record('lib.terraintex','AgriaDirt'));
 assert.deepEqual(refs.filter(x=>x.targetCatalog==='Model').map(x=>x.raw),['PlantMixAgria','RockMixAgria']);assert.equal(refs.filter(x=>x.kind==='file-path').length,2);
});
test('TerrainTexDef key remains a key and is not fabricated as DDS',()=>{
 const refs=api.inspectCatalogReferences(record('core.terraintex'));assert.equal(refs[0].kind,'asset-key');assert.equal(refs.at(-1).targetCatalog,'PhysicsMaterial');
});
test('water shores refer to Model catalog, not a guessed WaterShoreline catalog',()=>{
 const refs=api.inspectCatalogReferences(record('lib.water','BelShir'));assert.deepEqual(refs.filter(x=>x.raw.endsWith('Shoreline')).map(x=>x.targetCatalog),['Model','Model']);
});
test('two BelShir shoreline model records reference the same file',()=>{
 const a=api.inspectCatalogReferences(record('lib.model','BelShirBeachShoreline'))[0];const b=api.inspectCatalogReferences(record('lib.model','BelShirCliffShoreline'))[0];
 assert.equal(a.raw,b.raw);assert.ok(a.raw.endsWith('ShorelineWavesBeach.m3'));
});
test('foliage parent is retained as a Model link without flattening',()=>{
 const e=record('lib.model','PlantMixAgria');assert.equal(e.parent,'Foliage');assert.equal(api.inspectCatalogReferences(e)[0].targetCatalog,'Model');assert.equal(e.fields.some(x=>x.name==='Model'),false);
});
test('height codes for a real cliff doodad remain a 5 by 7 character grid',()=>{
 const h=api.inspectCliffDoodadHeightCodes(record('swarm.terrainobject','DefensiveWall451HMerge1Mirror'));
 assert.equal(h.width,7);assert.equal(h.height,5);assert.deepEqual(h.rows,['BBBBBBB','BBBBBBB','CCCBBBB','CCCCCBB','CCCCCCC']);assert.deepEqual(h.errors,[]);assert.equal(h.levelMapping,null);assert.equal(h.worldOrientation,null);
});
test('height code validator reports wrong row width without dropping raw text',()=>{
 const e=record('swarm.terrainobject','DefensiveWall451HMerge1Mirror');e.fields.find(x=>x.name==='HeightCodes').attributes.value='B';const h=api.inspectCliffDoodadHeightCodes(e);assert.ok(h.errors.includes('ROW_WIDTH_MISMATCH:0'));assert.equal(h.rows[0],'B');
});
test('absent dimensions and indexed height-code profiles are not guessed',()=>{
 assert.throws(()=>api.inspectCliffDoodadHeightCodes(record('core.terrainobject')));
 const e=record('swarm.terrainobject','DefensiveWall451HMerge1Mirror');e.fields.find(x=>x.name==='HeightCodes').attributes.index='0';assert.throws(()=>api.inspectCliffDoodadHeightCodes(e),/NEED_PROFILE/);
});
test('actor zero BlendTime and empty override are preserved as present',()=>{
 const e=record('core.actor','BuildingTerrainFlattenEditor');const fields=api.catalogFieldOccurrences(e);assert.equal(fields.find(x=>x.name==='BlendTime').attributes.value,'0.000000');assert.equal(fields.find(x=>x.name==='FoliageFXDeathSpawnTarget').attributes.value,'');assert.equal(fields.filter(x=>x.name==='TerrainDeformerFlags').length,2);
});
test('TextureSheet records are not treated as terrain blend layers',()=>{
 const e=record('lib.texturesheet','EmoticonsSheet1');assert.equal(e.type,'CTextureSheet');assert.equal(api.inspectCatalogReferences(e).filter(x=>x.targetCatalog==='TerrainTex').length,0);
});
test('all selected observations parse without pretending to be original byte snapshots',()=>{
 assert.equal(observations.originalBytesAvailable,false);for(const r of observations.records){const e=one(excerpt(r));assert.equal(e.type,r.type);assert.equal(e.id,r.attributes.id??null);assert.equal(e.fields.length,r.fields.length);}
});
test('PI support retains previous DTD/external-entity rejection',()=>assert.throws(()=>parseStrictXml('<!DOCTYPE C [<!ENTITY e SYSTEM "file:///x">]><Catalog/>'),/DTD_ENTITY_DISABLED/));
test('CLI reads local extracted files, records actual hashes, and retains duplicate IDs across files',()=>{
 const root=mkdtempSync(join(tmpdir(),'sc2-catalog-'));try{
  for(const sub of ['core','override']){mkdirSync(join(root,sub));writeFileSync(join(root,sub,'WaterData.xml'),'<Catalog><CWater id="Same"><State index="0"><Height value="9"/></State></CWater></Catalog>');}
  const out=join(root,'report.json');const run=spawnSync(process.execPath,['scripts/scan-terrain-catalogs.mjs','--root',root,'--out',out],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(readFileSync(out));assert.equal(report.documents.length,2);assert.equal(report.dependencyOrderResolved,false);assert.equal(report.cascStorageRead,false);assert.match(report.documents[0].sha256,/^[a-f0-9]{64}$/);
  const rerun=spawnSync(process.execPath,['scripts/scan-terrain-catalogs.mjs','--root',root,'--out',out],{encoding:'utf8'});assert.notEqual(rerun.status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('CLI marks malformed selected XML as partial rather than complete',()=>{
 const root=mkdtempSync(join(tmpdir(),'sc2-catalog-bad-'));try{writeFileSync(join(root,'WaterData.xml'),'<Catalog><CWater></Catalog>');const out=join(root,'report.json');const run=spawnSync(process.execPath,['scripts/scan-terrain-catalogs.mjs','--root',root,'--out',out],{encoding:'utf8'});assert.equal(run.status,2);const report=JSON.parse(readFileSync(out));assert.equal(report.status,'PARTIAL_SELECTED_SCAN');assert.equal(report.errors.length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
