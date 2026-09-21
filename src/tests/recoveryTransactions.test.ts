import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Workspace } from "../core/workspace.js";

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
