import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createProject} from '../app/project.js';

async function project(t:import('node:test').TestContext){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-authoring-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'ComponentList.SC2Components'),'<Components><DataComponent Type="info">DocumentInfo</DataComponent></Components>');
  return createProject(root,{loadUiSchema:false});
}

for(const [name,operations,expected] of [
  ['missing typed Effect',[{op:'object.create',ctype:'CEffectSet',id:'AuditSet',fields:[{name:'EffectArray',index:0,value:'AuditDefinitelyAbsentEffect'}]}],'DATA_AUTHOR_REFERENCE_MISSING'],
  ['unknown XSD field',[{op:'object.create',ctype:'CEffectDamage',id:'AuditDamage',fields:[{name:'AuditDefinitelyNotAnSC2Field',value:'anything'}]}],'DATA_AUTHOR_FIELD_UNKNOWN'],
  ['incomplete burn recipe',[{op:'recipe.weaponBurn',id:'AuditBurn',carrierEffect:'AuditCarrier',impactEffect:'AuditAbsentImpact',duration:4,period:0.5,periodicDamage:2,visualModel:'AuditAbsentModel'}],'DATA_AUTHOR_REFERENCE_MISSING'],
] as const){
  test(`strict createProject rejects ${name} before staging`,async t=>{
    const {data}=await project(t);
    await assert.rejects(data.apply({operations:operations as never,dryRun:false,stage:true}),new RegExp(expected));
    assert.equal(data.workspace.draftFiles().length,0);
  });
}

test('strict authoring resolves a forward reference against the final batch',async t=>{
  const {data}=await project(t);
  const result=await data.apply({operations:[
    {op:'object.create',ctype:'CEffectSet',id:'BatchSet',fields:[{name:'EffectArray',index:0,value:'BatchDamage'}]},
    {op:'object.create',ctype:'CEffectDamage',id:'BatchDamage',fields:[{name:'Amount',value:2}]},
  ],dryRun:false,stage:true});
  assert.equal(result.authoring.status,'VERIFIED_STATIC');
  assert.equal(result.authoring.editor,'NOT_RUN');
  assert.match((await data.workspace.readRaw('Base.SC2Data/GameData/UnitData.xml')).text,/BatchDamage/);
});

test('missing dependency scope is reported separately from a proven absent target',async t=>{
  const {data}=await project(t);
  await fs.writeFile(path.join(data.workspace.root,'DocumentInfo'),'<DocInfo><Dependencies><Value>file:Mods/Unavailable.SC2Mod</Value></Dependencies></DocInfo>');
  const operations=[{op:'object.create',ctype:'CEffectSet',id:'DependentSet',fields:[{name:'EffectArray',index:0,value:'MaybeInUnavailableMod'}]}] as never;
  await assert.rejects(data.apply({operations,dryRun:false,stage:true}),/DATA_AUTHOR_REFERENCE_SCOPE_INCOMPLETE/);
  const permissive=await data.apply({operations,dryRun:true,authoringPolicy:'compatibility'});
  assert.equal(permissive.authoring.status,'INCOMPLETE');
  assert.equal(permissive.authoring.accepted,false);
});

test('strict update preserves unchanged unknown XML',async t=>{
  const {data}=await project(t);
  const file='Base.SC2Data/GameData/UnitData.xml';
  await fs.mkdir(path.join(data.workspace.root,'Base.SC2Data','GameData'),{recursive:true});
  await fs.writeFile(path.join(data.workspace.root,file),'<Catalog><CUnit id="Existing"><Unknown foo="keep"/></CUnit></Catalog>');
  const result=await data.apply({operations:[{op:'field.set',object:'Existing',path:'LifeMax',value:100}],dryRun:false,stage:true});
  assert.equal(result.authoring.accepted,true);
  assert.match((await data.workspace.readRaw(file)).text,/<Unknown foo="keep"\/>/);
});

test('Data plan rejects a new typed Galaxy consumer before applying',async t=>{
  const {data}=await project(t);
  const plan=await data.plan({operations:[{op:'object.create',ctype:'CUnit',id:'PlannedUnit'}]});
  assert.equal(plan.readyToApply,true);
  await fs.writeFile(path.join(data.workspace.root,'consumer.galaxy'),'void Use(){UnitCreate(1,"PlannedUnit",0,1,null,0);}');
  await assert.rejects(data.applyPlan(plan.planId,false),/STALE_DATA_PLAN/);
  assert.equal(data.workspace.draftFiles().length,0);
});

test('Data plan stages the same forward graph after unchanged preview',async t=>{
  const {data}=await project(t);
  const plan=await data.plan({operations:[
    {op:'object.create',ctype:'CEffectSet',id:'PlannedSet',fields:[{name:'EffectArray',index:0,value:'PlannedDamage'}]},
    {op:'object.create',ctype:'CEffectDamage',id:'PlannedDamage',fields:[{name:'Amount',value:4}]},
  ]});
  const result=await data.applyPlan(plan.planId,false);
  assert.equal(result.authoring.accepted,true);
  assert.match((await data.workspace.readRaw('Base.SC2Data/GameData/UnitData.xml')).text,/PlannedDamage/);
});
test('multi-catalog batch validates a cross-file forward Effect graph and saves one group',async t=>{
  const {data}=await project(t);
  const effect='Base.SC2Data/GameData/EffectData.xml',damage='Base.SC2Data/GameData/DamageData.xml';
  const result=await data.batch({changes:[
    {file:effect,operations:[{op:'object.create',ctype:'CEffectSet',id:'CrossSet',fields:[{name:'EffectArray',index:0,value:'@damage'}]}]},
    {file:damage,operations:[{op:'object.create',as:'damage',ctype:'CEffectDamage',id:'CrossDamage',fields:[{name:'Amount',value:3}]}]},
  ],dryRun:false,stage:true});
  assert.equal(result.authoring.every(v=>v.authoring.accepted),true);
  assert.equal(await fs.stat(path.join(data.workspace.root,effect)).then(()=>true,()=>false),false);
  await data.workspace.save(effect,{backup:false});
  assert.match(await fs.readFile(path.join(data.workspace.root,effect),'utf8'),/CrossDamage/);
  assert.match(await fs.readFile(path.join(data.workspace.root,damage),'utf8'),/CrossDamage/);
  assert.match(await fs.readFile(path.join(data.workspace.root,'Base.SC2Data/GameData.xml'),'utf8'),/DamageData.xml/);
});
test('multi-catalog missing link rolls back every catalog and manifest',async t=>{
  const {data}=await project(t);
  await assert.rejects(data.batch({changes:[
    {file:'Base.SC2Data/GameData/EffectData.xml',operations:[{op:'object.create',ctype:'CEffectSet',id:'BadSet',fields:[{name:'EffectArray',value:'Absent'}]}]},
    {file:'Base.SC2Data/GameData/DamageData.xml',operations:[{op:'object.create',ctype:'CEffectDamage',id:'Other'}]},
  ],dryRun:false,stage:true}),/DATA_AUTHOR_REFERENCE_MISSING/);
  assert.equal(data.workspace.draftFiles().length,0);
});
