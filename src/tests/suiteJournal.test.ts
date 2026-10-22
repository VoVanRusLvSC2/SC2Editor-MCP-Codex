import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const load=async()=>await import(pathToFileURL(path.resolve('scripts/toolkit-suite-journal.mjs')).href);
test('a verifier process exiting mid-next-case retains prior replies and a nonaccepted checkpoint',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-suite-journal-exit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const url=pathToFileURL(path.resolve('scripts/toolkit-suite-journal.mjs')).href;
 const source=`import {createSuiteJournal} from ${JSON.stringify(url)};const j=await createSuiteJournal(${JSON.stringify(dir)});await j.startCase('done','game.status');await j.tool({tool:'game.status',body:{attached:false}});await j.case({id:'done',status:'passed'});await j.startCase('next','game.attach');process.exit(23);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{windowsHide:true,stdio:'ignore'}),code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,23);
 const state=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));assert.equal(state.state,'running');assert.equal(state.currentCase.id,'next');assert.equal(state.casesCompleted,1);assert.equal(state.outcome,undefined);assert.equal(JSON.parse((await fs.readFile(path.join(dir,'transcript.ndjson'),'utf8')).trim()).tool,'game.status');await assert.rejects(fs.access(path.join(dir,'result.json')));
});
test('completed tool replies survive an interrupted case without implying suite acceptance',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-suite-journal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const {createSuiteJournal}=await load(),j=await createSuiteJournal(dir);
 await j.startCase('attack','game.call');const reply={tool:'game.call',args:{method:'game.order'},isError:false,body:{accepted:true}};await j.tool(reply);
 assert.deepEqual(JSON.parse((await fs.readFile(path.join(dir,'transcript.ndjson'),'utf8')).trim()),reply);const state=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));assert.equal(state.state,'running');assert.equal(state.outcome,undefined);assert.equal(state.toolsRecorded,1);assert.equal(state.casesCompleted,0);assert.equal(state.currentCase.id,'attack');await assert.rejects(fs.access(path.join(dir,'result.json')));await assert.rejects(j.finish('passed'),/CASE_IN_PROGRESS/);
});
test('failed and skipped cases retain order and final incomplete outcome; a finished journal cannot append',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-suite-journal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const {createSuiteJournal}=await load(),j=await createSuiteJournal(dir);
 await j.startCase('attach','game.attach');await j.tool({tool:'game.attach',args:{map:'Probe.SC2Map'},transportError:'GAME_FRONTEND_EXIT_1'});await j.case({id:'attach',tool:'game.attach',status:'failed'});await j.startCase('depends','game.call');await j.case({id:'depends',tool:'game.call',status:'not_checked'});await j.finish('incomplete_or_failed');
 const state=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));assert.equal(state.state,'finished');assert.equal(state.outcome,'incomplete_or_failed');assert.equal(state.casesCompleted,2);assert.equal(state.currentCase,null);const cases=(await fs.readFile(path.join(dir,'cases.ndjson'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));assert.deepEqual(cases.map(r=>[r.event,r.id]),[['started','attach'],['completed','attach'],['started','depends'],['completed','depends']]);await assert.rejects(j.tool({}),/FINISHED/);await assert.rejects(j.startCase('late','game.status'),/FINISHED/);
});
