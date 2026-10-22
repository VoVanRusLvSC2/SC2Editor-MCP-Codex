import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as z from 'zod/v4';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {registerDataTools} from '../modules/data/tools.js';
import {compileAuthorScript} from '../app/authoringScript.js';
import {coalesceDataAuthoringSteps} from '../app/authoringDataGroups.js';
import {compactResult,runMcpBatch,type BatchTool,type BatchStep} from '../app/mcpBatch.js';
const file='Base.SC2Data/GameData/Test.xml';
async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-author-data-groups-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});const xml='<Catalog><CUnit id="Hero"><LifeMax value="100"/><LifeStart value="100"/></CUnit><CEffectDamage id="Damage"/><CButton id="FirstButton"/><CButton id="SecondButton"/><CAbilEffectTarget id="Template"/></Catalog>';await fs.writeFile(path.join(root,file),xml);await fs.writeFile(path.join(root,'Base.SC2Data/GameData.xml'),'<Includes><Catalog path="GameData/Test.xml"/></Includes>');
 const workspace=new Workspace(root),data=new DataWorkspace(workspace),calls:string[]=[],tools=new Map<string,BatchTool>();
 registerDataTools({registerTool:(name:string,config:any,callback:any)=>tools.set(name,{schema:config.inputSchema,invoke:async args=>{calls.push(name);return callback(args);}})} as any,{workspace:data});
 tools.set('modkit.save',{schema:z.object({file:z.string()}),invoke:async(args:any)=>{calls.push('modkit.save');return {content:[{type:'text',text:JSON.stringify(await workspace.save(args.file,{backup:false}))}]};}});
 return {root,workspace,data,calls,tools,xml};
}
const setters=(names:string[])=>names.map((name,i)=>`data set file=${file} id=Hero path=${name} value=${150-i}`).join('\n');

test('compatible Data setters share one final graph validation and one complete save',async t=>{
 const f=await fixture(t),steps=compileAuthorScript(setters(['LifeMax','LifeStart']),'save',f.tools);assert.deepEqual(steps.map(s=>s.tool),['data.apply','modkit.save']);assert.equal((steps[0].args.operations as unknown[]).length,2);
 const result=await runMcpBatch(steps,f.tools,{});assert.equal(result.ok,true);assert.deepEqual(f.calls,['data.apply','modkit.save']);assert.equal((result.steps[0].result as any).appliedTotal,2);const xml=await fs.readFile(path.join(f.root,file),'utf8');assert.ok(xml.includes('LifeMax value="150"'));assert.ok(xml.includes('LifeStart value="149"'));assert.deepEqual(f.workspace.draftFiles(),[]);
});
test('a later strict Data failure rolls back the whole adjacent group before save',async t=>{
 const f=await fixture(t),steps=compileAuthorScript(setters(['LifeMax','DefinitelyUnknownField']),'save',f.tools),result=await runMcpBatch(steps,f.tools,{});assert.equal(result.ok,false);assert.deepEqual(f.calls,['data.apply']);assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),f.xml);assert.deepEqual(f.workspace.draftFiles(),[]);
});
test('grouped plan leaves no draft and grouped stage keeps the complete transaction off disk until save',async t=>{
 const f=await fixture(t),source=setters(['LifeMax','LifeStart']);
 const planned=await runMcpBatch(compileAuthorScript(source,'plan',f.tools),f.tools,{});assert.equal(planned.ok,true);assert.deepEqual(f.workspace.draftFiles(),[]);assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),f.xml);
 const staged=await runMcpBatch(compileAuthorScript(source,'stage',f.tools),f.tools,{});assert.equal(staged.ok,true);assert.deepEqual(f.calls,['data.apply','data.apply']);assert.equal(await fs.readFile(path.join(f.root,file),'utf8'),f.xml);assert.ok(f.workspace.draftFiles().includes(file));
 await f.workspace.save(file,{backup:false});const saved=await fs.readFile(path.join(f.root,file),'utf8');assert.ok(saved.includes('LifeMax value="150"'));assert.ok(saved.includes('LifeStart value="149"'));assert.deepEqual(f.workspace.draftFiles(),[]);
});
test('two high-level abilities use original schemas/defaults and the evolving inherited-card guard in one group',async t=>{
 const f=await fixture(t),source=[`data ability.target file=${file} id=First sourceAbility=Template effect=Damage button=FirstButton unit=Hero card.slot=10 card.row=2 card.column=3`,`data ability.target file=${file} id=Second sourceAbility=Template effect=Damage button=SecondButton unit=Hero card.slot=11 card.row=2 card.column=4`].join('\n'),steps=compileAuthorScript(source,'save',f.tools);assert.deepEqual(steps.map(s=>s.tool),['data.apply','modkit.save']);
 const result=await runMcpBatch(steps,f.tools,{});assert.equal(result.ok,true);assert.deepEqual(f.calls,['data.apply','modkit.save']);assert.equal((result.steps[0].result as any).cardReviewCount,2);const xml=await fs.readFile(path.join(f.root,file),'utf8');assert.ok(xml.includes('id="First" parent="Template"'));assert.ok(xml.includes('id="Second" parent="Template"'));
});
test('file, read, backup and result-reference boundaries remain separate; unsupported schema conversions fall back',async t=>{
 const f=await fixture(t);
 const separate=compileAuthorScript(`data set file=${file} id=Hero path=LifeMax value=150\ndata card.check unit=Hero\ndata set file=${file} id=Hero path=LifeStart value=150`,'save',f.tools);assert.deepEqual(separate.map(s=>s.tool),['data.apply','modkit.save','data.card.check','data.apply','modkit.save']);
 const step=(id:string,change:Record<string,unknown>={}):BatchStep=>({id,tool:'data.apply',args:{file,operations:[{op:'field.set',object:'Hero',path:'LifeMax',value:150}],dryRun:true,...change}});
 for(const pair of [[step('a'),step('b',{file:'Base.SC2Data/GameData/Other.xml'})],[step('a'),step('b',{backup:false})],[step('a'),step('b',{expectedSha256:{[file]:'a'.repeat(64)}})],[step('a'),step('b',{operations:[{op:'field.set',object:'Hero',path:'LifeStart',value:{$from:'a.files.0.file'}}]})]])assert.deepEqual(coalesceDataAuthoringSteps(pair,'plan',f.tools),pair);
 const constrained=new Map(f.tools);constrained.set('data.apply',{...f.tools.get('data.apply')!,schema:z.object({file:z.string(),operations:z.array(z.unknown()).max(1)})});const pair=[step('a'),step('b')];assert.deepEqual(coalesceDataAuthoringSteps(pair,'plan',constrained),pair);
});
test('grouping respects operation/call budgets and preserves errors in original recipe arguments',async t=>{
 const f=await fixture(t),source=Array.from({length:600},(_,i)=>`data set file=${file} id=Hero path=LifeMax value=${i}`).join('\n'),steps=compileAuthorScript(source,'save',f.tools);assert.equal(steps.length,4);assert.deepEqual(steps.filter(s=>s.tool==='data.apply').map(s=>(s.args.operations as unknown[]).length),[500,100]);
 assert.throws(()=>compileAuthorScript(Array(21).fill('data card.check unit=Hero').join('\n'),'plan',f.tools),/STEP_LIMIT/);
 const bad=`data ability.target file=${file} id=First sourceAbility=Template effect=Damage button=FirstButton typo=true\ndata ability.target file=${file} id=Second sourceAbility=Template effect=Damage button=SecondButton`;
 const rejected=await runMcpBatch(compileAuthorScript(bad,'save',f.tools),f.tools,{});assert.equal(rejected.ok,false);assert.equal(rejected.completed,0);assert.deepEqual(f.calls,[]);
});
test('compact applied counts do not replace a stored full count with the summary page length',()=>{
 assert.equal((compactResult({applied:[{index:0,op:'field.set'}]}) as any).appliedTotal,1);assert.equal((compactResult({appliedTotal:500,applied:[{index:0,op:'field.set'}]}) as any).appliedTotal,500);
});
