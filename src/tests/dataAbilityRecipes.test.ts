import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {instantAbilityRecipe,targetAbilityRecipe} from '../modules/data/abilityRecipes.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {Workspace} from '../core/workspace.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const source=new DataDocument('<Catalog><CAbilEffectInstant id="Stimpack"/></Catalog>').objects()[0];
const args={id:'Pulse',effect:'PulseSearch',button:'PulseButton',energy:25,cooldown:5,unit:'Caster',card:{page:0,slot:8,row:2,column:1}};
test('new execution recipes own a native order identity even when their source declares a shared AbilSetId',()=>{
 for(const ctype of ['CAbilEffectInstant','CAbilEffectTarget']){
  const source=new DataDocument('<Catalog><'+ctype+' id="Source"><AbilSetId value="SharedOriginal"/></'+ctype+'></Catalog>').objects()[0],d=new DataDocument('<Catalog/>');
  if(ctype==='CAbilEffectInstant')instantAbilityRecipe(d,source,{id:'Independent',effect:'Damage',button:'Face'});else targetAbilityRecipe(d,source,{id:'Independent',sourceAbility:'Source',effect:'Damage',button:'Face'});
  assert.equal(d.objects()[0].fields.find(f=>f.name==='AbilSetId')?.value,'Independent');assert.equal(source.fields[0].value,'SharedOriginal');
 }
});

test('instant recipe preserves native execution template, neutralizes inherited life cost and binds an explicit command page',()=>{
 const d=new DataDocument('<Catalog><CUnit id="Caster" parent="Marine"><LifeMax value="1000"/></CUnit></Catalog>');
 instantAbilityRecipe(d,source,args);const a=d.objects().find(o=>o.id==='Pulse')!;assert.equal(a.parent,'Stimpack');
 const fields=a.fields.find(f=>f.name==='Cost')!.children;assert.equal(fields.find(f=>f.name==='Vital'&&f.index==='Life')?.value,'0');assert.equal(fields.find(f=>f.name==='Vital'&&f.index==='Energy')?.value,'25');assert.equal(fields.find(f=>f.name==='Cooldown')?.attrs.Location,'Unit');
 const u=d.objects().find(o=>o.id==='Caster')!,card=u.fields.find(f=>f.name==='CardLayouts')!;assert.equal(card.index,'0');assert.equal(card.children[0].index,'8');assert.equal(card.children[0].attrs.Column,'1');assert.equal(u.fields.find(f=>f.name==='LifeMax')?.value,'1000');
 const once=d.source;instantAbilityRecipe(d,source,{...args,replace:true});assert.equal(d.source,once);assert.throws(()=>instantAbilityRecipe(d,source,args),/REPLACE_REQUIRED/);
});

test('instant recipe rejects unsupported source, unknown local units, unindexed cards and occupied slots before mutation',()=>{
 for(const xml of ['<Catalog/>','<Catalog><CUnit id="Caster"><CardLayouts/></CUnit></Catalog>','<Catalog><CUnit id="Caster"><CardLayouts index="0"><LayoutButtons index="8" AbilCmd="Keep,Execute"/></CardLayouts></CUnit></Catalog>']){
  const d=new DataDocument(xml),before=d.source;assert.throws(()=>instantAbilityRecipe(d,source,args),/INSTANT_ABILITY_/);assert.equal(d.source,before);
 }
 assert.throws(()=>instantAbilityRecipe(DataDocument.create(),{...source,ctype:'CAbilEffectTarget'},{...args,unit:undefined,card:undefined}),/SOURCE_UNSUPPORTED/);
});
test('cast intro override targets native level0 instead of appending an inherited timing level',()=>{
 const d=new DataDocument('<Catalog><CUnit id="Caster"/></Catalog>');instantAbilityRecipe(d,source,{...args,castIntroTime:3});const ability=d.objects().find(o=>o.id==='Pulse')!,time=ability.fields.find(f=>f.name==='CastIntroTime')!;assert.equal(time.index,'0');assert.equal(time.value,'3');
 const once=d.source;instantAbilityRecipe(d,source,{...args,castIntroTime:3,replace:true});assert.equal(d.source,once);
 for(const castIntroTime of [-1,NaN,Infinity,524288]){const before=d.source;assert.throws(()=>instantAbilityRecipe(d,source,{...args,castIntroTime,replace:true}),/CAST_INTRO_BOUNDS/);assert.equal(d.source,before);}
 instantAbilityRecipe(d,source,{...args,replace:true});assert.equal(d.objects().find(o=>o.id==='Pulse')!.fields.some(f=>f.name==='CastIntroTime'),false);
});

test('outro and finish overrides are native level0 timings, including zero, and invalid values never partially replace either ability class',()=>{
 for(const targeted of [false,true]){
  const native={...source,ctype:targeted?'CAbilEffectTarget':'CAbilEffectInstant'},request={...args,sourceAbility:native.id!,castOutroTime:0,finishTime:2},d=new DataDocument('<Catalog><CUnit id="Caster"/></Catalog>');
  const write=(a:typeof request&{replace?:boolean})=>targeted?targetAbilityRecipe(d,native,a):instantAbilityRecipe(d,native,a);
  write(request);const timing=d.objects().find(o=>o.id==='Pulse')!.fields.filter(f=>['CastOutroTime','FinishTime'].includes(f.name));assert.deepEqual(timing.map(f=>[f.name,f.index,f.value]),[['CastOutroTime','0','0'],['FinishTime','0','2']]);const once=d.source;write({...request,replace:true});assert.equal(d.source,once);
  for(const field of ['castOutroTime','finishTime'] as const)for(const value of [-1,NaN,Infinity,524288]){assert.throws(()=>write({...request,replace:true,[field]:value}),/CAST_OUTRO_BOUNDS|FINISH_TIME_BOUNDS/);assert.equal(d.source,once);}
  const reset={...request,replace:true};delete (reset as Partial<typeof request>).castOutroTime;delete (reset as Partial<typeof request>).finishTime;write(reset);assert.ok(!d.objects().find(o=>o.id==='Pulse')!.fields.some(f=>['CastOutroTime','FinishTime'].includes(f.name)));
 }
});

test('target recipe retains a native target template and its filters, optionally overrides range, and is deterministic on explicit replacement',()=>{
 const source=new DataDocument('<Catalog><CAbilEffectTarget id="Snipe"><TargetFilters value="Biological;Self,Structure"/><Range value="10"/></CAbilEffectTarget></Catalog>').objects()[0];
 const d=new DataDocument('<Catalog><CUnit id="Caster" parent="Marine"/></Catalog>');
 const request={...args,id:'TargetPulse',sourceAbility:'Snipe',range:6};
 targetAbilityRecipe(d,source,request);const a=d.objects().find(o=>o.id==='TargetPulse')!;
 assert.equal(a.ctype,'CAbilEffectTarget');assert.equal(a.parent,'Snipe');assert.equal(a.fields.find(f=>f.name==='Range')?.value,'6');assert.equal(a.fields.some(f=>f.name==='TargetFilters'),false);
 assert.equal(a.fields.find(f=>f.name==='Range')?.index,'0','A range override must replace native level0, not append another inherited level');
 const cost=a.fields.find(f=>f.name==='Cost')!;assert.equal(cost.children.find(f=>f.name==='Cooldown')?.attrs.TimeUse,'5');
 const once=d.source;targetAbilityRecipe(d,source,{...request,replace:true});assert.equal(d.source,once);
 for(const range of [-1,NaN,Infinity,524288]){const before=d.source;assert.throws(()=>targetAbilityRecipe(d,source,{...request,replace:true,range}),/TARGET_ABILITY_RANGE_BOUNDS/);assert.equal(d.source,before);}
 assert.throws(()=>targetAbilityRecipe(DataDocument.create(),{...source,ctype:'CAbilEffectInstant'},request),/TARGET_ABILITY_SOURCE_UNSUPPORTED/);
});

test('ability recipes resolve a current local source once while retaining ambiguity across real active declarations',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-local-ability-template-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file='Base.SC2Data/GameData/Abilities.xml';await fs.mkdir(path.join(root,'Base.SC2Data/GameData'),{recursive:true});
 const xml='<Catalog><CAbilEffectTarget id="LocalTemplate"><TargetFilters value="Biological;Self"/></CAbilEffectTarget><CEffectDamage id="PulseSearch"/><CButton id="PulseButton"/><CUnit id="Caster"/></Catalog>';
 await fs.writeFile(path.join(root,file),xml);await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Abilities.xml"/></Includes>');
 const workspace=new DataWorkspace(new Workspace(root));
 const r=await workspace.apply({file,operations:[{op:'recipe.targetAbility',...args,id:'TargetPulse',sourceAbility:'LocalTemplate',range:6}],dryRun:true});assert.equal(r.authoring.accepted,true);
 await fs.writeFile(path.join(root,'Base.SC2Data/GameData/Other.xml'),'<Catalog><CAbilEffectTarget id="LocalTemplate"/></Catalog>');
 await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Abilities.xml"/><Catalog path="GameData/Other.xml"/></Includes>');
 await assert.rejects(workspace.apply({file,operations:[{op:'recipe.targetAbility',...args,id:'TargetPulse',sourceAbility:'LocalTemplate'}],dryRun:false}),/TARGET_ABILITY_SOURCE_AMBIGUOUS_OR_MISSING/);
 assert.equal(await fs.readFile(path.join(root,file),'utf8'),xml);
});
