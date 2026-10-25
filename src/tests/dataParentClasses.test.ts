import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DataDocument} from '../modules/data/document.js';
import {validateDataDocuments} from '../modules/data/validator.js';
import {parentClassCompatibility} from '../modules/data/parentClasses.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {Workspace} from '../core/workspace.js';
import {SchemaRegistry} from '../schema/schemaRegistry.js';

// Native Liberty has CActorMissile Reaper parent=GenericUnitBase (CActorUnit).
// Editor XMLAlerts 2026-10-20 rejects CActorUnit ArenaHero04Actor parent=Reaper.
const native='<CActorUnit id="GenericUnitBase" default="1"/><CActorMissile id="Reaper" parent="GenericUnitBase"><Model value="ReaperModel"/></CActorMissile>';
const file='Base.SC2Data/GameData/ActorData.xml';
const report=(child:string)=>validateDataDocuments(file,[{file,layer:'workspace',document:new DataDocument('<Catalog>'+native+child+'</Catalog>',file)}]);

test('native Actor class compatibility preserves inheritance direction and unknown pairs',()=>{
 assert.equal(parentClassCompatibility('CActorUnit','CActorMissile'),'incompatible');
 assert.equal(parentClassCompatibility('CActorMissile','CActorUnit'),'compatible');
 assert.equal(parentClassCompatibility('CActorMissile','CActorMissile'),'compatible');
 assert.equal(parentClassCompatibility('CActorFuture','CActorUnit'),'unknown');
});
test('Data validation catches the Editor-reported Reaper error at the parent path',()=>{
 const result=report('<CActorUnit id="ArenaHero04Actor" parent="Reaper"/>');
 assert.equal(result.valid,false);
 assert.ok(result.diagnostics.some(d=>d.code==='DATA_PARENT_CLASS_INCOMPATIBLE'&&d.severity==='error'&&d.path==='CActorUnit:ArenaHero04Actor@parent'));
});
test('native missile subclass and same-class Reaper child pass the new check',()=>{
 const result=report('<CActorMissile id="ArenaHero04Actor" parent="Reaper"/>');
 assert.equal(result.valid,true);
 assert.ok(!result.diagnostics.some(d=>d.code==='DATA_PARENT_CLASS_INCOMPATIBLE'));
});
test('unknown class combinations and missing parents are not invented incompatibilities',()=>{
 const result=report('<CActorFuture id="Future" parent="GenericUnitBase"/><CActorUnit id="Missing" parent="Absent"/>');
 assert.equal(result.valid,true);
 assert.ok(result.diagnostics.some(d=>d.code==='DATA_PARENT_UNRESOLVED'));
});
test('class repair changes outer tags only, preserves identity and refuses domain changes',()=>{
 const source='<Catalog>\r\n<CActorUnit id="Custom" parent="Reaper" unitName="Custom"><!--keep--><Future><CActorUnit unknown="yes"/></Future></CActorUnit>\r\n<CUnit id="Custom"/>\r\n</Catalog>';
 const doc=new DataDocument(source);
 doc.setType({id:'Custom',domain:'Actor'},'CActorMissile');
 assert.equal(doc.source,source.replace('<CActorUnit id=','<CActorMissile id=').replace('</CActorUnit>','</CActorMissile>'));
 const repaired=doc.source;
 doc.setType({id:'Custom',domain:'Actor'},'CActorMissile');
 assert.equal(doc.source,repaired);
 assert.throws(()=>doc.setType({id:'Custom',domain:'Actor'},'CUnit'),/DOMAIN_MISMATCH/);
 assert.equal(doc.source,repaired);
 const self=new DataDocument('<Catalog><CActorUnit id="X" parent="Reaper"/></Catalog>');
 self.setType('X','CActorMissile');
 assert.equal(self.source,'<Catalog><CActorMissile id="X" parent="Reaper"/></Catalog>');
});

async function fixture(t:import('node:test').TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-parent-class-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'Base.SC2Data/GameData'),{recursive:true});
 await fs.writeFile(path.join(root,file),'<Catalog>'+native+'</Catalog>');
 await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/ActorData.xml"/></Includes>');
 await fs.writeFile(path.join(root,'ComponentList.SC2Components'),'<Components/>');
 const workspace=new Workspace(root,await SchemaRegistry.loadBundled());
 return {root,data:new DataWorkspace(workspace),workspace};
}
for(const authoringPolicy of ['strict','compatibility'] as const)test(`${authoringPolicy} Data writes reject incompatible parents atomically`,async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.root,file),'utf8');
 await assert.rejects(f.data.apply({file,operations:[{op:'object.create',ctype:'CActorUnit',id:'ArenaHero04Actor',parent:'Reaper'}],dryRun:false,stage:false,authoringPolicy}),/DATA_PARENT_CLASS_INCOMPATIBLE/);
 assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),before);
 assert.deepEqual(f.workspace.draftFiles(),[]);
});
test('selective effective fields stop at an incompatible parent instead of merging invalid data',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.root,file),'<Catalog>'+native+'<CActorUnit id="ArenaHero04Actor" parent="Reaper"/></Catalog>');
 const context=await f.data.context({ids:['ArenaHero04Actor'],fields:['Model'],includeReferences:false});
 const effective=context.objects[0].effective!;
 assert.deepEqual(effective.unresolvedParents,[{id:'Reaper',reason:'PARENT_CLASS_INCOMPATIBLE'}]);
 assert.equal(effective.fields.Model?.declaredBy==='Reaper',false);
});
test('MCP class operation repairs an existing Actor without deleting its catalog identity',async t=>{
 const f=await fixture(t);
 await fs.writeFile(path.join(f.root,file),'<Catalog>'+native+'<CActorUnit id="ArenaHero04Actor" parent="Reaper"/></Catalog>');
 const result=await f.data.apply({file,operations:[{op:'object.setType',object:'ArenaHero04Actor',ctype:'CActorMissile'}],authoringPolicy:'compatibility',dryRun:false,stage:false});
 assert.equal(result.validation?.valid,true);
 assert.match(await fs.readFile(path.join(f.root,file),'utf8'),/<CActorMissile id="ArenaHero04Actor" parent="Reaper"\/>/);
});

const weaponFile='Base.SC2Data/GameData/WeaponData.xml';
test('batch class repair matches single-file writes and preserves comments, fields and IDs',async t=>{
 const single=await fixture(t),batch=await fixture(t);
 const source='<Catalog>\r\n  <!-- manual weapon -->\r\n  <CWeapon id="CustomWeapon"><!-- preserve --><Range value="6.0000"/><Period value="1.25"/></CWeapon>\r\n  <CWeaponLegacy id="Neighbor"><Range value="3"/></CWeaponLegacy>\r\n</Catalog>';
 for(const f of [single,batch])await fs.writeFile(path.join(f.root,weaponFile),source);
 const operation={op:'object.setType' as const,object:{id:'CustomWeapon',ctype:'CWeapon'},ctype:'CWeaponLegacy'};
 const one=await single.data.apply({file:weaponFile,operations:[operation],dryRun:false,stage:false,backup:false});
 const many=await batch.data.batch({changes:[{file:weaponFile,operations:[operation]}],dryRun:false,stage:false,backup:false});
 assert.equal(one.validation?.valid,true);assert.equal(many.validation?.valid,true);
 const expected=source.replace('<CWeapon id=','<CWeaponLegacy id=').replace('</CWeapon>','</CWeaponLegacy>');
 assert.equal(await fs.readFile(path.join(single.root,weaponFile),'utf8'),expected);
 assert.equal(await fs.readFile(path.join(batch.root,weaponFile),'utf8'),expected);
 assert.equal(many.applied[0].target,'CWeaponLegacy:CustomWeapon');
 assert.ok((await batch.data.context({ids:['CustomWeapon'],fields:['Range'],includeReferences:false})).operations.includes('object.setType'));
});

test('batch class changes preserve aliases for following field edits and cross-file links',async t=>{
 const f=await fixture(t),unitFile='Base.SC2Data/GameData/UnitData.xml';
 const result=await f.data.batch({changes:[
  {file:unitFile,operations:[{op:'object.create',ctype:'CUnit',id:'Consumer',fields:[{name:'WeaponArray',index:0,link:'@weapon'}]}]},
  {file:weaponFile,operations:[
   {op:'object.create',as:'weapon',ctype:'CWeapon',id:'BatchWeapon',fields:[{name:'Range',value:6}]},
   {op:'object.clone',as:'twin',object:'@weapon',id:'TwinWeapon'},
   {op:'object.setType',object:'@weapon',ctype:'CWeaponLegacy'},
   {op:'object.setType',object:'@twin',ctype:'CWeaponLegacy'},
   {op:'field.set',object:'@weapon',path:'Range',value:9},
   {op:'field.set',object:'@twin',path:'Range',value:4},
  ]},
 ],dryRun:false,stage:false,backup:false});
 assert.equal(result.validation?.valid,true);
 assert.equal(result.authoring.every(row=>row.authoring.accepted),true);
 assert.equal(result.aliases['@weapon'].key,'CWeaponLegacy:BatchWeapon');
 assert.equal(result.aliases['@twin'].key,'CWeaponLegacy:TwinWeapon');
 const weapons=new DataDocument(await fs.readFile(path.join(f.root,weaponFile),'utf8'));
 assert.equal(weapons.resolve('BatchWeapon').tag,'CWeaponLegacy');
 assert.equal(weapons.resolve('TwinWeapon').tag,'CWeaponLegacy');
 assert.match(weapons.source,/<Range value="9"/);assert.match(weapons.source,/<Range value="4"/);
 const units=await fs.readFile(path.join(f.root,unitFile),'utf8');assert.match(units,/Link="BatchWeapon"/);assert.ok(!units.includes('@weapon'));
});

for(const stage of [false,true])test(`batch cross-domain class change rolls back every file and draft (stage=${stage})`,async t=>{
 const f=await fixture(t),unitFile='Base.SC2Data/GameData/UnitData.xml';
 const source='<Catalog><CWeapon id="CustomWeapon"><Range value="6"/></CWeapon></Catalog>';
 await fs.writeFile(path.join(f.root,weaponFile),source);
 const files=[file,weaponFile,'Base.SC2Data/GameData.xml','ComponentList.SC2Components'];
 const before=await Promise.all(files.map(name=>fs.readFile(path.join(f.root,name))));
 await assert.rejects(f.data.batch({changes:[
  {file:weaponFile,operations:[{op:'object.setType',object:'CustomWeapon',ctype:'CWeaponLegacy'}]},
  {file:unitFile,operations:[{op:'object.create',as:'unit',ctype:'CUnit',id:'MustNotPersist'},{op:'object.setType',object:'@unit',ctype:'CActorUnit'}]},
 ],dryRun:false,stage,backup:false}),/DATA_CLASS_CHANGE_DOMAIN_MISMATCH/);
 for(let i=0;i<files.length;i++)assert.deepEqual(await fs.readFile(path.join(f.root,files[i])),before[i]);
 assert.equal(await fs.stat(path.join(f.root,unitFile)).then(()=>true,()=>false),false);
 assert.deepEqual(f.workspace.draftFiles(),[]);
});
