import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { createProject } from "../app/project.js";
import { bridgeCapabilities } from "../core/capabilities.js";
import { projectCoverage } from "../app/coverage.js";
import { dispatchGuiApi } from "../gui/api.js";

const commit = { dryRun: false, stage: false, backup: false };
const stage = { dryRun: false, stage: true };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-project-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "a"), "A");
  await fs.writeFile(path.join(root, "b"), "B");
  return new Workspace(root);
}

test("text and binary commands share a queue, retain both edits and recover after failure", async t => {
  const w = await fixture(t);
  const first = w.applyRawTransaction(["a"], async s => {
    await new Promise<void>(resolve => setImmediate(resolve));
    return new Map([["a", s.get("a")! + "1"]]);
  }, commit);
  const second = w.binary.apply(["a"], s => new Map([["a", Buffer.concat([s.get("a")!, Buffer.from("2")])]]), commit);
  await Promise.all([first, second]);
  assert.equal((await w.readRaw("a")).text, "A12");
  const bad = w.applyRawTransaction(["a"], () => { throw new Error("bad operation"); }, commit);
  const good = w.applyRawTransaction(["a"], s => new Map([["a", s.get("a")! + "3"]]), commit);
  await assert.rejects(bad, /bad operation/); await good;
  assert.equal((await w.readRaw("a")).text, "A123");
});

test("saving one member saves its entire text group; external edits block every member", async t => {
  const w = await fixture(t);
  await w.applyRawTransaction(["a", "b"], () => new Map([["a", "A1"], ["b", "B1"]]), stage);
  await fs.writeFile(w.resolveUserPath("b"), "EDITOR");
  await assert.rejects(w.save("a"), /STALE_TEXT_DRAFT/);
  assert.equal((await w.readRaw("a", false)).text, "A");
  assert.equal((await w.readRaw("b", false)).text, "EDITOR");
  assert.deepEqual(w.draftFiles().sort(), ["a", "b"]);
  await fs.writeFile(w.resolveUserPath("b"), "B");
  const result = await w.save("a", { backup: false });
  assert.deepEqual(result.savedFiles.sort(), ["a", "b"]);
  assert.equal((await w.readRaw("b", false)).text, "B1");
  assert.deepEqual(w.draftFiles(), []);
});

test("partial group edits fail and discard removes the whole coupled draft", async t => {
  const w = await fixture(t);
  await w.applyRawTransaction(["a", "b"], () => new Map([["a", "A1"]]), stage);
  await assert.rejects(w.applyRawTransaction(["a"], s => new Map(s), commit), /PARTIAL_TEXT_TRANSACTION/);
  assert.equal(w.discard("b"), true);
  assert.deepEqual(w.draftFiles(), []);
  assert.equal((await w.readRaw("a")).text, "A");
});

test("async validation cannot overwrite an external edit or a discarded draft", async t => {
  const w = await fixture(t);
  await assert.rejects(w.applyRawTransaction(["a"], async () => {
    await fs.writeFile(w.resolveUserPath("a"), "EDITOR");
    return new Map([["a", "NEW"]]);
  }, commit), /STALE_FILE_TRANSACTION/);
  assert.equal((await w.readRaw("a")).text, "EDITOR");
  await w.applyRawTransaction(["a"], () => new Map([["a", "draft"]]), stage);
  await assert.rejects(w.applyRawTransaction(["a"], async () => {
    w.discard("a");
    return new Map([["a", "NEW"]]);
  }, commit), /STALE_TEXT_DRAFT/);
  assert.equal((await w.readRaw("a")).text, "EDITOR");
});

test("identity commit flushes a pending draft and never leaves an obsolete text view", async t => {
  const w = await fixture(t);
  await w.applyRawTransaction(["a"], () => new Map([["a", "draft"]]), stage);
  await w.applyRawTransaction(["a"], s => new Map(s), commit);
  assert.equal(w.hasDraft("a"), false);
  assert.equal((await w.readRaw("a", false)).text, "draft");
});

test("second rename failure restores all original bytes and keeps the staged group", async t => {
  const w = await fixture(t);
  await w.applyRawTransaction(["a", "b"], () => new Map([["a", "A1"], ["b", "B1"]]), stage);
  const rename = fs.rename;
  let calls = 0;
  fs.rename = async (...args: Parameters<typeof fs.rename>) => {
    if (++calls === 2) throw new Error("injected rename failure");
    return rename(...args);
  };
  try { await assert.rejects(w.save("a", { backup: false }), /injected rename failure/); }
  finally { fs.rename = rename; }
  assert.equal((await w.readRaw("a", false)).text, "A");
  assert.equal((await w.readRaw("b", false)).text, "B");
  assert.deepEqual(w.draftFiles().sort(), ["a", "b"]);
  assert.deepEqual((await fs.readdir(w.root)).sort(), ["a", "b"]);
});

test("invalid UTF8 and symlink destinations cannot be rewritten through text editing", async t => {
  const w = await fixture(t);
  const bytes = Buffer.from([0xff, 0xfe, 0x61]);
  await fs.writeFile(w.resolveUserPath("a"), bytes);
  await assert.rejects(w.applyRawTransaction(["a"], () => new Map([["a", "new"]]), commit), /UNSUPPORTED_TEXT_ENCODING/);
  assert.deepEqual(await fs.readFile(w.resolveUserPath("a")), bytes);
  if (process.platform !== "win32") {
    await fs.symlink(os.tmpdir(), path.join(w.root, "escape"));
    assert.throws(() => w.resolveUserPath("escape/new.xml"), /symlink/);
  }
});

test("binary drafts pin existence as well as hashes and reject stale rebasing", async t => {
  const w = await fixture(t);
  const result = await w.binary.apply(["new"], () => new Map([["new", Buffer.from("draft")]]), stage);
  await fs.writeFile(w.resolveUserPath("new"), "");
  await assert.rejects(w.binary.save(result.transactionId!, { dryRun: false }), /STALE_BINARY_TRANSACTION/);
  await assert.rejects(w.binary.apply(["new"], () => new Map([["new", Buffer.from("another")]]), stage), /STALE_BINARY_TRANSACTION/);
  assert.equal((await w.binary.read("new", false)).bytes.length, 0);
});

test("composition shares Cutscene drafts, guards stale saves and keeps direct commit visible", async t => {
  const w = await fixture(t), p = await createProject(w.root);
  assert.equal(p.cutscene.workspace, p.workspace);
  await p.cutscene.create("scene.SC2Cutscene", { name: "Scene", ...stage });
  assert.equal(p.workspace.hasDraft("scene.SC2Cutscene"), true);
  assert.equal((await p.workspace.readRaw("scene.SC2Cutscene")).text, (await p.cutscene.open("scene.SC2Cutscene")).source);
  await p.cutscene.save("scene.SC2Cutscene");
  assert.equal(p.workspace.hasDraft("scene.SC2Cutscene"), false);
  const original = (await p.cutscene.open("scene.SC2Cutscene")).source;
  await p.workspace.applyRawTransaction(["scene.SC2Cutscene"], () => new Map([["scene.SC2Cutscene", original + "\n"]]), stage);
  await fs.writeFile(p.workspace.resolveUserPath("scene.SC2Cutscene"), original + "<!-- Editor -->");
  await assert.rejects(p.cutscene.save("scene.SC2Cutscene"), /STALE_TEXT_DRAFT/);
});

test("capabilities recognize component directories with map suffix and distinguish configured from verified adapters", async t => {
  const w = await fixture(t), root = path.join(w.root, "Map.SC2Map");
  await fs.mkdir(root);
  const oldRuntime = process.env.SC2_UI_RUNTIME_ADAPTER, oldArchive = process.env.SC2_UI_ARCHIVE_ADAPTER;
  process.env.SC2_UI_RUNTIME_ADAPTER = "configured"; process.env.SC2_UI_ARCHIVE_ADAPTER = "configured";
  try {
    const result = bridgeCapabilities(root);
    assert.equal(result.workspace.directlyEditable, true);
    assert.equal(result.runtime.adapterConfigured, true);
    assert.equal(result.runtime.actualGameValidation, false);
    assert.equal(result.archives.adapterConfigured, true);
    assert.equal(result.archives.packedMapReadWrite, false);
  } finally {
    if (oldRuntime === undefined) delete process.env.SC2_UI_RUNTIME_ADAPTER; else process.env.SC2_UI_RUNTIME_ADAPTER = oldRuntime;
    if (oldArchive === undefined) delete process.env.SC2_UI_ARCHIVE_ADAPTER; else process.env.SC2_UI_ARCHIVE_ADAPTER = oldArchive;
  }
});

test("project status covers exactly ten modules without claiming total engine coverage", async t => {
  const w = await fixture(t), p = await createProject(w.root);
  const report = projectCoverage(p);
  assert.deepEqual(Object.keys(report.modules).sort(), ["ai", "browse", "cutscene", "data", "map", "placement", "script", "terrain", "text", "ui"]);
  assert.equal(report.completeEngineCoverage, false);
  assert.equal(report.overallCoveragePercent, null);
  const result = await dispatchGuiApi(p.workspace, p.schema, { method: "GET", pathname: "/api/project/status" }, { ...p, projectStatus: () => report });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, report);
  const unavailable = await dispatchGuiApi(p.workspace, p.schema, { method: "GET", pathname: "/api/project/status" });
  assert.equal(unavailable.status, 503);
});

test("layout creation and Include registration form one group and fail without partial drafts", async t => {
  const w = await fixture(t);
  await fs.writeFile(w.resolveUserPath("Index.SC2Layout"), "<Desc></Desc>");
  await assert.rejects(w.createLayoutWithInclude("New.SC2Layout", "Missing.SC2Layout", stage), /Include file not found/);
  assert.equal(w.hasDraft("New.SC2Layout"), false);
  await w.createLayoutWithInclude("New.SC2Layout", "Index.SC2Layout", stage);
  const result = await w.save("New.SC2Layout", { backup: false });
  assert.deepEqual(result.savedFiles.sort(), ["Index.SC2Layout", "New.SC2Layout"]);
  assert.match((await w.readRaw("Index.SC2Layout", false)).text, /Include path="New.SC2Layout"/);
});
