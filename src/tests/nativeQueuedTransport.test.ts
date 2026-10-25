import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';
import {NativeStdioClient} from '../integrations/native/transport.js';import {nativeRelease} from '../integrations/native/release.js';import {nativeJobOperations,nativeQueuedMethods} from '../integrations/native/background.js';

async function fixture(t:test.TestContext){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-queued-transport-'));
 const source=`const readline=require('node:readline'),jobs=new Map(),calls=[];let sequence=0,tail=Promise.resolve();
 const names=${JSON.stringify([...Object.keys(nativeQueuedMethods),'sc2_modules','sc2_submit_job','sc2_job_status','sc2_job_wait','sc2_job_cancel'])};
 const respond=(r,result,error)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,...(error?{error}:{result})})+'\\n');
 const native=v=>({structuredContent:v,content:[{type:'text',text:JSON.stringify(v)}],...(v.status==='FAILED'?{isError:true}:{})});
 async function handle(r){
  if(!('id'in r))return;if(r.method==='initialize')return respond(r,{serverInfo:{name:'sc2-native-toolkit',version:${JSON.stringify(nativeRelease.version)}}});
  if(r.method==='tools/list')return respond(r,{tools:names.map(name=>({name,inputSchema:{type:'object'}}))});
  const name=r.params.name,args=r.params.arguments;calls.push({name,args});
  if(name==='sc2_modules')return respond(r,native({calls}));
  if(name==='sc2_submit_job'){
   if(args.arguments.scenario==='lost_submission')return respond(r,null,{code:-32000,message:'Response lost after admission'});
   if(args.arguments.scenario==='refused_submission')return respond(r,native({status:'FAILED',error:'Queue admission refused'}));
   if(args.arguments.scenario==='admission_failed')return respond(r,native({jobId:'e'.repeat(32),operation:args.operation,status:'FAILED',result:{status:'FAILED',error:'Known failure at admission'}}));
   const jobId=(++sequence).toString(16).padStart(32,'0'),job={jobId,operation:args.operation,status:'QUEUED',input:args.arguments,ready:Date.now()+(args.arguments.delay??150)};jobs.set(jobId,job);return respond(r,native({jobId,operation:job.operation,status:'QUEUED'}));
  }
  const job=jobs.get(args.job_id);if(!job)return respond(r,native({status:'FAILED',error:'Unknown job'}));
  if(name==='sc2_job_wait')await new Promise(resolve=>setTimeout(resolve,Math.min(args.wait_ms,50)));
  if(job.input.scenario==='observation_error')return respond(r,native({status:'FAILED',error:'Unconfirmed observation without job identity'}));
  const status=Date.now()>=job.ready?(job.input.scenario==='native_failed'?'FAILED':'SUCCEEDED'):'RUNNING';
  const value={jobId:job.input.scenario==='wrong_identity'?'f'.repeat(32):job.jobId,operation:job.operation,status};
  if(status==='SUCCEEDED'&&job.input.scenario!=='missing_result')value.result={status:job.input.scenario==='incomplete'?'NOT_CONFIRMED':'NATIVE_DATA_READ',nativeConfirmed:job.input.scenario!=='incomplete',complete:job.input.scenario!=='incomplete',fields:[{field:'CUnit_LifeMax',values:['45']}],originalArguments:job.input};
  if(status==='FAILED')value.result={status:'FAILED',nativeCompilePassed:false,error:'Original compile failure'};
  return respond(r,native(value));
 }
 readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);tail=tail.then(()=>handle(r));});`;
 const file=path.join(root,'frontend.cjs');await fs.writeFile(file,source);const client=new NativeStdioClient(process.execPath,[file],root);t.after(async()=>{await client.close();await fs.rm(root,{recursive:true,force:true});});return client;
}

test('all synchronous SDK work has an explicit matching native queued operation',()=>{
 assert.equal(Object.keys(nativeQueuedMethods).length,26);assert.deepEqual(new Set(Object.values(nativeQueuedMethods)),new Set(nativeJobOperations));
 assert.equal(nativeQueuedMethods.sc2_convert_xml,'execute');assert.equal(nativeQueuedMethods.sc2_compile_all,'compile_current');assert.equal(nativeQueuedMethods.sc2_check_map,'check_document');assert.equal(nativeQueuedMethods.sc2_audit_data,'audit_data');
});

test('queued transport preserves results and lets control pass a sequential legacy stdio handler',async t=>{
 const client=await fixture(t);await client.start();const admitted=await client.call('sc2_submit_job',{operation:'search_objects',arguments:{}});let complete=false;
 const input={map:'private/Input.SC2Map',catalog:'Unit',object_id:'Marine',delay:600},slow=client.call('sc2_read_data',input).then(v=>{complete=true;return v;});
 try{await new Promise(r=>setTimeout(r,50));const status=await client.call('sc2_job_status',{job_id:admitted.structuredContent!.jobId});assert.equal(status.isError,undefined);assert.equal(complete,false,'Status must pass before the long operation returns');await assert.rejects(client.close(),/REQUEST_IN_PROGRESS/);
  const result=await slow;assert.equal(result.isError,false);assert.deepEqual(result.structuredContent!.fields[0].values,['45']);assert.deepEqual(result.structuredContent!.originalArguments,input);assert.equal(result.structuredContent!.transportJob.operation,'read_data');assert.equal(result.structuredContent!.transportJob.state,'SUCCEEDED');
  const calls=(await client.call('sc2_modules',{})).structuredContent!.calls;assert.equal(calls.filter((c:any)=>c.name==='sc2_submit_job').length,2);assert.equal(calls.filter((c:any)=>c.name==='sc2_read_data').length,0);assert.ok(calls.filter((c:any)=>c.name==='sc2_job_wait').every((c:any)=>c.args.wait_ms===500));
 }finally{await slow;}
});

test('queued completion keeps explicit native failures and incomplete confirmations distinct',async t=>{
 const client=await fixture(t);const incomplete=await client.call('sc2_read_data',{scenario:'incomplete'});assert.equal(incomplete.isError,false);assert.equal(incomplete.structuredContent!.nativeConfirmed,false);assert.equal(incomplete.structuredContent!.complete,false);
 const failed=await client.call('sc2_compile_all',{scenario:'native_failed'});assert.equal(failed.isError,true);assert.equal(failed.structuredContent!.error,'Original compile failure');assert.equal(failed.structuredContent!.nativeCompilePassed,false);assert.equal(failed.structuredContent!.transportJob.state,'FAILED');assert.equal(client.info().queueRecoveryRequired,false);
 assert.equal(failed.structuredContent!.transportJob.responseError,true);assert.equal((await client.call('sc2_read_data',{})).structuredContent!.complete,true,'A confirmed operation failure is not an uncertain transport admission');
 assert.equal(failed.nativeJobReport!.status,'FAILED');assert.equal(failed.nativeJobReport!.result.error,'Original compile failure');
});

test('an immediate terminal error envelope is unwrapped, while an explicit admission refusal stays a refusal',async t=>{
 const client=await fixture(t),failed=await client.call('sc2_read_data',{scenario:'admission_failed'});assert.equal(failed.isError,true);assert.equal(failed.structuredContent!.error,'Known failure at admission');assert.equal(failed.structuredContent!.transportJob.state,'FAILED');assert.equal(client.info().queueRecoveryRequired,false);
 const refused=await client.call('sc2_read_data',{scenario:'refused_submission'});assert.equal(refused.isError,true);assert.equal(refused.structuredContent!.error,'Queue admission refused');assert.equal(refused.structuredContent!.transportJob,undefined);assert.equal(client.info().queueRecoveryRequired,false);
});

test('lost admissions and unconfirmed native results block further work without replay until explicit close',async t=>{
 for(const scenario of ['lost_submission','wrong_identity','missing_result','observation_error']){const client=await fixture(t);await assert.rejects(client.call('sc2_read_data',{scenario}));assert.equal(client.info().queueRecoveryRequired,true);await assert.rejects(client.call('sc2_read_data',{}),/RECOVERY_REQUIRED/);await assert.rejects(client.call('sc2_submit_job',{operation:'read_data',arguments:{}}),/RECOVERY_REQUIRED/);
  const calls=(await client.call('sc2_modules',{})).structuredContent!.calls;assert.equal(calls.filter((c:any)=>c.name==='sc2_submit_job').length,1);await client.close();assert.equal(client.info().queueRecoveryRequired,false);assert.equal((await client.call('sc2_read_data',{})).structuredContent!.complete,true);
 }
});
