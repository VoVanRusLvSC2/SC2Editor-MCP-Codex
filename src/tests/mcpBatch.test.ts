import test from 'node:test';import assert from 'node:assert/strict';import * as z from 'zod/v4';import {BatchMediaCollector,runMcpBatch,resolveBatchReferences,compactResult,type BatchTool} from '../app/mcpBatch.js';import {resolveModuleSelection} from '../app/moduleSelection.js';

test('batch media forwards only explicitly requested images within the shared budget',async()=>{
 const tool={schema:z.object({includeImages:z.boolean().default(false)}),invoke:async()=>({content:[{type:'text',text:'{"total":5}'},...Array.from({length:5},(_,i)=>[{type:'text',text:`item ${i}`},{type:'image',mimeType:'image/jpeg',data:'/9j/2Q=='}]).flat()]})};
 const tools=new Map([['terrain.visual_reference',tool]]),collector=new BatchMediaCollector();
 const result=await runMcpBatch([{id:'implicit',tool:'terrain.visual_reference',args:{}},{id:'explicit',tool:'terrain.visual_reference',args:{includeImages:true}}],tools,{},collector);
 assert.equal(result.ok,true);assert.deepEqual(collector.receipt(),{included:4,omitted:1});assert.equal(collector.content.length,8);assert.match((collector.content[0] as {text:string}).text,/Step explicit.*item 0/);assert.equal(JSON.stringify(result).includes('/9j/2Q=='),false);
});

test('compact live receipts retain session, recovery and bounded Save state',()=>{
 const result=compactResult({status:'prepared',sessionId:'session-1',saveAttempted:true,newWorkingMapCopies:0,save:{status:'saved',saved:true,sha256:'abc',rawXml:'hidden'},rawXml:'hidden'}) as Record<string,any>;
 assert.equal(result.sessionId,'session-1');assert.equal(result.saveAttempted,true);assert.deepEqual(result.save,{status:'saved',saved:true,sha256:'abc'});assert.equal(Object.hasOwn(result,'rawXml'),false);
 const unknown=compactResult({status:'save_unconfirmed',retryMutation:false,recovery:'Inspect the same document',document:{archive:'Current.SC2Map',documentDirty:true,pendingInput:true,rawXml:'hidden'}}) as Record<string,any>;
 assert.equal(unknown.retryMutation,false);assert.equal(unknown.recovery,'Inspect the same document');assert.deepEqual(unknown.document,{archive:'Current.SC2Map',documentDirty:true,pendingInput:true});
 const recovery=compactResult({status:'unknown',pendingId:'pending',recoveryContext:{token:'owned',windowId:'123',mode:'import.files',componentFile:'staged',raw:'hidden'}}) as Record<string,any>;
 assert.equal(recovery.pendingId,'pending');assert.deepEqual(recovery.recoveryContext,{token:'owned',windowId:'123',mode:'import.files',componentFile:'staged'});
 const files=compactResult({files:Array.from({length:9},(_,i)=>({action:'add',path:`Assets/Art/${i}.dds`,sha256:'x'}))}) as Record<string,any>;
 assert.equal(files.files[0].action,'add');assert.equal(files.files.length,8);assert.equal(files.filesTruncated,true);
 const changes=compactResult({status:'refreshed',triggerRuntime:'changed_runtime_not_semantically_verified',changed:Array.from({length:17},(_,i)=>`Component${i}`)}) as Record<string,any>;
 assert.equal(changes.changed.length,16);assert.equal(changes.changedTotal,17);assert.equal(changes.changedTruncated,true);assert.equal(changes.triggerRuntime,'changed_runtime_not_semantically_verified');
 const failed=compactResult({status:'compile_failed',compilerErrors:[{message:'Unknown function',line:'263',file:'Generated'}],reportFile:'job/result.json'}) as Record<string,any>;
 assert.equal(failed.compilerErrors[0].line,'263');assert.equal(failed.reportFile,'job/result.json');
});

test('compact GUI creation retains native verification and recovery identity',()=>{
 const receipt={status:'applied',planId:'owned-plan',sourceWindowId:'ai',windowId:'triggers',nativeLibraryVerified:true,existingRootLabelsVerified:true,player:1,every:5,amount:100};
 assert.deepEqual(compactResult({...receipt,rawXml:'excluded'}),receipt);
});

test('an unresolved live Save or refresh stops later batch mutations',async()=>{
 for(const status of ['stopped','needs_parameters','partial','save_unconfirmed','save_confirmed_prepare_blocked','save_required','attention_required','unknown','recovery_required','pending_open','pending_native','conflict','verification_failed','prepare_failed','preparation_failed','not_published','context_changed','compile_pending','compile_failed','compile_stale','adoption_unknown']){
  let later=0;const tools=new Map<string,BatchTool>([['live.refresh.begin',{schema:z.object({}),invoke:async()=>({content:[{type:'text',text:JSON.stringify({status,retryMutation:false,recovery:'Inspect the same document'})}]})}],['later',{schema:z.object({}),invoke:async()=>{later++;return {};}}]]);
  const result=await runMcpBatch([{id:'begin',tool:'live.refresh.begin',args:{}},{id:'later',tool:'later',args:{}}],tools,{});
  assert.equal(result.ok,false,status);assert.equal(later,0,status);assert.deepEqual(result.steps[0].result,{status,retryMutation:false,recovery:'Inspect the same document'});
 }
});

test('a failed native authoring preparation preserves a bounded useful compiler error and stops before Save',async()=>{
 let saves=0;const tools=new Map<string,BatchTool>([['live.ui.author',{schema:z.object({}),invoke:async()=>({content:[{type:'text',text:JSON.stringify({status:'preparation_failed',nativeMutationAttempted:false,result:{ok:false,failed:'s2',completed:1,steps:[{id:'s2',tool:'ui.apply',ok:false,error:'Invalid frame name',rawXml:'private'}]}})}]})}],['live.document.save',{schema:z.object({}),invoke:async()=>{saves++;return {};}}]]);
 const result=await runMcpBatch([{id:'author',tool:'live.ui.author',args:{}},{id:'save',tool:'live.document.save',args:{}}],tools,{});
 assert.equal(result.ok,false);assert.equal(saves,0);assert.deepEqual(result.steps[0].result,{status:'preparation_failed',nativeMutationAttempted:false,preparation:{failed:'s2',completed:1,tool:'ui.apply',error:'Invalid frame name'}});
});

test('compact main Actor review retains asset revision, selected sequences and unverified playback status',()=>{
 const animation={model:{id:'Marine',file:'marine.m3',sha256:'a'.repeat(64)},assetRevision:'b'.repeat(64),sequences:{cast:'Attack'},nativePlayback:'not_checked',supplementalCoverage:'partial',warnings:['Missing supplemental file']};
 const r=compactResult({applied:[{index:2,animation}],rawXml:'excluded'}) as {animationReviews:any[];animationReviewCount:number};assert.equal(r.animationReviewCount,1);assert.deepEqual(r.animationReviews,[{operation:2,...animation}]);assert.equal(Object.hasOwn(r,'rawXml'),false);
});

test('default compact batch keeps native job handles and readiness so clients can poll without full payloads',async()=>{
 const tools=new Map([['project.test.run',{schema:z.object({}).strict(),invoke:async()=>({content:[{type:'text',text:JSON.stringify({jobId:'owned-job',state:'queued',phase:'queued',outcome:null,privateLog:'excluded'})}]})}],['project.test.plan',{schema:z.object({}).strict(),invoke:async()=>({content:[{type:'text',text:JSON.stringify({planId:'plan',ready:true,issues:[],rawSource:'excluded'})}]})}]]);
 const response=await runMcpBatch([{id:'plan',tool:'project.test.plan',args:{}},{id:'run',tool:'project.test.run',args:{}}],tools,{});
 assert.equal(response.ok,true);assert.deepEqual(response.steps[0].result,{planId:'plan',ready:true,issues:[]});assert.deepEqual(response.steps[1].result,{jobId:'owned-job',state:'queued',phase:'queued',outcome:null});assert.ok(!JSON.stringify(response).includes('excluded'));assert.deepEqual(compactResult({planId:'blocked',ready:false,rawSource:'excluded'}),{planId:'blocked',ready:false});
});
test('MCP batch forwards plan identifiers and applies the original schema/defaults',async()=>{const calls:unknown[]=[],tools=new Map([['plan',{schema:z.object({file:z.string()}).strict(),invoke:async()=>({content:[{type:'text',text:JSON.stringify({planId:'p1',big:'ignored'})}]})}],['apply',{schema:z.object({planId:z.string(),dryRun:z.boolean().default(true)}).strict(),invoke:async(args:unknown)=>{calls.push(args);return {content:[{type:'text',text:'{"valid":true}'}]}}}]]);const r=await runMcpBatch([{id:'a',tool:'plan',args:{file:'test'}},{id:'b',tool:'apply',args:{planId:{$from:'a.planId'}}}],tools,{});assert.equal(r.ok,true);assert.deepEqual(calls,[{planId:'p1',dryRun:true}]);assert.ok(!JSON.stringify(r).includes('ignored'));});
test('batch preflights unknown/recursive tools before any mutation',async()=>{let calls=0;const tools=new Map([['save',{schema:z.object({}),invoke:async()=>{calls++;return {}}}]]);await assert.rejects(runMcpBatch([{id:'a',tool:'save',args:{}},{id:'b',tool:'unknown',args:{}}],tools,{}),/PREFLIGHT/);assert.equal(calls,0);await assert.rejects(runMcpBatch([{id:'a',tool:'modkit.batch',args:{}}],tools,{}),/PREFLIGHT/);});
test('batch rejects later static schema errors before invoking an earlier mutation',async()=>{let saved=0;const tools=new Map([['save',{schema:z.object({}),invoke:async()=>{saved++;return {}}}],['check',{schema:z.object({value:z.number()}).strict(),invoke:async()=>({})}]]);const result=await runMcpBatch([{id:'first',tool:'save',args:{}},{id:'second',tool:'check',args:{value:'invalid'}}],tools,{});assert.equal(result.ok,false);assert.equal(result.completed,0);assert.equal(saved,0);assert.equal(result.steps[0].preflight,true);});
test('a referenced refresh session still preflights static arguments before a dirty-map Save',async()=>{
 let saves=0;const tools=new Map<string,BatchTool>([['live.refresh.begin',{schema:z.object({}).strict(),invoke:async()=>{saves++;return {};}}],['live.refresh.author',{schema:z.object({sessionId:z.string().uuid(),script:z.string().min(1)}).strict(),invoke:async()=>({})}]]);
 for(const args of [{sessionId:{$from:'begin.sessionId'},script:''},{sessionId:{$from:'begin.sessionId'},script:'valid',unexpected:true}]){
  const result=await runMcpBatch([{id:'begin',tool:'live.refresh.begin',args:{}},{id:'author',tool:'live.refresh.author',args}],tools,{});
  assert.equal(result.ok,false);assert.equal(result.completed,0);assert.equal(result.steps[0].preflight,true);assert.equal(saves,0);
 }
});
test('batch stops at failed schema or tool result, retaining earlier successes',async()=>{let saved=0;const tools=new Map([['ok',{schema:z.object({}),invoke:async()=>({content:[{type:'text',text:'{"valid":true}'}]})}],['fail',{schema:z.object({}),invoke:async()=>({isError:true,content:[{type:'text',text:'{"error":"stale"}'}]})}],['save',{schema:z.object({}),invoke:async()=>{saved++;return {}}}]]);const r=await runMcpBatch([{id:'a',tool:'ok',args:{}},{id:'b',tool:'fail',args:{}},{id:'c',tool:'save',args:{}}],tools,{});assert.equal(r.ok,false);assert.equal(r.completed,1);assert.equal(saved,0);});
test('batch references cannot traverse prototypes or unresolved/future results',()=>{const results=new Map([['a',{planId:'x',items:[{file:'y'}]}]]);assert.equal(resolveBatchReferences({$from:'a.items.0.file'},results),'y');assert.throws(()=>resolveBatchReferences({$from:'a.__proto__.x'},results),/UNSAFE/);assert.throws(()=>resolveBatchReferences({$from:'future.planId'},results),/MISSING/);});
test('workflow profile loads all modules for hidden tool dispatch',()=>{const r=resolveModuleSelection({SC2_MCP_PROFILE:'workflow'});assert.equal(r.profile,'workflow');assert.ok(r.modules.has('terrain'));assert.ok(r.modules.has('ui'));assert.ok(r.modules.has('script'));});

test('negative validation results stop a batch even when the original tool has no isError flag',async()=>{let exports=0;const tools=new Map([['validate',{schema:z.object({}),invoke:async()=>({content:[{type:'text',text:'{"valid":false}'}]})}],['export',{schema:z.object({}),invoke:async()=>{exports++;return {}}}]]);const r=await runMcpBatch([{id:'check',tool:'validate',args:{}},{id:'pack',tool:'export',args:{}}],tools,{});assert.equal(r.ok,false);assert.equal(exports,0);});

test('batch preview summaries retain bounded per-state artifact paths',async()=>{const {compactResult}=await import('../app/mcpBatch.js');const result=compactResult({comparisonFile:'compare.png',variants:[{id:'hover',pngFile:'hover.png',reportFile:'hover.json',largeSource:'excluded'}]}) as {variants:Array<Record<string,unknown>>};assert.deepEqual(result.variants,[{id:'hover',pngFile:'hover.png',reportFile:'hover.json'}]);});

test('batch selective reads return only requested fields and rejected authoring stops execution',async()=>{let mutated=false;const tools=new Map([['read',{schema:z.object({}),invoke:async()=>({content:[{type:'text',text:'{"objects":[{"id":"A"}],"raw":"skip"}'}]})}],['reject',{schema:z.object({}),invoke:async()=>({content:[{type:'text',text:'{"accepted":false,"error":"invalid"}'}]})}],['save',{schema:z.object({}),invoke:async()=>{mutated=true;return {};}}]]);const r=await runMcpBatch([{id:'read',tool:'read',args:{},select:['objects']},{id:'reject',tool:'reject',args:{},select:['objects']},{id:'save',tool:'save',args:{}}],tools,{});assert.equal(r.ok,false);assert.equal(mutated,false);assert.deepEqual(r.steps[0].result,{objects:[{id:'A'}]});assert.deepEqual(r.steps[1].result,{accepted:false,error:'invalid'});});

test("compact pagination keeps a continuation for rows trimmed from the response",()=>{const r=compactResult({offset:12,total:24,nextOffset:null,items:Array.from({length:12},(_,id)=>({id:id+12}))}) as {items:unknown[];nextOffset:number;responseTruncated:boolean};assert.equal(r.items.length,8);assert.equal(r.nextOffset,20);assert.equal(r.responseTruncated,true);});

test('default batch map preview returns usable artifact paths without inline or unrelated file payloads',async()=>{
 const files={png:'C:/Map/.sc2mcp-output/Map.png',html:'C:/Map/.sc2mcp-output/Map.html',raw:'x'.repeat(50000),nested:{png:'ignored.png'}};
 const tools=new Map([['map.preview',{schema:z.object({}).strict(),invoke:async()=>({content:[{type:'text',text:JSON.stringify({backend:'modkit',files,largeSource:'excluded'})}]})}]]);
 const response=JSON.parse(JSON.stringify(await runMcpBatch([{id:'preview',tool:'map.preview',args:{}}],tools,{})));
 assert.equal(response.ok,true);assert.deepEqual(response.steps[0].result.files,{png:files.png,html:files.html});assert.ok(JSON.stringify(response).length<1000);
 const malformed=compactResult({files:{png:'data:image/png;base64,abc.png',html:'x'.repeat(5000)+'.html',raw:'ignored'}}) as {files?:unknown};assert.equal(malformed.files,undefined);
});
