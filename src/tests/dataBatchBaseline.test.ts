import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {SchemaRegistry} from '../schema/schemaRegistry.js';
import {DataWorkspace} from '../modules/data/workspace.js';

async function fixture(t:TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-batch-baseline-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'Base.SC2Data/GameData'),{recursive:true});
 await fs.writeFile(path.join(root,'ComponentList.SC2Components'),'<Components/>');
 const actor='Base.SC2Data/GameData/ActorData.xml';
 const source='<Catalog><CActorUnit id="Original" unitName="Marine" parent="GenericUnitBase"/><CActorUnit id="Broken" unitName="CustomMarine" parent="Original"><On Terms="UnitBirth.CustomMarine" Send="Create"/></CActorUnit></Catalog>';
 await fs.writeFile(path.join(root,actor),source);
 return {root,actor,source,data:new DataWorkspace(new Workspace(root,await SchemaRegistry.loadBundled()))};
}

test('explicit baseline preservation retains an existing actor error without changing its file',async t=>{
 const f=await fixture(t),changes=[{file:'Base.SC2Data/GameData/New.xml',operations:[{op:'object.create' as const,ctype:'CEffectDamage',id:'NewDamage'}]}];
 await assert.rejects(f.data.batch({changes,dryRun:false,stage:false}),/DATA_BATCH_VALIDATION_FAILED/);
 const result=await f.data.batch({changes,dryRun:false,stage:false,preserveExistingErrors:{reason:'Preserve the unchanged legacy hero while authoring an unrelated effect.'}});
 assert.equal(result.accepted,true);
 assert.equal(result.validation?.valid,false);
 assert.ok(result.validationDelta?.retainedErrors.some(d=>d.code==='DATA_ACTOR_CONCRETE_PARENT_CREATE'));
 assert.equal(result.validationDelta?.blockingErrors.length,0);
 assert.equal(await fs.readFile(path.join(f.root,f.actor),'utf8'),f.source);
});

test('baseline preservation never accepts errors on a catalog included in the edit',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.data.batch({changes:[{file:f.actor,operations:[{op:'field.set',object:'CActorUnit:Broken',path:'EditorCategories',value:'ObjectType:Unit'}]}],dryRun:false,stage:false,preserveExistingErrors:{reason:'This explicit edit must still reject its known invalid actor.'}}),/DATA_AUTHORING_REJECTED|DATA_BATCH_VALIDATION_FAILED/);
 assert.equal(await fs.readFile(path.join(f.root,f.actor),'utf8'),f.source);
});
