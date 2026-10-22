import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DataDocument} from '../modules/data/document.js';
import {projectileEffectRecipe} from '../modules/data/projectileRecipe.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {Workspace} from '../core/workspace.js';
import {visualRecipePreloads} from '../modules/data/actorRecipes.js';
import {compileAuthorScript} from '../app/authoringScript.js';

const xml=`<Catalog>
<CEffectLaunchMissile id="LaunchTemplate"><AmmoUnit value="Ammo"/><ImpactEffect value="OldSearch"/><ImpactLocation Value="TargetPoint"/></CEffectLaunchMissile>
<CEffectEnumArea id="OldSearch"/><CEffectDamage id="OldDamage"/>
<CEffectEnumArea id="PointSearch"/><CEffectDamage id="PointDamage"/>
<CUnit id="Ammo"/><CModel id="Ammo"/><CModel id="ImpactModel"/><CSound id="LaunchSound"/><CSound id="ImpactSound"/>
<CActorAction id="GenericAttack" default="1"><?token id="effectLaunch" type="CEffectLink"?><?token id="effectImpact" type="CEffectLink"?></CActorAction>
<CActorMissile id="GenericAttackMissile" default="1"><?token id="unitName" type="CUnitLink"?><Model value="##unitName##"/></CActorMissile>
<CActorMissile id="NativeMissile" parent="GenericAttackMissile" unitName="Ammo"/>
<CActorAction id="ActionTemplate" parent="GenericAttack" effectLaunch="LaunchTemplate" effectImpact="OldSearch"><On Terms="Effect.OldDamage.Start; At Caster" Send="ActionDamage"/><LaunchAssets Sound="LaunchSound"/><ImpactMap index="None" Sound="ImpactSound"/></CActorAction>
</Catalog>`;
const args={id:'PointLaunch',sourceEffect:'LaunchTemplate',sourceActor:'ActionTemplate',impactEffect:'PointSearch',damageEffect:'PointDamage',impactModel:'ImpactModel'};
const active=(d:DataDocument)=>d.objects();

test('projectile recipe rebinds launch/impact/damage, pins inherited missile/model/sound links and is deterministic on owned replacement',()=>{
 const d=new DataDocument(xml),r=projectileEffectRecipe(d,active(d),args),objects=d.objects();
 const launch=objects.find(o=>o.id==='PointLaunch')!,action=objects.find(o=>o.id==='PointLaunchAction')!;
 assert.equal(launch.parent,'LaunchTemplate');assert.equal(launch.fields.find(f=>f.name==='ImpactEffect')?.value,'PointSearch');
 assert.equal(action.parent,'GenericAttack');assert.equal(action.attrs.effectLaunch,'PointLaunch');assert.equal(action.attrs.effectImpact,'PointSearch');
 assert.equal(action.fields.find(f=>f.name==='On')?.attrs.Terms,'Effect.PointDamage.Start; At Caster');
 assert.equal(action.fields.find(f=>f.name==='Missile')?.value,'NativeMissile');assert.equal(action.fields.find(f=>f.name==='LaunchAssets')?.attrs.Sound,'LaunchSound');
 assert.equal(action.fields.find(f=>f.name==='ImpactMap'&&f.index==='None')?.attrs.Model,'ImpactModel');
 assert.equal(action.fields.find(f=>f.name==='ImpactMap'&&f.index==='Shield')?.attrs.Sound,'ImpactSound');
 assert.equal(r.missileModel,'Ammo');assert.equal(r.nativePlayback,'not_checked');assert.equal(objects.filter(o=>o.ctype==='CActorMissile'&&!o.isDefault).length,1);
 const once=d.source;projectileEffectRecipe(d,active(d),{...args,replace:true});assert.equal(d.source,once);
 assert.throws(()=>projectileEffectRecipe(d,active(d),args),/REPLACE_REQUIRED/);assert.equal(d.source,once);
 const preload=visualRecipePreloads('<Preload><Model id="Keep"/></Preload>',d,[],r.preloads);assert.match(preload,/<Unit id="Ammo"/);assert.match(preload,/<Actor id="NativeMissile"/);assert.match(preload,/<Sound id="ImpactSound"/);assert.match(preload,/<Model id="Keep"/);
 assert.equal(visualRecipePreloads(preload,d,[],r.preloads),preload);
});

test('projectile recipe rejects mismatched or ambiguous source chains and collisions before changing the document',()=>{
 for(const altered of [xml.replace('effectImpact="OldSearch"','effectImpact="PointSearch"'),xml.replace('Send="ActionDamage"','Send="Destroy"'),xml.replace('parent="GenericAttackMissile"','parent="OtherMissile"'),xml.replace('value="##unitName##"','value="##dynamic##"'),xml.replace('</Catalog>','<CActorMissile id="Duplicate" parent="GenericAttackMissile" unitName="Ammo"/></Catalog>'),xml.replace('</Catalog>','<CActorUnit id="PointLaunchAction"/></Catalog>')]){
  const d=new DataDocument(altered),before=d.source;assert.throws(()=>projectileEffectRecipe(d,active(d),{...args,replace:true}),/PROJECTILE_/);assert.equal(d.source,before);
 }
 for(const request of [{...args,sourceEffect:args.id},{...args,sourceActor:'Unknown'},{...args,impactModel:'Missing'},{...args,damageEffect:'PointSearch'}]){const d=new DataDocument(xml),before=d.source;assert.throws(()=>projectileEffectRecipe(d,active(d),request),/PROJECTILE_/);assert.equal(d.source,before);}
});

test('MCP projectile operation couples catalog, registration and preloads; missing feedback rejects without staging',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-projectile-recipe-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/Projectile.xml';
 await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),xml);await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Projectile.xml"/></Includes>');
 const workspace=new Workspace(root),data=new DataWorkspace(workspace);
 await assert.rejects(data.apply({file,operations:[{op:'recipe.projectileEffect',...args,impactModel:'Missing'}],dryRun:false}),/PROJECTILE_REFERENCE/);assert.deepEqual(workspace.draftFiles(),[]);
 const r=await data.apply({file,operations:[{op:'recipe.projectileEffect',...args}],dryRun:false});assert.equal(r.authoring.accepted,true);assert.ok(workspace.draftFiles().includes('Preload.xml'));
 await workspace.save(file,{backup:false});assert.match(await fs.readFile(path.join(root,'Preload.xml'),'utf8'),/<Actor id="NativeMissile"/);assert.deepEqual(workspace.draftFiles(),[]);
 const once=await fs.readFile(path.join(root,file),'utf8');await data.apply({file,operations:[{op:'recipe.projectileEffect',...args,replace:true}],dryRun:false});await workspace.save(file,{backup:false});assert.equal(await fs.readFile(path.join(root,file),'utf8'),once);
});

test('compact projectile authoring stages and saves the complete Data group through its public tool',()=>{
 const steps=compileAuthorScript('data effect.projectile id=PointLaunch sourceEffect=EMPLaunchMissile sourceActor=GhostEMPAttack impactEffect=PointSearch damageEffect=PointDamage impactModel=GhostEMPAttackImpactEffect','save');
 assert.deepEqual(steps.map(s=>s.tool),['data.effect.projectile','modkit.save']);assert.equal(steps[0].args.dryRun,false);assert.equal(steps[1].args.file,'Base.SC2Data/GameData/EffectData.xml');
});
