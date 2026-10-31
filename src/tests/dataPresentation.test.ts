import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';
import {checkEffectPresentation,inspectEffectPresentation,presentationSchema} from '../modules/data/presentation.js';
import type {DataWorkspace} from '../modules/data/workspace.js';
const declarations=(xml:string)=>new DataDocument(xml).objects().map(o=>({...o,file:'GameData/Presentation.xml'}));

test('inactive dependency catalogs do not create a false Model ambiguity in a workspace audit',async()=>{
 const live=new DataDocument('<Catalog><CEffectDamage id="Hit"/><CModel id="Impact"/><CActorAction id="Action" parent="GenericAttack" effectAttack="Hit"><ImpactMap index="None" Model="Impact"/></CActorAction></Catalog>');
 const records=Object.assign([{file:'Live.xml',layer:'workspace',engineActive:true,document:live},{file:'Unused.xml',layer:'dependency',engineActive:false,document:new DataDocument('<Catalog><CModel id="Impact"/></Catalog>')}],{issues:[]});
 const workspace={workspace:{withReadSet:async(fn:()=>Promise<unknown>)=>fn()},catalog:async()=>records} as unknown as DataWorkspace;
 const report=await checkEffectPresentation(workspace,{effects:['Hit']});assert.equal(report.effects[0].bindings[0].declaredVisualLinks[0].state,'found');
});
test('effect presentation audit distinguishes sound, unrelated prefixes and declared model bindings',()=>{
 const objects=declarations('<Catalog><CEffectDamage id="Wave"/><CModel id="Ring"><Model value="Ring.m3"/></CModel><CActorSound id="Sound"><On Terms="Effect.Wave.Start" Send="Create"/></CActorSound><CActorModel id="Other"><Model value="Ring"/><On Terms="Effect.WaveExtra.Start" Send="Create"/></CActorModel></Catalog>');
 const noVisual=inspectEffectPresentation(objects,{effects:['Wave']});assert.equal(noVisual.effects[0].presentation,'no_declared_visual_binding');assert.equal(noVisual.effects[0].bindings.length,1);
 const visual=declarations('<Catalog><CActorModel id="RingActor"><Model value="Ring"/><On Terms="Effect.Wave.Start; At Source" Send="Create"/><On Terms="Effect.Wave.Stop" Send="AnimBracketStop BSD"/><Host Subject="_Selectable"/><HostSiteOps Ops="SOpShadow"/></CActorModel></Catalog>');
 const linked=inspectEffectPresentation([...objects,...visual],{effects:['Wave']});assert.equal(linked.effects[0].presentation,'declared_links_found');assert.equal(linked.nativePlayback,'not_checked');
 const a=linked.effects[0].bindings.find(a=>a.actor==='RingActor')!;assert.equal(a.events.length,2);assert.equal(a.siteOps,'SOpShadow');assert.equal(a.assetResolution,'not_checked');
});
test('missing models and inherited-only bindings are review findings, with explicit invisible exceptions',()=>{
 const objects=declarations('<Catalog><CEffectDamage id="Pulse"/><CActorModel id="A" parent="Template"><Model value="Missing"/><On Terms="Effect.Pulse.Stop" Send="Create"/></CActorModel></Catalog>');
 const r=inspectEffectPresentation(objects,{effects:['Pulse']});assert.equal(r.effects[0].presentation,'needs_resolution');assert.equal(r.effects[0].bindings[0].modelDeclaration,'unresolved');
 const hidden=inspectEffectPresentation(objects,{effects:['Pulse'],invisible:[{effect:'Pulse',reason:'Internal targeting helper'}]});assert.equal(hidden.effects[0].presentation,'intentionally_invisible');assert.equal(hidden.effects[0].bindings.length,1);
 assert.throws(()=>presentationSchema.parse({effects:['Pulse'],invisible:[{effect:'Other',reason:'helper'}]}));
});

test('point-only effects with target actor scope remain review findings, without rejecting unit targets or unscoped ground visuals',()=>{
 const objects=declarations('<Catalog><CEffectEnumArea id="Cell"><ImpactLocation Value="TargetPoint"/></CEffectEnumArea><CEffectDamage id="UnitHit"/><CModel id="Triangle"/><CActorModel id="Filtered"><Model value="Triangle"/><On Terms="Effect.Cell.Start; At Target" Send="Create"/></CActorModel><CActorModel id="Ground"><Model value="Triangle"/><On Terms="Effect.Cell.Start" Send="Create"/><HostSiteOps Ops="SOpShadow"/></CActorModel><CActorModel id="Hit"><Model value="Triangle"/><On Terms="Effect.UnitHit.Start; At Target" Send="Create"/></CActorModel></Catalog>');
 const result=inspectEffectPresentation(objects,{effects:['Cell','UnitHit']});
 assert.match(result.effects[0].bindings.find(b=>b.actor==='Filtered')!.eventScopeReview[0],/POINT_EFFECT_TARGET_ACTOR_SCOPE/);
 assert.deepEqual(result.effects[0].bindings.find(b=>b.actor==='Ground')!.eventScopeReview,[]);
 assert.deepEqual(result.effects[1].bindings[0].eventScopeReview,[]);
 assert.equal(result.effects[0].presentation,'declared_links_found');
 assert.equal(result.nativePlayback,'not_checked');
});
