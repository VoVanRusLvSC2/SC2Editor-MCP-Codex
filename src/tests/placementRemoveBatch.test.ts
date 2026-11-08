import test from 'node:test';import assert from 'node:assert/strict';import{promises as fs}from'node:fs';import path from'node:path';import os from'node:os';
import{Workspace}from'../core/workspace.js';import{BrowseWorkspace}from'../modules/browse/workspace.js';import{DataWorkspace}from'../modules/data/workspace.js';import{PlacementWorkspace}from'../modules/placement/workspace.js';
import{registerPlacementTools}from'../modules/placement/tools.js';import{compactResult}from'../app/mcpBatch.js';import type{McpServer}from'@modelcontextprotocol/server';
import{createProject}from'../app/project.js';import{createProjectServer}from'../app/server.js';import{projectToolRegistry}from'../app/toolServer.js';import{resolveModuleSelection}from'../app/moduleSelection.js';
test('compact removal applies and saves only the requested component IDs',async()=>{
const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-remove-author-'));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
const project=await createProject(root,{selection:resolveModuleSelection({SC2_MCP_PROFILE:'workflow'})}),server=createProjectServer(project);
try{const before=await project.placement.scan(),ids=before.objects.map(o=>o.id!).slice(0,2),tool=projectToolRegistry(server).batchTools.get('modkit.author')!;
const reply=await tool.invoke(tool.schema.parse({script:`objects remove ids=${ids.join(',')}`,mode:'save'}),{}) as {content:Array<{text:string}>;isError?:boolean};
assert.notEqual(reply.isError,true,reply.content[0].text);const result=JSON.parse(reply.content[0].text);assert.equal(result.ok,true,JSON.stringify(result));
const after=await project.placement.scan();assert.equal(after.objects.length,before.objects.length-2);assert.ok(after.objects.every(o=>!ids.includes(o.id!)));
}finally{await server.close();await project.close();await fs.rm(root,{recursive:true,force:true});}
});
test('placement scan pages preserve exact component IDs through compact responses',async()=>{
const objects=Array.from({length:20},(_,i)=>({id:i+1,kind:'Doodad',position:{x:i,y:10}})),tools=new Map<string,any>();
const fake={scan:async()=>({objects,counts:{Doodad:20},sha256:'revision'})} as unknown as PlacementWorkspace;
registerPlacementTools({registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer,{workspace:fake});
const tool=tools.get('placement.scan'),page=async(offset:number)=>{const raw=await tool.callback(tool.config.inputSchema.parse({offset,limit:20}));return compactResult(JSON.parse(raw.content[0].text)) as any;};
const first=await page(0),second=await page(first.nextOffset),third=await page(second.nextOffset);
assert.equal(first.total,20);assert.equal(first.nextOffset,8);assert.equal(second.nextOffset,16);assert.equal(third.nextOffset,null);
assert.deepEqual([...first.objects,...second.objects,...third.objects].map((o:any)=>o.id),objects.map(o=>o.id));
});
test('Mass decoration removal rejects missing/duplicate IDs and retains stale source guards',async t=>{
const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-remove-batch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
const workspace=new Workspace(root),placement=new PlacementWorkspace(workspace,new BrowseWorkspace(workspace,new DataWorkspace(workspace)));
const scan=await placement.scan(),ids=scan.objects.map(o=>o.id!).slice(0,2);assert.equal(ids.length,2);
await assert.rejects(()=>placement.removeBatch({objectIds:[ids[0],ids[0]]}),/INVALID_REMOVE_BATCH/);await assert.rejects(()=>placement.removeBatch({objectIds:[9999999]}),/REMOVE_OBJECT_MISSING/);
const p=await placement.removeBatch({objectIds:ids});assert.equal(p.operations.length,2);
await fs.appendFile(path.join(root,'Objects'),'\n<!-- concurrent edit -->');await assert.rejects(()=>placement.apply(p.id,{dryRun:false,stage:false}),/STALE|changed/i);
assert.match(await fs.readFile(path.join(root,'Objects'),'utf8'),/concurrent edit/);
});
test('placement validation distinguishes stored objects from SC2 Editor layer visibility',async t=>{
const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-layer-diagnostic-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp('src/tests/fixtures/browse-placement-map',root,{recursive:true});
const workspace=new Workspace(root),placement=new PlacementWorkspace(workspace,new BrowseWorkspace(workspace,new DataWorkspace(workspace)));
const report=await placement.validate();
assert.ok(report.editorVisibility.placedObjects>0);
assert.equal(report.editorVisibility.editorLayerState,'UNOBSERVABLE');
assert.match(report.editorVisibility.hint,/Show Layer/);
});
