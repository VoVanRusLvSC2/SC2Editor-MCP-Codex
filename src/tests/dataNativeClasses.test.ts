import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DataDocument} from '../modules/data/document.js';
import {validateDataDocuments} from '../modules/data/validator.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {Workspace} from '../core/workspace.js';
import {SchemaRegistry} from '../schema/schemaRegistry.js';

const file='Base.SC2Data/GameData/WeaponData.xml',code='DATA_NATIVE_CLASS_INSTANCE_REFUSED';
const validation=(source:string)=>validateDataDocuments(file,[{file,layer:'workspace',document:new DataDocument(source,file)}]);

test('static class decisions match the exact six original Editor load controls',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('../../src/tests/fixtures/native-class-load-controls.json',import.meta.url),'utf8')) as {editorBuild:string;cases:Array<{name:string;catalogXml:string;catalogSha256:string;nativeLoadVerified:boolean;nativeValidationPassed:boolean}>};
 assert.equal(fixture.editorBuild,'5.0.17.98310');assert.equal(fixture.cases.length,6);
 for(const item of fixture.cases){
  assert.equal(createHash('sha256').update(item.catalogXml).digest('hex'),item.catalogSha256,item.name);assert.equal(item.nativeLoadVerified,true);
  const checked=validation(item.catalogXml);assert.equal(checked.valid,item.nativeValidationPassed,item.name);
  assert.equal(checked.diagnostics.some(d=>d.code===code),!item.nativeValidationPassed,item.name);
 }
});
async function fixture(t:import('node:test').TestContext,source='<Catalog/>'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-class-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(root,file),source);
 await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/WeaponData.xml"/></Includes>');
 await fs.writeFile(path.join(root,'ComponentList.SC2Components'),'<Components/>');
 const workspace=new Workspace(root,await SchemaRegistry.loadBundled());return{root,workspace,data:new DataWorkspace(workspace)};
}

test('native class validation reports a proven ordinary CWeapon refusal without rewriting XML',()=>{
 const source='<Catalog>\r\n<!-- imported --><CWeapon id="Broken"><Range value="6"/></CWeapon>\r\n</Catalog>',document=new DataDocument(source,file);
 const result=validateDataDocuments(file,[{file,layer:'workspace',document}]);
 assert.equal(result.valid,false);assert.ok(result.diagnostics.some(d=>d.code===code&&d.path==='CWeapon:Broken'));assert.equal(document.source,source);
});

test('idless and named defaults, concrete weapons and CEffect remain outside the refusal',()=>{
 const source='<Catalog><CWeapon default="1"/><CWeapon id="Template" default="1"/><CWeaponLegacy id="Concrete"/><CEffect id="EffectBase"/></Catalog>';
 const result=validation(source);assert.equal(result.valid,true);assert.ok(!result.diagnostics.some(d=>d.code===code));
});

test('explicit dynamic template flags are not guessed to be ordinary instances',()=>{
 const result=validation('<Catalog><CWeapon id="TokenDefault" default="##TemplateFlag##"/></Catalog>');assert.ok(!result.diagnostics.some(d=>d.code===code));
});

for(const mode of ['single','batch'] as const)test(`${mode} authoring rejects ordinary CWeapon before files or drafts are changed`,async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.root,file));
 const operations=[{op:'object.create' as const,ctype:'CWeapon',id:'NewWeapon',fields:[{name:'Range',value:6}]}];
 const request=mode==='single'?f.data.apply({file,operations,dryRun:false,stage:true}):f.data.batch({changes:[{file,operations}],dryRun:false,stage:true});
 await assert.rejects(request,new RegExp(code));assert.deepEqual(await fs.readFile(path.join(f.root,file)),before);assert.deepEqual(f.workspace.draftFiles(),[]);
});

test('native class discovery exposes the scoped observation separately from XSD metadata',async t=>{
 const f=await fixture(t),weapon=await f.data.describeType('CWeapon'),effect=await f.data.describeType('CEffect');
 assert.equal(weapon.nativeClassObservations.length,1);assert.equal(weapon.nativeClassObservations[0].editorBuild,'5.0.17.98310');assert.equal(weapon.nativeClassObservations[0].concreteAlternative,'CWeaponLegacy');
 assert.match(weapon.nativeClassObservations[0].ordinaryReportSha256,/^[a-f0-9]{64}$/);assert.deepEqual(effect.nativeClassObservations,[]);
});

test('new named defaults and clones retain their explicit default flag',async t=>{
 const f=await fixture(t);await f.data.apply({file,operations:[{op:'object.create',ctype:'CWeapon',id:'Template',attrs:{default:true},fields:[{name:'Range',value:6}]},{op:'object.clone',object:'Template',id:'TemplateCopy'}],dryRun:false,stage:false,backup:false});
 const document=new DataDocument(await fs.readFile(path.join(f.root,file),'utf8'));for(const id of ['Template','TemplateCopy'])assert.equal(document.resolve(id).attrs.default,'1');
});

for(const operation of [
 {op:'object.removeAttribute' as const,object:'Template',attribute:'default'},
 {op:'object.setAttribute' as const,object:'Template',attribute:'default',value:0},
] )test(`removing template status through ${operation.op} is rejected atomically`,async t=>{
 const source='<Catalog><CWeapon id="Template" default="1"><Range value="6"/></CWeapon></Catalog>',f=await fixture(t,source);
 await assert.rejects(f.data.apply({file,operations:[operation],dryRun:false,stage:false}),new RegExp(code));assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),source);
});

test('retyping a concrete weapon to a refused ordinary class is rejected',async t=>{
 const source='<Catalog><CWeaponLegacy id="Concrete"/></Catalog>',f=await fixture(t,source);
 await assert.rejects(f.data.batch({changes:[{file,operations:[{op:'object.setType',object:'Concrete',ctype:'CWeapon'}]}],dryRun:false,stage:true}),new RegExp(code));assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),source);assert.deepEqual(f.workspace.draftFiles(),[]);
});

test('cloning an imported ordinary weapon does not duplicate a natively refused instance',async t=>{
 const source='<Catalog><CWeapon id="Imported"/></Catalog>',f=await fixture(t,source);
 await assert.rejects(f.data.apply({file,operations:[{op:'object.clone',object:'Imported',id:'Clone'}],dryRun:false,stage:false}),new RegExp(code));assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),source);
});

test('a final valid class repair is accepted even with a transient abstract create',async t=>{
 const f=await fixture(t);const result=await f.data.batch({changes:[{file,operations:[{op:'object.create',as:'weapon',ctype:'CWeapon',id:'Repaired'},{op:'object.setType',object:'@weapon',ctype:'CWeaponLegacy'},{op:'field.set',object:'@weapon',path:'Range',value:7}]}],dryRun:false,stage:false,backup:false});
 assert.equal(result.validation?.valid,true);assert.equal(new DataDocument(await fs.readFile(path.join(f.root,file),'utf8')).resolve('Repaired').tag,'CWeaponLegacy');
});
