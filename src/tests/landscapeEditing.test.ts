import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {landscapeZonePlanSchema,landscapeInspectSchema,editLandscapeZone,inspectLandscapeState} from '../modules/terrain/landscapeEditing.js';
import {landscapeHash,landscapeZoneSchema} from '../modules/terrain/landscapeOwnership.js';
import {TerrainWorkspace} from '../modules/terrain/workspace.js';
import {PlacementDocument} from '../modules/placement/document.js';
import {compileAuthorScript} from '../app/authoringScript.js';
import {runMcpBatch,type BatchTool} from '../app/mcpBatch.js';
import {ownedFixture,ownedZone,ownedChild,ownedBindings,ownedBindingsManifest} from './support/ownedZoneFixture.js';

const definition=(record:any)=>({id:record.id,dependsOn:record.dependsOn,purpose:record.purpose,condition:record.condition,config:record.config});
const request=(record:any,changes:any={})=>({zone:record.id,expectedRequestHash:record.requestHash,changes});
const candidate=(terrain:TerrainWorkspace,plan:any)=>(terrain as any).plans.get(plan.id).next as Map<string,Buffer>;

test('owned-zone edit schemas reject unknown fields, unsafe paths and ambiguous unset requests',()=>{
 const valid={zone:'west',expectedRequestHash:'a'.repeat(64),changes:{config:{clusterRadius:8}}};assert.doesNotThrow(()=>landscapeZonePlanSchema.parse(valid));
 for(const patch of [{zone:'../west'},{expectedRequestHash:'short'},{changes:{id:'other'}},{changes:{config:{routeSource:null}}},{changes:{config:{terrain:{unknown:true}}}},{unset:['terrain.routes']},{unexpected:true}])assert.throws(()=>landscapeZonePlanSchema.parse({...valid,...patch}));
 for(const input of [{field:'groups'},{zone:'west',field:'patches'},{zone:'west',field:'terrain.materials.patches'},{zone:'west',group:'one'},{limit:9},{itemLimit:101}])assert.throws(()=>landscapeInspectSchema.parse(input));
});

test('zone merge changes only named boundaries and uses whole nested object/array replacement',()=>{
 const zone=landscapeZoneSchema.parse({...ownedZone(),purpose:'Original',dependsOn:['parent'],config:{...ownedZone().config,clusterCount:3,clusterRadius:6,terrain:{style:'forest',heightMode:'preserve',textureMode:'generate',seed:91,materials:{base:'BelShirDirtLight',patches:[{texture:'BelShirDirtLight',strength:.4,wavelength:8}]}}}}),record={...zone,requestHash:landscapeHash(zone)},state={version:1,zones:[record]} as any;
 const edited=editLandscapeZone(state,request(record,{config:{objectCount:5,terrain:{materials:{patches:[{texture:'BelShirDirtLight',strength:.2,wavelength:10}]}}}}));
 assert.equal(edited.purpose,'Original');assert.deepEqual(edited.dependsOn,['parent']);assert.equal(edited.config.seed,42);assert.equal(edited.config.clusterCount,3);assert.equal(edited.config.terrain.seed,91);assert.equal(edited.config.terrain.heightMode,'preserve');assert.equal(edited.config.terrain.materials!.base,undefined);assert.equal(edited.config.terrain.materials!.patches!.length,1);assert.equal(edited.config.terrain.materials!.patches![0].strength,.2);
 const unset=editLandscapeZone(state,{...request(record),unset:['clusterCount','clusterRadius']});assert.equal(unset.config.clusterCount,undefined);assert.equal(unset.config.clusterRadius,undefined);
 assert.throws(()=>editLandscapeZone(state,{...request(record,{config:{clusterRadius:9}}),unset:['clusterRadius']}),/SET_UNSET_CONFLICT/);
 assert.deepEqual(state.zones[0],record,'pure edit must not change retained definition');
});

test('bounded inspector pages exact config entries and omits binary preimages and object fingerprints',async t=>{
 const d=await ownedFixture(t),parent=ownedZone(),child=ownedChild();await d.apply({zones:[parent,child]});const ledger=await d.ledger();
 const page=await d.terrain.inspectLandscape({offset:0,limit:1});assert.equal(page.total,2);assert.equal(page.returned,1);assert.equal(page.truncated,true);assert.equal(page.zones[0].id,'west');
 const summary=await d.terrain.inspectLandscape({zone:'west'});assert.deepEqual(summary.zones[0].rebuildClosure,['west','leaf']);assert.equal(summary.zones[0].ownedObjects,4);assert.equal(summary.zones[0].requestHash,ledger.zones[0].requestHash);assert.equal(summary.zones[0].definitionIntegrity,'matched');
 const encoded=JSON.stringify(summary);for(const forbidden of ['patches','fingerprint','before','after','topology','objects":'])assert.equal(encoded.includes(forbidden),false,forbidden);
 const field=await d.terrain.inspectLandscape({zone:'west',field:'terrain.heightMode'});assert.equal(field.field?.value,'preserve');assert.equal(field.field?.omitted,false);
 const missing=await d.terrain.inspectLandscape({zone:'west',field:'clusterRadius'});assert.equal(missing.field?.present,false);
 const fake=structuredClone(ledger);fake.zones[0].config.queries=Array.from({length:5},(_,i)=>'query'+i);const array=inspectLandscapeState(fake,{zone:'west',field:'queries',itemOffset:1,itemLimit:2});assert.deepEqual(array.field?.items,['query1','query2']);assert.equal(array.field?.nextOffset,3);assert.equal(array.field?.total,5);
 fake.zones[0].config.queries=['x'.repeat(40000)];const oversize=inspectLandscapeState(fake,{zone:'west',field:'queries'});assert.deepEqual(oversize.field?.items,[]);assert.equal(oversize.field?.truncated,true);assert.equal(oversize.field?.nextOffset,null);assert.ok(Number(oversize.field?.oversizeItemBytes)>32768);
 await assert.rejects(d.terrain.inspectLandscape({zone:'unknown'}),/ZONE_NOT_FOUND/);
});

test('wrapper and explicit full intent produce identical closure, all component bytes and stable object slots',async t=>{
 const d=await ownedFixture(t),parent=ownedZone(),child=ownedChild(),other=ownedZone('east',22,4,28,10);await d.apply({zones:[parent,child,other]});
 const old=await d.ledger(),record=old.zones.find((z:any)=>z.id==='west'),otherRecord=structuredClone(old.zones.find((z:any)=>z.id==='east')),full=definition(record);full.config={...full.config,clusterCount:2,clusterRadius:3};
 const beforeObjects=await fs.readFile(path.join(d.root,'Objects'),'utf8'),manual=new PlacementDocument(beforeObjects),manualId=otherRecord.objects[0].id;manual.rotate(manualId,.37);await fs.writeFile(path.join(d.root,'Objects'),manual.source);const manualObject=manual.list().find(o=>o.id===manualId)!;
 const explicit=await d.terrain.ownedLandscape({zones:[full]}),wrapper=await d.terrain.landscapeZonePlan(request(record,{config:{clusterCount:2,clusterRadius:3}}));
 assert.deepEqual(wrapper.ownership,explicit.ownership);assert.deepEqual(wrapper.files,explicit.files);assert.deepEqual(candidate(d.terrain,wrapper),candidate(d.terrain,explicit));assert.deepEqual(wrapper.ownership.rebuilt.map((z:any)=>z.id),['west','leaf']);assert.deepEqual(d.workspace.binary.draftFiles(),[]);
 await d.commit(wrapper);const after=await d.ledger();assert.deepEqual(after.zones.find((z:any)=>z.id==='west').objects.map((o:any)=>o.id),record.objects.map((o:any)=>o.id));assert.deepEqual(after.zones.find((z:any)=>z.id==='east'),otherRecord);
 const actual=new PlacementDocument(await fs.readFile(path.join(d.root,'Objects'),'utf8')).list().find(o=>o.id===manualId)!;assert.deepEqual({...actual,nodeId:undefined},{...manualObject,nodeId:undefined});
 const updated=after.zones.find((z:any)=>z.id==='west');for(const terrain of [d.terrain,new TerrainWorkspace(d.workspace,d.browse,d.placement)]){const repeat=await terrain.landscapeZonePlan(request(updated,{config:{clusterCount:2,clusterRadius:3}}));assert.equal(repeat.ownership.rebuilt.length,0);assert.ok(repeat.files.every((f:any)=>f.changedBytes===0));}
});

test('wrapper rejects stale inspected hashes, missing zones, manual owned edits and pending drafts',async t=>{
 const d=await ownedFixture(t);await d.apply({zones:[ownedZone()]});const original=await d.ledger(),record=original.zones[0];
 await assert.rejects(d.terrain.landscapeZonePlan({...request(record),expectedRequestHash:'f'.repeat(64)}),/REQUEST_STALE/);await assert.rejects(d.terrain.landscapeZonePlan({...request(record),zone:'missing'}),/ZONE_NOT_FOUND/);
 const changed=structuredClone(original);changed.zones[0].purpose='Concurrent owner definition';await fs.writeFile(path.join(d.root,'.sc2mcp/locations.json'),JSON.stringify(changed));assert.equal((await d.terrain.inspectLandscape({zone:'west'})).zones[0].definitionIntegrity,'mismatch');await assert.rejects(d.terrain.landscapeZonePlan(request(record)),/DEFINITION_HASH_MISMATCH/);
 changed.zones[0].requestHash=landscapeHash(definition(changed.zones[0]));await fs.writeFile(path.join(d.root,'.sc2mcp/locations.json'),JSON.stringify(changed));await assert.rejects(d.terrain.landscapeZonePlan(request(record)),/REQUEST_STALE/);await fs.writeFile(path.join(d.root,'.sc2mcp/locations.json'),JSON.stringify(original));
 const objectsFile=path.join(d.root,'Objects'),before=await fs.readFile(objectsFile,'utf8'),manual=new PlacementDocument(before);manual.rotate(record.objects[0].id,.7);await fs.writeFile(objectsFile,manual.source);await assert.rejects(d.terrain.landscapeZonePlan(request(record,{config:{objectCount:5}})),/OWNED_OBJECT_CHANGED/);assert.deepEqual(d.workspace.binary.draftFiles(),[]);await fs.writeFile(objectsFile,before);
 await d.workspace.binary.apply(['Objects'],()=>new Map([['Objects',Buffer.from(before+'\n<!-- pending -->')]]),{dryRun:false,stage:true});await assert.rejects(d.terrain.landscapeZonePlan(request(record)),/PENDING_DRAFTS/);
});

for(const phase of ['apply','save'])test('wrapper inherits route/pad/formation bindings and retains their stale guard before '+phase,async t=>{
 const d=await ownedFixture(t);await fs.writeFile(path.join(d.root,'acceptance.json'),JSON.stringify(ownedBindingsManifest()));await d.apply({zones:[ownedZone()],...ownedBindings});const record=(await d.ledger()).zones[0],plan=await d.terrain.landscapeZonePlan(request(record,{config:{objectCount:5}}));
 assert.equal(plan.ownership.routeSource?.corridors,2);assert.equal(plan.ownership.padSource?.reservations.length,1);
 const files=['Objects','t3HeightMap','.sc2mcp/locations.json'],before=await Promise.all(files.map(file=>fs.readFile(path.join(d.root,file))));if(phase==='save')await d.terrain.apply(plan.id,{dryRun:false,stage:true,backup:false});
 await fs.appendFile(path.join(d.root,'acceptance.json'),'\n');if(phase==='apply')await assert.rejects(d.terrain.apply(plan.id,{dryRun:false,stage:true}),/STALE_LANDSCAPE_(ROUTE|PAD)_SOURCE/);else await assert.rejects(d.terrain.savePlan(plan.id,{dryRun:false,backup:false}),/STALE_LANDSCAPE_(ROUTE|PAD)_SOURCE/);
 for(const[i,file]of files.entries())assert.deepEqual(await fs.readFile(path.join(d.root,file)),before[i],file);
});

test('compact inspection preserves paged fields and zone edits retain ordinary Terrain lifecycle',async t=>{
 const d=await ownedFixture(t);await d.apply({zones:[ownedZone()]});const record=(await d.ledger()).zones[0],tools=new Map<string,BatchTool>([['terrain.landscape.inspect',{schema:landscapeInspectSchema,invoke:async args=>({content:[{type:'text',text:JSON.stringify(await d.terrain.inspectLandscape(args as any))}]})}]]);
 for(const mode of ['plan','stage','save'] as const){const steps=compileAuthorScript('terrain landscape.inspect zone=west field=terrain.heightMode',mode);assert.deepEqual(steps.map(s=>s.tool),['terrain.landscape.inspect']);const result=await runMcpBatch(steps,tools,{});assert.equal(result.ok,true);assert.equal((result.steps[0] as any).result.zones[0].requestHash,record.requestHash);assert.equal((result.steps[0] as any).result.field.value,'preserve');}
 const command='terrain landscape.zone zone=west expectedRequestHash='+record.requestHash+' changes.config.clusterRadius=3';assert.deepEqual(compileAuthorScript(command,'plan').map(s=>s.tool),['terrain.landscape.zone.plan']);const saved=compileAuthorScript(command,'save');assert.deepEqual(saved.map(s=>s.tool),['terrain.landscape.zone.plan','terrain.apply','terrain.save']);assert.deepEqual(saved[1].args.planId,{$from:'s1.id'});assert.deepEqual(saved[2].args.planId,{$from:'s1.id'});
});
