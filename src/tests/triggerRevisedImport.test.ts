import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {inspectRevisedGui} from '../modules/trigger/revisedImport.js';
const names=['FUNCTIONS','MAIN','GAMEPLAY','OBJECTIVES','CINEMATICS'];
const tree='<TriggerData><Root>'+names.map((_,i)=>`<Item Type="Category" Id="0000000${i}"/>`).join('')+'</Root>'+names.map((n,i)=>`<Element Type="Category" Id="0000000${i}"><Identifier>${n}</Identifier></Element>`).join('')+'</TriggerData>';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');

test('only exact typed Action splice declarations cross the native compiled import boundary',()=>{
 const macro='<TriggerData><Root/><Element Type="FunctionDef" Id="A"><Identifier>Initializer</Identifier><FlagEvent/><FlagOperator/><FlagSubFunctions/><ReturnType><Type Value="void"/></ReturnType><SubFunctionType Type="SubFuncType" Id="B"/><ScriptCode> #SUBFUNCS(actions) </ScriptCode></Element><Element Type="SubFuncType" Id="B"><Identifier>actions</Identifier><Action/></Element></TriggerData>';
 assert.throws(()=>inspectRevisedGui(macro),/SCRIPT_FALLBACK/);
 assert.equal(inspectRevisedGui(macro,{nativeLibraries:true}).declarativeMacros,1);
 for(const changed of [macro.replace('#SUBFUNCS(actions)','#SUBFUNCS(actions); Call();'),macro.replace('<Action/>','<Condition/>'),macro.replace('<FlagEvent/>','<FlagAction/>'),macro.replace('Type="SubFuncType" Id="B"/>','Type="SubFuncType" Library="Foreign" Id="B"/>'),macro.replace('<ReturnType><Type Value="void"/>','<ReturnType><Type Value="int"/>'),macro.replace('<Action/>','<Action/><FunctionDef Type="FunctionDef" Id="A"/>')])assert.throws(()=>inspectRevisedGui(changed,{nativeLibraries:true}),/SCRIPT_FALLBACK/);
});

test('native GUI inspection resolves library-qualified IDs and preserves library folders',()=>{
 const library=(id:string,other:string)=>`<Library Id="${id}"><Root><Item Type="Category" Library="${id}" Id="AA"/></Root><Element Type="Category" Id="AA"><Identifier>HELPERS</Identifier><Item Type="FunctionDef" Library="${id}" Id="BB"/></Element><Element Type="FunctionDef" Id="BB"><FunctionDef Type="FunctionDef" Library="${other}" Id="CC"/></Element><Element Type="FunctionDef" Id="CC"/></Library>`;
 const xml='<TriggerData><Root><Item Type="Library" Id="ABCD"/><Item Type="Library" Id="EF01"/></Root>'+library('ABCD','EF01')+library('EF01','ABCD')+'</TriggerData>';
 assert.throws(()=>inspectRevisedGui(xml),/NATIVE_LIBRARY_COMPILER_REQUIRED/);
 const counts=inspectRevisedGui(xml,{nativeLibraries:true});assert.equal(counts.functions,4);assert.deepEqual(counts.libraries,[{library:'ABCD',folders:['HELPERS']},{library:'EF01',folders:['HELPERS']}]);
 assert.throws(()=>inspectRevisedGui(xml.replace('Id="CC"/>','Id="BAD"/>'),{nativeLibraries:true}),/DANGLING/);
 assert.throws(()=>inspectRevisedGui(xml.replace('</TriggerData>','<Library Id="ABCD"><Root/></Library></TriggerData>'),{nativeLibraries:true}),/LIBRARY_SCOPE/);
 assert.throws(()=>inspectRevisedGui(xml.replace('<Identifier>HELPERS</Identifier>','<ScriptCode>Call();</ScriptCode>'),{nativeLibraries:true}),/SCRIPT_FALLBACK/);
 const external=inspectRevisedGui(xml.replace('Library="EF01" Id="CC"','Library="External" Id="CC"'),{nativeLibraries:true});assert.deepEqual(external.externalLibraries,['External']);
});
test('revised GUI import rejects script fallback and invalid folder ownership',()=>{
 assert.equal(inspectRevisedGui(tree).customScripts,0);
 assert.throws(()=>inspectRevisedGui(tree.replace('</TriggerData>','<Element Type="CustomScript" Id="A"/></TriggerData>')),/SCRIPT_FALLBACK/);
 assert.throws(()=>inspectRevisedGui(tree.replace('</TriggerData>','<Element Type="Param" Id="A"><ScriptCode>Call();</ScriptCode></Element></TriggerData>')),/SCRIPT_FALLBACK/);
 assert.ok(inspectRevisedGui(tree.replace('CINEMATICS','EXTRA')).folders.includes('EXTRA'));
 assert.throws(()=>inspectRevisedGui(tree.replace('<Identifier>MAIN</Identifier>','<Identifier>MAIN</Identifier><Item Type="Category" Id="00000000"/>')),/MULTIPLE_OWNERS/);
 assert.throws(()=>inspectRevisedGui(tree.replace('<Identifier>MAIN</Identifier>','<Identifier>MAIN</Identifier><Item Type="Category" Id="MISSING"/>')),/DANGLING/);
 assert.throws(()=>inspectRevisedGui(tree.replace('<Identifier>MAIN</Identifier>','<Identifier>MAIN</Identifier><Item Type="Category" Id="00000001"/>')),/MULTIPLE_OWNERS|CYCLE/);
});
test('revised GUI import accepts fewer or more folders and valid nesting without changing input',()=>{
 for(const count of [0,3,7]){
  const xml='<TriggerData><Root>'+Array.from({length:count},(_,i)=>`<Item Type="Category" Id="F${i}"/>`).join('')+'</Root>'+Array.from({length:count},(_,i)=>`<Element Type="Category" Id="F${i}"><Identifier>SYSTEM_${i}</Identifier></Element>`).join('')+'</TriggerData>';
  assert.equal(inspectRevisedGui(xml).folders.length,count);
 }
 const nested=tree.replace('<Root><Item Type="Category" Id="00000000"/>','<Root>').replace('<Identifier>MAIN</Identifier>','<Identifier>MAIN</Identifier><Item Type="Category" Id="00000000"/>');
 assert.ok(inspectRevisedGui(nested).folders.includes('MAIN/FUNCTIONS'));
});
test('revised GUI import pins both sources and stages tree/runtime/labels as one guarded transaction',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-revised-import-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const before='<TriggerData><Root/></TriggerData>',runtime='void InitMap () {}';
 await fs.writeFile(path.join(root,'Triggers'),before);await fs.writeFile(path.join(root,'MapScript.galaxy'),runtime);await fs.writeFile(path.join(root,'revised.xml'),tree);
 await fs.writeFile(path.join(root,'names.json'),JSON.stringify({'Category/Name/00000000':'FUNCTIONS'}));
 const ws=new Workspace(root),triggers=new TriggerWorkspace(ws),args={file:'revised.xml',stringsFile:'names.json',expectedSourceSha256:hash(before),expectedRuntimeSha256:hash(runtime),dryRun:true,stage:true};
 await assert.rejects(triggers.importRevised({...args,expectedRuntimeSha256:'0'.repeat(64)}),/SOURCE_STALE/);
 const preview=await triggers.importRevised(args);assert.equal(preview.counts.folders.length,5);assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),before);assert.deepEqual(ws.draftFiles(),[]);
 await triggers.importRevised({...args,dryRun:false});assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),before);
 await triggers.save(false);assert.equal(await fs.readFile(path.join(root,'Triggers'),'utf8'),tree);assert.match(await fs.readFile(path.join(root,'MapScript.galaxy'),'utf8'),/void InitMap/);
 assert.match(await fs.readFile(path.join(root,'enUS.SC2Data/LocalizedData/TriggerStrings.txt'),'utf8'),/FUNCTIONS/);
});
