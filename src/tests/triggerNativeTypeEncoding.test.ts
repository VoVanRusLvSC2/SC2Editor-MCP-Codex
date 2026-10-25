import test from 'node:test';import assert from 'node:assert/strict';
import {serializeAstElement} from '../modules/trigger/ast/codec.js';
import {nativeGuiProfile} from '../modules/trigger/nativeProfile.js';
import {compactResult} from '../app/mcpBatch.js';
import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Workspace} from '../core/workspace.js';import {TriggerWorkspace} from '../modules/trigger/workspace.js';

test('native library variable types retain their qualified TypeElement binding',()=>{
 const xml=serializeAstElement({id:'00000001',type:'Variable',identifier:'Record',variableType:{type:'struct',typeElement:{type:'Structure',id:'00000002',library:'A1B2C3D4'}},initialValue:{type:'Param',id:'00000003',library:'A1B2C3D4'}},'A1B2C3D4');
 assert.match(xml,/<TypeElement Type="Structure" Library="A1B2C3D4" Id="00000002"\/>/);
 assert.match(xml,/<Value Type="Param" Id="00000003"\/>/,'ordinary references retain their existing implicit library contract');
 const root=serializeAstElement({id:'00000001',type:'Variable',variableType:{type:'struct',typeElement:{type:'Structure',id:'00000002',library:''}}},'A1B2C3D4');
 assert.match(root,/<TypeElement Type="Structure" Library="" Id="00000002"\/>/);
});

test('native array-bound metadata retains its exact library while preserving the variable reference and dimension',()=>{
 const xml=serializeAstElement({id:'00000001',type:'Variable',variableType:{type:'int'},arraySizes:[{dim:0,variable:{id:'00000002',type:'Variable',library:'A1B2C3D4'}}]},'A1B2C3D4');
 assert.match(xml,/<ArraySize Dim="0" Type="Variable" Library="A1B2C3D4" Id="00000002"\/>/);assert.doesNotMatch(xml,/<ArraySize[^>]*Value=/);
 const unsafe='<TriggerData><Library Id="LIB"><Root/><Element Type="Variable" Id="A"><VariableType><Type Value="int"/><ArraySize Dim="0" Type="Variable" Id="BOUND"/></VariableType></Element></Library></TriggerData>';
 assert.equal(nativeGuiProfile(unsafe).issues[0].code,'NATIVE_ARRAY_BOUND_LIBRARY_REQUIRED');
});

test('native profile distinguishes valid XML from known library and zero-bound generator risks',()=>{
 const xml='<TriggerData><Root/>'+serializeAstElement({type:'Variable',id:'A',variableType:{type:'int'}})+'<Library Id="LIB"><Root/><Element Type="Variable" Id="B"><VariableType><Type Value="struct"/><TypeElement Type="Structure" Id="C"/><ArraySize Dim="0" Value="0"/></VariableType></Element><Element Type="Param" Id="D"><Variable Type="Variable" Library="" Id="A"/></Element></Library></TriggerData>';
 const result=nativeGuiProfile(xml);assert.equal(result.status,'requires_native_check');assert.deepEqual(result.issues.map(i=>i.code),['NATIVE_TYPE_ELEMENT_LIBRARY_REQUIRED','NATIVE_LITERAL_ZERO_ARRAY_BOUND','NATIVE_LIBRARY_ROOT_GLOBAL_REFERENCE']);assert.equal(result.compiler,'NOT_EXECUTED');assert.equal(result.issues[2].elementId,'D');
});

test('native profile does not flag qualified types, constant bounds or map locals as library global reads',()=>{
 const xml='<TriggerData><Root/><Element Type="FunctionDef" Id="F"><Variable Type="Variable" Id="A"/></Element><Element Type="Variable" Id="A"><VariableType><Type Value="int"/></VariableType></Element><Library Id="LIB"><Root/><Element Type="Variable" Id="B"><VariableType><Type Value="struct"/><TypeElement Type="Structure" Library="LIB" Id="C"/><ArraySize Dim="0" Type="Variable" Library="LIB" Id="ZERO"/></VariableType></Element><Element Type="Param" Id="D"><Variable Type="Variable" Library="" Id="A"/></Element></Library></TriggerData>';
 const result=nativeGuiProfile(xml);assert.equal(result.status,'no_known_issues');assert.equal(result.issueCount,0);assert.equal(result.compiler,'NOT_EXECUTED');
});

test('workflow receipts retain bounded native risks without promoting them to compiler validity',()=>{
 const refs=Array.from({length:20},(_,i)=>`<Element Type="Param" Id="P${i}"><Variable Type="Variable" Library="" Id="A"/></Element>`).join(''),xml='<TriggerData><Root/><Element Type="Variable" Id="A"><VariableType><Type Value="int"/></VariableType></Element><Library Id="LIB"><Root/>'+refs+'</Library></TriggerData>',profile=nativeGuiProfile(xml);
 assert.equal(profile.issueCount,20);assert.equal(profile.issues.length,12);assert.equal(profile.truncated,true);const result=compactResult({planId:'plan',nativeProfile:profile}) as {planId:string;nativeProfile:typeof profile};assert.equal(result.planId,'plan');assert.deepEqual(result.nativeProfile,profile);assert.equal(result.nativeProfile.compiler,'NOT_EXECUTED');
});

test('literal zero arrays lower to separate zero constants for globals, record fields and locals',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-zero-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/><Library Id="A1B2C3D4"><Root/></Library></TriggerData>');
 const ws=new Workspace(root),tr=new TriggerWorkspace(ws),p=await tr.plan({create:{library:'A1B2C3D4',identifier:'OneCell',folder:'GAMEPLAY/BOUNDS'},structures:[{name:'Record',fields:[{name:'Cell',type:'int',arraySizes:[0]}]}],variables:[{name:'Values',type:'int',arraySizes:[0,2]}],functions:[{name:'Scratch',kind:'Action',variables:[{name:'Local',type:'int',arraySizes:[0]}],calls:[]}],calls:[]});
 assert.equal(p.variables.length,1);assert.equal(p.nativeProfile.loweredZeroBounds.total,3);assert.equal(p.nativeProfile.issueCount,0);await tr.applyPlan(p.planId,false);await tr.save(false);
 const xml=(await ws.readRaw('Triggers')).text;assert.doesNotMatch(xml,/<ArraySize[^>]*Value="0"/);assert.equal(new Set(p.nativeProfile.loweredZeroBounds.items.map(i=>i.constantId)).size,3);
 const helpers=(await tr.inspect()).variables!.filter(v=>v.name.startsWith('MCPZeroBound_'));assert.equal(helpers.length,3);assert.ok(helpers.every(v=>v.scope==='global'&&v.constant&&v.initialScalar==='0'));
 await assert.rejects(tr.plan({targetTrigger:p.triggerId,calls:[{kind:'Action',function:'SetVariable',args:{var:{kind:'variable',name:'Values',indices:[{kind:'literal',type:'int',value:1},{kind:'literal',type:'int',value:0}]},val:{kind:'literal',type:'int',value:3}}}]}),/INDEX_BOUNDS/);
 assert.equal((await tr.validate()).valid,true);
});

test('editing a generated zero-bound constant stays a visible review finding and is not overwritten',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-zero-edit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');const ws=new Workspace(root),tr=new TriggerWorkspace(ws),p=await tr.plan({variables:[{name:'Cell',type:'int',arraySizes:[0]}],calls:[]});await tr.applyPlan(p.planId,false);await tr.save(false);
 const original=await fs.readFile(path.join(root,'Triggers'),'utf8'),changed=original.replace('<Value>0</Value>','<Value>5</Value>');assert.notEqual(changed,original);await fs.writeFile(path.join(root,'Triggers'),changed);
 const report=await tr.validate();assert.equal(report.nativeProfile.issues[0].code,'NATIVE_ZERO_BOUND_HELPER_CHANGED');await tr.plan({variables:[{name:'Unrelated',type:'int'}],calls:[]});assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),changed);
});
