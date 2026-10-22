import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {xpSearchRecipe} from '../modules/data/xpSearchRecipe.js';
import {compileAuthorScript} from '../app/authoringScript.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';

test('XP search is an explicit map-wide override and preserves unrelated gameplay and behavior data',()=>{
 const source='<Catalog><CGame id="Dflt"><DifficultyDefault value="3"/></CGame><CBehaviorVeterancy id="HeroXP"><SharedXPRadius index="Kills" value="7"/></CBehaviorVeterancy></Catalog>';
 const d=new DataDocument(source);xpSearchRecipe(d,{radius:0});
 assert.equal(d.objects().find(o=>o.domain==='Game'&&o.id==='Dflt')!.fields.find(f=>f.name==='VeterancySearchRadius')?.value,'0');
 assert.ok(d.source.includes('<DifficultyDefault value="3"/>'));
 assert.ok(d.source.includes('<SharedXPRadius index="Kills" value="7"/>'));
 const once=d.source;xpSearchRecipe(d,{radius:0});assert.equal(d.source,once);
 assert.throws(()=>xpSearchRecipe(d,{radius:10}),/REPLACE_REQUIRED/);assert.equal(d.source,once);
 xpSearchRecipe(d,{radius:10,replace:true});
 assert.equal(d.objects().find(o=>o.domain==='Game'&&o.id==='Dflt')!.fields.find(f=>f.name==='VeterancySearchRadius')?.value,'10');
});
test('XP search creates the native Dflt record and rejects invalid inputs before mutation',()=>{
 const d=new DataDocument('<Catalog/>');xpSearchRecipe(d,{radius:0});assert.equal(d.objects()[0].ctype,'CGame');assert.equal(d.objects()[0].id,'Dflt');
 for(const radius of [-1,NaN,Infinity,524288]){const doc=new DataDocument('<Catalog/>');assert.throws(()=>xpSearchRecipe(doc,{radius}),/RADIUS/);assert.equal(doc.source,'<Catalog/>');}
 for(const body of ['<CGame id="Dflt"/><CGame id="Dflt"/>','<CGame id="Dflt"><VeterancySearchRadius index="0" value="3"/></CGame>','<CGame id="Dflt"><VeterancySearchRadius value="3"/><VeterancySearchRadius value="4"/></CGame>']){
  const doc=new DataDocument('<Catalog>'+body+'</Catalog>'),before=doc.source;assert.throws(()=>xpSearchRecipe(doc,{radius:0,replace:true}),/GAME_RECORD|FIELD_SHAPE/);assert.equal(doc.source,before);
 }
});
test('compact XP search uses the gameplay catalog and retains the complete guarded Data save',()=>{
 const plan=compileAuthorScript('data xp.search radius=0','save');
 const serialized=JSON.stringify(plan);assert.match(serialized,/data.xp.search/);assert.match(serialized,/Base.SC2Data\/GameData\/GameData.xml/);assert.match(serialized,/modkit.save/);
});
test('strict XP search transactions reject a second catalog owner without staging partial changes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-xp-search-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const owned='Base.SC2Data/GameData/Owned.xml',other='Base.SC2Data/GameData/Other.xml';await fs.mkdir(path.dirname(path.join(root,owned)),{recursive:true});
 await fs.writeFile(path.join(root,owned),'<Catalog><CGame id="Dflt"><VeterancySearchRadius value="10"/></CGame></Catalog>');await fs.writeFile(path.join(root,other),'<Catalog/>');
 await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Owned.xml"/><Catalog path="GameData/Other.xml"/></Includes>');
 const workspace=new Workspace(root),data=new DataWorkspace(workspace);
 await assert.rejects(data.apply({file:other,operations:[{op:'recipe.xpSearch',radius:0}],dryRun:false}),/OTHER_CATALOG/);assert.deepEqual(workspace.draftFiles(),[]);
 const check=await data.apply({file:owned,operations:[{op:'recipe.xpSearch',radius:0,replace:true}],dryRun:true});assert.equal(check.authoring.accepted,true);assert.deepEqual(workspace.draftFiles(),[]);
});
