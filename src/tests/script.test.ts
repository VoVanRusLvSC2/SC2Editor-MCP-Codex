import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {ScriptWorkspace} from '../modules/script/workspace.js';
import {GalaxyDocument} from '../modules/script/document.js';
async function fixture(t:{after(fn:()=>Promise<void>):void}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-script-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const w=new Workspace(root);return{root,w,s:new ScriptWorkspace(w)};}

test("multi-file candidate plans reuse unchanged parsed files while retaining final diagnostics and stale guards", async (t) => {
  const { root, w, s } = await fixture(t);
  for (let i = 0; i < 12; i++)
    await fs.writeFile(path.join(root, `f${i}.galaxy`), `void Existing${i} () { }\n`);
  const plan = await s.plan({
    operations: [
      { op: "function.rename", file: "f0.galaxy", name: "Existing0", newName: "Renamed" },
      { op: "function.add", file: "f0.galaxy", source: "void Added () { Renamed(); }" },
    ],
  });
  assert.deepEqual(
    plan.changedFiles.map((f) => f.file),
    ["f0.galaxy"],
  );
  assert.equal(plan.validation.valid, true);
  assert.equal(plan.efficiency.candidateFiles, 12);
  assert.equal(plan.efficiency.candidateParses, 2);
  assert.ok(plan.efficiency.reusedDocumentReads >= 24);
  await s.apply(plan.planId, false);
  await s.save("f0.galaxy", false);
  assert.match(await fs.readFile(path.join(root, "f0.galaxy"), "utf8"), /void Renamed/);
  assert.equal(
    new GalaxyDocument(await fs.readFile(path.join(root, "f0.galaxy"), "utf8")).diagnostics.length,
    0,
  );
  const next = await s.plan({
    operations: [
      { op: "function.body", file: "f0.galaxy", name: "Added", body: " Renamed(); Renamed(); " },
    ],
  });
  await fs.appendFile(path.join(root, "f11.galaxy"), "// manual input edit");
  await assert.rejects(s.apply(next.planId, false), /STALE_SCRIPT_PLAN/);
  assert.deepEqual(w.draftFiles(), []);
});

test('whole-file replacement requires an explicit exact source hash and retains apply-time guards',async t=>{
 const {root,w,s}=await fixture(t),source='void InitMap () {}',sha=(v:string)=>createHash('sha256').update(v).digest('hex');await fs.writeFile(path.join(root,'MapScript.galaxy'),source);
 const op={op:'file.replace' as const,file:'MapScript.galaxy',source:'void Helpers () {}\nvoid InitMap () { Helpers(); }',expectedSourceSha256:sha(source)};
 await assert.rejects(s.plan({operations:[{...op,expectedSourceSha256:'0'.repeat(64)}]}),/REPLACE_SOURCE_STALE/);assert.deepEqual(w.draftFiles(),[]);
 const plan=await s.plan({operations:[op]});await fs.writeFile(path.join(root,'MapScript.galaxy'),source+'\n// Concurrent edit');await assert.rejects(s.apply(plan.planId,false),/STALE_SCRIPT_PLAN/);
 await fs.writeFile(path.join(root,'MapScript.galaxy'),source);const next=await s.plan({operations:[op]});await s.apply(next.planId,false);await s.save('MapScript.galaxy',false);assert.equal(await fs.readFile(path.join(root,'MapScript.galaxy'),'utf8'),op.source);
 await assert.rejects(s.plan({operations:[{...op,file:'missing.galaxy'}]}),/SCRIPT_FILE_NOT_FOUND/);
});

test('for headers cannot hide invalid calls inside the loop and immediately after it',async t=>{
 const {s}=await fixture(t);
 const source='void F () { int i; unitgroup g; for (i = 0; i < 20; i += 1) { g = UnitGroup("Marine", 15, RegionEntireMap(), "-;-", 1); } g = UnitGroup("Boss", 2, RegionEntireMap(), "-;-", 0); }';
 const bad=await s.validateSource(source);
 assert.equal(bad.valid,false);assert.equal(bad.diagnostics.filter(d=>d.code==='GALAXY_CALL_TYPE'&&d.message.includes('expected unitfilter, got string')).length,2);
 const fixed=await s.validateSource(source.replaceAll('"-;-"','UnitFilter(0, 0, 0, 0)'));
 assert.equal(fixed.valid,true);
});
test('Galaxy token spans retain comments, escaped strings, Includes, arrays and declaration boundaries',()=>{const source='include "TriggerLibs/NativeLib"\r\n// } comment\r\nstruct T { int x; };\r\nT[16] state;\r\nnative int Get (int x);\r\nvoid Init () { string s = "a\\"}b"; /* { */ Get(1); }\r\n';const d=new GalaxyDocument(source);assert.equal(d.source,source);assert.equal(d.diagnostics.length,0);assert.deepEqual(d.symbols.map(x=>[x.name,x.kind]),[['T','struct'],['state','global'],['Get','prototype'],['Init','function']]);assert.deepEqual(d.calls().map(x=>x.name),['Get']);assert.equal(d.includes[0]?.path,'TriggerLibs/NativeLib');for(const bad of ['void F () {','void F () { string s = "x; }','/* unclosed','void F () { ] }'])assert.ok(new GalaxyDocument(bad).diagnostics.some(x=>x.severity==='error'));});
test('script context obeys serialized budget, resolves indexed native signatures and reindexes staged changes',async t=>{const{w,s}=await fixture(t);const source='void Action () { UISetButtonHighlighted(PlayerGroupAll(), AbilityCommand("UpgradeMaxNydus", 0), true); TriggerCreate("'+('x'.repeat(4000))+'"); }\n';await fs.writeFile(w.resolveUserPath('a.galaxy'),source);const c=await s.context({file:'a.galaxy',name:'Action',maxChars:3000});assert.ok(JSON.stringify(c).length<=3000);assert.equal(c.sourceTruncated,true);assert.equal(c.nativeSignatures.find(x=>x.name==='UISetButtonHighlighted')?.guiAction?.displayName,'Turn Ability Highlight On/Off');assert.equal((await s.inspect()).nativeFunctions,2200);await w.applyRawTransaction(['a.galaxy'],()=>new Map([['a.galaxy','void Changed () {}\n']]),{dryRun:false,stage:true});assert.equal((await s.symbols()).items[0]?.name,'Changed');});
test('native API exposes official GUI action names instead of presenting implementation identifiers as editor actions',async()=>{const api=JSON.parse(await fs.readFile(path.resolve('generated/galaxy-native-api.json'),'utf8'));const ability=api.functions.find((x:{name:string})=>x.name==='UISetButtonHighlighted');const face=api.functions.find((x:{name:string})=>x.name==='UISetButtonFaceHighlighted');assert.equal(ability.guiAction?.displayName,'Turn Ability Highlight On/Off');assert.equal(ability.guiAction?.functionDefId,'EA56A214');assert.equal(face.guiAction?.displayName,'Turn Button Highlight On/Off');assert.equal(face.guiAction?.functionDefId,'5967E3C2');});
test('body patch and static rename preserve untouched source and reject dynamic references/collisions',async t=>{const{w,s}=await fixture(t);const original='// Action in a comment\r\nvoid Action () { /*retain*/ }\r\nvoid Run () { Action(); }\r\n';await fs.writeFile(w.resolveUserPath('a.galaxy'),original);const p=await s.plan({operations:[{op:'function.rename',file:'a.galaxy',name:'Action',newName:'NewAction'}]});await s.apply(p.planId,false);assert.equal((await w.readRaw('a.galaxy')).text,original.replace('void Action','void NewAction').replace(' Action();',' NewAction();'));await s.save('a.galaxy',false);const body=await s.plan({operations:[{op:'function.body',file:'a.galaxy',name:'Run',body:'\r\n    NewAction();\r\n'}]});await s.apply(body.planId);assert.equal(w.draftFiles().length,0);await fs.writeFile(w.resolveUserPath('a.galaxy'),original+'void Setup () { TriggerCreate("Action"); }\r\n');await assert.rejects(s.plan({operations:[{op:'function.rename',file:'a.galaxy',name:'Action',newName:'Other'}]}),/DYNAMIC_FUNCTION_REFERENCE/);await assert.rejects(s.plan({operations:[{op:'function.rename',file:'a.galaxy',name:'Run',newName:'if'}]}),/Reserved Galaxy/);});
test('new Include dependencies and staged edits invalidate plans without partial writes',async t=>{const{w,s}=await fixture(t);await fs.writeFile(w.resolveUserPath('a.galaxy'),'void A () {}');const p=await s.plan({operations:[{op:'function.body',file:'a.galaxy',name:'A',body:' int x = 1; '}]});await fs.writeFile(w.resolveUserPath('added.galaxy'),'void Added () {}');await assert.rejects(s.apply(p.planId,false),/STALE_SCRIPT_PLAN/);assert.equal(w.draftFiles().length,0);await assert.rejects(s.plan({operations:[{op:'file.create',file:'../escape.galaxy',source:'void F () {}'}]}));});
test('native arity and local Include cycles are errors; missing external libraries remain explicit',async t=>{const{w,s}=await fixture(t);await fs.writeFile(w.resolveUserPath('a.galaxy'),'include "ExternalLib"\nvoid A () { TriggerCreate(); }');let v=await s.validate();assert.equal(v.valid,false);assert.ok(v.diagnostics.some(x=>x.code==='NATIVE_ARITY'));assert.ok(v.includes.some(x=>x.status==='EXTERNAL_UNRESOLVED'));await fs.writeFile(w.resolveUserPath('a.galaxy'),'include "b"\nvoid A () {}');await fs.writeFile(w.resolveUserPath('b.galaxy'),'include "a"\nvoid B () {}');v=await s.validate();assert.ok(v.diagnostics.some(x=>x.code==='INCLUDE_CYCLE'));});
test('create and connect stage/save atomically, preserve entry code and reject early returns',async t=>{const{w,s}=await fixture(t);const entry='//keep\r\nvoid InitMap () {\r\n    //original\r\n}\r\n';await fs.writeFile(w.resolveUserPath('MapScript.galaxy'),entry);const p=await s.plan({operations:[{op:'file.create',file:'Scripts/Custom.galaxy',source:'void CustomInit () {}\r\n'},{op:'connect',file:'Scripts/Custom.galaxy',init:'CustomInit'}]});await s.apply(p.planId,true);assert.equal(w.draftFiles().length,0);await s.apply(p.planId,false);assert.equal((await w.readRaw('MapScript.galaxy',false)).text,entry);const saved=await s.save('Scripts/Custom.galaxy',false);assert.deepEqual(saved.savedFiles.sort(),['MapScript.galaxy','Scripts/Custom.galaxy']);assert.match((await w.readRaw('MapScript.galaxy')).text,/include "Scripts\/Custom"\r\nvoid InitMap/);assert.match((await w.readRaw('MapScript.galaxy')).text,/\/\/original\r\n {4}CustomInit\(\);/);const again=await s.plan({operations:[{op:'connect',file:'Scripts/Custom.galaxy',init:'CustomInit'}]});assert.equal(again.changedFiles.length,0);await fs.writeFile(w.resolveUserPath('MapScript.galaxy'),'void InitMap () { return; }');await assert.rejects(s.plan({operations:[{op:'connect',file:'Scripts/Custom.galaxy',init:'CustomInit'}]}),/EARLY_RETURN/);});
test('periodic recipe checks action signature and produces valid native arities without touching GUI triggers',async t=>{const{w,s}=await fixture(t);await fs.writeFile(w.resolveUserPath('MapScript.galaxy'),'void Action () {}\nvoid InitMap () {}');await fs.writeFile(w.resolveUserPath('Triggers'),'opaque GUI triggers');const p=await s.recipe({file:'Scripts/Income.galaxy',name:'IncomeInit',kind:'periodic',seconds:2,action:'Action'});assert.equal(p.validation.valid,true);await s.apply(p.planId,false);await s.save('Scripts/Income.galaxy',false);assert.match((await w.readRaw('Scripts/Income.galaxy')).text,/TriggerAddEventTimePeriodic\(IncomeInit_trigger, 2.0000, c_timeGame\)/);assert.equal((await w.readRaw('Triggers')).text,'opaque GUI triggers');await assert.rejects(s.recipe({file:'Scripts/Bad.galaxy',name:'Bad',kind:'periodic',action:'Missing'}),/ACTION_MUST/);});

test('file-set changes after staging block script save and leave the complete group staged',async t=>{const{w,s}=await fixture(t);await fs.writeFile(w.resolveUserPath('a.galaxy'),'void A () {}');const p=await s.plan({operations:[{op:'function.body',file:'a.galaxy',name:'A',body:' int x = 1; '}]});await s.apply(p.planId,false);await fs.writeFile(w.resolveUserPath('new.galaxy'),'void New () {}');await assert.rejects(s.save('a.galaxy',false),/STALE_SCRIPT_SAVE/);assert.equal((await w.readRaw('a.galaxy',false)).text,'void A () {}');assert.equal(w.hasDraft('a.galaxy'),true);s.discard('a.galaxy');assert.equal(w.draftFiles().length,0);});

test('declarative plan file keeps immutable operations and stale-source guards',async t=>{
 const {root,w,s}=await fixture(t);await fs.writeFile(path.join(root,'MapScript.galaxy'),'void InitMap () {}');
 const file=path.join(root,'request.json');await fs.writeFile(file,JSON.stringify({operations:[{op:'file.create',file:'Lab.galaxy',source:'void Lab_Init () {}'},{op:'connect',file:'Lab.galaxy',entryFile:'MapScript.galaxy',entry:'InitMap',init:'Lab_Init'}]}));
 const plan=await s.planFile('request.json');assert.deepEqual(w.draftFiles(),[]);
 await fs.writeFile(file,JSON.stringify({operations:[{op:'file.create',file:'Other.galaxy',source:'void Other () {}'}]}));
 await s.apply(plan.planId,false);assert.match((await w.readRaw('Lab.galaxy')).text,/Lab_Init/);assert.equal((await w.readRaw('Other.galaxy')).exists,false);assert.match((await w.readRaw('MapScript.galaxy')).text,/Lab_Init\(\)/);
 const next=await fixture(t);await fs.writeFile(path.join(next.root,'Existing.galaxy'),'void Existing () {}');await fs.writeFile(path.join(next.root,'request.json'),JSON.stringify({operations:[{op:'function.body',file:'Existing.galaxy',name:'Existing',body:' int value=1; '}]}));const stale=await next.s.planFile('request.json');await fs.writeFile(path.join(next.root,'Existing.galaxy'),'void Existing () { int changed=2; }');await assert.rejects(next.s.apply(stale.planId,false),/STALE_SCRIPT_PLAN/);assert.deepEqual(next.w.draftFiles(),[]);
});
test('plan files reject missing, non-JSON, oversized and escaping input without source execution',async t=>{
 const {root,w,s}=await fixture(t);await assert.rejects(s.planFile('missing.json'),/SCRIPT_PLAN_FILE_MISSING/);
 await fs.writeFile(path.join(root,'bad.json'),'process.exit(77)');await assert.rejects(s.planFile('bad.json'),SyntaxError);
 await fs.writeFile(path.join(root,'big.json'),' '.repeat(1024*1024+1));await assert.rejects(s.planFile('big.json'),/SCRIPT_PLAN_FILE_BYTE_LIMIT/);
 await assert.rejects(s.planFile('../escape.json'));assert.deepEqual(w.draftFiles(),[]);
});
