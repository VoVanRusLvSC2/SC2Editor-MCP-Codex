import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import * as z from 'zod/v4';
import {Workspace} from '../core/workspace.js';
import {NativeEditorBridge,nativeOperations} from '../integrations/native/bridge.js';
import {NativeStdioClient,type NativeClient} from '../integrations/native/transport.js';
import {nativeArgumentSchemas,parseNativeArguments} from '../integrations/native/contracts.js';
import {nativeQueuedMethods,nativeJobOperations,nativeExtendedSummary} from '../integrations/native/background.js';
import {nativeRelease} from '../integrations/native/release.js';
const upstream=JSON.parse(readFileSync(path.resolve('src/tests/fixtures/native-editor-v1.1-contract.json'),'utf8'));
const id='a'.repeat(32);
async function finished(bridge:NativeEditorBridge,id:string){for(let i=0;i<500;i++){const j=bridge.job(id);if(['completed','failed'].includes(j.state))return j;await new Promise(r=>setTimeout(r,5));}throw Error('Fixture timeout');}
async function fixture(t:test.TestContext,call:NativeClient['call']){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'editor-v1-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const client:NativeClient={start:async()=>{},close:async()=>{},info:()=>({connected:true}),describe:()=>upstream.tools,call:async(name,args)=>{calls.push({name,args});return call(name,args);}};
 const bridge=new NativeEditorBridge(new Workspace(root),{client,env:{}});t.after(()=>bridge.close());return{root,bridge,calls};
}
test('release1.1 RC pin uses the exact published archive and actual BUILD metadata layout',async()=>{
 const pin=JSON.parse(readFileSync(path.resolve('native-toolkit-release.json'),'utf8'));
 assert.equal(pin.version,'1.1.0-rc.1');assert.equal(pin.nativeProtocol,16);assert.equal(pin.archiveSha256,'5e93bb7c1d92e4b69823478c7ccc1afc2470ec2cbf9ad98bafcafeecbbd5c055');assert.equal(pin.buildMetadata,'BUILD.json');
 const {nativeReleaseAssets,nativeBuildMetadata}=await import(pathToFileURL(path.resolve('scripts/native-release-assets.mjs')).href);
 assert.equal(nativeReleaseAssets(pin).name,'SC2EditorToolkit-v1.1.0-rc.1-win64.zip');assert.equal(nativeBuildMetadata(pin,{version:'1.1.0-rc.1',nativeProtocol:16,sourceCommit:'d06739cb75a3e89bbdcaf072fcccaade01e25850'}).sourceCommit,'d06739cb75a3e89bbdcaf072fcccaade01e25850');
 assert.throws(()=>nativeBuildMetadata(pin,{version:'1.0.0',nativeProtocol:15}));
});
test('all31 public v1 method fields and requirements match independent tagged upstream schemas',()=>{
 assert.equal(upstream.tools.length,31);assert.deepEqual(new Set(nativeOperations),new Set(upstream.tools.map((t:any)=>t.name)));assert.equal(nativeJobOperations.length,26);
 for(const tool of upstream.tools){const generated=z.toJSONSchema(nativeArgumentSchemas[tool.name]);assert.equal(generated.additionalProperties,false);assert.deepEqual(Object.keys(generated.properties!).sort(),Object.keys(tool.inputSchema.properties).sort(),tool.name);assert.deepEqual([...(generated.required??[])].sort(),[...tool.inputSchema.required].sort(),tool.name);}
 assert.deepEqual(new Set(Object.values(nativeQueuedMethods)),new Set(nativeJobOperations));
});
test('every advertised property rejects wrong JSON types and out-of-contract numeric or enum values',()=>{
 const requiredValue=(key:string,definition:any):unknown=>key==='operation'?'doctor':key.endsWith('report_id')?id:definition.type==='object'?{left:0,bottom:0,right:4,top:4}:definition.type==='string'?'value':definition.type==='integer'?1:{};
 for(const tool of upstream.tools){
  const properties=tool.inputSchema.properties,base=Object.fromEntries(tool.inputSchema.required.map((key:string)=>[key,requiredValue(key,properties[key])]));
  assert.doesNotThrow(()=>parseNativeArguments(tool.name,base),tool.name);
  for(const[key,definition]of Object.entries(properties) as Array<[string,any]>){
   const wrong=definition.type==='string'?23:definition.type==='object'?[]:definition.type==='array'?{}:'not-a-number-or-boolean';
   assert.throws(()=>parseNativeArguments(tool.name,{...base,[key]:wrong}),tool.name+'.'+key);
   if(definition.enum)assert.throws(()=>parseNativeArguments(tool.name,{...base,[key]:definition.type==='integer'?-1:'__unsupported__'}));
   if(definition.maximum!==undefined)assert.throws(()=>parseNativeArguments(tool.name,{...base,[key]:definition.maximum+1}));
   if(definition.minimum!==undefined)assert.throws(()=>parseNativeArguments(tool.name,{...base,[key]:definition.minimum-1}));
  }
 }
});
test('v1 rejects unsupported, malformed and ambiguous direct or nested arguments before admission',()=>{
 for(const [method,args]of [
 ['sc2_doctor',{map:'a.SC2Map'}],['sc2_query_audit',{report_id:id,offset:10000001}],['sc2_find_object_uses',{report_id:id,target_catalog:'Unit'}],['sc2_compare_audits',{before_report_id:id,after_report_id:'short'}],
 ['sc2_read_data',{catalog:'Unit',object_id:'Marine',triggers_xml:'<x/>'}],['sc2_export_map_image',{include_units:'false'}],['sc2_capture_map_region',{bounds:{left:0,bottom:0,right:Infinity,top:10}}],['sc2_convert_xml',{template:'a.SC2Map',triggers_xml:'<x/>',triggers_file:'Triggers'}],
 ['sc2_submit_job',{operation:'query_audit',arguments:{report_id:id,extra:true}}],['sc2_submit_job',{operation:'doctor',arguments:[],timeout_seconds:1}],['sc2_submit_job',{operation:'open_document',arguments:{}}],
 ] as Array<[string,Record<string,unknown>]>)assert.throws(()=>parseNativeArguments(method,args),method);
 assert.deepEqual(parseNativeArguments('sc2_query_audit',{report_id:id,offset:10000000,limit:500}),{report_id:id,offset:10000000,limit:500});
});
test('doctor and stored audit queries require no owned document and preserve full query metadata',async t=>{
 const f=await fixture(t,async(name)=>({structuredContent:{outcome:'completed',status:'OK',editorStarted:false,graphicsReady:null,reportId:id,projectRevisionComplete:false,sameEditorAdapter:true,sameProjectRevision:false,before:{reportId:id,mapRevision:'old'},after:{reportId:id,mapRevision:'new'},totalChanges:510,fullObservations:{objects:{id:'object-artifact'}},payloadOmitted:true,total:510,offset:500,nextOffset:null,items:[{catalog:'Unit',objectId:'Marine',payloadOmitted:true}],kind:name}}));
 const requests=[['sc2_doctor',{}],['sc2_query_audit',{report_id:id,offset:500,limit:10}],['sc2_find_object_uses',{report_id:id,target_catalog:'Weapon',target_id:'GuassRifle'}],['sc2_compare_audits',{before_report_id:id,after_report_id:id}]] as const;
 for(const[method,args]of requests){const job=await finished(f.bridge,(await f.bridge.call(method,args)).id);assert.equal(job.state,'completed');assert.equal(job.result!.response.outcome,'completed');assert.equal(job.result!.response.extended.reportId,id);assert.equal(job.result!.response.extended.projectRevisionComplete,false);assert.equal(job.result!.response.extended.payloadOmitted,true);assert.equal(job.result!.response.extended.total,510);assert.equal(job.result!.response.extended.totalChanges,510);assert.equal(job.result!.response.extended.sameEditorAdapter,true);assert.equal(job.result!.response.extended.sameProjectRevision,false);assert.equal(job.result!.response.extended.before.mapRevision,'old');assert.equal(job.result!.response.extended.fullObservations.objects.id,'object-artifact');assert.equal(job.result!.response.extended.graphicsReady,null);}
 assert.deepEqual(f.calls.map(c=>c.name),requests.map(r=>r[0]));assert.equal((await f.bridge.status()).ownedDocument,null);assert.equal((await fs.readdir(f.root)).includes('map.SC2Map'),false);
 const capabilities=await f.bridge.tools() as any[];assert.equal(capabilities.length,31);assert.ok(capabilities.every(c=>c.available));assert.equal(capabilities.find(c=>c.name==='sc2_doctor').documentRequired,false);assert.equal(capabilities.find(c=>c.name==='sc2_submit_job').documentRequired,null);
 const count=f.calls.length;await assert.rejects(f.bridge.call('sc2_doctor',{unknown:true}));assert.equal(f.calls.length,count);
});
test('bounded audit pages do not skip native rows when the inline page is shorter',()=>{
 for(const key of ['items','changes']){const summary=nativeExtendedSummary({offset:40,limit:20,nextOffset:60,totalMatches:100,[key]:Array.from({length:20},(_,i)=>({id:40+i,payloadOmitted:i===0}))});assert.equal(summary.nextOffset,48);assert.equal(summary.nativeNextOffset,60);assert.equal(summary.inlineReturned,8);assert.equal(summary.nativeReturned,20);assert.equal(summary.responseTruncated,true);}
});

test('v1.1 camera and effective-field arguments validate direct and nested calls without silently losing data',()=>{
 const pose={x:60,y:64,z:8.5,pitch:56,yaw:180,roll:0,distance:34,fov:27.8};
 assert.deepEqual(parseNativeArguments('sc2_capture_terrain',{terrain_camera:pose}),{terrain_camera:pose});
 assert.deepEqual(parseNativeArguments('sc2_submit_job',{operation:'capture_terrain',arguments:{terrain_camera:pose}}).arguments,{terrain_camera:pose});
 for(const [key,value] of [['distance',0],['fov',180],['pitch',91],['yaw',361],['z',Infinity],['x','60']] as const)assert.throws(()=>parseNativeArguments('sc2_capture_terrain',{terrain_camera:{...pose,[key]:value}}));
 assert.throws(()=>parseNativeArguments('sc2_capture_terrain',{terrain_camera:{...pose,unknown:1}}));
 assert.throws(()=>parseNativeArguments('sc2_submit_job',{operation:'capture_terrain',arguments:{map_camera_id:'1',terrain_camera:pose}}),/SELECTOR_CONFLICT/);
 for(const method of ['sc2_query_audit','sc2_compare_audits'] as const){
  const ids=method==='sc2_query_audit'?{report_id:id}:{before_report_id:id,after_report_id:id};
  const args={...ids,section:'fields',catalog:'Unit',object_id:'Marine',field:'LifeMax',offset:0,limit:2};
  assert.deepEqual(parseNativeArguments(method,args),args);
  assert.throws(()=>parseNativeArguments(method,{...args,section:'objects'}),/REQUIRES_FIELDS/);
  assert.throws(()=>parseNativeArguments(method,{...args,field:'x'.repeat(1025)}));
 }
});

test('effective-field query and comparison preserve exact value encodings and incomplete coverage',async t=>{
 const coverage={complete:false,unsupportedValues:1};
 const row={catalog:'Unit',objectId:'Marine',path:'LifeMax',value:{serialization:'45.000000',primitiveBits:'42340000'}};
 const f=await fixture(t,async(name)=>({structuredContent:{outcome:'completed',status:'AUDIT_PAGE_READ',section:'fields',editorRequired:false,reportId:id,fieldValueCoverage:coverage,fieldValueEncodingVersion:1,fieldValuesRecorded:1,comparisonCoverageComplete:false,offset:0,limit:2,totalMatches:1,nextOffset:null,...name==='sc2_compare_audits'?{changes:[{before:row,after:{...row,value:{serialization:'73.000000',primitiveBits:'42920000'}}}]}:{items:[row]}}}));
 for(const method of ['sc2_query_audit','sc2_compare_audits'] as const){
  const args={...method==='sc2_query_audit'?{report_id:id}:{before_report_id:id,after_report_id:id},section:'fields',field:'LifeMax',limit:2};
  const job=await finished(f.bridge,(await f.bridge.call(method,args)).id);assert.equal(job.state,'completed');
  const summary=job.result!.response.extended;assert.deepEqual(summary.fieldValueCoverage,coverage);assert.equal(summary.fieldValueEncodingVersion,1);assert.equal(summary.comparisonCoverageComplete,false);assert.equal(summary.fieldValuesRecorded,1);
  assert.deepEqual(f.calls.at(-1)!.args,args);
  assert.match(JSON.stringify(summary),/42340000/);
 }
 assert.equal(nativeExtendedSummary({fieldValueCoverage:null,fieldValueEncodingVersion:null}).fieldValueCoverage,null);
});
test('new document-free operations remain incomplete when v1 result envelope is missing or unknown',async t=>{
 let outcome:unknown=undefined;const f=await fixture(t,async()=>({structuredContent:{status:'OK',...outcome===undefined?{}:{outcome}}}));
 for(const v of [undefined,'not-a-known-outcome','incomplete','pending']){outcome=v;const j=await finished(f.bridge,(await f.bridge.call('sc2_doctor',{})).id);assert.equal(j.result!.outcome,'incomplete');}
});
test('document-free queued operations retain original operation outcome and bounded errors',async t=>{
 let seq=0;const jobs=new Map<string,any>();const f=await fixture(t,async(name,args)=>{
  if(name==='sc2_submit_job'){const jobId=(++seq).toString(16).padStart(32,'0');const value={jobId,operation:args.operation,status:'SUCCEEDED',result:{outcome:'failed',status:'NATIVE_CHECK_COMPLETE',errorInfo:{code:'INVALID_ARGUMENT',message:'Unknown report',nextStep:'Use an owned report ID.',automaticRetry:false}}};jobs.set(jobId,value);return{structuredContent:value};}
  return{structuredContent:jobs.get(String(args.job_id))};
 });
 for(const operation of ['doctor','query_audit','find_object_uses','compare_audits']){
  const args=operation==='doctor'?{}:operation==='compare_audits'?{before_report_id:id,after_report_id:id}:operation==='find_object_uses'?{report_id:id,target_catalog:'Unit',target_id:'Marine'}:{report_id:id};
  const j=await finished(f.bridge,(await f.bridge.call('sc2_submit_job',{operation,arguments:args})).id);assert.equal(j.result!.nativeJob.operationOutcome,'failed');assert.equal(j.result!.nativeJob.queueSucceeded,true);assert.equal(j.result!.nativeJob.operationSucceeded,false);assert.equal(j.result!.operationResult.outcome,'failed');assert.equal(j.result!.operationResult.errorInfo.code,'INVALID_ARGUMENT');assert.equal(j.result!.operationResult.errorInfo.automaticRetry,false);
 }
 assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>c.name==='sc2_submit_job'));assert.equal((await f.bridge.status()).ownedDocument,null);
});
test('queued transport cannot turn SUCCEEDED plus failed or incomplete v1 outcomes into success',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'v1-transport-mock-'));
 const mock=`const rl=require('node:readline').createInterface({input:process.stdin});let job;rl.on('line',line=>{const r=JSON.parse(line);if(!('id'in r))return;let result;if(r.method==='initialize')result={serverInfo:{name:'sc2-native-toolkit',version:${JSON.stringify(nativeRelease.version)}}};else if(r.method==='tools/list')result={tools:['sc2_submit_job','sc2_job_wait','sc2_doctor'].map(name=>({name,inputSchema:{type:'object'}}))};else if(r.params.name==='sc2_submit_job'){job={jobId:'a'.repeat(32),operation:r.params.arguments.operation,status:'SUCCEEDED',result:{status:'AUDIT_FINISHED',outcome:r.params.arguments.arguments.render_backend==='legacy'?'failed':'incomplete',validationPassed:null,errorInfo:{code:'OPERATION_FAILED',message:'Native detail',nextStep:'Inspect evidence.',automaticRetry:false}}};result={structuredContent:job};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`;
 const script=path.join(root,'mock.cjs');await fs.writeFile(script,mock);const client=new NativeStdioClient(process.execPath,[script],root);t.after(async()=>{await client.close();await fs.rm(root,{recursive:true,force:true});});
 const bad=await client.call('sc2_doctor',{render_backend:'legacy'});assert.equal(bad.isError,true);assert.equal(bad.structuredContent!.outcome,'failed');assert.equal(bad.structuredContent!.errorInfo.automaticRetry,false);assert.equal(bad.structuredContent!.transportJob.state,'SUCCEEDED');
 const partial=await client.call('sc2_doctor',{render_backend:'auto'});assert.equal(partial.isError,false);assert.equal(partial.structuredContent!.outcome,'incomplete');assert.equal(client.info().queueRecoveryRequired,false);
});
