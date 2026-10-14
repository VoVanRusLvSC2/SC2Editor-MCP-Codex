import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.js';
import type {CascWorkspace} from '../modules/casc/workspace.js';
import {safeCascPath} from '../modules/casc/workspace.js';
import {CutscenePreviewWorkspace} from '../modules/cutscenePreview/workspace.js';

test('an authored developer-local model path is diagnosed without aborting native scene preview',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-native-model-path-')),requests:string[]=[],localPath=String.raw`C:\Users\JTHAVI~1\AppData\Local\Temp\previewTemp\SMX2_Background_EpilogueArrival_Ulnar.m3`;
 try{
  await fs.writeFile(path.join(directory,'fixture.SC2Cutscene'),`<CutsceneState><CCutsceneNodeDirector><CCutsceneNodeEndScene><CCutsceneElementEndScene start="1000"/></CCutsceneNodeEndScene></CCutsceneNodeDirector><CCutsceneNodeActor guid="12194676552284865459" name="Background" modelPath="${localPath}" fromArchive="0"/></CutsceneState>`);
  const casc={readLimited:async(file:string)=>{requests.push(file);if(!file.endsWith('.xml'))throw new Error('UNEXPECTED_ASSET_READ');return {bytes:Buffer.from('<Catalog/>'),metadata:{path:file,buildKey:'fixture',sha256:'fixture'}};},refreshBuild:async()=>({build:{buildKey:'fixture'}})} as unknown as CascWorkspace;
  const result=await new CutscenePreviewWorkspace(new Workspace(directory),casc).preview({file:'fixture.SC2Cutscene',packages:['mods/core.sc2mod'],snapshots:false,times:[0],width:160,height:120});
  const report=JSON.parse(await fs.readFile(result.reportFile,'utf8')),issue=report.issues.find((i:{code:string})=>i.code==='MODEL_PATH_UNRESOLVED');
  assert.equal(issue?.object,'12194676552284865459');assert.ok(issue.detail.includes(localPath));assert.ok(issue.detail.includes('origin=native modelPath'));
  assert.equal(result.loadedModels,0);assert.equal(report.engineValidated,false);assert.ok((await fs.stat(result.htmlFile)).size>0);
  assert.ok(requests.every(file=>file.endsWith('.xml')));assert.throws(()=>safeCascPath(localPath),/CASC_PATH_UNSAFE/);
 }finally{
  const relative=path.relative(os.tmpdir(),directory);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('sc2-native-model-path-'));
  await fs.rm(directory,{recursive:true,force:true});
 }
});
