import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compactDataBatch,compactDataValidation,DataResponseStore} from '../modules/data/responseStore.js';
import {ToolTelemetry} from '../app/telemetry.js';
import {Workspace} from '../core/workspace.js';
import {DataWorkspace} from '../modules/data/workspace.js';
import {DataDocument} from '../modules/data/document.js';

test('large Data validation uses bounded summary and pageable compressed snapshot',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-data-response-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const diagnostics=Array.from({length:2000},(_,i)=>({level:'L4',severity:'warning',code:'UNKNOWN_FIELD',message:'detail '+i,file:'UnitData.xml',path:'CUnit:'+i}));
 const report={valid:true,errors:0,warnings:2000,levels:{L4:'PASS'},diagnostics};
 const compact=compactDataValidation(report);assert.equal(compact.diagnostics.length,8);assert.equal(compact.diagnosticsTotal,2000);assert.equal(compact.nextOffset,8);
 const store=new DataResponseStore(root),saved=await store.save(report);assert.match(saved.reportId,/^[0-9a-f]{64}$/);const page=await store.page(saved.reportId,'diagnostics',1995,10);assert.equal(page.items.length,5);assert.equal(page.nextOffset,null);assert.equal((page.items[0] as {message:string}).message,'detail 1995');
 await assert.rejects(store.page('../bad','diagnostics',0,1),/DATA_REPORT_ID_INVALID/);
});

test('Data batch summary omits full diffs and validation graph',()=>{
 const report={accepted:true,dryRun:true,files:[{file:'UnitData.xml',after:'x'.repeat(200000)}],applied:[{file:'UnitData.xml',op:'field.set',target:'Marine'}],validation:{valid:true,errors:0,warnings:500,diagnostics:Array.from({length:500},()=>({severity:'warning',code:'WARN',message:'x'.repeat(1000)}))},authoring:[{file:'UnitData.xml',authoring:{accepted:true,status:'PASS',diagnostics:[]}}]};
 const compact=compactDataBatch(report);assert.equal(compact.filesTotal,1);assert.equal(compact.validation?.diagnosticsTotal,500);assert.ok(JSON.stringify(compact).length<10000);
});

test('retained baseline errors stay explicit and bounded in a compact batch response',()=>{
 const retainedErrors=Array.from({length:100},(_,i)=>({severity:'error',code:'OLD_ERROR',message:'Existing error '+i,file:'ActorData.xml',path:'Actor:'+i}));
 const compact=compactDataBatch({accepted:true,validation:{valid:false,errors:100,diagnostics:retainedErrors},validationDelta:{reason:'Keep untouched imported actors',retainedErrors,blockingErrors:[]}});
 assert.equal(compact.validation?.valid,false);
 assert.equal(compact.validationDelta?.retainedErrorsTotal,100);
 assert.equal(compact.validationDelta?.retainedErrors.length,8);
 assert.equal(compact.validationDelta?.blockingErrorsTotal,0);
});

test('MCP telemetry skips tokenizing over-budget payloads but keeps byte and time counts',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-token-budget-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const telemetry=new ToolTelemetry(root);telemetry.record('huge',{}, {content:[{type:'text',text:'x'.repeat(1100000)}]},12);const result=await telemetry.summary();assert.equal(result.calls,1);assert.equal(result.overBudgetTokenCounts,1);assert.equal(result.outputTextTokens,0);assert.equal(result.tools[0].durationMs,12);
});

test('focused Data reference validation checks workspace edges against dependency targets without reporting dependency-only baseline warnings',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-data-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=new DataWorkspace(new Workspace(root));
 const records=[{file:'Local.xml',layer:'workspace',document:new DataDocument('<Catalog><CUnit id="Local" parent="Dep"/></Catalog>','Local.xml')},{file:'Core.xml',layer:'dependency',document:new DataDocument('<Catalog><CUnit id="Dep" parent="Absent"/></Catalog>','Core.xml')}];
 const all=data.references(records as never),focused=data.references(records as never,'workspace');
 assert.ok(all.some(r=>r.value==='Absent'));assert.ok(focused.some(r=>r.value==='Dep'));assert.ok(!focused.some(r=>r.value==='Absent'));
});
