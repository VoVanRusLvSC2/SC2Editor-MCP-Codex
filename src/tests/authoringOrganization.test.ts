import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {organizeTriggerXml} from '../modules/trigger/organization.js';
import {Workspace} from '../core/workspace.js';
import {TriggerWorkspace} from '../modules/trigger/workspace.js';
import {organizeProject,checkProjectOrganization} from '../app/projectOrganization.js';
import {StyleCatalog} from '../modules/placement/styleCatalog.js';
import {planPositions,insidePolygon} from '../modules/placement/planner.js';
import {compileAuthorScript} from '../app/authoringScript.js';

test('nested GUI folders reuse IDs and preserve executable XML and other libraries',()=>{
 const executable='<Element Type="Trigger" Id="11111111"><Identifier>Wave</Identifier><Action Type="FunctionCall" Id="22222222"/></Element><Element Type="FunctionCall" Id="22222222"><ScriptCode>DoSomething();</ScriptCode></Element>';
 const external='<Library Id="Other"><Root/><Element Type="Trigger" Id="11111111"><Identifier>Other</Identifier></Element></Library>';
 const source='<TriggerData><Root><Item Type="Trigger" Id="11111111"/></Root>'+executable+external+'</TriggerData>';
 const args={genre:'mission' as const,assignments:[{type:'Trigger' as const,id:'11111111',folder:'GAMEPLAY/WAVES'}]};
 const first=organizeTriggerXml(source,args);assert.equal(first.created.length,6);assert.equal(first.moved.length,1);assert.ok(first.xml.includes(executable));assert.ok(first.xml.includes(external));assert.equal(first.issues.length,0);
 const second=organizeTriggerXml(first.xml,args);assert.equal(second.changed,false);assert.equal(second.created.length,0);assert.equal(second.moved.length,0);assert.deepEqual(second.folders,first.folders);
 assert.throws(()=>organizeTriggerXml(source,{folders:['UI']}),/MISSION_ROOT/);
 assert.throws(()=>organizeTriggerXml(source,{folders:['GAMEPLAY/MISC']}),/Catch-all/);
});

test('GUI invalid ownership fails before modifying anything',()=>{
 assert.throws(()=>organizeTriggerXml('<TriggerData><Root><Item Type="Trigger" Id="missing"/></Root></TriggerData>',{}),/DANGLING/);
 assert.throws(()=>organizeTriggerXml('<TriggerData><Root><Item Type="Trigger" Id="A"/><Item Type="Trigger" Id="A"/></Root><Element Type="Trigger" Id="A"/></TriggerData>',{}),/MULTIPLE_OWNERS/);
});

test('folder item ordering is explicit, repeatable and leaves trigger definitions intact',()=>{
 const definitions='<Element Type="Trigger" Id="A"><Identifier>First</Identifier></Element><Element Type="Trigger" Id="B"><Identifier>Second</Identifier></Element>';
 const source='<TriggerData><Root><Item Type="Trigger" Id="A"/><Item Type="Trigger" Id="B"/></Root>'+definitions+'</TriggerData>';
 const placed=organizeTriggerXml(source,{assignments:[{type:'Trigger',id:'A',folder:'GAMEPLAY/WAVES'},{type:'Trigger',id:'B',folder:'GAMEPLAY/WAVES'}]});
 const args={order:[{folder:'GAMEPLAY/WAVES',items:[{type:'Trigger' as const,id:'B'},{type:'Trigger' as const,id:'A'}]}]};
 const sorted=organizeTriggerXml(placed.xml,args);assert.ok(sorted.xml.includes(definitions));assert.ok(sorted.xml.includes('<Item Type="Trigger" Id="B"/><Item Type="Trigger" Id="A"/>'));assert.equal(organizeTriggerXml(sorted.xml,args).changed,false);
});

test('typed GUI plans reuse nested folders and keep global state and helpers with their system',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-gui-system-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root),trigger=new TriggerWorkspace(ws);
 for(const identifier of ['WaveStart','WaveStop']){const plan=await trigger.plan({create:{identifier,folder:'GAMEPLAY/WAVES'},calls:[],variables:[{name:identifier+'Count',type:'int',scope:'global'}],functions:[{name:identifier+'Helper',kind:'Action',calls:[]}]});await trigger.applyPlan(plan.planId,false);}
 const source=(await ws.readRaw('Triggers')).text,result=organizeTriggerXml(source,{folders:['GAMEPLAY/WAVES']});assert.equal(result.created.length,0);assert.equal(result.issues.length,0);assert.equal((source.match(/<Identifier>WAVES<\/Identifier>/g)??[]).length,1);
});

test('GUI organization localizes folders, dry-runs, stages atomically and rejects stale saves',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-organize-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'Triggers'),'<TriggerData><Root/></TriggerData>');
 const ws=new Workspace(root),triggers=new TriggerWorkspace(ws);
 const dry=await triggers.organize({folders:['GAMEPLAY/AI']});assert.equal(dry.created.length,6);assert.equal(ws.draftFiles().length,0);
 await triggers.organize({folders:['GAMEPLAY/AI'],dryRun:false});
 assert.ok((await ws.readRaw('enUS.SC2Data/LocalizedData/TriggerStrings.txt')).text.includes('=GAMEPLAY'));
 await fs.appendFile(path.join(root,'Triggers'),'\n');await assert.rejects(ws.save('Triggers'),/STALE/);
});

test('Galaxy is default and existing source and manifest ownership survive repeated organization',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sc2-galaxy-org-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const ws=new Workspace(root),trigger=new TriggerWorkspace(ws);
 await organizeProject(ws,trigger,{folders:['GAMEPLAY/WAVES'],dryRun:false});await ws.save('.sc2mcp/organization.json');
 const file=path.join(root,'Scripts/GAMEPLAY/WAVES/Module.galaxy');await fs.writeFile(file,'// Manual source\nvoid Waves() {}\n');
 await organizeProject(ws,trigger,{dryRun:false});await ws.save('.sc2mcp/organization.json');
 assert.equal(await fs.readFile(file,'utf8'),'// Manual source\nvoid Waves() {}\n');assert.equal((await checkProjectOrganization(ws)).status,'pass');
 const manifest=JSON.parse(await fs.readFile(path.join(root,'.sc2mcp/organization.json'),'utf8'));assert.ok(manifest.systems.includes('GAMEPLAY/WAVES'));assert.ok(manifest.files.some((f:{file:string})=>f.file==='Scripts/GAMEPLAY/WAVES/Module.galaxy'));
 assert.equal(await fs.stat(path.join(root,'Triggers')).catch(()=>null),null);
});

test('catalog pagination is complete, typed and bounded, including compressed data',async()=>{
 const catalog=new StyleCatalog(),first=await catalog.query({tileset:'Agria',section:'decor',limit:5});assert.ok('items' in first);if(!('items' in first))return;
 assert.equal(first.items.length,5);assert.equal(first.nextOffset,5);const pack=await catalog.pack('Agria');assert.equal(pack.sections.decor.length,42);assert.ok(pack.sections.vegetation.some(r=>r.id==='AgriaTree'));assert.ok(pack.sections.auto_vegetation.some(r=>r.catalog==='Model'));
 await assert.rejects(catalog.pack('../Agria'),/UNKNOWN/);await assert.rejects(catalog.read('../manifest.json'),/PATH_INVALID/);assert.equal((await catalog.profile()).profiles?.length,10);
});

test('polygon scatter respects concavity, reserved paths and reproducible seed',()=>{
 const points=[{x:0,y:0},{x:12,y:0},{x:12,y:3},{x:3,y:3},{x:3,y:12},{x:0,y:12}];
 const layout={type:'scatter' as const,area:{type:'polygon' as const,points,z:0},minimumDistance:0.3,seed:42,exclusionZones:[{type:'circle' as const,center:{x:1,y:1},radius:1}]};
 const first=planPositions({x:0,y:0,z:0},60,layout);assert.deepEqual(first,planPositions({x:0,y:0,z:0},60,layout));assert.ok(first.every(p=>insidePolygon(p,points)&&Math.hypot(p.x-1,p.y-1)>=1));
});

test('compact commands compile project and terrain lifecycle without JSON scaffolding',()=>{
 const steps=compileAuthorScript('project organize genre=mission\nterrain compose zone=west tileset=Agria rect=10,10,20,20 count=5','save');assert.equal(steps[0].tool,'project.organize');assert.equal(steps[1].tool,'modkit.save');assert.equal(steps[2].tool,'terrain.compose');assert.deepEqual(steps[2].args.area,{type:'rectangle',minX:10,minY:10,maxX:20,maxY:20});assert.equal(steps[2].args.dryRun,false);
});
