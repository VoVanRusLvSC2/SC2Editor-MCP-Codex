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
