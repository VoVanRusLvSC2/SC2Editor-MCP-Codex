import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {registerDataTools} from '../modules/data/tools.js';
import {readAnimationInventory} from '../modules/assets/animationInventory.js';
import type {CascWorkspace} from '../modules/casc/workspace.js';
import {sequenceModel} from './support/animationModel.js';
const file='Base.SC2Data/GameData/Test.xml',asset='Assets/Units/Terran/Marine/Marine.m3';
const xml='<Catalog><CActorUnit id="GenericUnitBase"><On Terms="UnitBirth.##unitName##" Send="Create"/></CActorUnit><CUnit id="Hero"/><CAbilEffectTarget id="Strike"/><CModel id="Unit"><?token id="Race" type="CString" value="Terran"?><Model value="Assets/Units/##Race##/##id##/##id##.m3"/></CModel><CModel id="Marine" parent="Unit"/><CActorUnit id="HeroActor" parent="GenericUnitBase" unitName="Hero"><Model value="Marine"/><On Terms="WeaponStart.*.AttackStart" Send="AnimBracketStart Attack Attack"/></CActorUnit></Catalog>';
const recipe={op:'recipe.unitAbilityAnimation' as const,id:'StrikeMotion',actor:'HeroActor',unit:'Hero',ability:'Strike',cast:'Attack',finish:'Spell'};
async function fixture(t:test.TestContext){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-anim-data-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));for(const [p,bytes]of [[file,xml],['Base.SC2Data/GameData.xml','<Includes><Catalog path="GameData/Test.xml"/></Includes>'],[asset,sequenceModel()]] as const){await fs.mkdir(path.dirname(path.join(root,p)),{recursive:true});await fs.writeFile(path.join(root,p),bytes);}const workspace=new Workspace(root),data=new DataWorkspace(workspace);data.animationModelReader=(resources,sources)=>readAnimationInventory(workspace,{read:async()=>{throw Error('CASC_FILE_NOT_FOUND');}} as Pick<CascWorkspace,'read'>,resources,sources);return {root,workspace,data};}

test('MCP animation recipe resolves real tokenized model bytes, stages atomically and preserves native events on a true repeat',async t=>{
 const f=await fixture(t),handlers=new Map<string,{config:any;run:(a:any)=>Promise<any>}>();registerDataTools({registerTool:(name:string,config:any,run:any)=>handlers.set(name,{config,run})} as any,{workspace:f.data});const tool=handlers.get('data.actor.ability_animation')!;
 const args={...recipe,file,dryRun:false,stage:true};delete (args as Partial<typeof recipe>).op;
 const result=JSON.parse((await tool.run(args)).content[0].text);assert.equal(result.authoring.accepted,true);const review=result.applied[0].animation;assert.equal(review.nativePlayback,'not_checked');assert.equal(review.model.id,'Marine');assert.equal(review.supplementalCoverage,'resolved');assert.match(review.assetRevision,/^[a-f0-9]{64}$/);
 assert.equal(review.assets.length,1);assert.equal(review.assets[0].resource,asset);assert.equal(review.assets[0].sha256,review.model.sha256);
 assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),xml);await f.workspace.save(file,{backup:false});const once=await fs.readFile(path.join(f.root,file),'utf8');assert.ok(once.includes('AnimBracketStart Attack Attack'));assert.equal((once.match(/id="HeroActor"/g)??[]).length,1);
 await f.data.apply({file,operations:[{...recipe,replace:true}],dryRun:false,stage:false,backup:false});assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),once);
 const fail=await tool.run({...args,cast:'Unknown',replace:true});assert.equal(fail.isError,true);assert.equal(JSON.parse(fail.content[0].text).error.code,'UNIT_ANIMATION_SEQUENCE_MISSING');assert.deepEqual(f.workspace.draftFiles(),[]);
 assert.equal(tool.config.inputSchema.safeParse({...args,animations:['Attack']}).success,false);
});
test('animation plan pins actual model revision and a model-only edit prevents apply without changing Data',async t=>{
 const f=await fixture(t),plan=await f.data.plan({file,operations:[recipe]});assert.equal(plan.readyToApply,true);assert.match(plan.applied[0].animation!.assetRevision,/^[a-f0-9]{64}$/);
 await fs.writeFile(path.join(f.root,asset),sequenceModel(['Attack','Spell','Walk']));await assert.rejects(f.data.applyPlan(plan.planId,false,true),/STALE_ASSET_REVISION/);assert.deepEqual(f.workspace.draftFiles(),[]);assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),xml);
});
test('a model edit after staging prevents the entire Data group from being saved',async t=>{
 const f=await fixture(t);await f.data.apply({file,operations:[recipe],dryRun:false,stage:true});await fs.writeFile(path.join(f.root,asset),sequenceModel(['Attack','Spell','Walk']));await assert.rejects(f.workspace.save(file,{backup:false}),/STALE/);assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),xml);assert.ok(f.workspace.hasDraft(file));
});
test('unresolved effective model or sequence fails before mutation and no injected inventory can replace actual bytes',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,file),xml.replace('value="Marine"','value="Missing"'));await assert.rejects(f.data.apply({file,operations:[recipe],dryRun:false,stage:true}),/DECLARATION_UNRESOLVED/);assert.deepEqual(f.workspace.draftFiles(),[]);
 await fs.writeFile(path.join(f.root,file),xml);await fs.writeFile(path.join(f.root,asset),sequenceModel(['Walk']));await assert.rejects(f.data.apply({file,operations:[recipe],dryRun:false,stage:true}),/SEQUENCE_MISSING/);assert.deepEqual(f.workspace.draftFiles(),[]);
});
