import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { currentArchive, liveDigest, liveFileDigest } from "../modules/editorLive/identity.js";
import { Workspace } from "../core/workspace.js";
import { versionMarker } from "../modules/document/codecs/metadata.js";
import { prepareEditorLoad } from "../modules/map/editorLoad.js";
import type { LiveRuntime } from "../modules/editorLive/runtime.js";
import {
  ensureRefreshRollback,
  prepareRefreshPackage,
  stageRefreshCandidate,
} from "../modules/editorLive/refreshPackage.js";

test("only the exact native-load normalization may differ from prepared component bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-normalization-")),
    components = path.join(root, "Components"),
    archive = path.join(root, "Current.SC2Map");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(components);
  await fs.writeFile(archive, "current map");
  const files = new Map([
    [
      "Objects",
      Buffer.from(
        '<PlacedObjects Version="27"><ObjectUnit Id="1" Position="1,2,0" UnitType="Marine" Player="1"/></PlacedObjects>',
      ),
    ],
    ["Preload.xml", Buffer.from('<Preload><Movie id="UserMovie"/></Preload>')],
    ["ComponentList.SC2Components", Buffer.from("<Components/>")],
    [
      "MapInfo.version",
      versionMarker("mapi", { major: 5, minor: 0, patch: 17, build: 98310 }, 1792517421, 1),
    ],
  ]);
  for (const [file, bytes] of files) await fs.writeFile(path.join(components, file), bytes);
  const load = prepareEditorLoad(files);
  let corruptPreload = false;
  const runtime: LiveRuntime = {
    workspace: new Workspace(components),
    call: async () => ({}),
    close: async () => {},
    export: async (candidate) => {
      await fs.mkdir(path.dirname(candidate), { recursive: true });
      await fs.writeFile(candidate, "reopened verified package");
      const hashes = Object.fromEntries(
        [...load.next].map(([file, bytes]) => [file, liveDigest(bytes)]),
      );
      if (corruptPreload) hashes["Preload.xml"] = liveDigest(Buffer.from("lost manual preload"));
      return {
        verification: { reopened: true, contentSha256: hashes },
        editorLoad: { changed: load.changed },
      };
    },
  };
  const baseline = new Map([["Objects", liveDigest(Buffer.from("previous objects"))]]);
  const result = await prepareRefreshPackage(runtime, baseline, archive, root);
  assert.ok(result?.changed.includes("Preload.xml"));
  assert.equal(await fs.readFile(archive, "utf8"), "current map");
  corruptPreload = true;
  await assert.rejects(
    prepareRefreshPackage(runtime, baseline, archive, root),
    /EXPORT_COMPONENT_MISMATCH: Preload.xml/,
  );
  assert.equal(await fs.readFile(archive, "utf8"), "current map");
});

test("a cross-volume package is fully staged beside its original before atomic publication", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-package-")),
    archive = path.join(root, "Current.SC2Map"),
    packed = path.join(root, "Packed.SC2Map"),
    bytes = Buffer.from("validated component package"),
    originalStat = fs.stat;
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(archive, "original current map");
  await fs.writeFile(packed, bytes);
  // Emulate only the source device identifier; copying, hashes and rename are real.
  const probe = t.mock.method(fs, "stat", async (...args: Parameters<typeof fs.stat>) => {
    const stat = await originalStat(...args);
    return String(args[0]) === packed
      ? { ...stat, dev: typeof stat.dev === "bigint" ? stat.dev + 1n : stat.dev + 1 }
      : stat;
  });
  const staged = await stageRefreshCandidate(packed, archive, liveDigest(bytes), root);
  probe.mock.restore();
  assert.notEqual(staged, packed);
  assert.equal(path.dirname(path.dirname(staged)), root);
  assert.deepEqual(await fs.readFile(staged), bytes);
  assert.equal(await fs.readFile(archive, "utf8"), "original current map");
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, "Staging.json"), "utf8")).candidate,
    staged,
  );
  await fs.rename(staged, archive);
  assert.deepEqual(await fs.readFile(archive), bytes);
  assert.deepEqual(await fs.readFile(packed), bytes);
});

test("a valid pre-close rollback can be reused but a conflicting artifact is never overwritten", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-rollback-")),
    archive = path.join(root, "Current.SC2Map"),
    rollback = path.join(root, "OriginalArchive.rollback"),
    bytes = Buffer.from("original current map");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(archive, bytes);
  await ensureRefreshRollback(archive, rollback, liveDigest(bytes));
  await ensureRefreshRollback(archive, rollback, liveDigest(bytes));
  await fs.writeFile(rollback, "preserve conflicting rollback");
  await assert.rejects(
    ensureRefreshRollback(archive, rollback, liveDigest(bytes)),
    /ROLLBACK_INVALID/,
  );
  assert.equal(await fs.readFile(rollback, "utf8"), "preserve conflicting rollback");
  assert.deepEqual(await fs.readFile(archive), bytes);
});

test("archive and rollback digests agree across multiple streaming chunks", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-stream-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, "Current.SC2Map"),
    rollback = path.join(root, "OriginalArchive.rollback"),
    contents = Buffer.alloc(2 * 1024 * 1024 + 37);
  for (let i = 0; i < contents.length; i++) contents[i] = i % 251;
  await fs.writeFile(archive, contents);
  const expected = liveDigest(contents);
  assert.equal((await currentArchive(root, archive)).sha256, expected);
  await ensureRefreshRollback(archive, rollback, expected);
  await fs.writeFile(rollback, Buffer.alloc(contents.length));
  await assert.rejects(ensureRefreshRollback(archive, rollback, expected), /ROLLBACK_INVALID/);
  assert.equal((await currentArchive(root, archive)).sha256, expected);
});

test("a file changed during digest is rejected rather than accepted as a stable map", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-changing-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, "Current.SC2Map"),
    original = fs.lstat;
  await fs.writeFile(archive, "map before concurrent edit");
  const probe = t.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
    if (String(args[0]) === archive) await fs.appendFile(archive, "concurrent edit");
    return original(...args);
  });
  await assert.rejects(liveFileDigest(archive), /LIVE_FILE_CHANGED_DURING_HASH/);
  probe.mock.restore();
  assert.equal(await fs.readFile(archive, "utf8"), "map before concurrent editconcurrent edit");
});
