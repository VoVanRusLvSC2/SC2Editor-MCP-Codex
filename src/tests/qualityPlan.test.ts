import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import type {McpServer} from '@modelcontextprotocol/server';
import {Workspace} from '../core/workspace.js';
import {planQuality} from '../modules/testing/qualityPlan.js';
import {readEvidenceInventory} from '../modules/testing/evidenceInventory.js';
import {registerProjectTestTools} from '../modules/testing/tools.js';
import type {ProjectTestWorkspace} from '../modules/testing/workspace.js';
import {compileAuthorScript} from '../app/authoringScript.js';
import {runMcpBatch,type BatchTool} from '../app/mcpBatch.js';

const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-quality-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const write=async(file:string,value:unknown)=>{const at=path.join(root,file);await fs.mkdir(path.dirname(at),{recursive:true});await fs.writeFile(at,typeof value==='string'?value:JSON.stringify(value));};
 await write('runtime/adapter.ts','export const profile=1;\r\n');
 const adapter=sha(await fs.readFile(path.join(root,'runtime/adapter.ts'))),record={sourceFingerprints:{'runtime/adapter.ts':adapter}};await write('record.json',record);
 const index={schemaVersion:1,records:[{id:'current',role:'scoped',file:'record.json',sha256:sha(await fs.readFile(path.join(root,'record.json')))}],coverage:[{id:'regional',required:true,state:'passed',records:['current'],reason:'Restricted observed profile'},{id:'styles',required:true,state:'partial',records:['current'],reason:'Final art remains open'},{id:'gui',required:true,state:'unsupported',records:['current']}]};await write('index.json',index);
 const bindings=[];
 for(const[id,coverage]of [['forest','styles'],['regional','regional'],['gui','gui']]){
  const manifest={version:1,map:'Map.SC2Map',editor:{checks:['load','compile'],contextLabel:'MAIN'},game:{views:[{id:'overview',camera:{x:32,y:32,distance:70,pitch:60,yaw:180}}]}};
  await write(id+'/suite.json',manifest);await write(id+'/Map.SC2Map','ordinary '+id);
  bindings.push({id,label:id,scope:'Explicit '+id+' fixture; coverage remains independently declared',coverage:[coverage],directory:id,manifest:'suite.json',records:['current'],requiredViews:['overview'],expectedInputs:{'suite.json':sha(await fs.readFile(path.join(root,id+'/suite.json'))),'Map.SC2Map':sha(await fs.readFile(path.join(root,id+'/Map.SC2Map')))},expectedSources:{'adapter.ts':adapter}});
 }
 const spec={version:1,bindings};await write('quality.json',spec);
 const workspace=new Workspace(root),args={file:'quality.json',indexFile:'index.json',limit:8},options={packageRoot:path.join(root,'runtime')};
 return{root,write,index,spec,workspace,args,options};
}

test('quality discovery pages existing suites and never upgrades partial or unsupported coverage',async t=>{
 const f=await fixture(t),r=await planQuality(f.workspace,f.args,f.options);
 assert.equal(r.readOnly,true);assert.equal(r.roadmapReady,false);assert.equal(r.bindingsTotal,3);assert.equal(r.nextOffset,null);
 assert.deepEqual(r.coverage.map(c=>[c.id,c.state]),[['regional','passed'],['styles','partial'],['gui','unsupported']]);
 for(const row of r.bindings){assert.equal(row.freshness,'matched');assert.equal(row.readyForPlan,true);assert.equal(Object.hasOwn(row,'passed'),false);const next=row.next as any;assert.equal(next.tool,'project.test.plan');assert.deepEqual(next.args,{file:'suite.json'});assert.equal(next.repeat,2);assert.ok(next.cli.argv.includes('--workspace'));assert.ok(!next.cli.argv.includes('--live'));assert.equal(path.dirname(next.manifestFile),next.workspace);}
 const page=await planQuality(f.workspace,{...f.args,limit:1,offset:1},f.options);assert.equal(page.bindings.length,1);assert.equal(page.bindings[0].id,'regional');assert.equal(page.nextOffset,2);
 const filter=await planQuality(f.workspace,{...f.args,coverage:['styles']},f.options);assert.equal(filter.bindings.length,1);assert.equal(filter.coverage.length,1);
 assert.ok(Buffer.byteLength(JSON.stringify(r))<16*1024);
});

test('quality discovery distinguishes changed map, manifest and declared adapter source',async t=>{
 const f=await fixture(t);await f.write('forest/Map.SC2Map','changed ordinary archive');let r=await planQuality(f.workspace,{...f.args,bindingIds:['forest']},f.options);assert.equal(r.bindings[0].freshness,'stale');assert.equal(r.bindings[0].readyForPlan,true);
 await f.write('forest/Map.SC2Map','ordinary forest');const manifest=JSON.parse(await fs.readFile(path.join(f.root,'forest/suite.json'),'utf8'));manifest.label='Changed';await f.write('forest/suite.json',manifest);r=await planQuality(f.workspace,{...f.args,bindingIds:['forest']},f.options);assert.equal(r.bindings[0].freshness,'stale');
 await f.write('runtime/adapter.ts','export const profile=2;');r=await planQuality(f.workspace,f.args,f.options);assert.equal(r.coverage.find(c=>c.id==='regional')!.state,'stale');assert.ok(r.bindings.every(b=>b.freshness==='stale'));assert.equal((r.bindings[0].sourceFingerprints as any).stale,1);
});

test('quality discovery rejects missing views, stale declared dependency and pending drafts',async t=>{
 const f=await fixture(t),manifest=JSON.parse(await fs.readFile(path.join(f.root,'forest/suite.json'),'utf8'));await f.write('forest/dep.SC2Mod','current dependency');manifest.dependencies=[{id:'lib',file:'dep.SC2Mod',sha256:sha('old dependency')}];manifest.game.views=[];await f.write('forest/suite.json',manifest);
 f.spec.bindings[0].expectedInputs['suite.json']=sha(await fs.readFile(path.join(f.root,'forest/suite.json')));Object.assign(f.spec.bindings[0].expectedInputs,{'dep.SC2Mod':sha('current dependency')});await f.write('quality.json',f.spec);
 const r=await planQuality(f.workspace,{...f.args,bindingIds:['forest']},f.options);assert.equal(r.bindings[0].readyForPlan,false);assert.equal(r.bindings[0].freshness,'missing');assert.deepEqual((r.bindings[0].issues as any[]).map(i=>i.code),['QUALITY_REQUIRED_VIEW_MISSING','QUALITY_DECLARED_DEPENDENCY_STALE']);
 manifest.game.views=[{id:'overview',camera:{x:32,y:32,distance:70,pitch:60,yaw:180}}];await f.write('forest/suite.json',manifest);const stale=await planQuality(f.workspace,{...f.args,bindingIds:['forest']},f.options);assert.equal(stale.bindings[0].freshness,'stale');
 const fake=Object.create(f.workspace) as Workspace;fake.draftFiles=()=>['manual.xml'];const drafted=await planQuality(fake,{...f.args,bindingIds:['gui']},f.options);assert.equal(drafted.pendingDrafts,1);assert.equal(drafted.bindings[0].readyForPlan,false);
});

test('portable source absence remains unverified and strict CLI inventory still rejects missing sources',async t=>{
 const f=await fixture(t);await fs.unlink(path.join(f.root,'runtime/adapter.ts'));const r=await planQuality(f.workspace,f.args,f.options);assert.equal(r.coverage.find(c=>c.id==='regional')!.state,'unverified');assert.equal(r.roadmapReady,false);assert.ok(r.bindings.every(b=>b.freshness==='unbound'));await assert.rejects(readEvidenceInventory(f.root,'index.json'),/ENOENT/);
});

test('quality discovery rejects record tampering, unknown references and escaping paths',async t=>{
 const f=await fixture(t);await assert.rejects(planQuality(f.workspace,{...f.args,bindingIds:['missing']},f.options),/QUALITY_BINDING_UNKNOWN/);await assert.rejects(planQuality(f.workspace,{...f.args,coverage:['missing']},f.options),/QUALITY_COVERAGE_UNKNOWN/);
 f.spec.bindings[0].directory='../outside';await f.write('quality.json',f.spec);await assert.rejects(planQuality(f.workspace,f.args,f.options),/scoped relative/);f.spec.bindings[0].directory='forest';await f.write('quality.json',f.spec);
 const manifest=JSON.parse(await fs.readFile(path.join(f.root,'forest/suite.json'),'utf8'));manifest.map='../other.SC2Map';await f.write('forest/suite.json',manifest);await assert.rejects(planQuality(f.workspace,f.args,f.options),/EVIDENCE_PATH_SCOPE/);
 await f.write('record.json',{});await assert.rejects(planQuality(f.workspace,f.args,f.options),/EVIDENCE_RECORD_DIGEST/);
});

test('shared inventory reads each declared source once across byte and normalized historic records',async t=>{
 const f=await fixture(t),second={sourceFingerprints:[{file:'runtime/adapter.ts',sha256LfUtf8:sha('export const profile=1;\n')}]};await f.write('second.json',second);f.index.records.push({id:'normalized',role:'historical',file:'second.json',sha256:sha(await fs.readFile(path.join(f.root,'second.json')))});await f.write('index.json',f.index);
 let reads=0;const original=fs.readFile;t.mock.method(fs,'readFile',async(...args:any[])=>{if(String(args[0])===path.join(f.root,'runtime/adapter.ts'))reads++;return Reflect.apply(original,fs,args);});const result=await readEvidenceInventory(f.root,'index.json');assert.equal(reads,1);assert.equal(result.matchingSourceScopes,2);
});

test('quality discovery truncates missing-input findings and rejects oversized index identities',async t=>{
 const f=await fixture(t);for(let i=0;i<40;i++)Object.assign(f.spec.bindings[0].expectedInputs,{['missing'+i+'.SC2Mod']:sha('missing')});await f.write('quality.json',f.spec);
 const r=await planQuality(f.workspace,{...f.args,bindingIds:['forest']},f.options),row=r.bindings[0];assert.equal(row.issuesTotal,40);assert.equal((row.issues as unknown[]).length,8);assert.equal(row.issuesTruncated,true);assert.equal(row.inputsTruncated,true);assert.ok(Buffer.byteLength(JSON.stringify(r))<16*1024);
 f.index.records[0].id='a'.repeat(81);await f.write('index.json',f.index);await assert.rejects(planQuality(f.workspace,f.args,f.options),/EVIDENCE_INDEX_RECORD/);
});

test('public and compact quality entry points expose bounded discovery without invoking native tests',async t=>{
 const f=await fixture(t),tools=new Map<string,BatchTool>();let calls=0;
 const server={registerTool(name:string,definition:any,invoke:any){tools.set(name,{schema:definition.inputSchema,invoke});}} as unknown as McpServer;
 registerProjectTestTools(server,{qualityPlan:async(args:any)=>{calls++;return planQuality(f.workspace,args,f.options);},plan:()=>{throw Error('Native planner must not run');},run:()=>{throw Error('Native runner must not run');}} as unknown as ProjectTestWorkspace);
 const steps=compileAuthorScript('project quality.plan file=quality.json indexFile=index.json','plan',tools),result=await runMcpBatch(steps,tools,{});assert.equal(result.ok,true);assert.equal(calls,1);const value=result.steps[0].result as any;assert.equal(value.bindings.length,3);assert.equal(value.integrity,true);assert.equal(value.roadmapReady,false);assert.ok(value.scope.includes('No Editor/Game'));
});
