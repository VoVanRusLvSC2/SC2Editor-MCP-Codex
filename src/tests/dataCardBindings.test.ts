import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DataDocument} from '../modules/data/document.js';
import {reviewCardBinding,unitCardState} from '../modules/data/cardBindings.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {Workspace} from '../core/workspace.js';
import {registerDataTools} from '../modules/data/tools.js';
const objects=(xml:string)=>new DataDocument('<Catalog>'+xml+'</Catalog>').objects();
const root='<CUnit id="Base"><CardLayouts><LayoutButtons Face="Move" Type="AbilCmd" AbilCmd="move,Move" Row="0" Column="0"/><LayoutButtons Face="Shared" Type="AbilCmd" AbilCmd="Old,Execute" Row="2" Column="0"/></CardLayouts></CUnit>';
const child='<CUnit id="Hero" parent="Base"><CardLayouts index="0"><LayoutButtons index="8" Face="Other" Type="AbilCmd" AbilCmd="Other,Execute" Row="2" Column="1"/></CardLayouts></CUnit>';
const proposal={ability:'New',button:'NewButton',page:0,slot:9,row:2,column:2};
test('card review resolves implicit fresh root ordinals and indexed inherited overlays',()=>{
 const r=unitCardState(objects(root+child),'Hero');assert.equal(r.layoutResolved,true);assert.deepEqual(r.lineage,['Hero','Base']);assert.deepEqual(r.bindings.map(b=>[b.page,b.slot,b.attrs.Face,b.declaredBy]),[[0,0,'Move','Base'],[0,1,'Shared','Base'],[0,8,'Other','Hero']]);
 assert.equal(reviewCardBinding(objects(root+child),'Hero',proposal).accepted,true);
});
test('inherited occupied slots, coordinates and shared faces reject before binding',()=>{
 for(const [change,code] of [[{slot:1},'CARD_SLOT_OCCUPIED'],[{column:0},'CARD_COORDINATE_OCCUPIED'],[{button:'Shared'},'CARD_SHARED_BUTTON_FACE']] as const){const r=reviewCardBinding(objects(root+child),'Hero',{...proposal,...change});assert.equal(r.accepted,false);assert.ok(r.conflicts.some(c=>c.code===code));}
});
test('intentional conditional reuse requires a reason and cannot waive occupied slots or unknown layout',()=>{
 const all=objects(root+child),conditional={...proposal,button:'Shared',column:0,conflictReason:'Mutually exclusive requirements'};
 const r=reviewCardBinding(all,'Hero',conditional);assert.equal(r.accepted,true);assert.equal(r.conflicts.length,2);assert.equal(r.exception?.reason,conditional.conflictReason);assert.equal(r.nativePresentation,'not_checked');
 assert.equal(reviewCardBinding(all,'Hero',{...conditional,slot:1}).accepted,false);
 assert.equal(reviewCardBinding(all,'Hero',{...conditional,conflictReason:'  '}).accepted,false);
 assert.equal(reviewCardBinding(objects(child),'Hero',conditional).accepted,false);
});
test('same faces on other pages and unrelated existing conditional overlaps do not block a new binding',()=>{
 const extra='<CUnit id="Grandchild" parent="Hero"><CardLayouts index="1"><LayoutButtons index="9" Face="NewButton" Type="AbilCmd" AbilCmd="PageTwo,Execute" Row="2" Column="2"/></CardLayouts><CardLayouts index="0"><LayoutButtons index="7" Face="Shared" Type="AbilCmd" AbilCmd="Conditional,Execute" Row="2" Column="0"/></CardLayouts></CUnit>';
 const all=objects(root+child+extra);assert.equal(reviewCardBinding(all,'Grandchild',proposal).accepted,true);
 assert.equal(reviewCardBinding(all,'Grandchild').accepted,false);
});
test('removed inherited entries and partial indexed overrides retain native attributes',()=>{
 const xml=root+'<CUnit id="Hero" parent="Base"><CardLayouts index="0"><LayoutButtons index="0" removed="1"/><LayoutButtons index="1" Column="3"/></CardLayouts></CUnit>';
 const r=unitCardState(objects(xml),'Hero');assert.equal(r.layoutResolved,true);assert.equal(r.bindings.length,1);assert.equal(r.bindings[0].attrs.Face,'Shared');assert.equal(r.bindings[0].attrs.Column,'3');
 const page=unitCardState(objects(root+'<CUnit id="Hero" parent="Base"><CardLayouts index="0" removed="1"/></CUnit>'),'Hero');assert.equal(page.layoutResolved,true);assert.equal(page.bindings.length,0);
});
test('ambiguous, mixed, tokenized, derived implicit and cyclic arrays retain unverified state',()=>{
 for(const xml of [child,root+root+child,root+'<CUnit id="Hero" parent="Base"><CardLayouts><LayoutButtons/></CardLayouts></CUnit>',root+'<CUnit id="Hero" parent="Base"><CardLayouts index="0"><LayoutButtons index="8"/><LayoutButtons/></CardLayouts></CUnit>',root+'<CUnit id="Hero" parent="Base"><CardLayouts index="##page##"/></CUnit>','<CUnit id="Hero" parent="Loop"/><CUnit id="Loop" parent="Hero"/>','<CUnit default="1"><CardLayouts/></CUnit>'+root+child]){
  const all=objects(xml),r=reviewCardBinding(all,'Hero',proposal);assert.equal(r.accepted,false);assert.equal(r.layoutResolved,false);assert.ok(r.unresolved.length>0);
 }
});
test('tokenized implicit presentation is a warning, not native presentation certification',()=>{
 const r=reviewCardBinding(objects('<CUnit id="Hero"><CardLayouts><LayoutButtons Face="##face##" Type="Passive"/></CardLayouts></CUnit>'),'Hero',proposal);assert.equal(r.accepted,true);assert.equal(r.warnings.length,1);assert.equal(r.nativePresentation,'not_checked');
});
test('zero inherited speed warns about movement availability without rejecting intentional stationary units',()=>{
 const still=objects(root.replace('<CardLayouts>','<Speed value="0"/><CardLayouts>')+child),review=reviewCardBinding(still,'Hero',proposal);assert.equal(review.accepted,true);assert.deepEqual(review.declaredSpeed,{value:0,declaredBy:'Base'});assert.ok(review.warnings.some(w=>w.code==='CARD_MOVE_AT_ZERO_SPEED'));
 const moving=objects(root.replace('<CardLayouts>','<Speed value="0"/><CardLayouts>')+child.replace('<CardLayouts index="0">','<Speed value="2.25"/><CardLayouts index="0">'));assert.equal(reviewCardBinding(moving,'Hero',proposal).warnings.length,0);
});
test('MCP guard rejects an inherited face before staging and read-only review remains inspectable',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-card-guard-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file='Base.SC2Data/GameData/Test.xml',xml='<Catalog>'+root+child+'<CAbilEffectTarget id="Template"/><CEffectDamage id="Damage"/><CButton id="Shared"/><CButton id="NewButton"/></Catalog>';
 await fs.mkdir(path.dirname(path.join(dir,file)),{recursive:true});await fs.writeFile(path.join(dir,file),xml);await fs.writeFile(path.join(dir,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Test.xml"/></Includes>');
 const data=new DataWorkspace(new Workspace(dir)),handlers=new Map<string,(args:any)=>Promise<any>>();registerDataTools({registerTool:(name:string,_config:unknown,handler:any)=>handlers.set(name,handler)} as any,{workspace:data});
 const args={file,id:'New',sourceAbility:'Template',effect:'Damage',button:'Shared',unit:'Hero',card:{page:0,slot:9,row:2,column:2},dryRun:false,stage:true};
 const fail=await handlers.get('data.ability.target')!(args),body=JSON.parse(fail.content[0].text);assert.equal(fail.isError,true);assert.equal(body.error.code,'DATA_CARD_BINDING_REJECTED');assert.equal(body.cardReview.conflicts[0].code,'CARD_SHARED_BUTTON_FACE');assert.deepEqual(data.workspace.draftFiles(),[]);assert.equal(await fs.readFile(path.join(dir,file),'utf8'),xml);
 const ok=await handlers.get('data.ability.target')!({...args,button:'NewButton',dryRun:true}),result=JSON.parse(ok.content[0].text);assert.equal(result.authoring.accepted,true);assert.equal(result.cardReviewCount,1);assert.equal(result.cardReviews[0].review.accepted,true);assert.equal(await fs.readFile(path.join(dir,file),'utf8'),xml);
 const check=JSON.parse((await handlers.get('data.card.check')!({unit:'Hero',offset:1,limit:1})).content[0].text);assert.equal(check.bindingAccepted,true);assert.equal(Object.hasOwn(check,'accepted'),false);assert.equal(check.bindings.length,1);assert.equal(check.nextOffset,2);
});
