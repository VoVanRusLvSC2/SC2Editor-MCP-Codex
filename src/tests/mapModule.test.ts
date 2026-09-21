import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { Workspace } from "../core/workspace.js";
import { MapInfoDocument } from "../modules/map/mapInfo.js";
import { MapWorkspace } from "../modules/map/workspace.js";
import { archiveBackendAvailable, archiveMetadataFile, directoryManifest, extractArchive, inspectArchive, packArchive, safeArchivePath } from "../archive/archiveAdapter.js";

const bounds = { left:4,bottom:4,right:28,top:28 };
async function fixture(t: { after(fn:() => Promise<void>):void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"sc2-map-test-")); t.after(() => fs.rm(root,{ recursive:true,force:true }));
  const source = path.join(root,"map"); await fs.mkdir(source);
  for(const dir of ["src/tests/fixtures/terrain-native/nydus","src/tests/fixtures/map-native/nydus"])
    for(const file of await fs.readdir(dir)) if(file.endsWith(".gz")) await fs.writeFile(path.join(source,file.slice(0,-3)),gunzipSync(await fs.readFile(path.join(dir,file))));
  const workspace = new Workspace(root); return { root,source,workspace,map:new MapWorkspace(workspace) };
}
for(const [id,w,h] of [["ant",136,136],["city",144,216],["nydus",32,32],["warships",256,256]] as const)
  test(`MapInfo ${id}: integrity, dimensions, lossless prefix writer and opaque tail`,async () => {
    const bytes = gunzipSync(await fs.readFile(`src/tests/fixtures/map-native/${id}/MapInfo.gz`));
    const d = new MapInfoDocument(bytes); assert.deepEqual(d.inspect().cells,[w,h]);
    assert.deepEqual(d.patch({}),bytes);
    const next = d.patch({ playableBounds:{ left:0,bottom:0,right:w,top:h },fogMaskStyle:d.fogMaskStyle === "Dark" ? "Black" : "Dark",minimapResolution:2 });
    const n = new MapInfoDocument(next); assert.equal(n.inspect().integrityVerified,true);
    assert.deepEqual(next.subarray(n.opaqueTailOffset),bytes.subarray(d.opaqueTailOffset));
    assert.throws(() => d.patch({ baseHeightFixed:d.baseHeightFixed+1 }),/REBUILD_REQUIRED/);
    assert.throws(() => d.patch({ playableBounds:{ left:0,bottom:0,right:w+1,top:h } }),/BOUNDS/);
    const invalid = Buffer.from(bytes); invalid[8] ^= 1; assert.throws(() => new MapInfoDocument(invalid),/INTEGRITY_HASH_MISMATCH/);
  });

test("metadata stage/save guards the entire file list and source bytes, while keeping the opaque tail",async t => {
  const f = await fixture(t);
  const original = await fs.readFile(path.join(f.source,"MapInfo"));
  assert.equal((await f.map.inspect("map")).valid,true);
  const p = await f.map.planMetadata("map",{ playableBounds:bounds,fogMaskStyle:"Dark" });
  const staged = await f.map.applyMetadata(p.id,{ dryRun:false,stage:true }); assert.ok(staged.transactionId);
  assert.deepEqual(await fs.readFile(path.join(f.source,"MapInfo")),original);
  await fs.writeFile(path.join(f.source,"external-new-entry"),"external");
  await assert.rejects(f.map.save(staged.transactionId!,{ dryRun:false }),/STALE_MAP_PLAN/);
  assert.deepEqual(await fs.readFile(path.join(f.source,"MapInfo")),original);
  await fs.unlink(path.join(f.source,"external-new-entry"));
  const terrainFile = path.join(f.source,"t3CellFlags"), flags = await fs.readFile(terrainFile);
  await fs.appendFile(terrainFile,Buffer.from([1]));
  await assert.rejects(f.map.save(staged.transactionId!,{ dryRun:false }),/STALE_MAP_PLAN/);
  await fs.writeFile(terrainFile,flags);
  await f.map.save(staged.transactionId!,{ dryRun:false });
  assert.deepEqual(new MapInfoDocument(await fs.readFile(path.join(f.source,"MapInfo"))).playableBounds,bounds);
});

test("complete native clone preserves scripts and unknown entries and rejects pending drafts",async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source,"custom.galaxy"),"void Custom () {}\n");
  await fs.writeFile(path.join(f.source,"unknown.bin"),Buffer.from([255,0,128,7]));
  const clone = await f.map.clone("map","copy",false); assert.equal(clone.cleanMap,false);
  assert.deepEqual(await directoryManifest(f.source),await directoryManifest(path.join(f.root,"copy")));
  await assert.rejects(f.map.clone("map","copy",false),/DESTINATION_EXISTS/);
  const p = await f.map.planMetadata("map",{ fogMaskStyle:"Dark" });
  const staged = await f.map.applyMetadata(p.id,{ dryRun:false });
  await assert.rejects(f.map.export("map","out.SC2Map"),/DRAFTS_PENDING/);
  await assert.rejects(f.map.clone("map","another"),/DRAFTS_PENDING/);
  f.map.discard(staged.transactionId!,false);
  assert.equal(f.map.capabilities().cleanMapCreation,false);
});
test("metadata dependency guard survives a generic restage of the byte group",async t => {
  const f = await fixture(t), plan = await f.map.planMetadata("map",{ fogMaskStyle:"Dark" });
  const original = await f.map.applyMetadata(plan.id,{ dryRun:false }); assert.ok(original.transactionId);
  const restaged = await f.workspace.binary.apply(["map/MapInfo"],source => new Map([["map/MapInfo",new MapInfoDocument(source.get("map/MapInfo")!).patch({ minimapResolution:2 })]]),{ dryRun:false });
  assert.ok(restaged.transactionId);
  await fs.writeFile(path.join(f.source,"added-after-restage"),"new");
  await assert.rejects(f.map.save(restaged.transactionId!,{ dryRun:false }),/STALE_MAP_PLAN/);
  await fs.unlink(path.join(f.source,"added-after-restage")); await f.map.save(restaged.transactionId!,{ dryRun:false });
  assert.equal(new MapInfoDocument(await fs.readFile(path.join(f.source,"MapInfo"))).minimapResolution,2);
});

test("native backend preserves unknown content, encrypted entry intent, empty files and locale variants",{ skip:!archiveBackendAvailable() },async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"sc2-mpq-test-")); t.after(() => fs.rm(root,{ recursive:true,force:true }));
  const source = path.join(root,"source"); await fs.mkdir(path.join(source,".sc2mcp-locales/1033"),{ recursive:true });
  await fs.writeFile(path.join(source,"neutral.bin"),Buffer.from([0,255,128,1,2,3]));
  await fs.writeFile(path.join(source,"empty"),Buffer.alloc(0));
  await fs.writeFile(path.join(source,".sc2mcp-locales/1033/neutral.bin"),"localized");
  await fs.writeFile(path.join(source,archiveMetadataFile),JSON.stringify({ protocol:"sc2-mcp-storm-v1",stormRevision:"fixture",headerOffset:0,
    entries:[{ name:"neutral.bin",localPath:"neutral.bin",locale:0,flags:0x30000,size:6,fileTime:"1234",internal:false },
      { name:"neutral.bin",localPath:".sc2mcp-locales/1033/neutral.bin",locale:1033,flags:0,size:9,fileTime:"0",internal:false }] }));
  await fs.writeFile(path.join(source,"neutral.bin.sc2uimcp.bak"),"backup must not be packed");
  const target = path.join(root,"Map.SC2Map"), result = await packArchive(source,target,{ backup:false });
  assert.equal(result.verification.entryCount,3); assert.equal(result.verification.reopened,true); assert.equal(result.backup,undefined);
  const manifest = await inspectArchive(target);
  assert.equal(manifest.entries.filter(e => !e.internal).length,3);
  assert.ok(manifest.entries.some(e => e.name === "neutral.bin" && e.locale === 1033));
  assert.ok(manifest.entries.some(e => e.name === "neutral.bin" && !e.locale && (e.flags & 0x10000)));
  const destination = path.join(root,"extracted"); await extractArchive(target,destination);
  assert.deepEqual(await fs.readFile(path.join(destination,"neutral.bin")),Buffer.from([0,255,128,1,2,3]));
  assert.equal(await fs.readFile(path.join(destination,".sc2mcp-locales/1033/neutral.bin"),"utf8"),"localized");
  await assert.rejects(extractArchive(target,destination),/DESTINATION_EXISTS/);
});

test("MCP map export supports a root workspace via reserved output and verifies every entry",{ skip:!archiveBackendAvailable() },async t => {
  const f = await fixture(t), map = new MapWorkspace(new Workspace(f.source));
  const target = ".sc2mcp-output/Generated.SC2Map";
  const before = await directoryManifest(f.source);
  assert.equal((await map.export("",target)).dryRun,true);
  const actual = await map.export("",target,false);
  assert.ok("verification" in actual); assert.equal(actual.verification.reopened,true);
  assert.deepEqual(await directoryManifest(f.source),before);
  await assert.rejects(map.export("","Wrong.SC2Map",false),/INSIDE_COMPONENTS/);
  await assert.rejects(map.inspect("../outside"),/escapes/);
});

test("failed archive reopening cannot replace a pre-existing map",async t => {
  if(process.platform === "win32") { t.skip("shell fixture"); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"sc2-bad-adapter-")); t.after(() => fs.rm(root,{ recursive:true,force:true }));
  const source = path.join(root,"source"), target = path.join(root,"Map.SC2Map"), adapter = path.join(root,"bad.sh");
  await fs.mkdir(source); await fs.writeFile(path.join(source,"a"),"expected"); await fs.writeFile(target,"original map");
  await fs.writeFile(adapter,'#!/bin/sh\nif [ "$1" = "pack" ]; then printf "bad archive" > "$3"; else printf "wrong" > "$3/a"; fi\n'); await fs.chmod(adapter,0o755);
  await assert.rejects(packArchive(source,target,{ adapter }),/VERIFICATION_FAILED/);
  assert.equal(await fs.readFile(target,"utf8"),"original map");
});

test("portable archive names reject traversal, ADS, controls, Windows aliases and ambiguous casing",async t => {
  for(const name of ["../evil","a/../evil","/evil","C:\\evil","a\nfile","a//b","CON.txt","a/COM1","a."]) assert.throws(() => safeArchivePath(name),/UNSAFE/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(),"sc2-name-collision-")); t.after(() => fs.rm(root,{ recursive:true,force:true }));
  if(process.platform !== "win32") { await fs.writeFile(path.join(root,"a"),"a"); await fs.writeFile(path.join(root,"A"),"b"); await assert.rejects(directoryManifest(root),/COLLISION/); }
});
