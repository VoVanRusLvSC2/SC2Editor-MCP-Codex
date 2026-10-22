import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
async function fixture(t:test.TestContext,xml:string){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-model-tokens-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(root,'Base.SC2Data/GameData/Test.xml'),xml);await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Test.xml"/></Includes>');return new DataWorkspace(new Workspace(root));}
test('effective Model resource uses the concrete id with inherited native Prefix/Race tokens',async t=>{
 const data=await fixture(t,'<Catalog><CModel id="Unit"><?token id="Race" type="CString" value="Neutral"?><?token id="Prefix" type="CString" value="Units/"?><Model value="Assets/##Prefix####Race##/##id##/##id##.m3"/><Name value="##Unknown##"/></CModel><CModel id="MarineBase" parent="Unit"><?token id="Race" type="CString" value="Terran"?></CModel><CModel id="Marine" parent="MarineBase"/></Catalog>');
 const r=await data.resolveFields({domain:'Model',id:'Marine',fields:['Model','Name']}),effective=r.objects[0].effective;assert.ok(effective);assert.equal(effective.fields.Model.value,'Assets/Units/Terran/Marine/Marine.m3');assert.equal(effective.fields.Model.status,'resolved');assert.equal(effective.fields.Name.status,'unknown');assert.deepEqual(effective.unresolvedParents,[]);
});
test('typed inherited Actor tokens with no default accept the concrete attribute value',async t=>{
 const data=await fixture(t,'<Catalog><CActorUnit default="1"><?token id="unitName" type="CUnitLink"?><Model value="##unitName##"/><Name value="##id##"/></CActorUnit><CActorUnit id="HeroActor" unitName="Marine"/></Catalog>');const r=await data.resolveFields({domain:'Actor',id:'HeroActor',fields:['Model','Name']}),effective=r.objects[0].effective;assert.ok(effective);assert.equal(effective.fields.Model.value,'Marine');assert.equal(effective.fields.Name.value,'HeroActor');
});
