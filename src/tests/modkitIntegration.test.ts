import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {Workspace} from '../core/workspace.js';
import {ModkitIntegration,ModkitCascBackend} from '../integrations/modkit/runtime.js';
import {encodeWorld,worldReviver,MapPreviewWorkspace} from '../modules/map/preview.js';
import {registerModkitIntegrationTools} from '../integrations/modkit/tools.js';
import type {McpServer} from '@modelcontextprotocol/server';

async function fixture(t:test.TestContext){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'modkit-adapter-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const map=path.join(root,'Map');await fs.mkdir(map);await fs.writeFile(path.join(map,'MapInfo'),'test');await fs.writeFile(path.join(map,'Objects'),'<PlacedObjects/>');await fs.writeFile(path.join(map,'unknown.bin'),Buffer.from([0,255,13,10]));
  const integration=new ModkitIntegration(new Workspace(root),path.join(root,'missing-install'));
  return {root,map,integration};
}
test('ModKit snapshots preserve unknown bytes, isolate inputs and detect same-length changes/tampering',async t=>{
  const {map,integration}=await fixture(t),first=await integration.snapshot('Map');
  assert.deepEqual(await fs.readFile(path.join(first.target,'unknown.bin')),Buffer.from([0,255,13,10]));
  await fs.writeFile(path.join(map,'unknown.bin'),Buffer.from([1,255,13,10]));
  const next=await integration.snapshot('Map');assert.notEqual(first.revision,next.revision);
  assert.equal((await fs.readFile(path.join(first.target,'unknown.bin')))[0],0);
  await fs.writeFile(path.join(next.target,'unknown.bin'),'corrupt');
  await assert.rejects(integration.snapshot('Map'),/INTEGRITY_MISMATCH/);
  await assert.rejects(integration.snapshot('../escape'),/escapes/);
});
test('ModKit snapshot identity includes configured dependency catalogs',async t=>{
  const {root}=await fixture(t),dep=path.join(root,'Dependency');await fs.mkdir(dep);await fs.writeFile(path.join(dep,'UnitData.xml'),'one');
  const integration=new ModkitIntegration(new Workspace(root),path.join(root,'missing-install'),()=>[dep]);
  const a=await integration.snapshot('Map');await fs.writeFile(path.join(dep,'UnitData.xml'),'two');const b=await integration.snapshot('Map');assert.notEqual(a.revision,b.revision);
});
test('ModKit input revision changes when the installed CASC build changes',async t=>{
  const {root}=await fixture(t),install=path.join(root,'Game');await fs.mkdir(install);await fs.writeFile(path.join(install,'.build.info'),'first');
  const integration=new ModkitIntegration(new Workspace(root),install);
  const before=await integration.snapshot('Map');await fs.writeFile(path.join(install,'.build.info'),'other');
  assert.notEqual((await integration.snapshot('Map')).revision,before.revision);
});

test('Pinned Host UVM fix is narrow, idempotent and refuses unknown platform code',async()=>{
  const {patchUvmArtifactUri}=await import(new URL('../../scripts/modkit/platform-patches.mjs',import.meta.url).href);
  const source='uri: `memory+uvm:${encodeURIComponent(source.ref.uri)}`';
  const patched=patchUvmArtifactUri(source);
  assert.match(patched,/\.uvm`$/);assert.equal(patchUvmArtifactUri(patched),patched);
  assert.throws(()=>patchUvmArtifactUri('other version'),/CONTEXT_MISMATCH/);
  assert.throws(()=>patchUvmArtifactUri(source+source),/CONTEXT_MISMATCH/);
});
test('Pinned native ramp enum fix is idempotent and refuses unknown or duplicated guards',async()=>{
 const {patchRampDirectionEnum}=await import(new URL('../../scripts/modkit/platform-patches.mjs',import.meta.url).href);
 const source='ramp.dir < 1 || ramp.dir > 8; template.ramp.dir < 1 || template.ramp.dir > 8',patched=patchRampDirectionEnum(source);
 assert.equal(patched,'ramp.dir < 0 || ramp.dir > 7; template.ramp.dir < 0 || template.ramp.dir > 7');assert.equal(patchRampDirectionEnum(patched),patched);
 for(const invalid of ['other version',source+source,source.replace('template.ramp.dir > 8','template.ramp.dir > 9'),source+'; ramp.dir < 0 || ramp.dir > 7'])assert.throws(()=>patchRampDirectionEnum(invalid),/MODKIT_RAMP_ENUM_PATCH_CONTEXT_MISMATCH/);
});

test('ModKit world payload preserves typed arrays, maps and safe script boundaries',()=>{
  const encoded=encodeWorld({name:'</script><script>bad()</script>',array:new Float32Array([1.25,-2]),map:new Map([['x',new Uint16Array([65535])]]),large:4n});
  assert.equal(encoded.includes('</script>'),false);
  const restored=runInNewContext(`JSON.parse(input,${worldReviver})`,{input:encoded,atob,Map,BigInt,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array});
  assert.deepEqual([...restored.array],[1.25,-2]);assert.equal(restored.map.get('x')[0],65535);assert.equal(restored.large,4n);
});
test('Self-contained map payload decodes through browser-compatible gzip streams',async()=>{
  const original=encodeWorld({samples:new Float32Array([.25,.5,1]),label:'terrain'}),bytes=gzipSync(original);
  const decoded=await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.equal(decoded,original);
});
test('Data compact reads do not mutate frozen canonical answers or lose provenance',async t=>{
  const {integration}=await fixture(t);
  const entity=Object.freeze({entityId:'Unit',fields:Object.freeze({LifeMax:600,Race:'Terr'}),fieldSources:Object.freeze({LifeMax:{path:'GameData/Unit.xml'},Race:{path:'GameData/Unit.xml'}})});
  integration.port=async()=>({data:async()=>Object.freeze({answer:Object.freeze({entities:Object.freeze([entity])})})} as unknown as Awaited<ReturnType<ModkitIntegration['port']>>);
  const result=await integration.dataQuery({directory:'Map',view:'entities',refs:[{namespace:'Unit',entityId:'Unit'}],fields:['LifeMax'],offset:0,limit:1,locales:['ruRU']});
  assert.deepEqual(result.answer.entities[0].fields,{LifeMax:600});assert.equal(result.answer.entities[0].omittedFieldCount,1);
  assert.equal(result.answer.entities[0].fieldSources.LifeMax.path,'GameData/Unit.xml');assert.equal(entity.fields.Race,'Terr');
});
test('ModKit CASC preserves folder boundaries, range identity, local-only reads and package aliases',async t=>{
  const {integration}=await fixture(t),keys=['mods/a.sc2mod/base.sc2data/test','mods/ab.sc2mod/test'],bytes=new Uint8Array([1,2,3,4]);
  const reader={entryIndex:{size:keys.length,lowerBound:(key:string)=>{const at=keys.findIndex(k=>k>=key);return at<0?keys.length:at;},keyAt:(i:number)=>keys[i],contentSizeAt:()=>4},localRow:(i:number)=>i===0,contentSizeOf:()=>4,readPath:async()=>bytes,
    resolveFile:()=>({contentKey:'a'.repeat(32)}),resolveContentKey:()=> 'b'.repeat(32)};
  integration.port=async()=>({casc:async()=>reader} as unknown as Awaited<ReturnType<ModkitIntegration['port']>>);
  const backend=new ModkitCascBackend(integration);
  assert.equal((await backend.list('mods/a.sc2mod','',0,20)).total,1);
  assert.equal((await backend.inspect('mods/a.sc2mod/test')).path,'mods/a.sc2mod/test');
  assert.equal((await backend.read('mods/a.sc2mod/test',1,2)).base64,'AgM=');
  await assert.rejects(backend.read('mods/ab.sc2mod/test',0,1),/NOT_LOCAL/);
  await assert.rejects(backend.read('mods/a.sc2mod/test',3,2),/RANGE_INVALID/);
  backend.close();await assert.rejects(backend.info(),/CLOSED/);
});
test('MCP map/Data tools expose bounded schemas and truthful missing-runtime errors',async t=>{
  const {integration}=await fixture(t),tools=new Map<string,any>();
  const server={registerTool:(name:string,config:unknown,callback:unknown)=>tools.set(name,{config,callback})} as unknown as McpServer;
  registerModkitIntegrationTools(server,integration,{map:true,data:true},new MapPreviewWorkspace(integration));
  assert.equal(tools.get('map.preview').config.inputSchema.parse({}).includeImage,false);
  assert.equal(tools.get('map.preview').config.inputSchema.parse({}).mode,'render');
  assert.throws(()=>tools.get('map.preview').config.inputSchema.parse({width:99999}));
  const bad=await tools.get('data.modkit.query').callback({view:'ids'});assert.equal(bad.isError,true);assert.match(bad.content[0].text,/NAMESPACE_REQUIRED/);
  const image=await tools.get('map.preview').callback({includeImage:true,output:'html'});assert.equal(image.isError,true);
});
