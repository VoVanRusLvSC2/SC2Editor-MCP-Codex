import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { CascWorkspace, parseCascBuildInfo, safeCascPath } from "../modules/casc/workspace.js";
import type { CascBackend, CascEntry, CascRead } from "../modules/casc/backend.js";
import { Workspace } from "../core/workspace.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { registerCascTools } from "../modules/casc/tools.js";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ZodType } from "zod/v4";
const file = "mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml";
const galaxy = "mods/core.sc2mod/base.sc2data/triggerlibs/natives.galaxy";
const buildInfo = (key = "a".repeat(32), version = "5.0.17.98310") => `Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Version!STRING:0\n1|${key}|${"c".repeat(32)}|${version}\n`;
class FakeBackend implements CascBackend {
  reads = 0; closed = false; unavailable = new Set<string>(); change?: () => Promise<void>;
  files = new Map<string, Buffer>([
    [file, Buffer.from('<Catalog><CUnit id="Probe"><LifeMax value="40"/></CUnit></Catalog>')],
    ["mods/core.sc2mod/base.sc2data/gamedata.xml", Buffer.from('<Includes><Catalog path="GameData/unitdata.xml"/></Includes>')],
    [galaxy, Buffer.from('native unit UnitCreate(int player);\nconst int Count = 3;\n')],
  ]);
  info() { return Promise.resolve({ protocol: "sc2-casc-local-v1", offline: true, indexedPaths: this.files.size }); }
  async inspect(path: string): Promise<CascEntry> { const bytes = this.files.get(path); if (!bytes) throw new Error("CASC_PATH_NOT_FOUND"); return { path, size: bytes.length, local: !this.unavailable.has(path), contentKey: createHash("md5").update(bytes).digest("hex"), encodingKey: "e".repeat(32), localeFlags: 0, nameType: 0 }; }
  async list(prefix: string, query: string, offset: number, limit: number) { const names = [...this.files.keys()].filter(name => (!prefix || name.startsWith(prefix + "/")) && name.includes(query)).sort(); return { total: names.length, nextOffset: offset + limit < names.length ? offset + limit : null, items: await Promise.all(names.slice(offset, offset + limit).map(name => this.inspect(name))) }; }
  async read(path: string, offset: number, length: number): Promise<CascRead> { if (this.unavailable.has(path)) throw new Error("CASC_FILE_NOT_LOCAL_OR_OPEN_FAILED"); const entry = await this.inspect(path), bytes = this.files.get(path)!; this.reads++; await this.change?.(); if (offset + length > bytes.length) throw new Error("CASC_READ_RANGE_BUDGET"); return { path, size: bytes.length, offset, contentKey: entry.contentKey, encodingKey: entry.encodingKey, base64: bytes.subarray(offset, offset + length).toString("base64") }; }
  close() { this.closed = true; }
}
async function fixture(t: test.TestContext) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-casc-cache-")); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const install = path.join(root, "install"), workspaceRoot = path.join(root, "workspace"); await fs.mkdir(install); await fs.mkdir(workspaceRoot); await fs.writeFile(path.join(install, ".build.info"), buildInfo());
 const backend = new FakeBackend(), mounted: string[] = [], unmounted: string[] = [];
 const casc = new CascWorkspace(workspaceRoot, { install, backendFactory: () => backend, onMount: root => mounted.push(root), onUnmount: root => unmounted.push(root) }); t.after(() => casc.close());
 return { root, install, workspaceRoot, backend, casc, mounted, unmounted };
}

test("CASC source identity selects one actual active build and omits unrelated build tags", () => {
 const build = parseCascBuildInfo(buildInfo()); assert.equal(build.buildKey, "a".repeat(32)); assert.equal(build.version, "5.0.17.98310");
 assert.throws(() => parseCascBuildInfo("wrong"), /HEADER_INVALID/);
 assert.throws(() => parseCascBuildInfo(buildInfo() + `1|${"b".repeat(32)}|x|other\n`), /AMBIGUOUS/);
 assert.throws(() => parseCascBuildInfo(buildInfo("invalid")), /KEY_INVALID/);
});

test("CASC logical paths reject filesystem escapes and protocol injection", () => {
 assert.equal(safeCascPath("Mods\\Core.SC2Mod/Base.SC2Data/file.xml"), "mods/core.sc2mod/base.sc2data/file.xml");
 for (const unsafe of ["../other", "/absolute", "C:/game", "mods//file", "mods/../file", "mods/file:stream", "mods/con", "a\tb", "a\nb", "a."]) assert.throws(() => safeCascPath(unsafe), /PATH_UNSAFE/);
});

test("CASC byte cache verifies content keys, serves warm reads, and survives a new reader session", async t => {
 const { casc, backend, workspaceRoot, install } = await fixture(t);
 const first = await casc.text(file, 0, 12), second = await casc.text(file, 0, 12);
 assert.equal(first.cacheHit, false); assert.equal(second.cacheHit, true); assert.equal(first.truncated, true); assert.equal(backend.reads, 1);
 const reopened = new CascWorkspace(workspaceRoot, { install, backendFactory: () => backend });
 assert.equal((await reopened.text(file)).cacheHit, true); assert.equal(backend.reads, 1); reopened.close();
});

test("CASC same-file concurrent misses perform one native read", async t => {
 const { casc, backend } = await fixture(t); await Promise.all([casc.read(file), casc.read(file), casc.read(file)]); assert.equal(backend.reads, 1);
});

test("CASC cache corruption triggers a real reread rather than stale content", async t => {
 const { casc, backend } = await fixture(t); await casc.read(file);
 await fs.writeFile(path.join(casc.cacheRoot, "a".repeat(32), "files", file), "corrupted");
 const repaired = await casc.read(file); assert.match(repaired.bytes.toString(), /Catalog/); assert.equal(repaired.cacheHit, false); assert.equal(backend.reads, 2); assert.equal(casc.stats.invalidCacheEntries, 1);
});

test("CASC build changes isolate cache files and unmount old dependency views", async t => {
 const { casc, backend, install, mounted, unmounted } = await fixture(t);
 await casc.mount(["mods/core.sc2mod"], ["catalogs"], [], 5); assert.equal(mounted.length, 1);
 const first = await casc.read(file); await fs.writeFile(path.join(install, ".build.info"), buildInfo("b".repeat(32), "5.0.18.100000"));
 const next = await casc.read(file); assert.notEqual(next.metadata.buildKey, first.metadata.buildKey); assert.equal(next.cacheHit, false); assert.equal(unmounted.length, 1); assert.equal(backend.closed, true);
});

test("CASC rejects a source-build change during native read before persisting cache", async t => {
 const { casc, backend, install } = await fixture(t); backend.change = () => fs.writeFile(path.join(install, ".build.info"), buildInfo("b".repeat(32)));
 await assert.rejects(casc.read(file), /BUILD_CHANGED_DURING_READ/);
 await assert.rejects(fs.stat(path.join(casc.cacheRoot, "a".repeat(32), "files", file)), /ENOENT/);
});

test("CASC absent local payload stays an explicit error and is not downloaded", async t => {
 const { casc, backend } = await fixture(t); backend.unavailable.add(file);
 assert.equal((await casc.inspect(file)).local, false); await assert.rejects(casc.read(file), /NOT_LOCAL/); assert.equal(backend.reads, 0);
});

test("CASC bounded byte reads preserve offsets and never create bulk asset cache", async t => {
 const { casc, backend } = await fixture(t); const range = await casc.bytes(file, 2, 7);
 assert.equal(range.offset, 2); assert.equal(range.hex, backend.files.get(file)!.subarray(2, 9).toString("hex"));
 await assert.rejects(casc.bytes(file, 0, 4097), /BYTE_RANGE_BUDGET/);
 await assert.rejects(casc.read("missing"), /PATH_NOT_FOUND/);
});

test("CASC mounted catalog bytes are real read-only dependency input to Data and Browse", async t => {
 const f = await fixture(t), workspace = new Workspace(f.workspaceRoot), data = new DataWorkspace(workspace), browse = new BrowseWorkspace(workspace, data);
 const casc = new CascWorkspace(f.workspaceRoot, { install: f.install, backendFactory: () => f.backend, onMount: root => { data.addDependencyRoot(root); browse.addDependencyRoot(root); } }); t.after(() => casc.close());
 const report = await casc.mount(["mods/core.sc2mod"], ["catalogs"], [], 5); assert.equal(report.reports[0].status, "MOUNTED");
 const result = await data.query({ ids: ["Probe"], includeDependencies: true, limit: 2 }); assert.equal(result.objects.length, 1); assert.equal(result.objects[0].layer, "dependency");
 assert.equal((await casc.restoreMounts()).length, 1);
 const file = path.join(data.extraRoots[0], "Base.SC2Data/GameData/unitdata.xml"); await fs.writeFile(file, '<Catalog/>');
 await assert.rejects(casc.restoreMounts(), /VIEW_CORRUPTED/);
});

test("CASC dependency order and browse identity survive the first mount and a fresh session", async t => {
 const f=await fixture(t),second='mods/void.sc2mod';
 f.backend.files.set(second+'/base.sc2data/gamedata/unitdata.xml',Buffer.from('<Catalog><CUnit id="VoidProbe"><LifeMax value="60"/></CUnit></Catalog>'));
 f.backend.files.set(second+'/base.sc2data/gamedata.xml',Buffer.from('<Includes><Catalog path="GameData/unitdata.xml"/></Includes>'));
 f.backend.files.set(second+'/documentinfo',Buffer.from('<DocInfo><Dependencies><Value>file:Mods/Core.SC2Mod</Value></Dependencies></DocInfo>'));
 await fs.writeFile(path.join(f.workspaceRoot,'DocumentInfo'),'<DocInfo><Dependencies><Value>file:Mods/Void.SC2Mod</Value></Dependencies></DocInfo>');
 const make=()=>{const workspace=new Workspace(f.workspaceRoot),data=new DataWorkspace(workspace),browse=new BrowseWorkspace(workspace,data),roots:string[]=[];
  const casc=new CascWorkspace(f.workspaceRoot,{install:f.install,backendFactory:()=>f.backend,onMount:root=>{roots.push(root);data.addDependencyRoot(root);browse.addDependencyRoot(root);}});t.after(()=>casc.close());return {browse,casc,roots};};
 const first=make();await first.casc.mount([second,'mods/core.sc2mod'],['catalogs'],[],12);
 const before=await first.browse.status();
 assert.equal((await first.browse.resolve({id:'Probe',catalogType:'Unit'})).dependencyReady,true);
 assert.equal((await first.browse.resolve({id:'VoidProbe',catalogType:'Unit'})).dependencyReady,true);
 const fresh=make();await fresh.casc.restoreMounts();
 assert.deepEqual(fresh.roots,first.roots);
 assert.equal((await fresh.browse.status()).fingerprint,before.fingerprint);
 assert.equal((await fresh.browse.resolve({id:'Probe',catalogType:'Unit'})).dependencyReady,true);
 assert.equal((await fresh.browse.resolve({id:'VoidProbe',catalogType:'Unit'})).dependencyReady,true);
 await fresh.casc.mount(['mods/core.sc2mod',second],['catalogs'],[],12);
 assert.deepEqual(fresh.roots,first.roots,'remounting existing packages must not reorder dependencies');
 assert.equal((await fresh.browse.status()).fingerprint,before.fingerprint);
});

test('CASC legacy manifests retain their established order and reject invalid ordinals before registration',async t=>{
 const f=await fixture(t),second='mods/void.sc2mod';f.backend.files.set(second+'/base.sc2data/gamedata/unitdata.xml',Buffer.from('<Catalog><CUnit id="VoidProbe"/></Catalog>'));
 await f.casc.mount([second,'mods/core.sc2mod'],['catalogs'],[],12);
 const directory=path.join(f.casc.cacheRoot,'a'.repeat(32),'mounts'),names=(await fs.readdir(directory)).sort(),expected:string[]=[];
 for(const name of names){const file=path.join(directory,name),record=JSON.parse(await fs.readFile(file,'utf8'));delete record.registrationOrder;expected.push(record.root);await fs.writeFile(file,JSON.stringify(record));}
 const roots:string[]=[],legacy=new CascWorkspace(f.workspaceRoot,{install:f.install,backendFactory:()=>f.backend,onMount:root=>roots.push(root)});t.after(()=>legacy.close());
 await legacy.restoreMounts();assert.deepEqual(roots,expected);
 for(const [i,name]of names.entries())assert.equal(JSON.parse(await fs.readFile(path.join(directory,name),'utf8')).registrationOrder,i);
 await legacy.mount([second,'mods/core.sc2mod'],['catalogs'],[],12);assert.deepEqual(roots,expected);
 const freshRoots:string[]=[],fresh=new CascWorkspace(f.workspaceRoot,{install:f.install,backendFactory:()=>f.backend,onMount:root=>freshRoots.push(root)});t.after(()=>fresh.close());await fresh.restoreMounts();assert.deepEqual(freshRoots,expected);
 const file=path.join(directory,names[0]),record=JSON.parse(await fs.readFile(file,'utf8'));
 for(const order of [-1,1.5,2,1]){
  record.registrationOrder=order;await fs.writeFile(file,JSON.stringify(record));let registrations=0;
  const invalid=new CascWorkspace(f.workspaceRoot,{install:f.install,backendFactory:()=>f.backend,onMount:()=>registrations++});t.after(()=>invalid.close());await assert.rejects(invalid.restoreMounts(),/MOUNT_ORDER_INVALID/);assert.equal(registrations,0);
 }
});

test('CASC concurrent mount, ensure and restore preserve one registration sequence',async t=>{
 const f=await fixture(t),second='mods/void.sc2mod';f.backend.files.set(second+'/base.sc2data/gamedata/unitdata.xml',Buffer.from('<Catalog><CUnit id="VoidProbe"/></Catalog>'));
 const [mounted,ensured,restored]=await Promise.all([f.casc.mount(['mods/core.sc2mod'],['catalogs'],[],12),f.casc.ensurePackage(second,['catalogs'],[]),f.casc.restoreMounts()]);
 assert.equal(mounted.reports[0].status,'MOUNTED');assert.equal(ensured.cacheHit,false);assert.deepEqual(restored,f.mounted);assert.equal(f.mounted.length,2);
 const roots:string[]=[],fresh=new CascWorkspace(f.workspaceRoot,{install:f.install,backendFactory:()=>f.backend,onMount:root=>roots.push(root)});t.after(()=>fresh.close());await fresh.restoreMounts();assert.deepEqual(roots,f.mounted);
});

test("CASC mount limits and partial payloads do not register incomplete roots", async t => {
 const { casc, mounted, backend } = await fixture(t); await assert.rejects(casc.mount(["mods/core.sc2mod"], ["catalogs"], [], 1), /FILE_COUNT_BUDGET/); assert.equal(mounted.length, 0);
 backend.unavailable.add(file); const report = await casc.mount(["mods/core.sc2mod"], ["catalogs"], [], 5); assert.equal(report.reports[0].status, "PARTIAL_NOT_MOUNTED"); assert.equal(mounted.length, 0);
});

test("CASC compressed Galaxy summaries reuse parser output with exact source SHA", async t => {
 const { casc } = await fixture(t), first = await casc.symbols(galaxy, "UnitCreate"), second = await casc.symbols(galaxy, "UnitCreate");
 assert.equal(first.summaryCacheHit, false); assert.equal(second.summaryCacheHit, true); assert.equal(second.items[0].name, "UnitCreate");
 await assert.rejects(casc.symbols(file), /GALAXY_FILE_REQUIRED/);
});

test("CASC cache rejects a symlink root instead of writing outside its scope", async t => {
 const { casc, root } = await fixture(t), outside = path.join(root, "outside"); await fs.mkdir(outside);
 await fs.symlink(outside, casc.cacheRoot, process.platform === "win32" ? "junction" : "dir");
 await assert.rejects(casc.read(file), /SYMLINK_REFUSED/); assert.deepEqual(await fs.readdir(outside), []);
});

test("CASC tool schemas remain bounded and unsafe reads return tool errors", async t => {
 const { casc } = await fixture(t), tools = new Map<string, { schema: ZodType; handler: (args: any) => Promise<any> }>();
 registerCascTools({ registerTool(name: string, config: { inputSchema: ZodType; annotations: { readOnlyHint: boolean } }, handler: (args: any) => Promise<any>) { assert.equal(config.annotations.readOnlyHint, true); tools.set(name, { schema: config.inputSchema, handler }); } } as unknown as McpServer, casc);
 assert.equal(tools.size, 9); const read = tools.get("casc.read_text")!; const result = await read.handler(read.schema.parse({ file: "../escape" })); assert.equal(result.isError, true);
 assert.equal(tools.get("casc.read_bytes")!.schema.safeParse({ file, length: 100000 }).success, false);
});

test("CASC cache destinations inside the installation are refused", async t => {
 const { workspaceRoot, install } = await fixture(t);
 assert.throws(() => new CascWorkspace(workspaceRoot, { install, cacheRoot: path.join(install, "cache") }), /INSIDE_INSTALL_REFUSED/);
});

test("Data cannot mutate a mounted CASC dependency view through direct or batch writes", async t => {
 const f = await fixture(t), workspace = new Workspace(f.workspaceRoot), data = new DataWorkspace(workspace);
 const casc = new CascWorkspace(f.workspaceRoot, { install: f.install, backendFactory: () => f.backend, onMount: root => data.addDependencyRoot(root) }); t.after(() => casc.close());
 await casc.mount(["mods/core.sc2mod"], ["catalogs"], [], 5);
 const file = path.relative(f.workspaceRoot, path.join(data.extraRoots[0], "Base.SC2Data/GameData/unitdata.xml"));
 await assert.rejects(data.apply({ file, operations: [{ op: "object.create", ctype: "CUnit", id: "Other" }] }), /DEPENDENCY_READ_ONLY/);
 await assert.rejects(data.batch({ changes: [{ file, operations: [{ op: "object.create", ctype: "CUnit", id: "Other" }] }] }), /DEPENDENCY_READ_ONLY/);
});


test("CASC trigger views include native SC2Lib and root Triggers bytes rather than only Galaxy files", async t => {
 const f=await fixture(t),library="mods/core.sc2mod/base.sc2data/triggerlibs/sample.sc2lib",triggers="mods/core.sc2mod/triggers";
 const libraryBytes=Buffer.from('<TriggerData><Library Id="Test"><Root/></Library></TriggerData>'),triggerBytes=Buffer.from('<TriggerData><Root/></TriggerData>');
 f.backend.files.set(library,libraryBytes);f.backend.files.set(triggers,triggerBytes);
 const report=await f.casc.mount(["mods/core.sc2mod"],["triggers"],[],10);assert.equal(report.reports[0].status,"MOUNTED");
 const mounted=f.mounted[0];assert.ok(mounted);
 assert.deepEqual(await fs.readFile(path.join(mounted,"Base.SC2Data/TriggerLibs/sample.sc2lib")),libraryBytes);
 assert.deepEqual(await fs.readFile(path.join(mounted,"Triggers")),triggerBytes);
 assert.equal((await f.casc.restoreMounts()).length,1);
});

test('CASC campaign mount ignores embedded map catalogs and retains earlier kinds',async t=>{
 const f=await fixture(t);const file='campaigns/test.sc2campaign/base.sc2data/gamedata/unitdata.xml';
 f.backend.files.set(file,Buffer.from('<Catalog><CUnit id="Owned"/></Catalog>'));
 f.backend.files.set('campaigns/test.sc2campaign/base.sc2maps/maps/demo.sc2map/base.sc2data/gamedata/unitdata.xml',Buffer.from('<Catalog><CUnit id="Unrelated"/></Catalog>'));
 const mounted=await f.casc.mount(['campaigns/test.sc2campaign'],['catalogs'],[],20);assert.equal(mounted.reports[0].files,1);
 const first=await f.casc.ensurePackage('campaigns/test.sc2campaign',['catalogs'],[]);assert.equal(first.cacheHit,true);
});

test("Internal preview read streams large CASC binaries and keeps default budget unchanged",async t=>{const {casc,backend}=await fixture(t);const large="mods/core.sc2mod/base.sc2assets/large.m3",bytes=Buffer.alloc(17*1024*1024,23);backend.files.set(large,bytes);await assert.rejects(casc.read(large),/FULL_FILE_BYTE_BUDGET/);assert.equal(backend.reads,0);const result=await casc.readLimited(large,32*1024*1024);assert.deepEqual(result.bytes,bytes);assert.equal(backend.reads,5);await assert.rejects(casc.read(large),/FULL_FILE_BYTE_BUDGET/);assert.equal((await casc.readLimited(large,32*1024*1024)).cacheHit,true);});
