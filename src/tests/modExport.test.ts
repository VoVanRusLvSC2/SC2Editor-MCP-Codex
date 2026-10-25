import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Workspace } from "../core/workspace.js";
import type { FileSnapshot } from "../core/fileTransactions.js";
import { MapWorkspace } from "../modules/map/workspace.js";
import { documentPlanSchema } from "../modules/document/schemas.js";
import { generateFoundation } from "../modules/document/manifest.js";
import { documentHeader, documentInfo, readDocumentHeader } from "../modules/document/codecs/metadata.js";
import { archiveBackendAvailable, archiveMetadataFile, directoryManifest, extractArchive, inspectArchive, type DirectoryEntry } from "../archive/archiveAdapter.js";

async function fixture(t: { after(fn: () => Promise<unknown>): void }, modType: "dependent" | "extension" = "dependent") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-authored-mod-export-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "mod");
  const generated = generateFoundation(documentPlanSchema.parse({ kind:"mod", modType, destination:"mod", dependencies:{ mode:"custom", entries:[] } }), "5.0.17.98310", 1792517421, "authored-mod-export-test");
  generated.files.set("Base.SC2Data/GameData.xml", Buffer.from('<Includes><Catalog path="GameData/UnitData.xml"/></Includes>\r\n'));
  generated.files.set("Base.SC2Data/GameData/UnitData.xml", Buffer.from('<Catalog><!-- manual annotation --><CUnit id="ExportedUnit" parent="Marine"><LifeMax value="175"/></CUnit></Catalog>\r\n'));
  generated.files.set("Triggers", Buffer.from('<TriggerData><Root><Item Type="Folder" Id="1234ABCD"/></Root><Element Type="Folder" Id="1234ABCD"><Identifier>GAMEPLAY</Identifier></Element></TriggerData>\r\n'));
  generated.files.set("Scripts/Authored.galaxy", Buffer.from('// Authored content\r\nvoid Authored () { }\r\n'));
  generated.files.set("Preload.xml", Buffer.from('<Preload><Model id="ManualModel" Future="preserve"/></Preload>\r\n'));
  generated.files.set("opaque.bin", Buffer.from([255, 0, 128, 10]));
  for (const [file, bytes] of generated.files) {
    await fs.mkdir(path.dirname(path.join(source, file)), { recursive:true });
    await fs.writeFile(path.join(source, file), bytes);
  }
  const workspace = new Workspace(root), map = new MapWorkspace(workspace);
  return { root, source, workspace, map };
}

for (const modType of ["dependent", "extension"] as const) test(`authored ${modType} mod export reopens exact committed Data, GUI, script and opaque bytes`, { skip:!archiveBackendAvailable() }, async t => {
  const f = await fixture(t, modType), before = await directoryManifest(f.source);
  assert.equal((await f.map.inspect("mod")).valid, false); // It has no map terrain or MapInfo.
  const dry = await f.map.export("mod", "out.SC2Mod");
  assert.equal(dry.kind, "mod");
  assert.deepEqual(dry.editorLoad.changed, []);
  await assert.rejects(fs.stat(path.join(f.root, "out.SC2Mod")), { code:"ENOENT" });
  const result = await f.map.export("mod", "out.SC2Mod", false);
  assert.ok("verification" in result);
  assert.equal(result.verification.reopened, true);
  assert.deepEqual(result.verification.contentSha256, Object.fromEntries(before.map(file => [file.file,file.sha256])));
  assert.deepEqual(result.editorLoad.changed, []);
  assert.equal(result.editorLoad.rendering, "NOT_APPLICABLE_MOD");
  assert.equal(result.editorValidation, "NOT_EXECUTED");
  await extractArchive(path.join(f.root, "out.SC2Mod"), path.join(f.root, "reopened"));
  assert.deepEqual(await directoryManifest(path.join(f.root, "reopened")), before);
  assert.deepEqual(await directoryManifest(f.source), before);
});

test("mod export preserves locale identities and existing output backups under the root output guard", { skip:!archiveBackendAvailable() }, async t => {
  const f = await fixture(t), map = new MapWorkspace(new Workspace(f.source));
  await fs.mkdir(path.join(f.source, ".sc2mcp-locales/1033"), { recursive:true });
  await fs.writeFile(path.join(f.source, ".sc2mcp-locales/1033/opaque.bin"), "localized bytes");
  await fs.writeFile(path.join(f.source, archiveMetadataFile), JSON.stringify({ protocol:"sc2-mcp-storm-v1", stormRevision:"test", headerOffset:0, entries:[
    { name:"opaque.bin", localPath:"opaque.bin", locale:0, flags:0x30000, size:4, fileTime:"1234", internal:false },
    { name:"opaque.bin", localPath:".sc2mcp-locales/1033/opaque.bin", locale:1033, flags:0, size:15, fileTime:"0", internal:false },
  ] }));
  await fs.writeFile(path.join(f.source,"opaque.bin.sc2uimcp.bak"),"excluded backup");
  await fs.writeFile(path.join(f.source,".sc2mcp-document.json"),"old foundation manifest");
  const before = await directoryManifest(f.source), target = ".sc2mcp-output/Export.SC2Mod";
  await fs.mkdir(path.join(f.source,".sc2mcp-output"));
  await fs.writeFile(path.join(f.source,target),"old output");
  const result = await map.export("",target,false);
  assert.ok("backup" in result && result.backup);
  assert.equal(await fs.readFile(result.backup,"utf8"),"old output");
  const packed = await inspectArchive(path.join(f.source,target));
  assert.equal(packed.entries.filter(entry => !entry.internal).length,before.length);
  assert.ok(packed.entries.some(entry => entry.name === "opaque.bin" && entry.locale === 1033));
  assert.ok(packed.entries.some(entry => entry.name === "opaque.bin" && entry.locale === 0 && (entry.flags & 0x10000) !== 0));
  await extractArchive(path.join(f.source,target),path.join(f.root,"reopened"));
  assert.deepEqual(await directoryManifest(path.join(f.root,"reopened")),before);
  assert.deepEqual(await directoryManifest(f.source),before);
  await assert.rejects(map.export("","inside.SC2Mod",false),/INSIDE_COMPONENTS/);
  await assert.rejects(map.export("","../escape.SC2Mod",false),/escapes/);
});

test("both text and binary drafts block authored mod export", async t => {
  const f = await fixture(t);
  await f.workspace.applyRawTransaction(["mod/Scripts/Authored.galaxy"], sources => new Map([["mod/Scripts/Authored.galaxy",sources.get("mod/Scripts/Authored.galaxy")! + "// draft\n"]]), { dryRun:false, stage:true });
  await assert.rejects(f.map.export("mod","text.SC2Mod",false),/DRAFTS_PENDING/);
  const binaryWorkspace = new Workspace(f.root), map = new MapWorkspace(binaryWorkspace);
  await binaryWorkspace.binary.apply(["mod/opaque.bin"],() => new Map([["mod/opaque.bin",Buffer.from("draft")]]),{ dryRun:false,stage:true });
  await assert.rejects(map.export("mod","binary.SC2Mod",false),/DRAFTS_PENDING/);
});

const negativeCases: Array<[string, (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>, RegExp]> = [
  ["map Header under mod extension", async f => { const file=path.join(f.source,"DocumentHeader"), bytes=await fs.readFile(file); bytes.writeUInt32LE(0,24); await fs.writeFile(file,bytes); }, /KIND_MISMATCH/],
  ["map components under mod Header", f => fs.writeFile(path.join(f.source,"MapInfo"),"map bytes"), /MAP_COMPONENT_PRESENT/],
  ["truncated Header", async f => { const file=path.join(f.source,"DocumentHeader"); await fs.writeFile(file,(await fs.readFile(file)).subarray(0,30)); }, /TRUNCATED/],
  ["unsupported Header version", async f => { const file=path.join(f.source,"DocumentHeader"), bytes=await fs.readFile(file); bytes.writeUInt32LE(9,4); await fs.writeFile(file,bytes); }, /HEADER_PROFILE/],
  ["trailing Header bytes", f => fs.appendFile(path.join(f.source,"DocumentHeader"),Buffer.from([0])), /TRAILING_BYTES/],
  ["Header build divergence", async f => { const file=path.join(f.source,"DocumentHeader"), bytes=await fs.readFile(file); bytes.writeUInt32LE(1,20); await fs.writeFile(file,bytes); }, /HEADER_INVALID/],
  ["dependency section divergence", f => fs.writeFile(path.join(f.source,"DocumentInfo"),documentInfo(["file:Mods/Other.SC2Mod"],false)), /DEPENDENCY_SECTIONS_DISAGREE/],
  ["malformed DocumentInfo XML", f => fs.writeFile(path.join(f.source,"DocumentInfo"),"<DocInfo><Dependencies></DocInfo>"), /INFO_INVALID/],
  ["malformed dependency children", f => fs.writeFile(path.join(f.source,"DocumentInfo"),"<DocInfo><ModType><Value>Interface</Value></ModType><Dependencies><Invalid/></Dependencies></DocInfo>"), /INFO_PROFILE/],
  ["missing registered marker", f => fs.unlink(path.join(f.source,"Triggers.version")), /COMPONENT_MISSING/],
  ["malformed registered marker", f => fs.writeFile(path.join(f.source,"GameData.version"),"malformed"), /VERSION_PROFILE/],
  ["registered marker type mismatch", async f => { await fs.writeFile(path.join(f.source,"GameData.version"),await fs.readFile(path.join(f.source,"Triggers.version"))); }, /VERSION_MISMATCH/],
  ["unsafe registered root", f => fs.writeFile(path.join(f.source,"ComponentList.SC2Components"),'<Components><DataComponent Type="info">../DocumentInfo</DataComponent></Components>'), /UNSAFE_ARCHIVE_NAME/],
  ["malformed component XML", f => fs.writeFile(path.join(f.source,"ComponentList.SC2Components"),'<Components><DataComponent Type="info">DocumentInfo</Components>'), /COMPONENT_LIST_INVALID/],
  ["map terrain registration", f => fs.writeFile(path.join(f.source,"ComponentList.SC2Components"),'<Components><DataComponent Type="terr">t3Terrain.xml</DataComponent></Components>'), /MAP_COMPONENT_PRESENT/],
  ["duplicate registration", f => fs.writeFile(path.join(f.source,"ComponentList.SC2Components"),'<Components><DataComponent Type="info">DocumentInfo</DataComponent><DataComponent Type="info">DocumentInfo</DataComponent></Components>'), /COMPONENT_DUPLICATE/],
];
for (const [name, mutate, expected] of negativeCases) test("mod export rejects " + name + " before replacing an output", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root,"existing.SC2Mod"),"preserved output");
  await mutate(f);
  await assert.rejects(f.map.export("mod","existing.SC2Mod",false),expected);
  assert.equal(await fs.readFile(path.join(f.root,"existing.SC2Mod"),"utf8"),"preserved output");
  await assert.rejects(fs.stat(path.join(f.root,"existing.SC2Mod.sc2uimcp.bak")),{ code:"ENOENT" });
});

test("valid mod cannot use a map extension, and matching ordered dependencies are retained", async t => {
  const f = await fixture(t);
  await assert.rejects(f.map.export("mod","out.SC2Map"),/KIND_MISMATCH/);
  const file = path.join(f.source,"DocumentHeader"), header = readDocumentHeader(await fs.readFile(file));
  const dependencies = ["file:Mods/A&B.SC2Mod","file:Mods/B.SC2Mod"];
  await fs.writeFile(file,documentHeader(dependencies,header.strings,header,"mod",header.identity));
  await fs.writeFile(path.join(f.source,"DocumentInfo"),documentInfo(dependencies,false));
  assert.equal((await f.map.export("mod","out.SC2Mod")).kind,"mod");
  await fs.writeFile(path.join(f.source,"DocumentInfo"),documentInfo([...dependencies].reverse(),false));
  await assert.rejects(f.map.export("mod","out.SC2Mod"),/DEPENDENCY_SECTIONS_DISAGREE/);
});

// Mutate only the test source after the real snapshot boundary, before archive publication.
function afterSnapshot(map: MapWorkspace, mutate: () => Promise<unknown>) {
  const internal = map as unknown as { snapshotCopy(directory:string,destination:string,files:DirectoryEntry[]):Promise<FileSnapshot> };
  const copy = internal.snapshotCopy.bind(map);
  internal.snapshotCopy = async (...args) => { const result=await copy(...args); await mutate(); return result; };
}
for (const change of ["content","new entry","archive metadata"] as const) test(`mod export refuses ${change} changed after the committed snapshot`, { skip:!archiveBackendAvailable() }, async t => {
  const f = await fixture(t), target=path.join(f.root,"existing.SC2Mod");
  await fs.writeFile(target,"preserved output");
  afterSnapshot(f.map, async () => {
    if(change === "content") return fs.appendFile(path.join(f.source,"Scripts/Authored.galaxy"),"// external change");
    if(change === "new entry") return fs.writeFile(path.join(f.source,"external.bin"),"external change");
    return fs.writeFile(path.join(f.source,archiveMetadataFile),"changed metadata");
  });
  await assert.rejects(f.map.export("mod","existing.SC2Mod",false), change === "archive metadata" ? /STALE_FILE_TRANSACTION/ : /STALE_MAP_EXPORT/);
  assert.equal(await fs.readFile(target,"utf8"),"preserved output");
});

test("mod export rejects malformed archive metadata without changing an output", { skip:!archiveBackendAvailable() }, async t => {
  const f=await fixture(t);
  await fs.writeFile(path.join(f.root,"existing.SC2Mod"),"preserved output");
  await fs.writeFile(path.join(f.source,archiveMetadataFile),'{}');
  await assert.rejects(f.map.export("mod","existing.SC2Mod",false),/INVALID_ARCHIVE_MANIFEST/);
  assert.equal(await fs.readFile(path.join(f.root,"existing.SC2Mod"),"utf8"),"preserved output");
});

test("mod export rejects source archive metadata symlinks before publication", { skip:!archiveBackendAvailable() }, async t => {
  const f=await fixture(t), target=path.join(f.root,"metadata.json");
  await fs.writeFile(target,JSON.stringify({ protocol:"sc2-mcp-storm-v1",stormRevision:"test",headerOffset:0,entries:[] }));
  try { await fs.symlink(target,path.join(f.source,archiveMetadataFile)); }
  catch(error) { if((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Symlink privilege unavailable"); return; } throw error; }
  await assert.rejects(f.map.export("mod","out.SC2Mod",false),/symlink/i);
  await assert.rejects(fs.stat(path.join(f.root,"out.SC2Mod")),{ code:"ENOENT" });
});

test("registered public map.export MCP tool exports an authored mod with exact reopen evidence", { skip:!archiveBackendAvailable(), timeout:30000 }, async t => {
  const f=await fixture(t), before=await directoryManifest(f.source);
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string] => entry[1] !== undefined));
  env.SC2_UI_ROOT=f.root; env.SC2_MCP_MODULES="map"; delete env.SC2_MCP_PROFILE;
  const client=new Client({ name:"authored-mod-export-test",version:"1" });
  try {
    await client.connect(new StdioClientTransport({ command:process.execPath,args:["dist/index.js"],env,stderr:"pipe" }));
    const response=await client.callTool({ name:"map.export",arguments:{ directory:"mod",archive:"out.SC2Mod",dryRun:false } });
    assert.notEqual(response.isError,true,JSON.stringify(response));
    if(response.content[0].type !== "text") throw new Error("Expected text response");
    const result=JSON.parse(response.content[0].text);
    assert.equal(result.kind,"mod");
    assert.equal(result.verification.reopened,true);
    assert.deepEqual(result.verification.contentSha256,Object.fromEntries(before.map(file => [file.file,file.sha256])));
  } finally { await client.close(); }
});
