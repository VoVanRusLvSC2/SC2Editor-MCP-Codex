import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {Workspace} from '../core/workspace.js';
import {ModkitIntegration,modkitAvailable,modkitHome} from '../integrations/modkit/runtime.js';
import {ModkitTerrainWorkspace} from '../modules/terrain/modkitWorkspace.js';
import {modkitRampPlaceSchema,modkitTerrainPlanSchema} from '../modules/terrain/modkitSchemas.js';
import {parseState} from '../modules/terrain/operations.js';
import {editNativeGeometry} from '../modules/terrain/nativeGeometry.js';
import {compileAuthorScript} from '../app/authoringScript.js';
import {compactResult} from '../app/mcpBatch.js';
import {registerModkitTerrainTools} from '../modules/terrain/modkitTools.js';
import type {McpServer} from '@modelcontextprotocol/server';

const optional={skip:!modkitAvailable()};
const components=['t3Terrain.xml','t3HeightMap','t3SyncHeightMap','t3SyncCliffLevel','t3CellFlags'];
const bounds={minX:96,minY:14,maxX:128,maxY:42};
const op={op:'ramp.place',donorDirectory:'Donor',rampIndex:2,bounds,offsetX:-80,offsetY:0,levelOffset:0,cliffSetIndex:1,extraHalfWidth:0};
// Independent cliff-stroke reference retained from the manually authored and
// native-reviewed JoinedDiagonals fixture. Do not derive these from ramp.place.
const runs=[
 [[26,18,44,20],[26,20,44,22],[28,22,44,24],[30,24,44,26],[32,26,44,28],[34,28,44,30],[36,30,44,32],[38,32,44,34]],
 [[88,80,104,82],[88,82,108,84],[90,84,110,86],[92,86,110,88],[94,88,110,90],[96,90,110,92],[98,92,110,94],[100,94,110,96],[102,96,110,98],[104,98,110,100]],
];
const clone=(m:Map<string,Uint8Array>):Map<string,Uint8Array>=>new Map([...m].map(([k,v])=>[k,Buffer.from(v)]));
const equalFiles=(a:Map<string,Uint8Array>,b:Map<string,Uint8Array>,label='unchanged')=>{assert.deepEqual([...a.keys()],[...b.keys()]);for(const[k,v]of a)assert.deepEqual(Buffer.from(v),Buffer.from(b.get(k)!),label+': '+k);};
let held:Promise<any>|undefined;
async function runtime(){return held??=(async()=>{
 const req=createRequire(path.join(modkitHome(),'package.json')),load=(n:string)=>import(pathToFileURL(req.resolve(n)).href);
 const [f,n,o,{createTerrainApi},{placeJoinedRamp}]=await Promise.all([load('@modkit/blizzard-starcraft2/map/format'),load('@modkit/blizzard-starcraft2/map/navigation'),load('@modkit/blizzard-starcraft2/map/overview'),import(new URL('../../scripts/modkit/terrain-api.mjs',import.meta.url).href),import(new URL('../../scripts/modkit/terrain-ramp-join.mjs',import.meta.url).href)]);
 return {f,api:createTerrainApi(f,n,o),placeJoinedRamp};
})();}
async function fixture(f:any,lower=1){
 const donor=new Map<string,Uint8Array>();for(const name of components)donor.set(name,gunzipSync(await fs.readFile('src/tests/fixtures/terrain-native/city/'+name+'.gz')));
 const p=f.parseTerrainXml(Buffer.from(donor.get('t3Terrain.xml')!).toString()),target=clone(donor),h=f.readHeightMap(target.get('t3HeightMap')),s=f.readSyncHeightMap(target.get('t3SyncHeightMap')),c=f.readSyncCliffLevel(target.get('t3SyncCliffLevel')),flags=f.readCellFlags(target.get('t3CellFlags'));
 assert.equal(p.ramps[2].dir,5);assert.equal(p.ramps[2].lo,1);assert.equal(p.ramps[2].hi,2);
 p.standardHeight=7.9696152996;
 const base=Math.round((p.standardHeight+p.quantizeBias)/p.quantizeScale),adjust=Math.round(((lower-1)*2+p.quantizeBias)/p.quantizeScale),world=(base+adjust)*p.quantizeScale-2*p.quantizeBias;
 h.sizeX=h.sizeY=s.sizeX=s.sizeY=129;h.cells=Array.from({length:129**2},()=>({heightBase:base,heightAdjustments:adjust,mask:lower}));s.cells=Array.from({length:129**2},()=>({height:Math.round(world*256),mask:lower}));c.sizeX=c.sizeY=flags.sizeX=flags.sizeY=128;c.heights=Array(128**2).fill(lower*64);flags.types=new Uint8Array(128**2).fill(128);
 target.set('t3Terrain.xml',Buffer.from(Buffer.from(donor.get('t3Terrain.xml')!).toString().replace('<terrain version="114"','<terrain version="115"').replace(/dim="145 217\s*"/,'dim="129 129"').replace(/standardHeight="[^"]*"/,'standardHeight="7.9696152996"').replace(/<cliffSetList\b[^>]*>[\s\S]*?<\/cliffSetList>/,'<cliffSetList num="2"><cliffSet i="0" name="KorhalCliff1"/><cliffSet i="1" name="KorhalCliff1"/></cliffSetList>').replace(/<cliffCellList\b[^>]*>[\s\S]*?<\/cliffCellList>/,'<cliffCellList num="4096" numOccupied="0"/>').replace(/<rampList\b[^>]*>[\s\S]*?<\/rampList>/,'<rampList num="0"/>')));
 target.set('t3HeightMap',f.writeHeightMap(h));target.set('t3SyncHeightMap',f.writeSyncHeightMap(s));target.set('t3SyncCliffLevel',f.writeSyncCliffLevel(c));target.set('t3CellFlags',f.writeCellFlags(flags));
 for(const[name,bytes]of donor)target.set('@donor:Donor:'+name,bytes);
 return {target,donor,p};
}
function prepare(target:Map<string,Uint8Array>,variant=0,level=2){
 const sources=new Map<string,Buffer>(components.map(name=>[name,Buffer.from(target.get(name)!)])),state=parseState(sources);
 for(const[minX,minY,maxX,maxY]of runs[variant])editNativeGeometry(state,{op:'cliff.paint',area:{type:'rectangle',minX,minY,maxX,maxY},parameters:{level,cliffSet:1,variation:0}});
 sources.set('t3HeightMap',state.heights.bytes);if(state.sync)sources.set('t3SyncHeightMap',state.sync.bytes);
 const result=clone(target);for(const[name,bytes]of sources)result.set(name,bytes);return result;
}

test('joined ramp schemas and compact lifecycle retain explicit mode and transaction references',()=>{
 const {op:operation,...request}=op,parsed=modkitRampPlaceSchema.parse(request);assert.equal(operation,'ramp.place');assert.equal(parsed.adjoining,'prepare_closed');assert.equal(parsed.directory,'');
 for(const change of [{adjoining:'repair'},{offsetX:1},{levelOffset:2},{extraHalfWidth:1},{unknown:true}])assert.throws(()=>modkitRampPlaceSchema.parse({...request,...change}));
 assert.equal(modkitTerrainPlanSchema.parse({operations:[{...op,adjoining:'verify'}]}).operations[0].op,'ramp.place');
 const command='terrain ramp.place directory=Map donorDirectory=Donor rampIndex=2 bounds=96,14,128,42 offset=-80,0 cliffSetIndex=1 adjoining=verify';
 const planned=compileAuthorScript(command,'plan');assert.deepEqual(planned.map(s=>s.tool),['terrain.ramp.place']);assert.equal(planned[0].args.adjoining,'verify');assert.deepEqual(planned[0].args.bounds,bounds);
 const staged=compileAuthorScript(command,'stage');assert.deepEqual(staged.map(s=>s.tool),['terrain.ramp.place','terrain.modkit.apply']);assert.deepEqual(staged[1].args,{planId:{$from:'s1.planId'},dryRun:false});
 const saved=compileAuthorScript(command,'save');assert.deepEqual(saved.map(s=>s.tool),['terrain.ramp.place','terrain.modkit.apply','modkit.save']);assert.deepEqual(saved[2].args.file,{$from:'s1.files.0.file'});
});

test('compact joined plan review retains bounded preparation evidence',()=>{
 const operation={op:'ramp.place',engineValidated:false,adjoining:{mode:'prepare_closed',highCells:54,checkedFlatCells:170,preparedStrokes:8,envelope:{minX:14,minY:12,maxX:50,maxY:44},strokes:Array(128).fill({}),scope:'Native tests remain separate.'}};
 const result=compactResult({planId:'modkit_terrain_test',valid:true,operations:Array(10).fill(operation),engineValidated:false}) as any;
 assert.equal(result.operations.length,8);assert.equal(result.operationsTotal,10);assert.equal(result.operationsTruncated,true);assert.equal(result.operations[0].adjoining.highCells,54);assert.equal(result.operations[0].adjoining.preparedStrokes,8);assert.equal(result.operations[0].adjoining.strokes,undefined);assert.equal(result.engineValidated,false);
});

test('public joined tool forwards validated defaults to the guarded workspace planner',async()=>{
 const tools=new Map<string,any>(),calls:any[]=[],server={registerTool:(name:string,definition:any,handler:any)=>tools.set(name,{definition,handler})};
 registerModkitTerrainTools(server as unknown as McpServer,{place:async(request:any)=>{calls.push(request);return{planId:'modkit_terrain_public',valid:true,engineValidated:false};}} as ModkitTerrainWorkspace);
 const tool=tools.get('terrain.ramp.place'),{op:operation,...request}=op;assert.equal(operation,'ramp.place');const parsed=tool.definition.inputSchema.parse(request),reply=await tool.handler(parsed);
 assert.equal(calls.length,1);assert.equal(calls[0].adjoining,'prepare_closed');assert.equal(calls[0].directory,'');assert.equal(JSON.parse(reply.content[0].text).planId,'modkit_terrain_public');assert.equal(tool.definition.annotations.readOnlyHint,true);
 assert.throws(()=>tool.definition.inputSchema.parse({...request,bounds:{...bounds,maxX:95}}));
});

for(const variant of [0,1])test('joined ramp prepares the independent native-reviewed '+(variant?'widened':'default')+' landing',optional,async()=>{
 const {f,api}=await runtime(),input=await fixture(f),before=clone(input.target),operation={...op,...(variant?{offsetX:-16,offsetY:64,extraHalfWidth:2}:{})};
 const manual=prepare(input.target,variant),reference=api.plan(manual,[{...operation,op:'ramp.template'}]),joined=api.plan(input.target,[operation]);
 for(const name of components)assert.deepEqual(joined.next.get(name),reference.next.get(name),'independent manual strokes + original transport: '+name);
 assert.deepEqual(joined.reports[0].adjoining.strokes.map((s:any)=>[s.area.minX,s.area.minY,s.area.maxX,s.area.maxY]),runs[variant]);assert.equal(joined.reports[0].engineValidated,false);
 equalFiles(input.target,before,'planning preserves target and donor');
 assert.throws(()=>api.plan(input.target,[{...operation,adjoining:'verify'}]),/ADJOINING_LEVEL_MISMATCH/);
 const verified=api.plan(manual,[{...operation,adjoining:'verify'}]);for(const name of components)assert.deepEqual(verified.next.get(name),reference.next.get(name));assert.equal(verified.reports[0].adjoining.preparedStrokes,0);
 const high=variant?{x:101,y:87}:{x:37,y:23},low=variant?{x:87,y:101}:{x:23,y:37},h=f.readHeightMap(joined.next.get('t3HeightMap')),s=f.readSyncHeightMap(joined.next.get('t3SyncHeightMap'));
 for(const[p,level]of [[low,1],[high,2]] as const){assert.equal(h.cells[p.y*129+p.x].mask,level);assert.equal(s.cells[p.y*129+p.x].mask,level);}
});

test('joined ramp one-level translation keeps SMAP low labels and native heights aligned',optional,async()=>{
 const {f,api}=await runtime(),input=await fixture(f,2),result=api.plan(input.target,[{...op,levelOffset:4}]),h=f.readHeightMap(result.next.get('t3HeightMap')),s=f.readSyncHeightMap(result.next.get('t3SyncHeightMap')),p=f.parseTerrainXml(Buffer.from(result.next.get('t3Terrain.xml')).toString());
 assert.equal(p.ramps[0].lo,2);assert.equal(p.ramps[0].hi,3);
 for(const[x,y,level]of [[23,37,2],[37,23,3]]){const i=y*129+x;assert.equal(h.cells[i].mask,level);assert.equal(s.cells[i].mask,level);assert.ok(Math.abs(s.cells[i].height/256-(input.p.standardHeight+(level-1)*2))<0.01);}
});

test('joined preparation rejects manual target state and leaves every input byte untouched',optional,async()=>{
 const {f,api,placeJoinedRamp}=await runtime();
 const cases:[string,(m:Map<string,Uint8Array>)=>void,RegExp][]=[
  ['hidden',m=>{const d=f.readCellFlags(m.get('t3CellFlags'));d.types[15*128+17]|=4;m.set('t3CellFlags',f.writeCellFlags(d));},/HIDDEN_TARGET/],
  ['hole',m=>{const d=f.readCellFlags(m.get('t3CellFlags'));d.types[15*128+17]|=1;m.set('t3CellFlags',f.writeCellFlags(d));},/TARGET_HOLE/],
  ['manual SMAP',m=>{const d=f.readSyncHeightMap(m.get('t3SyncHeightMap'));d.cells[15*129+17].height+=256;m.set('t3SyncHeightMap',f.writeSyncHeightMap(d));},/TARGET_NOT_CLEAR_FLAT/],
  ['manual CLIF',m=>{const d=f.readSyncCliffLevel(m.get('t3SyncCliffLevel'));d.heights[15*128+17]+=64;m.set('t3SyncCliffLevel',f.writeSyncCliffLevel(d));},/TARGET_NOT_CLEAR_FLAT|TARGET_CLIF_MISMATCH/],
  ['cancelled sculpt',m=>{const d=f.readHeightMap(m.get('t3HeightMap'));d.cells[15*129+17].heightBase+=100;d.cells[15*129+17].heightAdjustments-=100;m.set('t3HeightMap',f.writeHeightMap(d));},/TARGET_NOT_CLEAR_FLAT/],
  ['object',m=>m.set('Objects',Buffer.from('<PlacedObjects Version="28"><ObjectDoodad Id="1" Type="Rock" Position="17,15,0" Scale="1,1,1"/></PlacedObjects>')),/OBJECT_CONFLICT/],
  ['malformed object',m=>m.set('Objects',Buffer.from('<PlacedObjects><ObjectDoodad></PlacedObjects>')),/OBJECTS_INVALID/],
  ['invalid object position',m=>m.set('Objects',Buffer.from('<PlacedObjects Version="28"><ObjectDoodad Id="1" Type="Rock" Position="bad,15,0"/></PlacedObjects>')),/OBJECT_POSITION_INVALID/],
 ];
 for(const[label,change,error]of cases){const input=await fixture(f);change(input.target);const before=clone(input.target);assert.throws(()=>placeJoinedRamp(f,input.target,input.donor,op),error,label);equalFiles(input.target,before,label+' rejection is atomic');}
 const input=await fixture(f),before=clone(input.target);assert.throws(()=>api.plan(input.target,[op,{...op,offsetX:-78}]),/overlap|TARGET_NOT_CLEAR_FLAT|EXISTING_TOPOLOGY/i);equalFiles(input.target,before,'failed later operation preserves source');
});

test('joined placement refuses unknown cliff row contents instead of dropping manual XML',optional,async()=>{
 const {f,api}=await runtime();
 for(const body of ['<custom keep="yes"/>','<!--keep manual note-->','manual text']){const input=await fixture(f),target=prepare(input.target),xml=Buffer.from(target.get('t3Terrain.xml')!).toString().replace(/<cc\b([^>]*)\/>/,`<cc$1>${body}</cc>`);assert.ok(xml.includes(body));target.set('t3Terrain.xml',Buffer.from(xml));const before=clone(target);
  for(const operation of [{...op,adjoining:'verify'},{...op,op:'ramp.template'}])assert.throws(()=>api.plan(target,[operation]),/UNKNOWN_LIST_CONTENT/);
  equalFiles(target,before,'manual XML stays untouched');
 }
});

test('joined donor landing guards reject hidden, holed, sculpted and incoherent companions',optional,async()=>{
 const {f,placeJoinedRamp}=await runtime();
 for(const kind of ['lowHole','highHidden','base','smap','clif']){const input=await fixture(f),donor=clone(input.donor),x=kind==='lowHole'?96:106,y=kind==='lowHole'?14:18;
  if(kind==='lowHole'||kind==='highHidden'){const d=f.readCellFlags(donor.get('t3CellFlags'));d.types[y*d.sizeX+x]|=kind==='lowHole'?1:4;donor.set('t3CellFlags',f.writeCellFlags(d));}
  if(kind==='base'){const d=f.readHeightMap(donor.get('t3HeightMap'));d.cells[y*d.sizeX+x].heightBase+=100;donor.set('t3HeightMap',f.writeHeightMap(d));}
  if(kind==='smap'){const d=f.readSyncHeightMap(donor.get('t3SyncHeightMap'));d.cells[y*d.sizeX+x].height+=256;donor.set('t3SyncHeightMap',f.writeSyncHeightMap(d));}
  if(kind==='clif'){const d=f.readSyncCliffLevel(donor.get('t3SyncCliffLevel'));d.heights[y*d.sizeX+x]+=64;donor.set('t3SyncCliffLevel',f.writeSyncCliffLevel(d));}
  const targetBefore=clone(input.target),donorBefore=clone(donor);assert.throws(()=>placeJoinedRamp(f,input.target,donor,op),/MODKIT_RAMP_JOIN_DONOR_/,kind);equalFiles(input.target,targetBefore,kind+' target');equalFiles(donor,donorBefore,kind+' donor');
 }
});

async function diskFixture(t:any){
 const {f,api}=await runtime(),input=await fixture(f),root=await fs.mkdtemp(path.join(os.tmpdir(),'joined-ramp-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const[directory,files]of [['Map',input.target],['Donor',input.donor]] as const){await fs.mkdir(path.join(root,directory));for(const[name,bytes]of files)if(!name.startsWith('@'))await fs.writeFile(path.join(root,directory,name),bytes);}
 const workspace=new Workspace(root),integration=new ModkitIntegration(workspace,path.join(root,'missing'));integration.port=async()=>({terrain:async(view:string,files:any,args:any)=>api[view](files,args)}) as any;
 const terrain=new ModkitTerrainWorkspace(integration),{op:operation,...request}=op;assert.equal(operation,'ramp.place');return {root,workspace,terrain,request:{directory:'Map',...request},input};
}

test('joined public workspace plans dry, stages one complete terrain group and saves through any member',optional,async t=>{
 const d=await diskFixture(t),plan=await d.terrain.place(d.request);assert.equal(plan.valid,true);assert.ok(plan.files.length>=4);assert.deepEqual(d.workspace.binary.draftFiles(),[]);
 await d.terrain.apply(plan.planId);assert.deepEqual(d.workspace.binary.draftFiles(),[]);
 for(const name of components)assert.deepEqual(await fs.readFile(path.join(d.root,'Map',name)),Buffer.from(d.input.target.get(name)!));
 const applied=await d.terrain.apply(plan.planId,false);assert.equal((applied as any).staged,true);assert.deepEqual(new Set(d.workspace.binary.draftFiles()),new Set(plan.files.map(p=>p.file)));
 assert.equal((await d.terrain.apply(plan.planId,false)).alreadyApplied,true);
 const saved=await d.workspace.binary.saveContaining(plan.files[0].file,{dryRun:false});assert.equal(saved.saved,true);assert.equal(saved.files.length,plan.files.length);assert.deepEqual(d.workspace.binary.draftFiles(),[]);
 for(const file of plan.files)assert.notEqual((await fs.readFile(path.join(d.root,file.file))).length,0);
 for(const[name,bytes]of d.input.donor)assert.deepEqual(await fs.readFile(path.join(d.root,'Donor',name)),bytes,'donor remains read-only');
});

for(const stage of ['beforeApply','beforeSave'])for(const dependency of ['Donor/t3SyncHeightMap','Map/Objects'])test('joined transaction rejects changed '+dependency+' '+stage,optional,async t=>{
 const d=await diskFixture(t),plan=await d.terrain.place(d.request);if(stage==='beforeSave')await d.terrain.apply(plan.planId,false);
 const file=path.join(d.root,dependency);await fs.appendFile(file,Buffer.from([32]));
 if(stage==='beforeApply')await assert.rejects(d.terrain.apply(plan.planId,false),/STALE/);else await assert.rejects(d.workspace.binary.saveContaining(plan.files[0].file,{dryRun:false}),/STALE/);
 for(const name of components)assert.deepEqual(await fs.readFile(path.join(d.root,'Map',name)),Buffer.from(d.input.target.get(name)!),'failed transaction preserves target: '+name);
});
