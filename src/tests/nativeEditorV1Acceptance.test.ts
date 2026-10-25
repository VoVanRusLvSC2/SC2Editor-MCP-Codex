import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {NativeEditorBridge} from '../integrations/native/bridge.js';
import type {NativeClient} from '../integrations/native/transport.js';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const id='b'.repeat(32);
async function finished(bridge:NativeEditorBridge,id:string){for(let n=0;n<600;n++){const job=bridge.job(id);if(['completed','failed'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}throw Error('Fixture timeout');}
async function fixture(t:test.TestContext,hook?:NativeClient['call']){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'editor-v1-acceptance-'));await fs.writeFile(path.join(root,'Map.SC2Map'),'saved source');
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];let loadedHash='',operation='',sequence=0,nativeId='';
 const client:NativeClient={start:async()=>{},close:async()=>{},info:()=>({connected:true}),call:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});if(hook)return hook(name,args);
  if(name==='sc2_read_data'){
   if(args.map)loadedHash=hash(await fs.readFile(String(args.map)));
   return{structuredContent:{outcome:'completed',status:'NATIVE_DATA_READ',complete:true,catalog:args.catalog,objectId:args.object_id,sourceSha256:loadedHash,mapRevision:loadedHash,sourceUnchanged:true,fields:[{field:'FreshRead',values:[String(calls.length)]}]}};
  }
  if(name==='sc2_submit_job'){operation=String(args.operation);nativeId=(++sequence).toString(16).padStart(32,'0');return{structuredContent:{jobId:nativeId,operation,status:'RUNNING'}};}
  if(name==='sc2_job_status'||name==='sc2_job_wait')return{structuredContent:{jobId:nativeId,operation,status:'SUCCEEDED',result:{status:'OK',outcome:'completed'}}};
  if(name==='sc2_job_cancel')return{structuredContent:{jobId:nativeId,operation,status:'CANCELLED',result:{outcome:'cancelled'}}};
  return{structuredContent:{status:'OK',outcome:'completed'}};
 }};
 const bridge=new NativeEditorBridge(new Workspace(root),{client,env:{}});t.after(async()=>{await bridge.close();await fs.rm(root,{recursive:true,force:true});});return{bridge,calls,root};
}
const requests=[['sc2_doctor',{}],['sc2_query_audit',{report_id:id}],['sc2_find_object_uses',{report_id:id,target_catalog:'Unit',target_id:'Marine'}],['sc2_compare_audits',{before_report_id:id,after_report_id:id}]] as const;

test('all four document-free direct calls preserve an existing verified Data document and fresh native reads',async t=>{
 const f=await fixture(t),read={map:'Map.SC2Map',catalog:'Unit',object_id:'Marine'};
 const original=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 const proof=(await f.bridge.status()).loadedDataDocument;
 for(const[method,args]of requests){
  assert.equal((await finished(f.bridge,(await f.bridge.call(method,args)).id)).result?.outcome,'completed');
  assert.deepEqual((await f.bridge.status()).loadedDataDocument,proof);
  const reread=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
  assert.equal(reread.result?.documentReuse.reusedLoadedDocument,true);assert.equal(reread.result?.documentReuse.loadedByJob,original.id);assert.equal(f.calls.at(-1)?.args.map,undefined);
 }
 assert.equal(f.calls.filter(c=>c.name==='sc2_read_data').length,5);
});

test('polled document-free queued calls preserve Data proof while native field reads stay uncached',async t=>{
 const f=await fixture(t),read={map:'Map.SC2Map',catalog:'Unit',object_id:'Marine'};
 for(const[method,args]of requests){
  await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);const proof=(await f.bridge.status()).loadedDataDocument;
  const submitted=await finished(f.bridge,(await f.bridge.call('sc2_submit_job',{operation:method.slice(4),arguments:args})).id);
  assert.equal(submitted.result?.nativeJob.terminal,false);
  for(const control of ['sc2_job_status','sc2_job_wait'] as const){
   const polled=await finished(f.bridge,(await f.bridge.call(control,{job_id:submitted.result!.nativeJob.id,...control==='sc2_job_wait'?{wait_ms:1}:{}})).id);
   assert.equal(polled.result?.nativeJob.operationSucceeded,true);assert.deepEqual((await f.bridge.status()).loadedDataDocument,proof);
  }
  const reread=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);assert.equal(reread.result?.documentReuse.reusedLoadedDocument,true);assert.equal(f.calls.at(-1)?.args.map,undefined);
 }
});

test('cancel still invalidates a warm Data proof for a document-free native job',async t=>{
 const f=await fixture(t);await finished(f.bridge,(await f.bridge.call('sc2_read_data',{map:'Map.SC2Map',catalog:'Unit',object_id:'Marine'})).id);
 assert.ok((await f.bridge.status()).loadedDataDocument);
 const submitted=await finished(f.bridge,(await f.bridge.call('sc2_submit_job',{operation:'doctor',arguments:{}})).id);
 await finished(f.bridge,(await f.bridge.call('sc2_job_cancel',{job_id:submitted.result!.nativeJob.id})).id);
 assert.equal((await f.bridge.status()).loadedDataDocument,null);
});

test('document-free polling cannot authorize an implicit Data read after its source changes',async t=>{
 const f=await fixture(t);await finished(f.bridge,(await f.bridge.call('sc2_read_data',{map:'Map.SC2Map',catalog:'Unit',object_id:'Marine'})).id);
 const submitted=await finished(f.bridge,(await f.bridge.call('sc2_submit_job',{operation:'doctor',arguments:{}})).id);
 await fs.writeFile(path.join(f.root,'Map.SC2Map'),'changed saved source');
 await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:submitted.result!.nativeJob.id})).id);
 const calls=f.calls.length,read=await finished(f.bridge,(await f.bridge.call('sc2_read_data',{catalog:'Unit',object_id:'Marine'})).id);
 assert.equal(read.state,'failed');assert.match(read.error??'',/OWNED_SOURCE_CHANGED/);assert.equal(f.calls.length,calls);assert.equal((await f.bridge.status()).ownedDocument,null);assert.equal((await f.bridge.status()).loadedDataDocument,null);
});

for(const[wrapper,flags,expected]of [
 ['check',{outcome:'failed'},'failed'],['check',{outcome:'incomplete'},'incomplete'],['check',{outcome:'completed',validationPassed:null},'incomplete'],['check',{outcome:'completed',nativeConfirmed:false},'incomplete'],['check',{outcome:'completed',validationPassed:false},'failed'],
 ['capture',{outcome:'failed'},'failed'],['capture',{outcome:'incomplete'},'incomplete'],['capture',{outcome:'completed',validationPassed:null},'incomplete'],['capture',{outcome:'completed',nativeConfirmed:false},'incomplete'],['capture',{outcome:'completed',validationPassed:false},'failed'],
] as const)test(`dedicated ${wrapper} preserves ${JSON.stringify(flags)} and discards uncertain ownership`,async t=>{
 const f=await fixture(t,async()=>({structuredContent:{status:'OK',nativeValidationPassed:true,nativeCompilePassed:true,...flags}}));
 const request=wrapper==='check'?await f.bridge.check({archive:'Map.SC2Map',checks:['load'],includeDiffs:false,deadlineSeconds:1200}):await f.bridge.capture({archive:'Map.SC2Map',mode:'viewport',size:512,deadlineSeconds:1200});
 const job=await finished(f.bridge,request.id);assert.equal(job.result?.outcome,expected);assert.equal(job.state,expected==='failed'?'failed':'completed');assert.equal((await f.bridge.status()).ownedDocument,null);assert.equal(f.calls.length,1);
});
