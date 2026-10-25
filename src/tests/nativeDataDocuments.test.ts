import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {NativeEditorBridge} from '../integrations/native/bridge.js';
import type {NativeClient,NativeResult} from '../integrations/native/transport.js';

const hash=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
type Hook=(name:string,args:Record<string,unknown>,value:Record<string,any>)=>Promise<NativeResult|undefined>|NativeResult|undefined;
async function fixture(t:test.TestContext,hook?:Hook){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-data-documents-'));
 await fs.writeFile(path.join(root,'Test.SC2Map'),'source45');
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 let loadedHash='',reads=0;
 const client:NativeClient={start:async()=>{},close:async()=>{},info:()=>({connected:true}),call:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  let value:Record<string,any>={status:'OK'};
  if(['sc2_read_data','sc2_data_links','sc2_check_resources'].includes(name)){
   if(args.map??args.template)loadedHash=hash(await fs.readFile(String(args.map??args.template)));
   reads++;
   value={status:name==='sc2_read_data'?'NATIVE_DATA_READ':name==='sc2_data_links'?'NATIVE_DATA_LINKS_READ':'NATIVE_MAIN_MODEL_FILE_CHECK_PASSED',complete:true,catalog:args.catalog,objectId:args.object_id,sourceSha256:loadedHash,mapRevision:loadedHash,sourceUnchanged:true,
    fields:[{field:'NativeObservation',values:[String(reads)]},{field:'CUnit_LifeMax',values:[loadedHash===hash('source73')?'73':'45']}],resourceValidationPassed:true};
  }
  return await hook?.(name,args,value)??{structuredContent:value};
 }};
 const bridge=new NativeEditorBridge(new Workspace(root),{client,env:{}});
 t.after(async()=>{await bridge.close();await fs.rm(root,{recursive:true,force:true});});
 return{root,bridge,calls};
}
async function finished(bridge:NativeEditorBridge,id:string){for(let n=0;n<600;n++){const job=bridge.job(id);if(['completed','failed'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}throw Error('Native fixture timed out');}
const read={map:'Test.SC2Map',catalog:'Unit',object_id:'Marine'};

test('same-source Data inspection reuses only the loaded document and makes a fresh native call per page/catalog',async t=>{
 const f=await fixture(t);
 const first=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 const firstInput=String(f.calls[0].args.map);assert.notEqual(firstInput,path.join(f.root,'Test.SC2Map'));
 assert.equal(first.result?.documentReuse.reusedLoadedDocument,false);
 for(const[method,args]of [['sc2_read_data',{...read,field_offset:1}],['sc2_data_links',read],['sc2_check_resources',{...read,catalog:'Model'}]] as const){
  const job=await finished(f.bridge,(await f.bridge.call(method,args)).id);
  assert.equal(job.state,'completed');assert.equal(job.result?.documentReuse.reusedLoadedDocument,true);
  assert.equal(job.result?.documentReuse.omittedExplicitSource,true);assert.equal(job.result?.documentReuse.nativeSourceMatched,true);assert.equal(job.result?.documentReuse.snapshotUnchanged,true);assert.equal(job.result?.documentReuse.fieldResultsCached,false);
  assert.equal(f.calls.at(-1)?.args.map,undefined);
 }
 assert.equal(f.calls.length,4);
 const firstRaw=JSON.parse(await fs.readFile(first.report,'utf8'));
 assert.equal(firstRaw.native.fields[0].values[0],'1');
 const implicit=await finished(f.bridge,(await f.bridge.call('sc2_read_data',{catalog:'Unit',object_id:'Marine'})).id),raw=JSON.parse(await fs.readFile(implicit.report,'utf8'));
 assert.equal(raw.native.fields[0].values[0],'5','Every inspection reaches native UI; fields are not served from an earlier result');
 assert.equal(implicit.result?.documentReuse.loadedByJob,first.id);
 assert.equal((await f.bridge.status()).loadedDataDocument?.sourceSha256,hash('source45'));
});

test('source content or source pathname changes require a new private open',async t=>{
 const f=await fixture(t);await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 await fs.writeFile(path.join(f.root,'Test.SC2Map'),'source73');
 const changed=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 assert.equal(changed.result?.documentReuse.reusedLoadedDocument,false);assert.ok(f.calls.at(-1)?.args.map);
 const raw=JSON.parse(await fs.readFile(changed.report,'utf8'));assert.deepEqual(raw.native.fields.find((v:any)=>v.field==='CUnit_LifeMax').values,['73']);
 await fs.writeFile(path.join(f.root,'Other.SC2Map'),'source73');
 const other=await finished(f.bridge,(await f.bridge.call('sc2_read_data',{...read,map:'Other.SC2Map'})).id);
 assert.equal(other.result?.documentReuse.reusedLoadedDocument,false);assert.ok(f.calls.at(-1)?.args.map);
});

test('an edited loaded snapshot refuses reuse before native execution and is not silently reopened',async t=>{
 const f=await fixture(t);await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 await fs.appendFile(String(f.calls[0].args.map),'edited private copy');
 const count=f.calls.length,job=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 assert.equal(job.state,'failed');assert.match(job.error??'',/NATIVE_DATA_SNAPSHOT_CHANGED/);assert.equal(f.calls.length,count);assert.equal((await f.bridge.status()).loadedDataDocument,null);assert.equal((await f.bridge.status()).ownedDocument,null);
});

test('a removed loaded snapshot clears document ownership before another native call',async t=>{
 const f=await fixture(t);await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 await fs.unlink(String(f.calls[0].args.map));const count=f.calls.length;
 const job=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 assert.equal(job.state,'failed');assert.match(job.error??'',/NATIVE_DATA_SNAPSHOT_CHANGED/);assert.equal(f.calls.length,count);assert.equal((await f.bridge.status()).ownedDocument,null);
});

test('a reused read with a wrong native source revision fails without automatic replay or stale fields',async t=>{
 let mismatch=false;const f=await fixture(t,async(name,_args,value)=>name==='sc2_read_data'&&mismatch?{structuredContent:{...value,sourceSha256:hash('wrong'),mapRevision:hash('wrong')}}:undefined);
 await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);mismatch=true;
 const job=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 assert.equal(job.state,'failed');assert.equal(job.result?.documentReuse.nativeSourceMatched,false);assert.equal(job.result?.documentReuse.issue,'NATIVE_DATA_SOURCE_IDENTITY_UNCONFIRMED');assert.equal(job.result?.sourceUnchanged,true);assert.equal(f.calls.length,2);assert.equal((await f.bridge.status()).loadedDataDocument,null);
});

test('known failure discards the loaded Data document and requires an explicit next source',async t=>{
 let fail=false;const f=await fixture(t,async(name,_args,value)=>name==='sc2_read_data'&&fail?{isError:true,structuredContent:{...value,status:'FAILED',error:'Original Data XML did not confirm the exact selected catalog/ID'}}:undefined);
 await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);fail=true;
 const bad=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);assert.equal(bad.state,'failed');assert.equal((await f.bridge.status()).loadedDataDocument,null);
 const calls=f.calls.length,implicit=await finished(f.bridge,(await f.bridge.call('sc2_read_data',{catalog:'Unit',object_id:'Marine'})).id);
 assert.equal(implicit.state,'failed');assert.match(implicit.error??'',/OWNED_DOCUMENT_REQUIRED/);assert.equal(f.calls.length,calls);
});

test('other native operations and Data request options cannot reuse a previous document proof',async t=>{
 const f=await fixture(t);await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);
 await finished(f.bridge,(await f.bridge.call('sc2_compile_all',{})).id);
 assert.equal((await f.bridge.status()).loadedDataDocument,null);
 const reopened=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);assert.equal(reopened.result?.documentReuse.reusedLoadedDocument,false);
 const configured=await finished(f.bridge,(await f.bridge.call('sc2_read_data',{...read,render_backend:'auto'})).id);
 assert.equal(configured.result?.documentReuse,undefined);assert.ok(f.calls.at(-1)?.args.map);assert.equal(f.calls.at(-1)?.args.render_backend,'auto');assert.equal((await f.bridge.status()).loadedDataDocument,null);
 const after=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);assert.equal(after.result?.documentReuse.reusedLoadedDocument,false);
 await f.bridge.stop();assert.equal((await f.bridge.status()).loadedDataDocument,null);
});

test('incomplete serialization or an unconfirmed native revision never creates a reuse proof',async t=>{
 let uncertain=true;const f=await fixture(t,async(name,_args,value)=>name==='sc2_read_data'&&uncertain?{structuredContent:{...value,complete:false,mapRevision:undefined}}:undefined);
 await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);assert.equal((await f.bridge.status()).loadedDataDocument,null);uncertain=false;
 const next=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);assert.equal(next.result?.documentReuse.reusedLoadedDocument,false);assert.ok(f.calls.at(-1)?.args.map);
});

test('interleaved native job observation cannot reinstall an invalidated Data document proof',async t=>{
 const nativeId='a'.repeat(32);let hold=false,release!:()=>void,entered!:()=>void;
 const enteredPromise=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const f=await fixture(t,async(name,_args,value)=>{
  if(name==='sc2_submit_job'||name==='sc2_job_status')return{structuredContent:{jobId:nativeId,operation:'search_objects',status:'SUCCEEDED',result:{status:'MAP_OBJECTS_FOUND'}}};
  if(name==='sc2_read_data'&&hold){entered();await gate;}return{structuredContent:value};
 });
 await finished(f.bridge,(await f.bridge.call('sc2_submit_job',{operation:'search_objects',arguments:{map:'Test.SC2Map'}})).id);
 await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);hold=true;
 const second=await f.bridge.call('sc2_read_data',read);await enteredPromise;
 const control=await finished(f.bridge,(await f.bridge.call('sc2_job_status',{job_id:nativeId})).id);assert.equal(control.state,'completed');release();
 assert.equal((await finished(f.bridge,second.id)).state,'completed');assert.equal((await f.bridge.status()).loadedDataDocument,null);hold=false;
 const third=await finished(f.bridge,(await f.bridge.call('sc2_read_data',read)).id);assert.equal(third.result?.documentReuse.reusedLoadedDocument,false);assert.ok(f.calls.at(-1)?.args.map);
});
