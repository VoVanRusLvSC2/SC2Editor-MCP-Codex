import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {archiveBackendAvailable,packArchive,extractArchive} from '../archive/archiveAdapter.js';
import type {NativeGuiEvidence} from '../integrations/native/guiEvidence.js';
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const before='<TriggerData><Root/></TriggerData>',runtime='void InitMap() {}';
const xml='<TriggerData><Root><Item Type="Library" Id="ABCD"/></Root><Library Id="ABCD"><Root><Item Type="FunctionDef" Library="ABCD" Id="BB"/></Root><Element Type="FunctionDef" Id="BB"><Identifier>Helper</Identifier></Element></Library></TriggerData>';
async function fixture(t:test.TestContext){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-gui-'));t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
 const original=path.join(temporary,'Template');await fs.mkdir(original);for(const [file,value]of Object.entries({MapInfo:'fixture map context',Triggers:before,'MapScript.galaxy':runtime}))await fs.writeFile(path.join(original,file),value);
 await fs.mkdir(path.join(original,'Base.SC2Data/GameData'),{recursive:true});await fs.writeFile(path.join(original,'Base.SC2Data/GameData/UnitData.xml'),'<Catalog/>');
 const template=path.join(temporary,'Template.SC2Map');await packArchive(original,template);
 const root=path.join(temporary,'Target');await extractArchive(template,root);await fs.writeFile(path.join(root,'revised.xml'),xml);
 const output=path.join(temporary,'Native.galaxy'),compiled='int lib_ABCD_gv_Proof = 42;\nvoid InitMap() {}';await fs.writeFile(output,compiled);
 const ws=new Workspace(root),triggers=new TriggerWorkspace(ws),proof:NativeGuiEvidence={jobId:'fixture',xmlSha256:hash(xml),template:{absolute:template,sha256:hash(await fs.readFile(template))},output:{absolute:output,sha256:hash(compiled)}};
 triggers.nativeGuiArtifact=async()=>proof;
 const args={file:'revised.xml',nativeJobId:'fixture',expectedSourceSha256:hash(before),expectedRuntimeSha256:hash(runtime),dryRun:false,stage:true};
 return {root,ws,triggers,proof,args,compiled};
}
test('native GUI import atomically adopts exact XML/runtime and guards Data changes until save',{skip:!archiveBackendAvailable()},async t=>{
 const f=await fixture(t);const result=await f.triggers.importRevised({...f.args,dryRun:true});assert.equal(result.compiler,'NATIVE_PASSED');assert.deepEqual(f.ws.draftFiles(),[]);
 await f.triggers.importRevised(f.args);assert.equal((await f.ws.readRaw('Triggers')).text,xml);assert.equal((await f.ws.readRaw('MapScript.galaxy')).text,f.compiled);assert.equal(await fs.readFile(path.join(f.root,'Triggers'),'utf8'),before);
 await fs.appendFile(path.join(f.root,'Base.SC2Data/GameData/UnitData.xml'),'changed');await assert.rejects(f.triggers.save(false),/STALE/);assert.equal(await fs.readFile(path.join(f.root,'Triggers'),'utf8'),before);
});
test('native GUI import refuses a different XML, context, or extra library source',{skip:!archiveBackendAvailable()},async t=>{
 const f=await fixture(t);f.proof.xmlSha256=hash('other');await assert.rejects(f.triggers.importRevised(f.args),/XML_MISMATCH/);assert.deepEqual(f.ws.draftFiles(),[]);f.proof.xmlSha256=hash(xml);
 await fs.writeFile(path.join(f.root,'MapInfo'),'different map');await assert.rejects(f.triggers.importRevised(f.args),/CONTEXT_MISMATCH/);await fs.writeFile(path.join(f.root,'MapInfo'),'fixture map context');
 await fs.mkdir(path.join(f.root,'TriggerLibs'));await fs.writeFile(path.join(f.root,'TriggerLibs/Extra.galaxy'),'void Extra() {}');await assert.rejects(f.triggers.importRevised(f.args),/CONTEXT_EXTRA/);assert.deepEqual(f.ws.draftFiles(),[]);
});
test('native GUI adoption saves actual library-qualified labels with the coupled source group',{skip:!archiveBackendAvailable()},async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'Base.SC2Data/GameData/UnitData.xml.sc2uimcp.bak'),'backup context is not compiled');await fs.writeFile(path.join(f.root,'labels.json'),JSON.stringify({'FunctionDef/Name/lib_ABCD_BB':'Helper'}));
 await f.triggers.importRevised({...f.args,stringsFile:'labels.json'});await f.triggers.save(false);
 assert.equal(await fs.readFile(path.join(f.root,'MapScript.galaxy'),'utf8'),f.compiled);assert.match(await fs.readFile(path.join(f.root,'enUS.SC2Data/LocalizedData/TriggerStrings.txt'),'utf8'),/FunctionDef\/Name\/lib_ABCD_BB=Helper/);
});
