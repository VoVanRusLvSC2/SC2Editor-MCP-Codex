import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {learnRecipe,type LearnRecipe} from '../modules/data/learnRecipe.js';
import {DataCardBindingError,reviewCardBinding} from '../modules/data/cardBindings.js';
import {compileAuthorScript} from '../app/authoringScript.js';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';

const source='<Catalog><CUnit id="Ghost"><CardLayouts><LayoutButtons Face="Move" Type="AbilCmd" AbilCmd="move,Move" Row="0" Column="0"/></CardLayouts></CUnit><CUnit id="Hero" parent="Ghost"><BehaviorArray Link="XP"/><AbilArray Link="Pulse"/></CUnit><CBehaviorVeterancy id="XP"><VeterancyLevelArray index="0" MinVeterancyXP="0"/><VeterancyLevelArray index="1" MinVeterancyXP="50"/><VeterancyLevelArray index="2" MinVeterancyXP="100"/></CBehaviorVeterancy><CAbilEffectTarget id="Pulse"><Levels value="3"/><Effect index="0" value="RankOne"/><Effect index="1" value="RankTwo"/><Effect index="2" value="RankThree"/></CAbilEffectTarget><CButton id="LearnPulse"/><CButton id="LearnOther"/></Catalog>';
const request:LearnRecipe={id:'HeroLearn',unit:'Hero',veterancy:'XP',points:0,pointsPerLevel:1,entries:[{command:1,ability:'Pulse',button:'LearnPulse',minLevel:1,levelSkip:1,card:{page:0,slot:13,row:1,column:1}}]};
test('native Learn records bind one point pool, explicit progression and actual Learn commands without rewriting execution mechanics',()=>{
 const d=new DataDocument(source),pulse=source.match(/<CAbilEffectTarget id="Pulse">[\s\S]*?<\/CAbilEffectTarget>/)![0];learnRecipe(d,d.objects(),request);
 const learn=d.objects().find(o=>o.id==='HeroLearn')!,hero=d.objects().find(o=>o.id==='Hero')!;
 assert.equal(learn.ctype,'CAbilLearn');assert.equal(learn.fields.find(f=>f.name==='VeterancyBehavior')?.value,'XP');assert.equal(learn.fields.find(f=>f.name==='Points')?.value,'0');assert.equal(learn.fields.find(f=>f.name==='PointsPerLevel')?.value,'1');
 const entry=learn.fields.find(f=>f.name==='InfoArray')!;assert.equal(entry.index,'Learn1');assert.equal(entry.children.find(f=>f.name==='Abil')?.value,'Pulse');
 const card=hero.fields.find(f=>f.name==='CardLayouts')!.children.find(f=>f.name==='LayoutButtons')!;assert.equal(card.attrs.AbilCmd,'HeroLearn,Learn1');assert.equal(hero.fields.filter(f=>f.name==='AbilArray'&&f.link==='HeroLearn').length,1);
 assert.equal(d.source.match(/<CAbilEffectTarget id="Pulse">[\s\S]*?<\/CAbilEffectTarget>/)![0],pulse);
 const once=d.source;learnRecipe(d,d.objects(),{...request,replace:true});assert.equal(d.source,once);assert.throws(()=>learnRecipe(d,d.objects(),request),/REPLACE_REQUIRED/);
});
test('learn replacement removes stale owned commands, preserves unrelated cards and can relocate an entry',()=>{
 const d=new DataDocument(source);learnRecipe(d,d.objects(),request);
 const next={...request,replace:true,entries:[{...request.entries[0],command:2,card:{page:0,slot:14,row:1,column:2}}]};learnRecipe(d,d.objects(),next);
 const hero=d.objects().find(o=>o.id==='Hero')!,card=hero.fields.find(f=>f.name==='CardLayouts')!.children;
 assert.equal(card.find(f=>f.index==='13')?.attrs.removed,'1');assert.equal(card.find(f=>f.index==='14')?.attrs.AbilCmd,'HeroLearn,Learn2');
 const review=reviewCardBinding(d.objects(),'Hero');assert.equal(review.layoutResolved,true);assert.ok(review.bindings.some(b=>b.attrs.AbilCmd==='move,Move'));assert.ok(!review.bindings.some(b=>b.attrs.AbilCmd==='HeroLearn,Learn1'));
});
test('wrong references, rank reachability and duplicate learn entries reject before any source write',()=>{
 for(const input of [{...request,points:-1},{...request,pointsPerLevel:Infinity},{...request,entries:[]},{...request,entries:[request.entries[0],request.entries[0]]},{...request,entries:[{...request.entries[0],command:21}]},{...request,entries:[{...request.entries[0],minLevel:2}]},{...request,entries:[{...request.entries[0],levelSkip:2}]},{...request,entries:[{...request.entries[0],button:'Missing'}]}]){
  const d=new DataDocument(source),before=d.source;assert.throws(()=>learnRecipe(d,d.objects(),input),/LEARN_RECIPE_/);assert.equal(d.source,before);
 }
 for(const xml of [source.replace('<Levels value="3"/>',''),source.replace('<Levels value="3"/>','<Levels value="0"/>'),source.replace('<BehaviorArray Link="XP"/>',''),source.replace('<CBehaviorVeterancy id="XP">','<CBehaviorVeterancy id="XP" parent="Other">'),source.replace('</Catalog>','<CAbilEffectTarget id="Pulse"/> </Catalog>'),source.replace('<CUnit id="Ghost">','<CUnit id="Ghost" parent="Hero">')]){
  const d=new DataDocument(xml),before=d.source;assert.throws(()=>learnRecipe(d,d.objects(),request),/LEARN_RECIPE_/);assert.equal(d.source,before);
 }
});
test('explicit veterancy indexes are semantic and may be serialized out of numeric order',()=>{
 const d=new DataDocument(source.replace('<VeterancyLevelArray index="0" MinVeterancyXP="0"/><VeterancyLevelArray index="1" MinVeterancyXP="50"/><VeterancyLevelArray index="2" MinVeterancyXP="100"/>','<VeterancyLevelArray index="2" MinVeterancyXP="100"/><VeterancyLevelArray index="0" MinVeterancyXP="0"/><VeterancyLevelArray index="1" MinVeterancyXP="50"/>'));learnRecipe(d,d.objects(),request);assert.ok(d.objects().some(o=>o.id==='HeroLearn'));
});
test('learning never overwrites an unrelated native card and independent learn commands cannot share a cell or face accidentally',()=>{
 const d=new DataDocument(source),before=d.source;assert.throws(()=>learnRecipe(d,d.objects(),{...request,entries:[{...request.entries[0],card:{page:0,slot:0,row:1,column:1}}]}),DataCardBindingError);assert.equal(d.source,before);
 const second=source.replace('</Catalog>','<CAbilEffectInstant id="Other"><Levels value="1"/></CAbilEffectInstant></Catalog>');
 for(const conflict of [{button:'LearnPulse',row:2,column:2},{button:'LearnOther',row:1,column:1}]){
  const p=new DataDocument(second),initial=p.source;
  assert.throws(()=>learnRecipe(p,p.objects(),{...request,entries:[request.entries[0],{command:2,ability:'Other',button:conflict.button,card:{page:0,slot:14,row:conflict.row,column:conflict.column}}]}),DataCardBindingError);assert.equal(p.source,initial);
 }
});
test('an explicitly removed card is reusable and competing progression/learn pools remain explicit conflicts',()=>{
 const d=new DataDocument(source.replace('<BehaviorArray Link="XP"/>','<BehaviorArray Link="XP"/><CardLayouts index="0"><LayoutButtons index="13" removed="1"/></CardLayouts>'));learnRecipe(d,d.objects(),request);assert.equal(d.objects().find(o=>o.id==='Hero')!.fields.find(f=>f.name==='CardLayouts')!.children[0].attrs.removed,undefined);
 for(const xml of [source.replace('<AbilArray Link="Pulse"/>','<AbilArray Link="Pulse"/><AbilArray Link="OtherLearn"/>').replace('</Catalog>','<CAbilLearn id="OtherLearn"/></Catalog>'),source.replace('<BehaviorArray Link="XP"/>','<BehaviorArray Link="XP"/><BehaviorArray Link="OtherXP"/>').replace('</Catalog>','<CBehaviorVeterancy id="OtherXP"/></Catalog>')]){
  const p=new DataDocument(xml),before=p.source;assert.throws(()=>learnRecipe(p,p.objects(),request),/CONFLICTING_/);assert.equal(p.source,before);
 }
});
test('compact hero learn expands a flat entry and retains stage/save guards',()=>{
 const r=compileAuthorScript('data hero.learn id=HeroLearn unit=Hero veterancy=XP ability=Pulse button=LearnPulse command=1 card.page=0 card.slot=13 card.row=1 card.column=1','save');
 assert.equal(r[0].tool,'data.hero.learn');assert.deepEqual(JSON.parse(JSON.stringify(r[0].args.entries)),[{command:1,ability:'Pulse',button:'LearnPulse',card:{page:0,slot:13,row:1,column:1}}]);assert.ok(r.some(s=>s.tool==='modkit.save'));
});
test('the strict Data transaction accepts the complete Learn graph and rejects a conflicting replacement without staging partial work',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-learn-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/Local.xml';await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
 const xml=source.replace('Face="Move"','Face="Move"').replace('</Catalog>','<CButton id="Move"/><CAbilMove id="move"/><CEffectDamage id="RankOne"/><CEffectDamage id="RankTwo"/><CEffectDamage id="RankThree"/></Catalog>');
 await fs.writeFile(path.join(root,file),xml);await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Local.xml"/></Includes>');
 const w=new Workspace(root),data=new DataWorkspace(w),preview=await data.apply({file,operations:[{op:'recipe.learn',...request}],dryRun:true});assert.equal(preview.authoring.accepted,true);assert.deepEqual(w.draftFiles(),[]);assert.equal(await fs.readFile(path.join(root,file),'utf8'),xml);
 const invalid={...request,entries:[{...request.entries[0],card:{page:0,slot:0,row:1,column:1}}]};await assert.rejects(data.apply({file,operations:[{op:'recipe.learn',...invalid}],dryRun:false}),DataCardBindingError);assert.deepEqual(w.draftFiles(),[]);assert.equal(await fs.readFile(path.join(root,file),'utf8'),xml);
});
