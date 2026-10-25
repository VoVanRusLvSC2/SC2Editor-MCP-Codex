import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Workspace} from '../core/workspace.js';import {NativeEditorBridge,nativeOperations} from '../integrations/native/bridge.js';import type {NativeClient,NativeResult} from '../integrations/native/transport.js';
import {registerNativeEditorTools} from '../integrations/native/tools.js';import type {McpServer} from '@modelcontextprotocol/server';import sharp from 'sharp';

const id='a'.repeat(32),otherId='b'.repeat(32);
async function fixture(t:test.TestContext,custom?:(name:string,args:Record<string,unknown>,standard:()=>NativeResult)=>Promise<NativeResult>,env:NodeJS.ProcessEnv={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-background-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Test.SC2Map'),'saved source');
 const calls:Array<{name:string;args:Record<string,any>}>=[];let state='QUEUED',closed=0,isClosed=false,active=0,maxActive=0;
 const result=()=>({jobId:id,operation:'search_objects',status:state,automaticRetry:false,...(state==='SUCCEEDED'?{result:{status:'MAP_OBJECTS_FOUND',nativeConfirmed:false,objects:[]}}:{})});
 const client:NativeClient={start:async()=>{isClosed=false;},describe:()=>nativeOperations.map(name=>({name,description:'fixture',inputSchema:{type:'object'}})),info:()=>({connected:!isClosed}),close:async()=>{if(!isClosed){closed++;isClosed=true;}},call:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});active++;maxActive=Math.max(maxActive,active);
  const standard=():NativeResult=>({structuredContent:name==='sc2_submit_job'?{...result(),operation:args.operation}:name.startsWith('sc2_job_')?result():{status:'OK'}});
  try{return custom?await custom(name,args,standard):standard();}finally{active--;}
 }};
 const workspace=new Workspace(root),bridge=new NativeEditorBridge(workspace,{client,env});t.after(()=>bridge.close());
 return{root,workspace,bridge,calls,setState:(s:string)=>{state=s;},counts:()=>({closed,maxActive}),result};
}
async function finished(bridge:NativeEditorBridge,id:string){for(let n=0;n<500;n++){const j=bridge.job(id);if(j.state==='completed'||j.state==='failed')return j;await new Promise(r=>setTimeout(r,5));}throw Error('Fixture job did not finish');}
async function submit(bridge:NativeEditorBridge,operation='search_objects',args:Record<string,unknown>={map:'Test.SC2Map'}){return finished(bridge,(await bridge.call('sc2_submit_job',{operation,arguments:args})).id);}
function jobTool(bridge:NativeEditorBridge){const callbacks=new Map<string,any>();registerNativeEditorTools({registerTool:(name:string,_config:unknown,callback:unknown)=>callbacks.set(name,callback)} as unknown as McpServer,bridge);return callbacks.get('editor.job');}

test('native background paths, outputs, controls and operation envelopes reject before SDK admission',async t=>{
 const f=await fixture(t);
 for(const args of [
  {operation:'unknown',arguments:{}},
  {operation:'search_objects',map:'Test.SC2Map'},
  {operation:'search_objects',arguments:[]},
  {operation:'search_objects',arguments:{map:'../Outside.SC2Map'}},
  {operation:'search_objects',arguments:{map:'Test.SC2Map',output:'outside.png'}},
  {operation:'search_objects',arguments:{map:'Test.SC2Map',overwrite:false}},
  {operation:'search_objects',arguments:{arguments:{map:'Test.SC2Map'}}},
  {operation:'search_objects',arguments:{job_id:id}},
  {operation:'search_objects',timeout_seconds:0},
 ])await assert.rejects(f.bridge.call('sc2_submit_job',args));
 await assert.rejects(f.bridge.call('sc2_job_status',{job_id:id}),/BACKGROUND_JOB_UNKNOWN/);
 await assert.rejects(f.bridge.call('sc2_job_wait',{job_id:id,wait_ms:30001}),/WAIT_RANGE/);
 await assert.rejects(f.bridge.call('sc2_job_cancel',{job_id:'../../other'}),/JOB_ID_INVALID/);
 await assert.rejects(f.bridge.call('sc2_job_status',{job_id:id,map:'Test.SC2Map'}),/CONTROL_ARGUMENTS/);
 assert.equal(f.calls.length,0);
});

test('background input links cannot escape the workspace, including non-archive side inputs',async t=>{
 const f=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-bg-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'Other.SC2Map'),'outside');await fs.writeFile(path.join(outside,'Triggers.xml'),'<TriggerData/>');
 await fs.symlink(path.join(outside,'Other.SC2Map'),path.join(f.root,'Linked.SC2Map'));
 await fs.symlink(path.join(outside,'Triggers.xml'),path.join(f.root,'Linked.xml'));
 await assert.rejects(f.bridge.call('sc2_submit_job',{operation:'search_objects',arguments:{map:'Linked.SC2Map'}}));
 await assert.rejects(f.bridge.call('sc2_submit_job',{operation:'execute',arguments:{template:'Test.SC2Map',triggers_file:'Linked.xml'}}));
 assert.equal(f.calls.length,0);
});

test('submission copies nested inputs, remains pending and does not promote a queued document',async t=>{
 const f=await fixture(t),j=await submit(f.bridge);assert.equal(j.state,'completed');assert.equal(j.result?.outcome,'submitted');assert.equal(j.result?.nativeJob.state,'QUEUED');assert.equal(j.result?.nativeJob.operationSucceeded,false);assert.equal(j.result?.evidenceValidForCurrentInputs,false);assert.equal((await f.bridge.status()).ownedDocument,null);
 const call=f.calls.find(c=>c.name==='sc2_submit_job')!,copy=call.args.arguments.map;assert.notEqual(copy,path.join(f.root,'Test.SC2Map'));assert.ok(copy.startsWith(f.bridge.work+path.sep));assert.equal(await fs.readFile(copy,'utf8'),'saved source');assert.equal(call.args.map,undefined);
 f.setState('RUNNING');await assert.rejects(f.bridge.stop(),/BACKGROUND_JOBS_IN_PROGRESS/);assert.equal(f.counts().closed,0);
 f.setState('SUCCEEDED');const observed=await finished(f.bridge,(await f.bridge.call('sc2_job_wait',{job_id:id,wait_ms:0})).id);assert.equal(observed.state,'completed');assert.equal(observed.result?.nativeJob.terminal,true);assert.equal(observed.result?.evidenceValidForCurrentInputs,true);assert.equal(observed.result?.operationResult.nativeConfirmed,false);assert.equal(observed.result?.nativeGuiImportEligible,undefined);
 const admission=JSON.parse(await fs.readFile(j.report,'utf8'));assert.equal(admission.native.status,'QUEUED','Observation must not overwrite immutable admission evidence');
});

test('native observation runs while a legacy operation is waiting, without queue deadlock',async t=>{
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
 const f=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_read_data'){started();await gate;return{structuredContent:{status:'DATA_READ',complete:true,fields:[]}};}return standard();});
 await submit(f.bridge);f.setState('RUNNING');const slow=await f.bridge.call('sc2_read_data',{map:'Test.SC2Map',catalog:'Unit',object_id:'Marine'});await ready;
 try{const query=await f.bridge.call('sc2_job_status',{job_id:id});const observed=await Promise.race([finished(f.bridge,query.id),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('Control blocked behind native operation')),2000))]);assert.equal(observed.result?.nativeJob.state,'RUNNING');assert.equal(f.bridge.job(slow.id).state,'running');assert.equal(f.counts().maxActive,2);}finally{release();f.setState('SUCCEEDED');await finished(f.bridge,slow.id);}
});

test('a saturated work queue still admits bounded independent status observations',async t=>{
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
 const f=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_read_data'){started();await gate;}return standard();});await submit(f.bridge);f.setState('RUNNING');
 const queued=[];queued.push(await f.bridge.call('sc2_read_data',{map:'Test.SC2Map',catalog:'Unit',object_id:'Marine'}));await ready;
 try{for(let n=1;n<8;n++)queued.push(await f.bridge.call('sc2_read_data',{map:'Test.SC2Map',catalog:'Unit',object_id:'Marine'}));await assert.rejects(f.bridge.call('sc2_read_data',{map:'Test.SC2Map',catalog:'Unit',object_id:'Marine'}),/NATIVE_QUEUE_FULL/);
  const observation=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal(observation.result?.nativeJob.state,'RUNNING');assert.equal(f.bridge.job(queued[0].id).state,'running');
 }finally{release();f.setState('SUCCEEDED');await Promise.all(queued.map(job=>finished(f.bridge,job.id)));}
});

test('current-document jobs preserve call timing and block later ambiguous implicit-document reads',async t=>{
 const f=await fixture(t,async(name,args,standard)=>{const r=standard();if(name.startsWith('sc2_job_'))r.structuredContent!.operation='compile_current';if(name==='sc2_submit_job')assert.equal((args.arguments as any).map,undefined,'Reopening a map would lose the compiled in-memory context');return r;});
 await finished(f.bridge,(await f.bridge.call('sc2_open_document',{map:'Test.SC2Map'})).id);assert.ok((await f.bridge.status()).ownedDocument);
 const j=await submit(f.bridge,'compile_current',{scope:'mapRoot'});assert.equal(j.result?.nativeJob.state,'QUEUED');assert.equal((await f.bridge.status()).ownedDocument,null);
 const read=await finished(f.bridge,(await f.bridge.call('sc2_read_data',{catalog:'Unit',object_id:'Marine'})).id);assert.equal(read.state,'failed');assert.match(read.error??'',/OWNED_DOCUMENT_REQUIRED/);assert.equal(f.calls.filter(c=>c.name==='sc2_read_data').length,0);
 f.setState('SUCCEEDED');await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal((await f.bridge.status()).ownedDocument,null,'A completed background job cannot identify the current document after other queued work');
});

test('changed source and changed private input snapshots invalidate otherwise successful background evidence',async t=>{
 for(const mutateCopy of [false,true]){const f=await fixture(t);await submit(f.bridge);const copy=f.calls[0].args.arguments.map;await fs.appendFile(mutateCopy?copy:path.join(f.root,'Test.SC2Map'),' manual change');f.setState('SUCCEEDED');const j=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal(j.state,'failed');assert.equal(j.result?.nativeJob.state,'SUCCEEDED');assert.equal(j.result?.evidenceValidForCurrentInputs,false);assert.equal(j.result?.sourceUnchanged,mutateCopy);assert.equal(j.result?.inputSnapshotsUnchanged,!mutateCopy);assert.equal(f.calls.filter(c=>c.name==='sc2_submit_job').length,1);}
});

test('an older concurrent observation cannot regress a known terminal job or its terminal report',async t=>{
 let release!:()=>void,started!:()=>void,first=true;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
 const f=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_job_status'&&first){first=false;started();await gate;return{structuredContent:{jobId:id,operation:'search_objects',status:'RUNNING'}};}return standard();});await submit(f.bridge);const old=await f.bridge.call('sc2_job_status',{job_id:id});await ready;
 try{f.setState('SUCCEEDED');const current=await finished(f.bridge,(await f.bridge.call('sc2_job_wait',{job_id:id,wait_ms:0})).id);release();const delayed=await finished(f.bridge,old.id);assert.equal(delayed.result?.nativeJob.observedState,'RUNNING');assert.equal(delayed.result?.nativeJob.state,'SUCCEEDED');assert.equal(delayed.result?.nativeJob.terminalReport,current.report);}finally{release();f.setState('SUCCEEDED');}
});

test('foreign IDs, mismatching native identity and conflicting terminal states never change the admitted binding',async t=>{
 let corrupt=false;const f=await fixture(t,async(name,_args,standard)=>{const r=standard();if(corrupt&&name.startsWith('sc2_job_'))r.structuredContent!.jobId=otherId;return r;});await submit(f.bridge);const other=new NativeEditorBridge(f.workspace);t.after(()=>other.close());await assert.rejects(other.call('sc2_job_status',{job_id:id}),/BACKGROUND_JOB_UNKNOWN/);
 corrupt=true;const bad=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal(bad.state,'failed');assert.match(bad.error??'',/IDENTITY_MISMATCH/);corrupt=false;f.setState('SUCCEEDED');await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);f.setState('FAILED');const conflict=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal(conflict.state,'failed');assert.match(conflict.error??'',/TERMINAL_STATE_CONFLICT/);assert.equal((await f.bridge.status()).nativeJobs[0].state,'SUCCEEDED');
});

test('queued cancellation remains a cancelled operation, and close drains without implicit cancellation',async t=>{
 const f=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_job_cancel')f.setState('CANCELLED');return standard();});await submit(f.bridge);const cancelled=await finished(f.bridge,(await f.bridge.call('sc2_job_cancel',{job_id:id})).id);assert.equal(cancelled.state,'completed');assert.equal(cancelled.result?.nativeJob.state,'CANCELLED');assert.equal(cancelled.result?.nativeJob.operationSucceeded,false);await f.bridge.stop();assert.equal(f.counts().closed,1);
 const draining=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_job_wait')draining.setState('SUCCEEDED');return standard();});await submit(draining.bridge);await draining.bridge.close();assert.equal(draining.calls.filter(c=>c.name==='sc2_job_cancel').length,0);assert.equal(draining.calls.filter(c=>c.name==='sc2_submit_job').length,1);assert.equal(draining.counts().closed,1);
});

test('native terminal error flags preserve job identity, failure results and graceful stop',async t=>{
 for(const state of ['FAILED','CANCELLED','TIMED_OUT','INTERRUPTED']){const f=await fixture(t,async(name,_args,standard)=>{const r=standard();if(name.startsWith('sc2_job_')){r.isError=true;r.structuredContent!.result={status:'FAILED',error:'Original '+state};}return r;});await submit(f.bridge);f.setState(state);
  const observed=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal(observed.state,'completed');assert.equal(observed.result?.nativeJob.state,state);assert.equal(observed.result?.nativeJob.responseError,true);assert.equal(observed.result?.nativeJob.operationSucceeded,false);assert.equal(observed.result?.operationResult.error,'Original '+state);assert.equal(observed.result?.evidenceValidForCurrentInputs,true);assert.equal((await f.bridge.status()).nativeBackgroundAdmissionUncertain,false);await f.bridge.stop();assert.equal(f.counts().closed,1);
 }
});

test('immediately failed admission and shutdown observation accept only complete native job envelopes',async t=>{
 const immediate=await fixture(t,async(_name,_args,standard)=>{const r=standard();r.isError=true;r.structuredContent!.status='FAILED';r.structuredContent!.result={status:'FAILED',error:'Native task failed immediately'};return r;});const admitted=await submit(immediate.bridge);assert.equal(admitted.state,'completed');assert.equal(admitted.result?.nativeJob.state,'FAILED');assert.equal(admitted.result?.operationResult.error,'Native task failed immediately');assert.equal((await immediate.bridge.status()).nativeBackgroundAdmissionUncertain,false);await immediate.bridge.stop();
 const draining=await fixture(t,async(name,_args,standard)=>{const r=standard();if(name==='sc2_job_wait'||name==='sc2_job_status'){r.isError=true;r.structuredContent!.status='FAILED';r.structuredContent!.result={status:'FAILED',error:'Native failed before drain'};}return r;});await submit(draining.bridge);await draining.bridge.close();assert.equal(draining.counts().closed,1);assert.equal(draining.calls.filter(c=>c.name==='sc2_submit_job').length,1);assert.equal(draining.calls.filter(c=>c.name==='sc2_job_cancel').length,0);
});

test('an error response without native job identity cannot certify a terminal operation',async t=>{
 let unconfirmed=true;const f=await fixture(t,async(name,_args,standard)=>name==='sc2_job_status'&&unconfirmed?{isError:true,structuredContent:{status:'FAILED',error:'Unknown control result'}}:standard());await submit(f.bridge);
 const observed=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal(observed.state,'failed');assert.match(observed.error??'',/RESPONSE_UNCONFIRMED/);assert.equal((await f.bridge.status()).nativeJobs[0].state,'QUEUED');unconfirmed=false;f.setState('SUCCEEDED');await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);
});

test('an uncertain submission is not automatically retried, adopted or silently resubmitted',async t=>{
 const f=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_submit_job')throw Error('Transport response lost');return standard();});const first=await submit(f.bridge);assert.equal(first.state,'failed');assert.equal((await f.bridge.status()).nativeBackgroundAdmissionUncertain,true);const second=await submit(f.bridge);assert.equal(second.state,'failed');assert.match(second.error??'',/ADMISSION_UNCERTAIN/);assert.equal(f.calls.filter(c=>c.name==='sc2_submit_job').length,1);assert.equal((await f.bridge.status()).ownedDocument,null);await f.bridge.stop();assert.equal((await f.bridge.status()).nativeBackgroundAdmissionUncertain,false);
});

test('a queued source revision change blocks background admission before the SDK call',async t=>{
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
 const f=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_open_document'){started();await gate;}return standard();});
 const opening=await f.bridge.call('sc2_open_document',{map:'Test.SC2Map'});await ready;
 const queued=await f.bridge.call('sc2_submit_job',{operation:'search_objects',arguments:{map:'Test.SC2Map'}});
 await fs.writeFile(path.join(f.root,'Test.SC2Map'),'new manual revision');release();await finished(f.bridge,opening.id);
 const refused=await finished(f.bridge,queued.id);assert.equal(refused.state,'failed');assert.match(refused.error??'',/SOURCE_CHANGED_WHILE_QUEUED/);assert.equal(f.calls.filter(c=>c.name==='sc2_submit_job').length,0);assert.equal(await fs.readFile(path.join(f.root,'Test.SC2Map'),'utf8'),'new manual revision');
});

test('a current-document Data read cannot certify a source changed during native execution',async t=>{
 const f=await fixture(t,async(name,_args,standard)=>{if(name==='sc2_read_data'){await fs.appendFile(path.join(f.root,'Test.SC2Map'),' edited');return{structuredContent:{status:'DATA_READ',complete:true,fields:[]}};}return standard();});
 await finished(f.bridge,(await f.bridge.call('sc2_open_document',{map:'Test.SC2Map'})).id);
 const read=await finished(f.bridge,(await f.bridge.call('sc2_read_data',{catalog:'Unit',object_id:'Marine'})).id);assert.equal(read.state,'failed');assert.equal(read.result?.sourceUnchanged,false);assert.equal(read.result?.response.extended.complete,true);assert.equal((await f.bridge.status()).ownedDocument,null);
});

test('effective Data, links, resources and native map reports retain bounded pages and full original strings',async t=>{
 const large='original array value '.repeat(600),f=await fixture(t,async()=>({structuredContent:{status:'DATA_READ',complete:true,catalog:'Unit',objectId:'Marine',fields:Array.from({length:120},(_,i)=>({field:'Field'+i,value:i?String(i):large})),relatedObjects:[{catalog:'Effect',id:'GuassRifle'},{catalog:'Weapon',id:'GuassRifle'}],resourceValidationPassed:false,resourceErrors:[{code:'MAIN_MODEL_FILE_MISSING'}],checks:{compile:{nativeCompilePassed:false}}}}));
 for(const method of ['sc2_read_data','sc2_data_links','sc2_check_resources','sc2_check_map'] as const){const j=await finished(f.bridge,(await f.bridge.call(method,method==='sc2_check_map'?{map:'Test.SC2Map'}:{map:'Test.SC2Map',catalog:'Unit',object_id:'Marine'})).id);assert.equal(j.state,'completed');assert.equal(j.result?.response.extended.complete,true);const page=j.result?.response.extended.fieldsPage;assert.equal(page.total,120);assert.equal(page.items.length,8);assert.equal(page.items[0].truncated,true);assert.equal(j.result?.response.extended.resourceValidationPassed,false);assert.ok(Buffer.byteLength(JSON.stringify(j.result))<24000);const full=JSON.parse(await fs.readFile(j.report,'utf8'));assert.equal(full.native.fields[0].value,large);const detail=await f.bridge.details(j.id,'/native/fields/0/value',0,1);assert.ok('truncated' in detail);assert.equal(detail.truncated,true);assert.ok('totalCharacters' in detail);assert.equal(detail.totalCharacters,large.length);}
 const tools=await f.bridge.tools();assert.ok(Array.isArray(tools));assert.equal(tools.length,31);assert.ok(tools.every(t=>t.available));
});

test('full Data audit snapshots the source, retains unknown coverage and bounds findings without truncating private evidence',async t=>{
 const audit={status:'DATA_AUDITED',catalogTraversalComplete:true,referenceAndFileValidationComplete:false,allObservedTypedTargetsPresent:false,validationPassed:null,counts:{objects:50000,fields:7000000,coverageGaps:12},catalogs:Array.from({length:109},(_,i)=>({catalog:i})),findings:Array.from({length:500},(_,i)=>({kind:'unresolved',value:'detail'.repeat(700),i})),objectsArtifact:{id:'opaque-objects'},findingsArtifact:{id:'opaque-findings'},reportArtifact:{id:'opaque-report'}};
 const f=await fixture(t,async(name,_args,standard)=>name.startsWith('sc2_job_')?{structuredContent:{jobId:id,operation:'audit_data',status:'SUCCEEDED',result:audit}}:name==='sc2_audit_data'?{structuredContent:audit}:standard());
 const callbacks=new Map<string,any>();registerNativeEditorTools({registerTool:(name:string,_config:unknown,callback:unknown)=>callbacks.set(name,callback)} as unknown as McpServer,f.bridge);
 const raw=await callbacks.get('editor.data.audit')({archive:'Test.SC2Map',limit:3,deadlineSeconds:14400});assert.equal(raw.isError,undefined);
 const admitted=await finished(f.bridge,JSON.parse(raw.content[0].text).id);assert.equal(admitted.result?.nativeJob.state,'QUEUED');
 const call=f.calls.find(c=>c.name==='sc2_submit_job')!;assert.equal(call.args.operation,'audit_data');assert.equal(call.args.timeout_seconds,14400);assert.equal(call.args.arguments.limit,3);assert.notEqual(call.args.arguments.map,path.join(f.root,'Test.SC2Map'));assert.equal(await fs.readFile(call.args.arguments.map,'utf8'),'saved source');
 const terminal=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id),summary=terminal.result?.operationResult.extended;
 assert.equal(summary.catalogTraversalComplete,true);assert.equal(summary.referenceAndFileValidationComplete,false);assert.equal(summary.validationPassed,null);assert.equal(summary.findingsPage.total,500);assert.equal(summary.findingsPage.items.length,8);assert.equal(summary.catalogsPage.total,109);assert.equal(summary.counts.fields,7000000);assert.ok(Buffer.byteLength(JSON.stringify(terminal.result))<24000);
 const stored=JSON.parse(await fs.readFile(terminal.report,'utf8'));assert.equal(stored.native.result.findings.length,500);assert.equal(stored.native.result.findings[0].value,audit.findings[0].value);assert.equal((await f.bridge.status()).loadedDataDocument,null);
 await fs.appendFile(path.join(f.root,'Test.SC2Map'),' manual change');const stale=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:id})).id);assert.equal(stale.result?.sourceUnchanged,false);assert.equal(stale.result?.evidenceValidForCurrentInputs,false);
});

test('a background PNG is delivered from its submission directory after a separate terminal observation',async t=>{
 let file='';const png=await sharp({create:{width:32,height:32,channels:3,background:'#559944'}}).png().toBuffer();
 const f=await fixture(t,async(name,args,standard)=>{
  if(name==='sc2_submit_job'){file=String((args.arguments as Record<string,unknown>).output);await fs.writeFile(file,png);}
  const result=standard();if(name.startsWith('sc2_job_')){result.structuredContent!.operation='capture_terrain';if(result.structuredContent!.status==='SUCCEEDED')result.structuredContent!.result={status:'OK',preview:{path:file},requestedTerrainFrameVerified:true};}return result;
 });
 const admission=await submit(f.bridge,'capture_terrain');assert.equal(admission.result?.capture,undefined);f.setState('SUCCEEDED');
 const observation=await finished(f.bridge,(await f.bridge.call('sc2_job_wait',{job_id:id,wait_ms:0})).id);
 assert.equal(observation.state,'completed');assert.equal(observation.result?.capture.artifactOwnershipVerified,true);assert.notEqual(path.dirname(admission.report),path.dirname(observation.report));assert.equal(path.dirname(file),path.dirname(admission.report));
 const reply=await jobTool(f.bridge)({jobId:observation.id,includeImage:true});assert.equal(reply.isError,undefined);const frame=reply.content.find((c:any)=>c.type==='image');assert.ok(frame);assert.deepEqual(Buffer.from(frame.data,'base64'),png);
 assert.equal(JSON.parse(await fs.readFile(admission.report,'utf8')).native.status,'QUEUED');
});

test('a shared external work root never authorizes another worker image in direct or background results',async t=>{
 const external=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-bg-images-'));t.after(()=>fs.rm(external,{recursive:true,force:true}));
 const foreign=path.join(external,'w',otherId,'Foreign.png');await fs.mkdir(path.dirname(foreign),{recursive:true});await sharp({create:{width:32,height:32,channels:3,background:'#664433'}}).png().toFile(foreign);
 const result={status:'OK',preview:{path:foreign},requestedTerrainFrameVerified:true};
 const f=await fixture(t,async(name,_args,standard)=>name==='sc2_submit_job'?{structuredContent:{jobId:id,operation:'capture_terrain',status:'SUCCEEDED',result}}:{...standard(),structuredContent:result},{SC2_NATIVE_WORK_ROOT:external});
 const direct=await finished(f.bridge,(await f.bridge.call('sc2_capture_terrain',{map:'Test.SC2Map'})).id);
 const capture=await finished(f.bridge,(await f.bridge.capture({archive:'Test.SC2Map',mode:'viewport',size:512,deadlineSeconds:1200})).id);
 const background=await submit(f.bridge,'capture_terrain');
 for(const job of [direct,capture,background]){assert.equal(job.state,'failed');assert.equal(job.result?.capture.artifactOwnershipVerified,false);const reply=await jobTool(f.bridge)({jobId:job.id,includeImage:true});assert.ok(reply.content.every((c:any)=>c.type!=='image'));await assert.rejects(async()=>f.bridge.readCaptureArtifact(job.id),/ARTIFACT_UNCONFIRMED/);}
 assert.equal(background.result?.evidenceValidForCurrentInputs,false);assert.equal((await f.bridge.status()).ownedDocument,null);
});

test('native PNG delivery accepts the exact owned SDK worker and rechecks file size at read time',async t=>{
 let file='';const png=await sharp({create:{width:32,height:32,channels:3,background:'#887744'}}).png().toBuffer();
 const f=await fixture(t,async()=>({structuredContent:{status:'OK',preview:{path:file}}}));file=path.join(f.bridge.configuration().workerDirectory,'frames','Native.png');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,png);
 const capture=await finished(f.bridge,(await f.bridge.call('sc2_capture_terrain',{map:'Test.SC2Map'})).id);assert.equal(capture.state,'completed');assert.deepEqual(await f.bridge.readCaptureArtifact(capture.id),png);
 await fs.writeFile(file,Buffer.alloc(6*1024*1024+1));const reply=await jobTool(f.bridge)({jobId:capture.id,includeImage:true});assert.equal(reply.isError,true);assert.ok(reply.content.every((c:any)=>c.type!=='image'));assert.match(reply.content[0].text,/SIZE_LIMIT/);
});
