import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import {ScriptWorkspace} from '../modules/script/workspace.js';

test('Galaxy validation rejects pinned native argument, return and condition type mismatches',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-types-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'custom.galaxy'),'int Bad(){ if (7) { UnitCreate(1,22,0,1,null,0); } return "wrong"; }');
 const script=new ScriptWorkspace(new Workspace(root));
 const result=await script.validate();
 assert.equal(result.valid,false);
 const codes=result.diagnostics.map(x=>x.code);
 assert.ok(codes.includes('GALAXY_CALL_TYPE'));
 assert.ok(codes.includes('GALAXY_RETURN_TYPE'));
 assert.ok(codes.includes('GALAXY_CONDITION_TYPE'));
 assert.equal(result.compiler,'NOT_EXECUTED');
});
test('Galaxy bounded typecheck verifies simple parameters and local return',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-types-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'custom.galaxy'),'int Compute(int value){ int answer = value; if (true) { answer = 1; } return answer; }');
 const script=new ScriptWorkspace(new Workspace(root));
 const result=await script.validate();
 assert.equal(result.valid,true);
 assert.equal(result.typecheck.files[0].status,'VERIFIED_SUBSET');
});

test('Galaxy structref call binding accepts an owned record lvalue without accepting a different record type',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-record-ref-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const script=new ScriptWorkspace(new Workspace(root)),prefix='struct Row { int value; }; struct Other { int value; }; Row state; Other wrong; void Mutate(structref<Row> row) { row.value = 23; } ';
 const good=await script.validateSource(prefix+'void Use() { Mutate(state); }');assert.equal(good.valid,true);assert.ok(!good.diagnostics.some(d=>d.code==='GALAXY_CALL_TYPE'));assert.equal(good.compiler,'NOT_EXECUTED');
 const bad=await script.validateSource(prefix+'void Use() { Mutate(wrong); }');assert.equal(bad.valid,false);assert.ok(bad.diagnostics.some(d=>d.code==='GALAXY_CALL_TYPE'&&d.message.includes('got Other')));
});

test('record temporaries are not falsely certified as verified reference binding',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-ref-temporary-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const result=await new ScriptWorkspace(new Workspace(root)).validateSource('struct Row { int value; }; Row state; Row Read() { return state; } void Consume(structref<Row> row) {} void Use() { Consume(Read()); }');
 assert.equal(result.valid,true);assert.equal(result.typecheck.status,'INCOMPLETE');assert.equal(result.compiler,'NOT_EXECUTED');
});

test('Galaxy typecheck binds while arithmetic and compound assignments in scenario C',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-loop-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'custom.galaxy'),'int ScenarioCSum(int limit) { int total = 0; int i = 0; while (i < limit) { total += i; i += 1; } if (total > 0) { return total; } else { return 0; } }');
 const result=await new ScriptWorkspace(new Workspace(root)).validate();
 assert.equal(result.valid,true);
 assert.equal(result.typecheck.files[0].status,'VERIFIED_SUBSET');
});

test('Galaxy typecheck separates nested local scopes and rejects escaped locals',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'custom.galaxy');
 await fs.writeFile(file,'int Good() { int value = 1; if (true) { bool value = false; if (value) { return 2; } } return value; }');
 const script=new ScriptWorkspace(new Workspace(root));
 const good=await script.validate();
 assert.equal(good.valid,true);
 assert.equal(good.typecheck.files[0].status,'VERIFIED_SUBSET');
 await fs.writeFile(file,'int Bad() { if (true) { int value = 1; } return value; }');
 const bad=await new ScriptWorkspace(new Workspace(root)).validate();
 assert.equal(bad.valid,false);
 assert.ok(bad.diagnostics.some(x=>x.code==='GALAXY_SCOPE_UNBOUND'));
});

test('Galaxy typecheck rejects invalid while and compound operator operand types',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-operators-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'custom.galaxy'),'int Bad() { int value = 0; while (value && true) { value += true; } return value; }');
 const result=await new ScriptWorkspace(new Workspace(root)).validate();
 assert.equal(result.valid,false);
 assert.ok(result.diagnostics.filter(x=>x.code==='GALAXY_OPERATOR_TYPE').length>=2);
});

test('Galaxy catches native type names used as record fields before packing',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-keywords-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'custom.galaxy'),'struct State { int wave; int timer; }; void InitMap() {}');
 const result=await new ScriptWorkspace(new Workspace(root)).validate();assert.equal(result.valid,false);assert.ok(result.diagnostics.filter(x=>x.code==='GALAXY_RESERVED_IDENTIFIER').length>=2);
 await fs.writeFile(path.join(root,'custom.galaxy'),'struct State { int mf_wave; int mf_timer; }; void InitMap() {}');assert.equal((await new ScriptWorkspace(new Workspace(root)).validate()).valid,true);
});
test('native handle local declarations reject reserved names before staging',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-local-handles-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const workspace=new Workspace(root),script=new ScriptWorkspace(workspace),source='void Probe(){ unit marker; point timer; trigger wave; }';
 const checked=await script.validateSource(source);assert.equal(checked.valid,false);assert.equal(checked.diagnostics.filter(d=>d.code==='GALAXY_RESERVED_IDENTIFIER').length,3);
 await assert.rejects(script.plan({operations:[{op:'file.create',file:'Probe.galaxy',source}]}),/GALAXY_RESERVED_IDENTIFIER/);
 assert.deepEqual(workspace.draftFiles(),[]);await assert.rejects(fs.access(path.join(root,'Probe.galaxy')));
});
test('native handle locals retain types through assignments, calls and returns',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-handle-types-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const script=new ScriptWorkspace(new Workspace(root));
 const good=await script.validateSource('unit Pick(){ unit result = UnitLastCreated(); return result; } point At(){ point position = Point(4.0, 4.0); return position; } bool Empty(){ marker handle = null; return handle == null; }');
 assert.equal(good.valid,true,JSON.stringify(good.diagnostics));
 const wrongReturn=await script.validateSource('unit Wrong(){ point position = Point(4.0, 4.0); return position; }');assert.equal(wrongReturn.valid,false);assert.ok(wrongReturn.diagnostics.some(d=>d.code==='GALAXY_RETURN_TYPE'));
 const wrongArgument=await script.validateSource('void Wrong(){ point position = Point(4.0, 4.0); UnitSetPosition(position, position, true); }');assert.equal(wrongArgument.valid,false);assert.ok(wrongArgument.diagnostics.some(d=>d.code==='GALAXY_CALL_TYPE'));
});

test('native GUI CombineText/CombineStrings additions preserve their type, mixed additions remain invalid',async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-concat-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'custom.galaxy');await fs.writeFile(file,'text Caption(){ return (StringExternal("Prefix") + (IntToText(30) + StringExternal("Suffix"))); } string Name(){ return ("A" + "B"); }');assert.equal((await new ScriptWorkspace(new Workspace(root)).validate()).valid,true);await fs.writeFile(file,'text Bad(){ return StringExternal("Prefix") + 30; }');assert.equal((await new ScriptWorkspace(new Workspace(root)).validate()).valid,false);});
