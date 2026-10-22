import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {gunzipSync} from 'node:zlib';

test('workflow MCP discovers and executes organization/catalog through compact author commands',{timeout:30000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-author-protocol-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
 const child=spawn(process.execPath,['dist/index.js'],{env:{...process.env,SC2_UI_ROOT:root,SC2_MCP_PROFILE:'workflow',SC2_ASSET_ROOTS:'',SC2_BROWSE_INSTALLED_ROOTS:''},stdio:['pipe','pipe','pipe']});
 t.after(()=>{child.stdin.end();child.kill();});let id=0,buffer='',stderr='';
 const pending=new Map<number,{resolve:(r:any)=>void;reject:(e:Error)=>void}>();child.stderr.on('data',d=>stderr+=d);
 child.on('exit',()=>{for(const p of pending.values())p.reject(new Error(stderr));pending.clear();});
 child.stdout.on('data',d=>{buffer+=d;let end;while((end=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);const p=pending.get(message.id);if(p){pending.delete(message.id);if(message.error)p.reject(new Error(JSON.stringify(message.error)));else p.resolve(message.result);}}});
 const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');});
 await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'authoring-protocol-test',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const invoke=async(name:string,args:unknown)=>{const r=await rpc('tools/call',{name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
 const tools=await invoke('modkit.tools',{query:'terrain.compose'});assert.equal(tools.items[0].name,'terrain.compose');
 const plan=await invoke('modkit.author',{script:'project organize genre=mission\nterrain catalog tileset=Agria section=vegetation limit=4',mode:'plan'});assert.equal(plan.ok,true);assert.equal(plan.steps[1].result.items.length,4);assert.equal(await fs.stat(path.join(root,'.sc2mcp/organization.json')).catch(()=>null),null);
 const saved=await invoke('modkit.author',{script:'project organize genre=mission',mode:'save'});assert.equal(saved.ok,true);assert.equal(JSON.parse(await fs.readFile(path.join(root,'.sc2mcp/organization.json'),'utf8')).logicDefault,'galaxy');
 const checked=await invoke('modkit.author',{script:'project check'});assert.equal(checked.ok,true);
 const repeated=await invoke('modkit.author',{script:'project organize genre=mission',mode:'save'});assert.equal(repeated.ok,true);
 for(const n of await fs.readdir('src/tests/fixtures/terrain-native/nydus'))await fs.writeFile(path.join(root,n.slice(0,-3)),gunzipSync(await fs.readFile(path.join('src/tests/fixtures/terrain-native/nydus',n))));
 const before=await fs.readFile(path.join(root,'t3HeightMap'));
 const terrain=await invoke('modkit.author',{script:'terrain raise rect=4,4,8,8 amount=0.5',mode:'save'});assert.equal(terrain.ok,true);assert.equal(terrain.steps.length,3);assert.ok(typeof terrain.steps[1].result.transactionId==='string');assert.notDeepEqual(await fs.readFile(path.join(root,'t3HeightMap')),before);
 const repair=await invoke('modkit.author',{script:'terrain cliff.repair rect=4,4,8,8',mode:'save'});assert.equal(repair.ok,true);
});
