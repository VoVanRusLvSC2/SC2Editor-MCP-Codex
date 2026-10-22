import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {veterancyRecipe,type VeterancyRecipe} from '../modules/data/veterancyRecipe.js';
const source='<Catalog><CUnit id="Marine"/><CUnit id="Hero" parent="Marine"><LifeMax value="1000"/></CUnit><CEffectModifyUnit id="LevelUp"/></Catalog>';
const args:VeterancyRecipe={id:'Progression',unit:'Hero',levelEffect:'LevelUp',levels:[{xp:0},{xp:50,lifeDelta:100,damageDelta:5},{xp:150,lifeDelta:100,damageDelta:5}]};
test('veterancy recipe binds native solo kill-XP levels and cumulative deltas without duplicating a repeated owned behavior',()=>{
 const d=new DataDocument(source);veterancyRecipe(d,d.objects(),args);
 const b=d.objects().find(o=>o.id==='Progression')!,u=d.objects().find(o=>o.id==='Hero')!;
 assert.equal(b.ctype,'CBehaviorVeterancy');assert.equal(u.fields.find(f=>f.name==='LifeMax')?.value,'1000');
 assert.equal(u.fields.filter(f=>f.name==='BehaviorArray'&&f.link==='Progression').length,1);
 assert.equal(b.fields.find(f=>f.name==='SharedXPFraction')?.value,'0');
 assert.deepEqual(b.fields.filter(f=>f.name==='VeterancyLevelArray').map(f=>[f.index,f.attrs.MinVeterancyXP]),[['0','0'],['1','50'],['2','100']]);
 const once=d.source;veterancyRecipe(d,d.objects(),{...args,replace:true});assert.equal(d.source,once);
 assert.throws(()=>veterancyRecipe(d,d.objects(),args),/REPLACE_REQUIRED/);
});
test('invalid thresholds/stat totals, incompatible records and conflicting or unresolved parent veterancy reject before writes',()=>{
 const invalid:VeterancyRecipe[]=[{...args,levels:[]},{...args,levels:[{xp:1}]},{...args,levels:[{xp:0},{xp:0}]},{...args,levels:[{xp:0},{xp:Infinity}]},{...args,levels:[{xp:0,lifeDelta:-1}]},{...args,levels:[{xp:0,damageDelta:300000},{xp:1,damageDelta:300000}]},{...args,xpFraction:11},{...args,levelEffect:'Missing'}];
 for(const request of invalid){const d=new DataDocument(source),before=d.source;assert.throws(()=>veterancyRecipe(d,d.objects(),request),/VETERANCY_RECIPE_/);assert.equal(d.source,before);}
 for(const xml of [source.replace('<CUnit id="Marine"/>',''),source.replace('<CUnit id="Marine"/>','<CUnit id="Marine"/><CUnit id="Marine"/>'),source.replace('<CUnit id="Marine"/>','<CBehaviorVeterancy id="Other"/><CUnit id="Marine"><BehaviorArray Link="Other"/></CUnit>'),source.replace('<CUnit id="Marine"/>','<CUnit id="Marine" parent="Hero"/>'),source.replace('</Catalog>','<CBehaviorBuff id="Progression"/></Catalog>')]){
  const d=new DataDocument(xml),before=d.source;assert.throws(()=>veterancyRecipe(d,d.objects(),{...args,replace:true}),/VETERANCY_RECIPE_/);assert.equal(d.source,before);
 }
});
