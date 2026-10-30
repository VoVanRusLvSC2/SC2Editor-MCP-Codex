import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {unitActorRecipe,effectModelRecipe,visualRecipePreloads} from '../modules/data/actorRecipes.js';
import {concreteActorCreateConflict} from '../modules/data/actorConstruction.js';
import {validateDataDocuments} from '../modules/data/validator.js';

test('normal Data validation reports the observed duplicate-primary-actor construction',()=>{
 const d=new DataDocument(native.source.replace('</Catalog>','<CActorUnit id="Hero" parent="Marine" unitName="Hero"><On Terms="UnitBirth.Hero" Send="Create"/></CActorUnit></Catalog>'));
 const result=validateDataDocuments('ActorData.xml',[{file:'ActorData.xml',layer:'workspace',document:d}]);
 assert.equal(result.valid,false);assert.ok(result.diagnostics.some(d=>d.code==='DATA_ACTOR_CONCRETE_PARENT_CREATE'&&d.severity==='error'));
});

const native=new DataDocument('<Catalog><CActorUnit default="1" id="GenericUnitBase"><On Terms="UnitBirth.##unitName##" Send="Create"/></CActorUnit><CActorUnit id="Marine" parent="GenericUnitBase" unitName="Marine"><PortraitModel value="MarinePortrait"/><On Terms="UnitDeath.Marine; AnimPlaying Cover" Target="_DeathModel" Send="AnimClear Cover"/><Macros value="UnloadDropAnim"/></CActorUnit></Catalog>');
test('review duplicated actor movement timing and unindexed inherited event collisions',()=>{
 const dependency=new DataDocument('<Catalog><CActorUnit id="GenericUnitBase"><On Terms="UnitBirth.*" Send="Create"/></CActorUnit><CActorUnit id="Odin" parent="GenericUnitBase"><WalkAnimMoveSpeed value="1.75"/></CActorUnit></Catalog>');
 const map=new DataDocument('<Catalog><CActorUnit id="Hero" parent="GenericUnitBase"><Model value="Odin"/><On Terms="WeaponStart.Odin.AttackStart" Send="AnimBracketStart Attack Attack"/></CActorUnit></Catalog>');
 const validate=()=>validateDataDocuments('map.xml',[{file:'base.xml',layer:'dependency',document:dependency},{file:'map.xml',layer:'workspace',document:map}]);
 assert.ok(validate().diagnostics.some(d=>d.code==='DATA_ACTOR_WALK_SPEED_REVIEW'));
 assert.ok(validate().diagnostics.some(d=>d.code==='DATA_ACTOR_EVENT_MERGE_REVIEW'));
 const sparse=new DataDocument('<Catalog><CActorUnit id="Hero" parent="GenericUnitBase"><Model value="Odin"/><On index="128" Terms="WeaponStart.Odin.AttackStart" Send="AnimBracketStart Attack Attack"/></CActorUnit></Catalog>');
 assert.ok(validateDataDocuments('map.xml',[{file:'base.xml',layer:'dependency',document:dependency},{file:'map.xml',layer:'workspace',document:sparse}]).diagnostics.some(d=>d.code==='DATA_ACTOR_EVENT_SPARSE_REVIEW'));
 const fixed=new DataDocument('<Catalog><CActorUnit id="Hero" parent="GenericUnitBase"><Model value="Odin"/><WalkAnimMoveSpeed value="1.75"/><On index="1" Terms="WeaponStart.Odin.AttackStart" Send="AnimBracketStart Attack Attack"/></CActorUnit></Catalog>');
 const findings=validateDataDocuments('map.xml',[{file:'base.xml',layer:'dependency',document:dependency},{file:'map.xml',layer:'workspace',document:fixed}]).diagnostics;
 assert.ok(!findings.some(d=>['DATA_ACTOR_WALK_SPEED_REVIEW','DATA_ACTOR_EVENT_MERGE_REVIEW'].includes(d.code)));
});
test('concrete actor duplication is blocked; rebuilding preserves presentation and one inherited primary Create',()=>{
 const d=new DataDocument('<Catalog><CActorUnit id="HeroActor" parent="Marine" unitName="Hero"><On Terms="UnitBirth.Hero" Send="Create"/><On Terms="UnitDeath.Hero" Send="Destroy"/></CActorUnit></Catalog>');
 const source=native.objects().find(o=>o.id==='Marine')!;
 assert.ok(concreteActorCreateConflict(d.objects()[0],[source]));
 assert.throws(()=>unitActorRecipe(d,source,{id:'HeroActor',unit:'Hero',model:'Marine'}),/REPLACE_REQUIRED/);
 unitActorRecipe(d,source,{id:'HeroActor',unit:'Hero',model:'Marine',replace:true});
 const hero=d.objects()[0];assert.equal(hero.parent,'GenericUnitBase');assert.equal(hero.attrs.unitName,'Hero');
 assert.equal(concreteActorCreateConflict(hero,[native.objects()[0]]),false);
 const events=[...native.objects()[0].fields,...hero.fields].filter(f=>f.name==='On').map(f=>({terms:f.attrs.Terms.replaceAll('##unitName##','Hero'),send:f.attrs.Send}));
 assert.equal(events.filter(e=>e.terms==='UnitBirth.Hero'&&e.send==='Create').length,1);
 assert.ok(events.some(e=>e.terms==='UnitDeath.Hero; AnimPlaying Cover'));
 assert.ok(hero.fields.some(f=>f.name==='Macros'&&f.value==='UnloadDropAnim'));
 assert.ok(['Model','BuildModel','PlacementModel'].every(n=>hero.fields.some(f=>f.name===n&&f.value==='Marine')));
 const once=d.source;unitActorRecipe(d,source,{id:'HeroActor',unit:'Hero',model:'Marine',replace:true});assert.equal(d.source,once);
});
test('effect model uses native bracket lifecycle and a landing effect instead of an unrelated timer',()=>{
 const d=DataDocument.create();effectModelRecipe(d,{id:'Drop',effect:'Descent',stopEffect:'Unload',model:'DropPodFalling',siteOp:'MercDropSOpShadow'});
 const o=d.objects()[0];assert.equal(o.parent,'ModelAnimationStyleOneShotNoOrphan');
 assert.ok(o.fields.some(f=>f.name==='On'&&f.attrs.Terms==='Effect.Descent.Start'&&f.attrs.Send==='Create'));
 assert.ok(o.fields.some(f=>f.name==='On'&&f.attrs.Terms==='Effect.Unload.Start'&&f.attrs.Send==='AnimBracketStop BSD'));
 assert.ok(!d.source.includes('TimerSet'));assert.ok(!d.source.includes('UnitBirth'));
 assert.throws(()=>effectModelRecipe(d,{id:'Drop',effect:'X',model:'X'}),/REPLACE_REQUIRED/);
});

test('Blink source Start/Stop hosts and EMP stop/ground bindings match the native presentation patterns',()=>{
 const d=DataDocument.create();
 effectModelRecipe(d,{id:'Out',effect:'CustomBlink',model:'BlinkOriginModel',at:'Source',host:'_Selectable',inheritScale:true,orphanPolicy:'stop',siteOp:'SOpAttachOriginStationary'});
 effectModelRecipe(d,{id:'In',effect:'CustomBlink',model:'BlinkStopModel',event:'Stop',at:'Source',host:'_Selectable',inheritScale:true,orphanPolicy:'stop',siteOp:'SOpAttachOrigin'});
 effectModelRecipe(d,{id:'Pulse',effect:'PulseSearch',model:'GhostEMPAttackImpactEffect',stopEffect:'PulseSearch',stopEvent:'Stop',orphanPolicy:'stop',siteOp:'SOpShadow'});
 const [out,arrival,pulse]=d.objects();
 assert.equal(out.parent,'ModelAnimationStyleOneShot');assert.ok(out.fields.some(f=>f.name==='Host'&&f.attrs.Subject==='_Selectable'));
 assert.ok(out.fields.some(f=>f.name==='On'&&f.attrs.Terms==='Effect.CustomBlink.Start; At Source'));
 assert.ok(arrival.fields.some(f=>f.name==='On'&&f.attrs.Terms==='Effect.CustomBlink.Stop; At Source'));
 assert.ok(pulse.fields.some(f=>f.name==='On'&&f.attrs.Terms==='Effect.PulseSearch.Stop'&&f.attrs.Send==='AnimBracketStop BSD'));
 assert.ok(!pulse.fields.some(f=>(f.attrs.Terms??'').includes('At Caster')));
});

test('visual preloads include model/effect and related sound, preserve authored entries, and do not duplicate on rerun',()=>{
 const d=new DataDocument('<Catalog><CActorSound id="BlinkSound"><Sound value="Stalker_Blink"/><On Terms="Effect.MyBlink.Stop; At Source" Send="Create"/></CActorSound></Catalog>');
 const recipes=[{id:'BlinkIn',effect:'MyBlink',model:'BlinkStopModel'}];
 const result=visualRecipePreloads('<Preload><Movie id="Keep"/></Preload>',d,recipes);
 for(const fragment of ['<Movie id="Keep"/>','<Actor id="BlinkIn"/>','<Model id="BlinkStopModel"/>','<Effect id="MyBlink"/>','<Actor id="BlinkSound"/>','<Sound id="Stalker_Blink"/>'])assert.ok(result.includes(fragment));
 assert.equal(visualRecipePreloads(result,d,recipes),result);
 assert.throws(()=>visualRecipePreloads('<Broken/>',d,recipes),/PRELOAD_XML_INVALID/);
});
