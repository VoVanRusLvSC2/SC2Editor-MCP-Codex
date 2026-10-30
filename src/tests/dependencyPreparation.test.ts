import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { DataCatalogRepository } from "../modules/data/catalogRepository.js";
import { changedSnapshot, assertSnapshots } from "../core/fileTransactions.js";

test("dependency preparation shares pending work within a read scope and isolates later calls and read memos", async () => {
  const workspace = new Workspace(os.tmpdir());
  const key = {},
    other = {};
  let calls = 0;
  const prepare = async () => ++calls;
  await workspace.withReadSet(async () => {
    assert.deepEqual(
      await Promise.all([
        workspace.prepareReadScope(key, prepare),
        workspace.prepareReadScope(key, prepare),
      ]),
      [1, 1],
    );
    assert.equal(await workspace.prepareReadScope(other, prepare), 2);
    const isolated = await workspace.memoizeReads(() => workspace.prepareReadScope(key, prepare));
    assert.equal(isolated.value, 3);
    assert.equal(await workspace.prepareReadScope(key, prepare), 1);
  });
  assert.equal(await workspace.withReadSet(() => workspace.prepareReadScope(key, prepare)), 4);
  assert.equal(await workspace.prepareReadScope(key, prepare), 5);
  assert.equal(await workspace.prepareReadScope(key, prepare), 6);
});

test("a failed dependency preparation can retry without retaining its rejection", async () => {
  const workspace = new Workspace(os.tmpdir()),
    key = {};
  await workspace.withReadSet(async () => {
    await assert.rejects(
      workspace.prepareReadScope(key, async () => {
        throw Error("unavailable");
      }),
      /unavailable/,
    );
    assert.equal(await workspace.prepareReadScope(key, async () => "recovered"), "recovered");
  });
});

test("prepared inputs remain guarded through staging and later save, including equal-size edits", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "read-preparation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependency = path.join(root, "dependency.txt");
  await fs.writeFile(dependency, "before");
  const workspace = new Workspace(root),
    key = {};
  await workspace.withReadSet(async () => {
    const prepare = () => workspace.readDependency(dependency);
    assert.equal(await workspace.prepareReadScope(key, prepare), "before");
    await workspace.applyRawTransaction(
      ["output.txt"],
      () => new Map([["output.txt", "candidate"]]),
      { dryRun: false, stage: true },
    );
  });
  const stat = await fs.stat(dependency);
  await fs.writeFile(dependency, "edited");
  await fs.utimes(dependency, stat.atime, stat.mtime);
  await assert.rejects(workspace.save("output.txt"), /STALE_/);
  await assert.rejects(fs.stat(path.join(root, "output.txt")), { code: "ENOENT" });
});

test("snapshot comparisons preserve the first mismatch or I/O error in input order", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-read-order-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "first.txt");
  await fs.writeFile(file, "current");
  const resolve = (key: string) => {
    if (key === "later") throw Error("later read error");
    return file;
  };
  const reads = new Map([
    ["first", { exists: true, bytes: Buffer.from("before") }],
    ["later", { exists: true, bytes: Buffer.from("anything") }],
  ]);
  assert.equal(await changedSnapshot(resolve, reads), "first");
  await assert.rejects(assertSnapshots(resolve, reads), /STALE_FILE_TRANSACTION: first/);
  reads.set("first", { exists: true, bytes: Buffer.from("current") });
  await assert.rejects(changedSnapshot(resolve, reads), /later read error/);
  assert.equal(await changedSnapshot(resolve, new Map()), undefined);
});

async function catalogFixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-preparation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const map = path.join(root, "map"),
    dependency = path.join(root, "dep.SC2Mod");
  const file = path.join(dependency, "Base.SC2Data/GameData/UnitData.xml");
  await fs.mkdir(map);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '<Catalog><CUnit id="Native"/></Catalog>');
  await fs.writeFile(
    path.join(map, "DocumentInfo"),
    "<DocInfo><Dependencies><Value>file:dep.SC2Mod</Value></Dependencies></DocInfo>",
  );
  const workspace = new Workspace(map),
    repository = new DataCatalogRepository(workspace, [dependency]);
  return { map, dependency, file, workspace, repository };
}

test("dependency catalogs reuse prepared documents without leaking caller metadata or workspace overrides", async (t) => {
  const f = await catalogFixture(t),
    readDirectory = f.workspace.readDirectory.bind(f.workspace);
  let walks = 0;
  f.workspace.readDirectory = async (...args) => {
    if (args[0].startsWith(f.dependency)) walks++;
    return readDirectory(...args);
  };
  await f.workspace.withReadSet(async () => {
    const before = await f.repository.catalog(),
      count = walks;
    const original = before.find((r) => r.layer === "dependency")!;
    original.engineActive = false;
    original.provenance.push("caller");
    original.activationWarnings?.push("caller");
    const after = await f.repository.catalog(
      new Map([
        ["Base.SC2Data/GameData/NewData.xml", '<Catalog><CUnit id="Workspace"/></Catalog>'],
      ]),
    );
    const reused = after.find((r) => r.layer === "dependency")!;
    assert.equal(walks, count);
    assert.equal(reused.document, original.document);
    assert.notEqual(reused.engineActive, false);
    assert.equal(reused.provenance.includes("caller"), false);
    assert.equal(reused.activationWarnings?.includes("caller"), false);
    assert.equal(
      after.some(
        (r) =>
          r.layer === "workspace" && r.document.entries().some((n) => n.attrs.id === "Workspace"),
      ),
      true,
    );
  });
  const count = walks;
  await f.workspace.withReadSet(() => f.repository.catalog());
  assert.ok(walks > count);
});

for (const change of ["content", "new", "removed", "activation"] as const) {
  test(`prepared dependency catalogs reject ${change} changes inside an operation`, async (t) => {
    const f = await catalogFixture(t);
    await f.workspace.withReadSet(async () => {
      await f.repository.catalog();
      if (change === "content") {
        const stat = await fs.stat(f.file);
        await fs.writeFile(f.file, '<Catalog><CUnit id="Edited"/></Catalog>');
        await fs.utimes(f.file, stat.atime, stat.mtime);
      } else if (change === "new")
        await fs.writeFile(path.join(path.dirname(f.file), "NewData.xml"), "<Catalog/>");
      else if (change === "removed") await fs.unlink(f.file);
      else
        await fs.writeFile(
          path.join(f.dependency, "Base.SC2Data/GameData.xml"),
          '<Includes><Catalog path="GameData/UnitData.xml"/></Includes>',
        );
      await assert.rejects(f.repository.catalog(), /STALE_DATA_DEPENDENCY_CATALOG/);
    });
    await f.workspace.withReadSet(() => f.repository.catalog());
  });
}

test("prepared catalog keys include native activation configuration and refuse mutated document snapshots", async (t) => {
  const f = await catalogFixture(t);
  f.repository.addDependencyRoot(f.dependency, "mods/core.sc2mod");
  await f.workspace.withReadSet(async () => {
    f.repository.nativeCatalogFiles = new Set(["unitdata.xml"]);
    assert.equal(
      (await f.repository.catalog()).find((r) => r.layer === "dependency")!.engineActive,
      true,
    );
    f.repository.nativeCatalogFiles = new Set();
    const records = await f.repository.catalog(),
      native = records.find((r) => r.layer === "dependency")!;
    assert.notEqual(native.engineActive, true);
    native.document.source = native.document.source.replace("Native", "Edited");
    await assert.rejects(f.repository.catalog(), /STALE_DATA_DEPENDENCY_CATALOG/);
  });
});
