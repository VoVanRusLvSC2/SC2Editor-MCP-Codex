import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const cli=path.resolve('scripts/run-map-tests.mjs');
async function fixture(t:test.TestContext,mode='passed'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-map-cli-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const entry=path.join(root,'fake-mcp.mjs'),log=path.join(root,'calls.jsonl');
 await fs.writeFile(entry,`
 import readline from 'node:readline';import fs from 'node:fs';import {createHash} from 'node:crypto';
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7sAAAAASUVORK5CYII=';
 const digest=createHash('sha256').update(Buffer.from(png,'base64')).digest('hex');let jobs=0;
 for await(const line of readline.createInterface({input:process.stdin})){const q=JSON.parse(line);if(!('id'in q))continue;let result;
 if(q.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'fixture',version:'1'}};
 else{const name=q.params.name,args=q.params.arguments;fs.appendFileSync(process.env.SC2_CLI_TEST_LOG,JSON.stringify({name,args})+'\\n');let body;
 if(name==='project.test.plan')body={planId:'plan',ready:true};
 else if(name==='project.test.run')body={jobId:'job-'+(++jobs)};
 else if(name==='project.test.status')body={jobId:args.jobId,state:'completed',phase:'finished'};
 else if(name==='project.test.report')body={jobId:args.jobId,outcome:process.env.SC2_CLI_TEST_MODE,evidenceValidForCurrentInputs:true,nextOffset:null,checks:process.env.SC2_CLI_TEST_MODE==='passed'?[{id:'formation:squad:reverse:frame',status:'passed',evidence:{sha256:digest}}]:[{id:'formation:squad:forward',status:'inconclusive',reason:'uncertain order'}]};
 else throw Error('Unexpected tool '+name);
 result={content:[{type:'text',text:JSON.stringify(body)},...(args.includeImage?[{type:'image',mimeType:'image/png',data:png}]:[])]};}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');}
 `);
 const run=async(extra:string[])=>{
  const child=spawn(process.execPath,[cli,'--workspace',root,'--manifest','tests.json','--entry',entry,...extra],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,SC2_CLI_TEST_LOG:log,SC2_CLI_TEST_MODE:mode}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  const code=await new Promise<number|null>((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});
  const calls=(await fs.readFile(log,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
  return {code,out,err,calls};
 };
 return {run};
}

test('map-test CLI selects and digest-checks reverse formation frames through actual stdio MCP',async t=>{
 const f=await fixture(t),r=await f.run(['--live','--repeat','2','--formation','squad','--direction','reverse']);assert.equal(r.code,0,r.err);
 assert.equal(r.calls.filter(c=>c.name==='project.test.run').length,2);
 assert.ok(r.calls.filter(c=>c.args.includeImage).every(c=>c.args.formationId==='squad'&&c.args.direction==='reverse'&&c.args.viewId===undefined));
 const completed=r.out.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)).filter(s=>s.outcome);assert.equal(completed.length,2);assert.ok(completed.every(s=>/^[a-f0-9]{64}$/.test(s.deliveredImageSha256)));
});

test('CLI emits an uncertain terminal report and never automatically repeats it or requests a missing formation frame',async t=>{
 const f=await fixture(t,'inconclusive'),r=await f.run(['--live','--repeat','2','--formation','squad','--direction','reverse']);assert.equal(r.code,1);assert.match(r.err,/TEST_SUITE_FAILED/);
 assert.equal(r.calls.filter(c=>c.name==='project.test.run').length,1);assert.equal(r.calls.some(c=>c.args.includeImage),false);
 const report=r.out.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)).find(s=>s.outcome);assert.equal(report.outcome,'inconclusive');
});

test('CLI rejects conflicting or malformed image selectors before starting a server',async t=>{
 for(const args of [['--formation','squad','--view','gate'],['--formation','../escape'],['--direction','reverse'],['--formation','squad','--direction','sideways']]){const f=await fixture(t),r=await f.run(args);assert.equal(r.code,1);assert.equal(r.calls.length,0);}
});
