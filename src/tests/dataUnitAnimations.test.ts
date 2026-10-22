import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {unitAbilityAnimationRecipe} from '../modules/data/unitAnimations.js';
const xml='<Catalog><CActorUnit id="GenericUnitBase"><On Terms="UnitBirth.##unitName##" Send="Create"/></CActorUnit><CUnit id="Hero"/><CAbilEffectTarget id="Strike"/><CActorUnit id="HeroActor" parent="GenericUnitBase" unitName="Hero"><Model value="Marine"/><On Terms="WeaponStart.*.AttackStart" Send="AnimBracketStart Attack Attack"/><On Terms="UnitDeath.Hero" Send="Destroy"/><PortraitModel value="KeepPortrait"/></CActorUnit></Catalog>';
const request={id:'Strike',actor:'HeroActor',unit:'Hero',ability:'Strike',cast:'Attack',channel:'Spell',finish:'Stand Victory'};
const model={actor:'HeroActor',unit:'Hero',actorModel:'Marine',file:'marine.m3',sha256:'a'.repeat(64),animations:['Attack','Spell','Stand Victory']};
const events=(d:DataDocument)=>d.objects().find(o=>o.id==='HeroActor')!.fields.filter(f=>f.name==='On').map(f=>f.attrs);
test('main Actor animation phases use real model selectors with explicit stop/death cleanup and leave native events/portrait intact',()=>{
 const d=new DataDocument(xml),beforeActors=d.objects().filter(o=>o.ctype==='CActorUnit').length;
 const r=unitAbilityAnimationRecipe(d,d.objects(),request,model),ons=events(d);assert.equal(r.nativePlayback,'not_checked');assert.equal(r.events,9);
 for(const [phase,selector]of [['Cast','Attack'],['Channel','Spell PlayForever'],['Finish','Stand,Victory']]){
  assert.ok(ons.some(e=>e.Terms==='Abil.Strike.Source'+phase+'Start'&&e.Send==='AnimPlay MCP_Strike_'+phase.toLowerCase()+' '+selector));
  assert.equal(ons.some(e=>e.Terms==='Abil.Strike.Source'+phase+'Stop'&&e.Send==='AnimClear MCP_Strike_'+phase.toLowerCase()),phase!=='Finish');
 }
 assert.ok(ons.some(e=>e.Terms==='UnitMovementUpdate.*.Walk; AnimPlaying MCP_Strike_finish'));
 assert.ok(ons.some(e=>e.Send==='AnimBracketStart Attack Attack'));assert.ok(ons.some(e=>e.Send==='Destroy'));assert.equal(d.objects().filter(o=>o.ctype==='CActorUnit').length,beforeActors);assert.ok(d.source.includes('KeepPortrait'));
});
test('explicit replacement changes only owned animation messages and repeats without changing bytes',()=>{
 const d=new DataDocument(xml);unitAbilityAnimationRecipe(d,d.objects(),request,model);const once=d.source;
 assert.throws(()=>unitAbilityAnimationRecipe(d,d.objects(),request,model),/REPLACE_REQUIRED/);assert.equal(d.source,once);
 unitAbilityAnimationRecipe(d,d.objects(),{...request,replace:true},model);assert.equal(d.source,once);
 unitAbilityAnimationRecipe(d,d.objects(),{id:'Strike',actor:'HeroActor',unit:'Hero',ability:'Strike',cast:'Spell',replace:true},model);const ons=events(d);assert.ok(!ons.some(e=>e.Send?.includes('MCP_Strike_channel')));assert.ok(ons.some(e=>e.Send==='AnimBracketStart Attack Attack'));
});
test('unknown model sequence, wrong model, missing evidence/phase and wrong main Actor reject before mutation',()=>{
 for(const [args,evidence]of [[{...request,cast:'DoesNotExist'},model],[request,{...model,actorModel:'Other'}],[request,{...model,sha256:''}],[{id:'Strike',actor:'HeroActor',unit:'Hero',ability:'Strike'},model],[{...request,unit:'Another'},model],[{...request,cast:'Attack; Destroy'},model]] as const){const d=new DataDocument(xml),before=d.source;assert.throws(()=>unitAbilityAnimationRecipe(d,d.objects(),args,evidence),/UNIT_ANIMATION_/);assert.equal(d.source,before);}
});
test('existing foreign ability animation, a competing primary Actor and unresolved/cyclic parent are not silently overwritten',()=>{
 const variants=[xml.replace('<PortraitModel','<On Terms="Abil.Strike.SourceCastStart; ValidateUnit Special" Send="AnimPlay Existing Spell"/><PortraitModel'),xml.replace('</Catalog>','<CActorUnit id="Duplicate" unitName="Hero"/></Catalog>'),xml.replace('</Catalog>','<CActorUnit id="HeroActor" unitName="Hero"/></Catalog>'),xml.replace('parent="GenericUnitBase"','parent="Missing"'),xml.replace('<CActorUnit id="GenericUnitBase">','<CActorUnit id="GenericUnitBase" parent="HeroActor">')];
 for(const source of variants){const d=new DataDocument(source),before=d.source;assert.throws(()=>unitAbilityAnimationRecipe(d,d.objects(),{...request,replace:true},model),/UNIT_ANIMATION_/);assert.equal(d.source,before);}
});
test('binding ownership is exact and stable independently of ability IDs',()=>{
 const d=new DataDocument(xml.replace('</Catalog>','<CAbilEffectTarget id="Other"/></Catalog>'));
 unitAbilityAnimationRecipe(d,d.objects(),request,model);
 unitAbilityAnimationRecipe(d,d.objects(),{...request,id:'Strike_Extra',ability:'Other'},model);
 unitAbilityAnimationRecipe(d,d.objects(),{...request,cast:'Spell',replace:true},model);
 assert.ok(events(d).some(e=>e.Terms==='Abil.Other.SourceCastStart'&&e.Send==='AnimPlay MCP_Strike_Extra_cast Attack'));
 const before=d.source;assert.throws(()=>unitAbilityAnimationRecipe(d,d.objects(),{...request,id:'OtherBinding'},model),/EXISTING_BINDING_UNVERIFIED/);assert.equal(d.source,before);
});
test('long cast looping and phase-bounded finish are explicit and retain their stop handlers',()=>{
 const d=new DataDocument(xml);unitAbilityAnimationRecipe(d,d.objects(),{...request,loopCast:true,clearFinishOnStop:true},model);const ons=events(d);
 assert.ok(ons.some(e=>e.Terms==='Abil.Strike.SourceCastStart'&&e.Send==='AnimPlay MCP_Strike_cast Attack PlayForever'));
 assert.ok(ons.some(e=>e.Terms==='Abil.Strike.SourceCastStop'&&e.Send==='AnimClear MCP_Strike_cast'));
 assert.ok(ons.some(e=>e.Terms==='Abil.Strike.SourceFinishStop'&&e.Send==='AnimClear MCP_Strike_finish'));
});
