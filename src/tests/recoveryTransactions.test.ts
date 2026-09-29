import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Workspace } from "../core/workspace.js";
import { FileTransactionFailure } from "../core/fileTransactions.js";

async function fixture(t: { after(fn:() => Promise<void>):void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"sc2-recovery-")); t.after(() => fs.rm(root,{ recursive:true,force:true }));
  await fs.writeFile(path.join(root,"a"),Buffer.from([255,0,128])); await fs.writeFile(path.join(root,"b"),"original b"); return root;
}
async function killedCommit(root: string, after = "a") {
  const moduleUrl = pathToFileURL(path.resolve("dist/core/workspace.js")).href;
  const worker = path.join(root,"worker.mjs");
  await fs.writeFile(worker,`
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Workspace } from ${JSON.stringify(moduleUrl)};
const root=process.argv[2],w=new Workspace(root),rename=fs.rename;
fs.rename=async(from,to)=>{
 await rename(from,to);
 if(String(to)===path.join(root,process.argv[3])) {
  process.stdout.write('FIRST_RENAMED\\n');
  setInterval(()=>{},1000);
  await new Promise(()=>{});
 }
};
await w.binary.apply(['a','b','new'],()=>new Map([['a',Buffer.from('changed a')],['b',Buffer.from('changed b')],['new',Buffer.from('new file')]]),{dryRun:false,stage:false,backup:false});
`);
  const child = spawn(process.execPath,[worker,root,after],{ stdio:["pipe","pipe","pipe"] });
  let output = "", errors = "";
  child.stderr.on("data",chunk => { errors += chunk; });
  await new Promise<void>((resolve,reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("worker timeout: "+errors)); },10000);
    child.once("error",e => { clearTimeout(timer); reject(e); });
    child.once("exit",code => { clearTimeout(timer); if(!output.includes("FIRST_RENAMED")) reject(new Error(`worker exited ${code}: ${errors}`)); });
    child.stdout.on("data",chunk => { output += chunk; if(output.includes("FIRST_RENAMED")) { clearTimeout(timer); resolve(); } });
  });
  await new Promise<void>(resolve => { child.once("exit",() => resolve()); child.kill("SIGKILL"); });
}
test("process death between component renames is recovered before the next transaction, without backups",async t => {
  const root = await fixture(t); await killedCommit(root);
  assert.equal(await fs.readFile(path.join(root,"a"),"utf8"),"changed a");
  assert.equal(await fs.readFile(path.join(root,"b"),"utf8"),"original b");
  const restarted = new Workspace(root); await restarted.recover();
  assert.deepEqual(await fs.readFile(path.join(root,"a")),Buffer.from([255,0,128]));
  assert.equal(await fs.readFile(path.join(root,"b"),"utf8"),"original b");
  await assert.rejects(fs.stat(path.join(root,"new")),/ENOENT/);
  await assert.rejects(fs.stat(path.join(root,".sc2mcp-journal")),/ENOENT/);
  await assert.rejects(fs.stat(path.join(root,".sc2mcp-lock.json")),/ENOENT/);
  await restarted.binary.apply(["a"],() => new Map([["a",Buffer.from("after restart")]]),{ dryRun:false,stage:false,backup:false });
  assert.equal(await fs.readFile(path.join(root,"a"),"utf8"),"after restart");
});
test("recovery preflights every component and preserves an external edit with a conflict",async t => {
  const root = await fixture(t); await killedCommit(root);
  await fs.writeFile(path.join(root,"b"),"external editor");
  await assert.rejects(new Workspace(root).recover(),/RECOVERY_CONFLICT/);
  assert.equal(await fs.readFile(path.join(root,"a"),"utf8"),"changed a");
  assert.equal(await fs.readFile(path.join(root,"b"),"utf8"),"external editor");
  await fs.writeFile(path.join(root,"b"),"original b"); await new Workspace(root).recover();
  assert.deepEqual(await fs.readFile(path.join(root,"a")),Buffer.from([255,0,128]));
});
test("fully renamed but uncommitted group is rolled back and its newly created entry removed",async t => {
  const root = await fixture(t); await killedCommit(root,"new");
  assert.equal(await fs.readFile(path.join(root,"new"),"utf8"),"new file");
  await new Workspace(root).recover();
  assert.deepEqual(await fs.readFile(path.join(root,"a")),Buffer.from([255,0,128]));
  assert.equal(await fs.readFile(path.join(root,"b"),"utf8"),"original b");
  await assert.rejects(fs.stat(path.join(root,"new")),/ENOENT/);
});
test("two processes serialize read-modify-write through the workspace lock",async t => {
  const root = await fixture(t), worker = path.join(root,"increment.mjs"); await fs.writeFile(path.join(root,"counter"),"0");
  const moduleUrl = pathToFileURL(path.resolve("dist/core/workspace.js")).href;
  await fs.writeFile(worker,`
import {Workspace} from ${JSON.stringify(moduleUrl)};
const w=new Workspace(process.argv[2]);
for(let i=0;i<5;i++)await w.applyRawTransaction(['counter'],async source=>{
 await new Promise(resolve=>setTimeout(resolve,20));
 return new Map([['counter',String(Number(source.get('counter'))+1)]]);
},{dryRun:false,stage:false,backup:false});
`);
  const launch = () => new Promise<void>((resolve,reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath,[worker,root],{ stdio:["pipe","pipe","pipe"] }); let errors="";
    child.stderr.on("data",chunk => { errors += chunk; }); child.once("error",reject);
    child.once("exit",code => code === 0 ? resolve() : reject(new Error(`increment worker ${code}: ${errors}`)));
  });
  await Promise.all([launch(),launch()]); assert.equal(await fs.readFile(path.join(root,"counter"),"utf8"),"10");
});

test("journal marker retries bounded transient Windows sharing errors and preserves atomic replacement",async t=>{
  const root=await fixture(t),originalRename=fs.rename;let denied=0;
  fs.rename=async(from,to)=>{
    if(String(to).endsWith(path.join('.sc2mcp-journal','commit-never')))throw new Error('unreachable');
    if(String(to).endsWith('manifest.json')&&(await fs.readFile(from,'utf8')).includes('"committed"')&&denied++<2)throw Object.assign(new Error('injected sharing violation'),{code:'EPERM'});
    return originalRename(from,to);
  };
  try{await new Workspace(root).applyRawTransaction(['b'],()=>new Map([['b','updated b']]),{dryRun:false,stage:false,backup:false});}
  finally{fs.rename=originalRename;}
  assert.equal(denied,3);
  assert.equal(await fs.readFile(path.join(root,'b'),'utf8'),'updated b');
  await assert.rejects(fs.stat(path.join(root,'.sc2mcp-journal')),/ENOENT/);
});

test("persistent journal EPERM aborts save with draft intact and original on disk",async t=>{
  const root=await fixture(t),workspace=new Workspace(root),originalRename=fs.rename;
  await workspace.applyRawTransaction(['b'],()=>new Map([['b','staged b']]),{dryRun:false,stage:true});
  let attempts=0;
  fs.rename=async(from,to)=>{
    if(String(to).endsWith('manifest.json')&&(await fs.readFile(from,'utf8')).includes('"committed"')){attempts++;throw Object.assign(new Error('injected persistent sharing violation'),{code:'EPERM'});}
    return originalRename(from,to);
  };
  try{await assert.rejects(workspace.save('b',{backup:false}),error=>{assert.ok(error instanceof FileTransactionFailure);assert.equal(error.code,'FILE_TRANSACTION_FAILED');assert.deepEqual(error.state,{written:['b'],restored:['b'],recoveryRequired:false,stagedState:'UNCHANGED_BY_COMMIT'});assert.match(error.message,/EPERM/);return true;});}
  finally{fs.rename=originalRename;}
  assert.equal(attempts,4);
  assert.equal(await fs.readFile(path.join(root,'b'),'utf8'),'original b');
  assert.equal((await workspace.readRaw('b')).text,'staged b');
  await workspace.recover();
  await assert.rejects(fs.stat(path.join(root,'.sc2mcp-journal')),/ENOENT/);
});

test("post-rename error recognizes committed marker without replaying rename",async t=>{
  const root=await fixture(t),originalRename=fs.rename;let injected=false;
  fs.rename=async(from,to)=>{
    const commit=String(to).endsWith('manifest.json')&&(await fs.readFile(from,'utf8')).includes('"committed"');
    await originalRename(from,to);
    if(commit&&!injected){injected=true;throw Object.assign(new Error('injected after rename'),{code:'EPERM'});}
  };
  try{await new Workspace(root).applyRawTransaction(['b'],()=>new Map([['b','updated b']]),{dryRun:false,stage:false,backup:false});}
  finally{fs.rename=originalRename;}
  assert.equal(injected,true);
  assert.equal(await fs.readFile(path.join(root,'b'),'utf8'),'updated b');
  await assert.rejects(fs.stat(path.join(root,'.sc2mcp-journal')),/ENOENT/);
});


test("transient EPERM while reading a linked workspace lock does not mean unlocked",async t=>{
 const root=await fixture(t),originalRead=fs.readFile;let denied=0;
 fs.readFile=(async(...args:Parameters<typeof fs.readFile>)=>{
  if(String(args[0]).endsWith('.sc2mcp-lock.json')&&denied++<2)throw Object.assign(new Error('injected lock sharing violation'),{code:'EPERM'});
  return originalRead(...args);
 }) as typeof fs.readFile;
 try{await new Workspace(root).applyRawTransaction(['b'],()=>new Map([['b','new b']]),{dryRun:false,stage:false,backup:false});}
 finally{fs.readFile=originalRead;}
 assert.equal(denied,3);assert.equal(await fs.readFile(path.join(root,'b'),'utf8'),'new b');
});

test("target rename failure compensates an earlier file and preserves the stage",async t=>{
 const root=await fixture(t),ws=new Workspace(root),originalRename=fs.rename;
 await ws.applyRawTransaction(['b','new'],()=>new Map([['b','new b'],['new','new file']]),{dryRun:false,stage:true});
 fs.rename=async(from,to)=>{
  if(String(to)===path.join(root,'new'))throw Object.assign(new Error('injected target rename refusal'),{code:'EACCES'});
  return originalRename(from,to);
 };
 try{await assert.rejects(ws.applyRawTransaction(['b','new'],m=>new Map(m),{dryRun:false,stage:false,backup:false}),/EACCES|rename refusal/);}
 finally{fs.rename=originalRename;}
 assert.equal(await fs.readFile(path.join(root,'b'),'utf8'),'original b');
 await assert.rejects(fs.stat(path.join(root,'new')),/ENOENT/);
 assert.equal((await ws.readRaw('b')).text,'new b');
 assert.equal((await ws.readRaw('new')).text,'new file');
 await ws.recover();
});


test("restart recovery notices an external edit after group preflight",async t=>{
 const root=await fixture(t);await killedCommit(root);
 const originalRename=fs.rename;let changed=false;
 fs.rename=async(from,to)=>{
  await originalRename(from,to);
  if(!changed&&String(to)===path.join(root,'a')&&String(from).includes('.recover.')){changed=true;await fs.writeFile(path.join(root,'b'),'external during recovery');}
 };
 try{await assert.rejects(new Workspace(root).recover(),/RECOVERY_CONFLICT/);}
 finally{fs.rename=originalRename;}
 assert.equal(changed,true);
 assert.equal(await fs.readFile(path.join(root,'b'),'utf8'),'external during recovery');
 assert.deepEqual(await fs.readFile(path.join(root,'a')),Buffer.from([255,0,128]));
 assert.equal((await fs.readdir(path.join(root,'.sc2mcp-journal'))).some(name=>name.startsWith('commit-')),true);
});

test("empty or corrupt recovery manifest is reported without changing project files",async t=>{
 const root=await fixture(t),dir=path.join(root,'.sc2mcp-journal','commit-invalid');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'manifest.json'),'');
 await assert.rejects(new Workspace(root).recover(),/INVALID_RECOVERY_JOURNAL_JSON/);
 assert.equal(await fs.readFile(path.join(root,'b'),'utf8'),'original b');
 assert.equal(await fs.readFile(path.join(dir,'manifest.json'),'utf8'),'');
});
