import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DataDocument} from '../modules/data/document.js';
import {abilityChargesRecipe} from '../modules/data/abilityCharges.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {Workspace} from '../core/workspace.js';
import {compileAuthorScript} from '../app/authoringScript.js';

const xml='<Catalog><CEffectDamage id="Damage"/><CButton id="Face"/><CAbilEffectTarget id="Template"/><CAbilEffectTarget id="Pulse" parent="Template"><Effect index="0" value="Damage"/><Cost index="0"><Vital index="Energy" value="25"/><Cooldown Link="KeepCooldown" TimeUse="5" Location="Unit"/><Charge Link="Old" CountMax="9"/></Cost><CmdButtonArray index="Execute" DefaultButtonFace="Face"/></CAbilEffectTarget></Catalog>';
test('charge ownership preserves mechanics and card while replacing only direct Charge across all four supported scopes',()=>{
 for(const location of ['Abil','Unit','Player','Global'] as const){
  const d=new DataDocument(xml);abilityChargesRecipe(d,{id:'Pulse',max:3,start:2,use:1,regen:8,location,link:'Pool/'+location});
  const a=d.objects().find(o=>o.id==='Pulse')!,cost=a.fields.find(f=>f.name==='Cost')!,charge=cost.children.find(f=>f.name==='Charge')!;
  assert.equal(cost.children.filter(f=>f.name==='Charge').length,1);assert.equal(charge.link,'Pool/'+location);assert.equal(charge.attrs.CountMax,'3');assert.equal(charge.attrs.CountStart,'2');assert.equal(charge.attrs.CountUse,'1');assert.equal(charge.attrs.TimeUse,'8');assert.equal(charge.attrs.Location,location);assert.equal(charge.children.find(f=>f.index==='EnableChargeTimeQueuing')?.value,'1');
  assert.equal(charge.attrs.TimeStart,'8','Initial recovery must not immediately fill a partial starting stock');
  assert.equal(cost.children.find(f=>f.name==='Vital')?.value,'25');assert.equal(cost.children.find(f=>f.name==='Cooldown')?.link,'KeepCooldown');assert.equal(a.fields.find(f=>f.name==='Effect')?.value,'Damage');assert.equal(a.fields.find(f=>f.name==='CmdButtonArray')?.attrs.DefaultButtonFace,'Face');
  const once=d.source;abilityChargesRecipe(d,{id:'Pulse',max:3,start:2,use:1,regen:8,location,link:'Pool/'+location});assert.equal(d.source,once);
 }
});
test('charge disable neutralizes inherited timers/flags and new direct Cost is created without fabricating energy or cooldown',()=>{
 const d=new DataDocument(xml);abilityChargesRecipe(d,{id:'Pulse',max:0});const c=d.objects().find(o=>o.id==='Pulse')!.fields.find(f=>f.name==='Cost')!.children.find(f=>f.name==='Charge')!;assert.equal(c.attrs.CountMax,'0');assert.equal(c.attrs.CountStart,'0');assert.equal(c.attrs.CountUse,'0');assert.equal(c.attrs.HideCount,'1');assert.equal(c.children.find(f=>f.index==='RestoreAllChargesOnCooldown')?.value,'0');
 const bare=new DataDocument('<Catalog><CAbilEffectInstant id="Pulse"/></Catalog>');abilityChargesRecipe(bare,{id:'Pulse',max:2});const children=bare.objects()[0].fields[0].children;assert.deepEqual(children.map(f=>f.name),['Charge']);assert.equal(children[0].attrs.CountStart,'2');
});

test('finite partial and empty initial stocks disable only initial refill while preserving a zero use timer',()=>{
 for(const start of [0,1]){const d=new DataDocument(xml);abilityChargesRecipe(d,{id:'Pulse',max:3,start,use:1,regen:0});const charge=d.objects().find(o=>o.id==='Pulse')!.fields.find(f=>f.name==='Cost')!.children.find(f=>f.name==='Charge')!;assert.equal(charge.attrs.CountStart,String(start));assert.equal(charge.attrs.TimeStart,'-1');assert.equal(charge.attrs.TimeUse,'0');}
});
test('invalid charge counts, identity, scopes and ambiguous cost shapes reject before mutation',()=>{
 for(const request of [{max:-1},{max:1.5},{max:1001},{max:2,start:3},{max:2,use:0},{max:2,use:3},{max:0,regen:1},{max:2,regen:Infinity},{max:2,regen:-1},{max:2,location:'Behavior'},{max:2,link:'bad key'}]){
  const d=new DataDocument(xml),before=d.source;assert.throws(()=>abilityChargesRecipe(d,{id:'Pulse',...request} as any),/ABILITY_CHARGES_/);assert.equal(d.source,before);
 }
 for(const source of [xml.replace('Cost index="0"','Cost'),xml.replace('<CAbilEffectTarget id="Pulse"','<CAbilLearn id="Pulse"').replace('</CAbilEffectTarget></Catalog>','</CAbilLearn></Catalog>'),'<Catalog/>']){const d=new DataDocument(source),before=d.source;assert.throws(()=>abilityChargesRecipe(d,{id:'Pulse',max:2}),/ABILITY_CHARGES_/);assert.equal(d.source,before);}
});
test('MCP charge plans pin their source, stage strictly and preserve unchanged noncharge fields through save',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-ability-charges-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/Charges.xml';await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),xml);await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Charges.xml"/></Includes>');
 const workspace=new Workspace(root),data=new DataWorkspace(workspace),operation={op:'recipe.abilityCharges' as const,id:'Pulse',max:3,regen:8};
 const p=await data.plan({file,operations:[operation]});assert.equal(p.readyToApply,true);await fs.appendFile(path.join(root,file),' ');await assert.rejects(data.applyPlan(p.planId,false),/STALE_DATA_PLAN/);assert.deepEqual(workspace.draftFiles(),[]);
 await fs.writeFile(path.join(root,file),xml);const r=await data.apply({file,operations:[operation],dryRun:false});assert.equal(r.authoring.accepted,true);await workspace.save(file,{backup:false});const saved=await fs.readFile(path.join(root,file),'utf8');assert.match(saved,/KeepCooldown/);assert.match(saved,/CountMax="3"/);
 await assert.rejects(data.apply({file,operations:[{...operation,max:-1}],dryRun:false}),/ABILITY_CHARGES_/);assert.deepEqual(workspace.draftFiles(),[]);assert.equal(await fs.readFile(path.join(root,file),'utf8'),saved);
});
test('compact native charge configuration has explicit stage/save boundaries and keeps zero as a real disabled gate',()=>{
 const steps=compileAuthorScript('data ability.charges id=Pulse max=0','save');assert.deepEqual(steps.map(s=>s.tool),['data.ability.charges','modkit.save']);assert.equal(steps[0].args.max,0);assert.equal(steps[0].args.dryRun,false);
});
