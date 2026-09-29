import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataDocument } from '../modules/data/document.js';
import { DataWorkspace } from '../modules/data/workspace.js';
import { TriggerWorkspace } from '../modules/trigger/workspace.js';
import { Workspace } from '../core/workspace.js';
import { scanXml } from '../core/xmlScanner.js';

const catalog = '<Catalog><CEffectDamage id="AuditDamage"/><CEffectSet id="AuditSet"><EffectArray value="AuditDamage"/><Note value="AuditDamage"/></CEffectSet></Catalog>';
test('M01 typed value reference rename preserves unrelated text', () => {
  const doc = new DataDocument(catalog);
  assert.ok(doc.references().some(r => r.value === 'AuditDamage'));
  doc.renameObject('AuditDamage', 'Renamed');
  assert.equal(doc.patchReferences('AuditDamage', 'Renamed', 'Effect'), 1);
  assert.match(doc.source, /EffectArray value="Renamed"/);
  assert.match(doc.source, /Note value="AuditDamage"/);
});
test('M02 deleting a value-referenced Effect fails before staging', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hardening-data-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = 'Base.SC2Data/GameData/EffectData.xml';
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), catalog);
  const ws = new Workspace(root);
  await assert.rejects(new DataWorkspace(ws).apply({file, operations:[{op:'object.delete',object:'AuditDamage'}]}), /incoming reference/);
  assert.equal((await ws.readRaw(file)).text, catalog);
});
test('M10 M11 graft without Identifier accepts reordered single quoted attributes and appends actions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hardening-trigger-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = "<TriggerData><Library Id='Local'><Element Id='AAAA0001' Type='Trigger'><Action Id='AAAA0002' Type='FunctionCall'/></Element><Element Id='AAAA0002' Type='FunctionCall'><ScriptCode>Old();</ScriptCode></Element></Library></TriggerData>";
  const source = "<TriggerData><Library Id='Source'><Element Id='BBBB0001' Type='Trigger'><Action Id='BBBB0002' Type='FunctionCall'/></Element><Element Id='BBBB0002' Type='FunctionCall'><ScriptCode>New();</ScriptCode></Element></Library></TriggerData>";
  await fs.writeFile(path.join(root,'Triggers'),target);
  await fs.writeFile(path.join(root,'source.xml'),source);
  const ws = new Workspace(root), trigger = new TriggerWorkspace(ws);
  assert.equal((await trigger.inspect()).count,1);
  await trigger.graft({sourceFile:'source.xml',sourceTrigger:'BBBB0001',targetTrigger:'AAAA0001',kind:'Action',index:0,dryRun:false});
  const staged = (await ws.readRaw('Triggers')).text;
  assert.equal(scanXml(staged).diagnostics.length,0);
  const refs = (await trigger.get('AAAA0001')).references;
  assert.deepEqual(refs.map(r=>r.id),['AAAA0002','BBBB0002']);
  assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),target);
});
test('M18 typed GUI plan creates category, native event, literal action and preset Wait; dryRun/stale guards',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-author-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const original='<TriggerData><Library Id="Local"><Root/></Library></TriggerData>';await fs.writeFile(path.join(root,'Triggers'),original);
 const ws=new Workspace(root),triggers=new TriggerWorkspace(ws);
 const plan=await triggers.plan({create:{library:'Local',identifier:'Start',category:'Tests'},calls:[{kind:'Event',function:'TriggerAddEventMapInit',args:{}},{kind:'Action',function:'DialogDestroyAll',args:{}},{kind:'Action',function:'Wait',args:{'00000419':{kind:'literal',type:'fixed',value:'0.5'},'00000420':{kind:'preset',id:'00000013'}}}]});
 await triggers.applyPlan(plan.planId);assert.equal((await ws.readRaw('Triggers')).text,original);
 await triggers.applyPlan(plan.planId,false);assert.equal((await triggers.validate()).valid,true);
 assert.equal((await triggers.get('Start')).references.length,3);assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),original);
 await triggers.save(false);const saved=await fs.readFile(path.join(root,'Triggers'),'utf8');assert.match(saved,/<ParameterDef Type="ParamDef" Library="Ntve" Id="00000419"/);assert.match(saved,/<Value>0.5<\/Value>/);
 await assert.rejects(triggers.applyPlan(plan.planId,false),/changed|STALE/);
});
test('M19 unsupported GUI expression fails before staging',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-unsupported-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Root/></Library></TriggerData>');
 const ws=new Workspace(root),triggers=new TriggerWorkspace(ws);
 await assert.rejects(triggers.plan({create:{library:'Local',identifier:'Bad'},calls:[{kind:'Action',function:'Wait',args:{'00000419':{kind:'customScript',source:'Unknown()'},'00000420':{kind:'preset',id:'00000013'}}}]}),/UNSUPPORTED/);
 assert.equal(ws.draftFiles().length,0);
});

import {DataXsdRegistry} from '../modules/data/xsdRegistry.js';
import {galaxyReferences} from '../modules/data/crossReferences.js';
test('M03 M05 inline EffectArray schema keeps members local and catalog identities distinct',()=>{
 const schema=new DataXsdRegistry(),type=schema.describe('CEffectSet')!;
 assert.equal(type.fields.some(f=>f.name==='index'||f.name==='removed'),false);
 const array=type.fields.find(f=>f.name==='EffectArray')!;
 assert.equal(array.inlineType?.base,'CEffectLink');
 assert.equal(schema.linkDomain(array.inlineType),'Effect');
 assert.ok(schema.members(array.inlineType!).some(f=>f.name==='value'));
 const doc=new DataDocument('<Catalog><CUnit id="Same"/><CActor id="Same"/><CEffectSet id="Effects"><EffectArray value="Same"/></CEffectSet><CAbilTrain id="Train"><InfoArray index="0"><Unit value="Same"/></InfoArray></CAbilTrain></Catalog>');
 doc.renameObject({id:'Same',domain:'Unit'},'UnitOnly');doc.patchReferences('Same','UnitOnly','Unit');
 assert.match(doc.source,/<CActor id="Same"/);assert.match(doc.source,/<EffectArray value="Same"/);assert.match(doc.source,/<Unit value="UnitOnly"/);
});
test('M06 M07 M08 class defaults, tokens, repeated arrays and removed values retain evidence',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-effective-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file='Base.SC2Data/GameData/EffectData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});
 const xml='<Catalog><CEffectSet default="1"><Chance value="0"/></CEffectSet><CEffectSet id="Base"><EffectArray value="A"/><EffectArray value="B"/></CEffectSet><CEffectSet id="Child" parent="Base"><?token id="chance" value="0.5"?><Chance value="##chance##"/><EffectArray index="0" removed="1"/></CEffectSet></Catalog>';await fs.writeFile(path.join(root,file),xml);
 const result=await new DataWorkspace(new Workspace(root)).resolveFields({id:'Child',domain:'Effect'});const fields=result.objects[0].effective!.fields;
 assert.equal(fields.Chance.value,'0.5');assert.equal(fields.Chance.status,'resolved');assert.equal(fields['EffectArray[#0]'].rawValue,'A');assert.equal(fields['EffectArray[#1]'].rawValue,'B');assert.equal(fields['EffectArray[#0]'].value,undefined);assert.equal(fields['EffectArray[#0]'].status,'unknown');assert.equal(fields['EffectArray[0]'].status,'removed');assert.equal(await fs.readFile(path.join(root,file),'utf8'),xml);
});
test('M20 M22 Galaxy catalog expressions resolve constants/concatenation and retain dynamic coverage',()=>{
 const r=galaxyReferences('a.galaxy','const string PREFIX = "Audit"; void Run(){UnitCreate(1,PREFIX + "Spawn",0,1,null,0);UnitCreate(1,name,0,1,null,0);}');
 assert.equal(r.references[0].value,'AuditSpawn');assert.equal(r.references[0].targetDomain,'Unit');assert.equal(r.references[0].rewrite,'readOnly');assert.equal(r.issues[0].targetDomain,'Unit');
});
test('M25 Data rename updates Galaxy literal atomically and shared script reads see draft',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-cross-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/UnitData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="AuditSpawn"/></Catalog>');const script='void Run(){UnitCreate(1,"AuditSpawn",0,1,null,0);}';await fs.writeFile(path.join(root,'a.galaxy'),script);
 const ws=new Workspace(root),data=new DataWorkspace(ws);
 await data.apply({file,operations:[{op:'object.rename',object:'AuditSpawn',newId:'Renamed',updateReferences:true}],dryRun:false});
 assert.match((await ws.readRaw('a.galaxy')).text,/"Renamed"/);assert.equal(await fs.readFile(path.join(root,'a.galaxy'),'utf8'),script);
 await ws.save(file,{backup:false});assert.match(await fs.readFile(path.join(root,'a.galaxy'),'utf8'),/"Renamed"/);
});
test('M14 graft rejects a missing implicit local dependency before staging',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-dangling-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Element Type="Trigger" Id="A"/></Library></TriggerData>');await fs.writeFile(path.join(root,'source.xml'),'<TriggerData><Library Id="Src"><Element Type="Trigger" Id="B"><Action Type="FunctionCall" Id="C"/></Element><Element Type="FunctionCall" Id="C"><Parameter Id="Missing" Type="Param"/></Element></Library></TriggerData>');const ws=new Workspace(root);await assert.rejects(new TriggerWorkspace(ws).graft({sourceFile:'source.xml',sourceTrigger:'B',targetTrigger:'A',kind:'Action',index:0,dryRun:false}),/DANGLING_SOURCE_REF/);assert.equal(ws.draftFiles().length,0);
});

import {ScriptWorkspace} from '../modules/script/workspace.js';
test('M21 function rename respects local shadow and struct member identity',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-bind-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source='void Action(){} void Run(){ Action(); { int Action = 1; int keep = Action; } Action(); }';await fs.writeFile(path.join(root,'a.galaxy'),source);
 const ws=new Workspace(root),script=new ScriptWorkspace(ws);const plan=await script.plan({operations:[{op:'function.rename',file:'a.galaxy',name:'Action',newName:'Renamed'}]});await script.apply(plan.planId,false);
 assert.equal((await ws.readRaw('a.galaxy')).text,'void Renamed(){} void Run(){ Renamed(); { int Action = 1; int keep = Action; } Renamed(); }');
});

test('M04 M09 composed token reference blocks delete and rewrites only established span',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-tokenref-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/EffectData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});
 const xml='<Catalog><CEffectDamage id="AuditTarget"/><CEffectSet id="Base"><?token id="suffix" value="Target"?></CEffectSet><CEffectSet id="Child" parent="Base"><EffectArray value="Audit##suffix##"/></CEffectSet></Catalog>';await fs.writeFile(path.join(root,file),xml);
 const ws=new Workspace(root),data=new DataWorkspace(ws);const refs=await data.referenceQuery({id:'AuditTarget',domain:'Effect',direction:'incoming'});assert.equal(refs.total,1);
 await assert.rejects(data.apply({file,operations:[{op:'object.delete',object:'AuditTarget'}]}),/incoming reference/);
 await data.apply({file,operations:[{op:'object.rename',object:'AuditTarget',newId:'NewTarget',updateReferences:true}],dryRun:false});const staged=(await ws.readRaw(file)).text;assert.match(staged,/<EffectArray value="NewTarget"/);assert.match(staged,/<\?token id="suffix" value="Target"\?>/);
});


import {projectPath} from '../app/paths.js';
test('M12 M13 M15 graft typed closure from implicit library keeps external identity and same Id across Types',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-graph-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source='<TriggerData><Element Id="T" Type="Trigger"><Action Id="C" Type="FunctionCall"/></Element><Element Id="C" Type="FunctionCall"><FunctionDef Type="FunctionDef" Library="Ntve" Id="External"/><Parameter Type="Param" Id="C"/></Element><Element Id="C" Type="Param"><ValueType Type="int"/><Value>1</Value></Element></TriggerData>';
 const target='<TriggerData><Library Id="Named"><Element Type="Trigger" Id="A"/><Element Type="Variable" Id="C"><Type Value="int"/></Element></Library><Library Id="Other"><Element Type="Trigger" Id="A"/></Library></TriggerData>';
 await fs.writeFile(path.join(root,'Triggers'),target);await fs.writeFile(path.join(root,'source.xml'),source);const ws=new Workspace(root),tr=new TriggerWorkspace(ws);
 await assert.rejects(tr.get('A'),/NOT_UNIQUE/);await tr.graft({sourceFile:'source.xml',sourceTrigger:'T',targetTrigger:'Named::A',kind:'Action',index:0,dryRun:false});
 const staged=(await ws.readRaw('Triggers')).text;assert.match(staged,/FunctionDef Type="FunctionDef" Library="Ntve" Id="External"/);assert.equal(scanXml(staged).nodes.filter(n=>n.tag==='Element'&&n.attrs.Id==='C').length,3);assert.equal((await tr.validate()).valid,true);
});
test('M16 localized graft rejects resource requirement before drafts',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-strings-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="L"><Element Type="Trigger" Id="T"/></Library></TriggerData>');await fs.writeFile(path.join(root,'source.xml'),'<TriggerData><Library Id="S"><Element Type="Trigger" Id="T"><Action Type="FunctionCall" Id="C"/></Element><Element Type="FunctionCall" Id="C"><Parameter Type="Param" Id="P"/></Element><Element Type="Param" Id="P"><ValueType Type="text"/><Value>LocalizedKey</Value></Element></Library></TriggerData>');const ws=new Workspace(root);await assert.rejects(new TriggerWorkspace(ws).graft({sourceFile:'source.xml',sourceTrigger:'T',targetTrigger:'T',kind:'Action',index:0,dryRun:false}),/LOCALIZATION_RESOURCE_REQUIRED/);assert.deepEqual(ws.draftFiles(),[]);
});
test('M18 M23 typed variable and gamelink plan rejects stale dependency, preserves action order',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-gamelink-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/UnitData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="Marine"/></Catalog>');await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="L"><Element Type="Trigger" Id="T"/><Element Type="Variable" Id="Point"><VariableType><Type Value="point"/></VariableType></Element></Library></TriggerData>');
 const ws=new Workspace(root),tr=new TriggerWorkspace(ws);const plan=await tr.plan({targetTrigger:'T',calls:[{kind:'Action',function:'UnitCreate',args:{'972A74CB':{kind:'literal',type:'int',value:1},'EF0CF6FF':{kind:'gamelink',domain:'Unit',id:'Marine'},'5AC69524':{kind:'preset',id:'8347A95C'},'1EC7B7A1':{kind:'literal',type:'int',value:1},'9329BF02':{kind:'variable',id:'Point'},'5908CAE6':{kind:'literal',type:'fixed',value:0}}},{kind:'Event',function:'TriggerAddEventMapInit',args:{}}]});
 await tr.applyPlan(plan.planId);assert.deepEqual(ws.draftFiles(),[]);await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="Changed"/></Catalog>');await assert.rejects(tr.applyPlan(plan.planId,false),/DEPENDENCY_STALE/);assert.deepEqual(ws.draftFiles(),[]);
 await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="Marine"/></Catalog>');await tr.applyPlan(plan.planId,false);const xml=(await ws.readRaw('Triggers')).text;assert.ok(xml.indexOf('<Event ')<xml.indexOf('<Action '));assert.match(xml,/Variable Type="Variable" Library="L" Id="Point"/);assert.match(xml,/<Value>Marine<\/Value>/);
});
test('M23 schema revision and foreign workspace reject a GUI plan before mutation',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-schema-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="L"><Element Type="Trigger" Id="T"/></Library></TriggerData>');const registryFile=path.join(root,'registry.json');await fs.copyFile(projectPath('generated/trigger-authoring-registry.json'),registryFile);const ws=new Workspace(root),tr=new TriggerWorkspace(ws,registryFile),plan=await tr.plan({targetTrigger:'T',calls:[{kind:'Action',function:'DialogDestroyAll',args:{}}]});
 const registry=JSON.parse(await fs.readFile(registryFile,'utf8'));registry.build++;await fs.writeFile(registryFile,JSON.stringify(registry));await assert.rejects(tr.applyPlan(plan.planId,false),/CONTEXT_STALE|SCHEMA_STALE/);await assert.rejects(new TriggerWorkspace(new Workspace(root),registryFile).applyPlan(plan.planId,false),/PLAN_NOT_FOUND/);assert.deepEqual(ws.draftFiles(),[]);
});
test('M25 placement and GUI consumers participate in one Data rename/save group',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-objects-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/UnitData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="Marine"/></Catalog>');await fs.writeFile(path.join(root,'Objects'),'<PlacedObjects Version="27"><ObjectUnit Id="1" UnitType="Marine" Name="Marine"/><ObjectDoodad Id="2" Type="Marine"/></PlacedObjects>');await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Element Type="Param" Id="P"><ValueType Type="gamelink" GameType="Unit"/><Value>Marine</Value></Element></TriggerData>');const ws=new Workspace(root),data=new DataWorkspace(ws);await assert.rejects(data.apply({file,operations:[{op:'object.delete',object:'Marine'}]}),/incoming reference/);
 await data.apply({file,operations:[{op:'object.rename',object:'Marine',newId:'Renamed',updateReferences:true}],dryRun:false});const placed=(await ws.readRaw('Objects')).text;assert.match(placed,/UnitType="Renamed" Name="Marine"/);assert.match(placed,/ObjectDoodad Id="2" Type="Marine"/);assert.match((await ws.readRaw('Triggers')).text,/<Value>Renamed<\/Value>/);await ws.save(file,{backup:false});assert.match(await fs.readFile(path.join(root,'Objects'),'utf8'),/UnitType="Renamed"/);
});
test('M04 actor event attribute/child carriers have precise rewrite spans and scoped wildcard coverage',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-actor-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/UnitData.xml',actor='Base.SC2Data/GameData/ActorData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="Marine"/><CEffectDamage id="Other"/></Catalog>');await fs.writeFile(path.join(root,actor),'<Catalog><CActorUnit id="A"><On Terms="UnitBirth.Marine" Send="Create"/><On><Terms value="UnitDeath.Marine"/><Send value="Create"/></On></CActorUnit></Catalog>');const ws=new Workspace(root),data=new DataWorkspace(ws);assert.equal((await data.referenceQuery({id:'Marine',domain:'Unit',direction:'incoming'})).total,2);
 await data.apply({file,operations:[{op:'object.rename',object:'Marine',newId:'Renamed',updateReferences:true}],dryRun:false});assert.match((await ws.readRaw(actor)).text,/UnitBirth.Renamed/);assert.match((await ws.readRaw(actor)).text,/UnitDeath.Renamed/);ws.discard(file);await fs.writeFile(path.join(root,actor),'<Catalog><CActorUnit id="A"><On Terms="UnitBirth.*" Send="Create"/></CActorUnit></Catalog>');await assert.rejects(data.apply({file,operations:[{op:'object.delete',object:'Marine',force:true}],allowInvalid:true}),/COVERAGE_UNKNOWN/);assert.deepEqual(ws.draftFiles(),[]);
});
test('M06 declared dependencies exclude installed roots and report scalar layer conflicts without pretending runtime order',async t=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-layers-'));t.after(()=>fs.rm(parent,{recursive:true,force:true}));const root=path.join(parent,'Test.SC2Map'),dep=path.join(parent,'Liberty.SC2Mod'),unused=path.join(parent,'Unused.SC2Mod'),file='Base.SC2Data/GameData/UnitData.xml';for(const dir of [root,dep,unused])await fs.mkdir(path.join(dir,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,'DocumentInfo'),'<DocInfo><Dependencies><Value>file:Mods/Liberty.SC2Mod</Value></Dependencies></DocInfo>');await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="A"><LifeMax value="20"/></CUnit></Catalog>');await fs.writeFile(path.join(dep,file),'<Catalog><CUnit id="A"><LifeMax value="10"/><Food value="1"/></CUnit></Catalog>');await fs.writeFile(path.join(unused,file),'<Catalog><CUnit id="A"><LifeMax value="999"/></CUnit></Catalog>');const data=new DataWorkspace(new Workspace(root),undefined,[unused,dep]);const result=await data.context({file,ids:['A'],includeReferences:false});const fields=result.objects[0].effective!.fields;assert.equal(fields.LifeMax.status,'unknown');assert.equal(fields.LifeMax.value,undefined);assert.equal(fields.Food.value,'1');const records=await data.catalog();assert.equal(records.find(r=>r.absolute===path.join(unused,file))?.engineActive,false);assert.equal(records.find(r=>r.absolute===path.join(dep,file))?.dependencyAvailability,'DECLARED_AVAILABLE');
});

test('M23 Galaxy plan and staged save retain Native API schema hash',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-script-schema-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const api=path.join(root,'api.json');await fs.copyFile(projectPath('generated/galaxy-native-api.json'),api);await fs.writeFile(path.join(root,'a.galaxy'),'void A(){}');const ws=new Workspace(root),script=new ScriptWorkspace(ws,api),plan=await script.plan({operations:[{op:'function.body',file:'a.galaxy',name:'A',body:' int x=1; '}]});const original=await fs.readFile(api,'utf8');await fs.writeFile(api,original+'\n');await assert.rejects(script.apply(plan.planId,false),/STALE_SCRIPT_SCHEMA/);assert.deepEqual(ws.draftFiles(),[]);await fs.writeFile(api,original);await script.apply(plan.planId,false);await fs.writeFile(api,original+'\n');await assert.rejects(script.save('a.galaxy',false),/STALE_FILE_TRANSACTION/);assert.equal(await fs.readFile(path.join(root,'a.galaxy'),'utf8'),'void A(){}');
});
test('M26 GUI concurrent apply, path traversal and missing foreign plan fail without partial drafts',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-gui-lock-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="L"><Element Type="Trigger" Id="T"/></Library></TriggerData>');const ws=new Workspace(root),tr=new TriggerWorkspace(ws),plan=await tr.plan({targetTrigger:'T',calls:[{kind:'Action',function:'DialogDestroyAll',args:{}}]});const results=await Promise.allSettled([tr.applyPlan(plan.planId,false),tr.applyPlan(plan.planId,false)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await tr.get('T')).references.length,1);ws.discard('Triggers');await assert.rejects(tr.graft({sourceFile:'../outside.xml',sourceTrigger:'T',targetTrigger:'T',kind:'Action',index:0,dryRun:false}),/outside|escape|root|path/i);await assert.rejects(tr.plan({create:{library:'L',identifier:'Bad'},stringFiles:['../TriggerStrings.txt'],calls:[]}),/STRING_FILE_SCOPE/);assert.deepEqual(ws.draftFiles(),[]);
});

test('M13 M15 M17 independent CASC named-library call graft retains its real NativeLib binding',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-corpus-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=await fs.readFile(projectPath('src/tests/fixtures/mcp-hardening/corpus-graft.xml'),'utf8');await fs.writeFile(path.join(root,'source.xml'),source);await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="Local"><Element Type="Trigger" Id="T"/></Library></TriggerData>');const ws=new Workspace(root),tr=new TriggerWorkspace(ws);await tr.graft({sourceFile:'source.xml',sourceTrigger:'FixtureRoot',targetTrigger:'T',kind:'Action',index:0,dryRun:false});const actual=(await tr.get('T',{includeRaw:true})).references[0].definition!;assert.ok(actual.includes('Library="Ntve"'));assert.equal(scanXml(actual).nodes.find(n=>n.tag==='FunctionDef')?.attrs.Id,'7B4A4D9D');assert.equal((await tr.validate()).valid,true);
});

test('M26 Windows junction, drive and UNC paths are rejected server-side',async t=>{
 const outer=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-junction-'));t.after(()=>fs.rm(outer,{recursive:true,force:true}));const root=path.join(outer,'workspace'),outside=path.join(outer,'outside');await fs.mkdir(root);await fs.mkdir(outside);await fs.symlink(outside,path.join(root,'escape'),process.platform==='win32'?'junction':'dir');const ws=new Workspace(root);assert.throws(()=>ws.resolveUserPath('escape/file.xml'),/symlink/);assert.throws(()=>ws.resolveUserPath('../outside/file.xml'),/escapes/);if(process.platform==='win32'){assert.throws(()=>ws.resolveUserPath('C:/outside/file.xml'),/escapes/);assert.throws(()=>ws.resolveUserPath('\\\\server\\share\\file.xml'),/escapes/);}assert.deepEqual(await fs.readdir(outside),[]);
});
test('M06 unresolved layer token overrides never become a trusted effective scalar',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-layer-token-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const dir=path.join(root,'Base.SC2Data/GameData');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'A.xml'),'<Catalog><CEffectDamage id="A"><?token id="amount" value="1"?><Amount value="##amount##"/></CEffectDamage></Catalog>');await fs.writeFile(path.join(dir,'B.xml'),'<Catalog><CEffectDamage id="A"><?token id="amount" value="2"?><Amount value="##amount##"/></CEffectDamage></Catalog>');const result=await new DataWorkspace(new Workspace(root)).resolveFields({id:'A',domain:'Effect'});assert.ok(result.objects.every(o=>o.effective!.fields.Amount.value===undefined));assert.ok(result.objects.every(o=>o.effective!.fields.Amount.reason==='RUNTIME_LAYER_TOKEN_OVERRIDE_UNVERIFIED'));
});

test('M23 newly created catalog consumers invalidate a staged Data destructive operation',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-directory-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/UnitData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="A"/></Catalog>');const ws=new Workspace(root),data=new DataWorkspace(ws);await data.apply({file,operations:[{op:'object.rename',object:'A',newId:'B',updateReferences:true}],dryRun:false});await fs.writeFile(path.join(root,'new.galaxy'),'void Run(){UnitCreate(1,"A",0,1,null,0);}');await assert.rejects(ws.save(file,{backup:false}),/STALE_DIRECTORY/);assert.match(await fs.readFile(path.join(root,file),'utf8'),/id="A"/);assert.match((await ws.readRaw(file)).text,/id="B"/);
});

test('M25 Data edits preserve a pre-existing coupled GUI/TriggerStrings draft group',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-coupled-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/UnitData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});await fs.writeFile(path.join(root,file),'<Catalog><CUnit id="Marine"/></Catalog>');await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Library Id="L"><Element Type="Variable" Id="Point"><VariableType><Type Value="point"/></VariableType></Element></Library></TriggerData>');const ws=new Workspace(root),tr=new TriggerWorkspace(ws),plan=await tr.plan({create:{library:'L',identifier:'Spawn'},calls:[{kind:'Action',function:'UnitCreate',args:{'972A74CB':{kind:'literal',type:'int',value:1},'EF0CF6FF':{kind:'gamelink',domain:'Unit',id:'Marine'},'5AC69524':{kind:'preset',id:'8347A95C'},'1EC7B7A1':{kind:'literal',type:'int',value:1},'9329BF02':{kind:'variable',id:'Point'},'5908CAE6':{kind:'literal',type:'fixed',value:0}}}]});await tr.applyPlan(plan.planId,false);const strings=(await ws.readRaw('enUS.SC2Data/LocalizedData/TriggerStrings.txt')).text;await new DataWorkspace(ws).apply({file,operations:[{op:'object.rename',object:'Marine',newId:'Renamed',updateReferences:true}],dryRun:false});assert.equal((await ws.readRaw('enUS.SC2Data/LocalizedData/TriggerStrings.txt')).text,strings);assert.match((await ws.readRaw('Triggers')).text,/<Value>Renamed<\/Value>/);assert.equal((await tr.validate()).valid,true);const followup=await tr.plan({targetTrigger:'Spawn',calls:[{kind:'Action',function:'DialogDestroyAll',args:{}}]});await tr.applyPlan(followup.planId,false);assert.equal((await tr.get('Spawn')).references.length,2);await ws.save(file,{backup:false});assert.equal(await fs.readFile(path.join(root,'enUS.SC2Data/LocalizedData/TriggerStrings.txt'),'utf8'),strings);
});

test('M02 M06 inherited field token overrides protect resolved targets and reject unsafe template rewrites',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-inherited-token-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file='Base.SC2Data/GameData/EffectData.xml';await fs.mkdir(path.join(root,path.dirname(file)),{recursive:true});const xml='<Catalog><CEffectDamage id="Foo"/><CEffectDamage id="Bar"/><CEffectSet id="Template"><?token id="effect" value="Foo"?><EffectArray value="##effect##"/></CEffectSet><CEffectSet id="Child" parent="Template" effect="Bar"/></Catalog>';await fs.writeFile(path.join(root,file),xml);const ws=new Workspace(root),data=new DataWorkspace(ws),refs=await data.referenceQuery({id:'Bar',domain:'Effect',direction:'incoming'});assert.equal(refs.total,1);assert.equal(refs.items[0].object,'CEffectSet:Child');assert.equal(refs.items[0].rewritePolicy,'readOnly');await assert.rejects(data.apply({file,operations:[{op:'object.delete',object:'Bar'}]}),/incoming reference/);await assert.rejects(data.apply({file,operations:[{op:'object.rename',object:'Bar',newId:'Renamed',updateReferences:true}]}),/REWRITE_UNSUPPORTED/);await assert.rejects(data.apply({file,operations:[{op:'object.rename',object:'Foo',newId:'Renamed',updateReferences:true}]}),/REWRITE_UNSUPPORTED/);assert.equal(await fs.readFile(path.join(root,file),'utf8'),xml);assert.deepEqual(ws.draftFiles(),[]);
});

test('M09 token declarations inside comments/CDATA do not affect semantic references',()=>{
 const xml='<Catalog><CEffectSet id="Set"><?token id="effect" value="Real"?><!-- <?token id="effect" value="Comment"?> --><Note><![CDATA[<?token id="effect" value="Cdata"?>]]></Note><EffectArray value="##effect##"/></CEffectSet></Catalog>',doc=new DataDocument(xml);assert.equal(doc.references()[0].value,'Real');assert.equal(doc.source,xml);
});
test('M13 qualified implicit library selector is distinct from a named library with the same ID',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hardening-implicit-select-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Element Type="Trigger" Id="T"/><Library Id="Named"><Element Type="Trigger" Id="T"/></Library></TriggerData>');const tr=new TriggerWorkspace(new Workspace(root));await assert.rejects(tr.get('T'),/NOT_UNIQUE/);assert.equal((await tr.get('::T')).library,'');assert.equal((await tr.get('Named::T')).library,'Named');
});
