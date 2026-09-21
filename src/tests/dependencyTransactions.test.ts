import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../core/workspace.js";
import { createProject } from "../app/project.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-readset-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "target"), "original");
  await fs.writeFile(path.join(root, "dependency"), "reference");
  return new Workspace(root);
}
const commit = { dryRun: false, stage: false, backup: false };
const stage = { dryRun: false, stage: true };

test("preflight read set rejects changed dependencies before transform", async t => {
  const w = await fixture(t); let transformed = false;
  await assert.rejects(w.withReadSet(async () => {
    await w.readRaw("dependency");
    await fs.writeFile(w.resolveUserPath("dependency"), "external");
    await w.applyRawTransaction(["target"], () => { transformed = true; return new Map([["target", "new"]]); }, commit);
  }), /STALE_FILE_TRANSACTION/);
  assert.equal(transformed, false);
  assert.equal((await w.readRaw("target")).text, "original");
});

test("validation reads are pinned and staged dependencies survive until save", async t => {
  const w = await fixture(t);
  await w.applyRawTransaction(["target"], async () => {
    await w.readRaw("dependency"); return new Map([["target", "draft"]]);
  }, stage);
  await fs.writeFile(w.resolveUserPath("dependency"), "external");
  await assert.rejects(w.save("target"), /STALE_FILE_TRANSACTION/);
  assert.equal((await w.readRaw("target", false)).text, "original");
  assert.equal(w.hasDraft("target"), true);
  await fs.writeFile(w.resolveUserPath("dependency"), "reference");
  await w.save("target", { backup: false });
  assert.equal((await w.readRaw("target", false)).text, "draft");
});

test("external dependency roots are read-only participants, including missing file guards", async t => {
  const w = await fixture(t), external = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-external-"));
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  const file = path.join(external, "Catalog.xml"); await fs.writeFile(file, "<Catalog/>");
  await w.withReadSet(async () => {
    await w.readDependency(file);
    await w.readRaw("missing");
    await w.applyRawTransaction(["target"], () => new Map([["target", "draft"]]), stage);
  });
  await fs.writeFile(w.resolveUserPath("missing"), "");
  await assert.rejects(w.save("target"), /STALE_FILE_TRANSACTION/);
  await fs.unlink(w.resolveUserPath("missing")); await fs.writeFile(file, "<Catalog changed='1'/>");
  await assert.rejects(w.save("target"), /STALE_FILE_TRANSACTION/);
  assert.equal((await w.readRaw("target", false)).text, "original");
});

test("async dependency changes cannot commit and read contexts do not leak across calls", async t => {
  const w = await fixture(t);
  await assert.rejects(w.applyRawTransaction(["target"], async () => {
    await w.readRaw("dependency"); await fs.writeFile(w.resolveUserPath("dependency"), "external");
    return new Map([["target", "new"]]);
  }, commit), /STALE_FILE_TRANSACTION/);
  await w.applyRawTransaction(["target"], () => new Map([["target", "independent"]]), commit);
  assert.equal((await w.readRaw("target")).text, "independent");
});

test("Data staged edits retain catalog dependency snapshots until grouped save", async t => {
  const w = await fixture(t), project = await createProject(w.root);
  const dir = path.join(w.root, "Base.SC2Data/GameData"); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "UnitData.xml"), '<Catalog><CUnit id="A"/></Catalog>');
  await fs.writeFile(path.join(dir, "ActorData.xml"), '<Catalog><CActorUnit id="Actor"/></Catalog>');
  await project.data.apply({ operations: [{ op: "object.delete", object: "A" }], ...stage, validate: false });
  await fs.writeFile(path.join(dir, "ActorData.xml"), '<Catalog><CActorUnit id="Actor"><UnitName value="A"/></CActorUnit></Catalog>');
  await assert.rejects(project.workspace.save("Base.SC2Data/GameData/UnitData.xml"), /STALE_FILE_TRANSACTION/);
  assert.match(await fs.readFile(path.join(dir, "UnitData.xml"), "utf8"), /id="A"/);
});

test("AI verifies missing Triggers after staging instead of allowing a new binding to be broken", async t => {
  const w = await fixture(t), p = await createProject(w.root);
  await fs.writeFile(path.join(w.root, "CustomAI"), '<AIData><Definition Id="A"/></AIData>');
  await p.ai.apply({ operations: [{ op: "definition.rename", definition: "A", newId: "B" }], ...stage, validate: false });
  await fs.writeFile(path.join(w.root, "Triggers"), '<Triggers><Value Type="aidef" Value="A"/></Triggers>');
  await assert.rejects(p.workspace.save("CustomAI"), /STALE_FILE_TRANSACTION/);
  assert.match(await fs.readFile(path.join(w.root, "CustomAI"), "utf8"), /Id="A"/);
});

test("discarding a dependency draft invalidates a dependent staged result", async t => {
  const w = await fixture(t);
  await w.applyRawTransaction(["dependency"], () => new Map([["dependency", "new reference"]]), stage);
  await w.applyRawTransaction(["target"], async () => { await w.readRaw("dependency"); return new Map([["target", "draft"]]); }, stage);
  w.discard("dependency");
  await assert.rejects(w.save("target"), /STALE_DEPENDENCY_DRAFT/);
  assert.equal((await w.readRaw("target", false)).text, "original");
});
