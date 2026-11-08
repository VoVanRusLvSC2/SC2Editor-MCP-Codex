import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../core/workspace.js";
import { liveDigest } from "../modules/editorLive/identity.js";
import {
  prepareRefreshResources,
  refreshResourcesSchema,
} from "../modules/editorLive/refreshResources.js";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-refresh-assets-")),
    parent = path.join(root, "sources"),
    target = path.join(root, "components");
  await fs.mkdir(parent);
  await fs.mkdir(path.join(target, "Assets", "Art"), { recursive: true });
  await fs.writeFile(path.join(parent, "texture.dds"), "new texture");
  await fs.writeFile(path.join(parent, "model.m3"), "new model");
  await fs.writeFile(path.join(target, "Assets/Art/old.dds"), "old texture");
  await fs.writeFile(path.join(target, "Assets/Art/remove.dds"), "unused texture");
  await fs.writeFile(path.join(target, "Triggers"), "unchanged trigger graph");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, parent: new Workspace(parent), target: new Workspace(target) };
}

test("one prepared group adds, replaces and removes resource bytes without touching other components", async (t) => {
  const f = await fixture(t);
  const changes = refreshResourcesSchema.parse({
    sessionId: "d1d044cb-c1c0-46a6-a243-0c1dbb44967a",
    changes: [
      { action: "add", path: "Assets/Art/new.m3", source: "model.m3" },
      {
        action: "replace",
        path: "Assets/Art/old.dds",
        source: "texture.dds",
        expectedSha256: liveDigest(Buffer.from("old texture")),
      },
      { action: "remove", path: "Assets/Art/remove.dds" },
    ],
  }).changes;
  const result = await prepareRefreshResources(f.parent, f.target, changes);
  assert.equal(result.editorChanged, false);
  assert.equal(
    await fs.readFile(path.join(f.target.root, "Assets/Art/new.m3"), "utf8"),
    "new model",
  );
  assert.equal(
    await fs.readFile(path.join(f.target.root, "Assets/Art/old.dds"), "utf8"),
    "new texture",
  );
  await assert.rejects(fs.stat(path.join(f.target.root, "Assets/Art/remove.dds")), {
    code: "ENOENT",
  });
  assert.equal(
    await fs.readFile(path.join(f.target.root, "Triggers"), "utf8"),
    "unchanged trigger graph",
  );
});

test("invalid or stale group members refuse the entire resource group before any write", async (t) => {
  const f = await fixture(t);
  for (const changes of [
    [
      { action: "add" as const, path: "Assets/Art/new.m3", source: "model.m3" },
      { action: "remove" as const, path: "Assets/Art/old.dds", expectedSha256: "0".repeat(64) },
    ],
    [
      { action: "add" as const, path: "Assets/Art/new.m3", source: "model.m3" },
      { action: "add" as const, path: "Assets/Art/OLD.dds", source: "texture.dds" },
    ],
    [{ action: "add" as const, path: "Assets/Art/leak.dll", source: "model.m3" }],
    [{ action: "add" as const, path: "Assets/Art/leak.cs", source: "model.m3" }],
    [{ action: "add" as const, path: "Assets/Art/new.m3", source: "../outside" }],
    [{ action: "remove" as const, path: "Assets/Art/../../Triggers" }],
  ]) {
    await assert.rejects(prepareRefreshResources(f.parent, f.target, changes));
    await assert.rejects(fs.stat(path.join(f.target.root, "Assets/Art/new.m3")), {
      code: "ENOENT",
    });
    assert.equal(
      await fs.readFile(path.join(f.target.root, "Assets/Art/old.dds"), "utf8"),
      "old texture",
    );
  }
});

test("resource paths, PE payloads and inconsistent action arguments are rejected", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.parent.root, "payload.dds"), Buffer.from("MZpayload"));
  await assert.rejects(
    prepareRefreshResources(f.parent, f.target, [
      { action: "add", path: "Assets/Art/payload.dds", source: "payload.dds" },
    ]),
    /SOURCE_INVALID/,
  );
  for (const change of [
    { action: "add", path: "Assets/Art/file.dds" },
    { action: "remove", path: "Assets/Art/file.dds", source: "texture.dds" },
  ])
    assert.equal(
      refreshResourcesSchema.safeParse({
        sessionId: "d1d044cb-c1c0-46a6-a243-0c1dbb44967a",
        changes: [change],
      }).success,
      false,
    );
});

test("a source changed while the group is being staged prevents every target write", async (t) => {
  const f = await fixture(t),
    originalWrite = fs.writeFile.bind(fs),
    source = path.join(f.parent.root, "texture.dds");
  let changed = false;
  t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
    if (!changed && String(args[0]).includes(".sc2uimcp.")) {
      changed = true;
      await originalWrite(source, "concurrent manual change");
    }
    return originalWrite(...args);
  });
  await assert.rejects(
    prepareRefreshResources(f.parent, f.target, [
      { action: "replace", path: "Assets/Art/old.dds", source: "texture.dds" },
      { action: "remove", path: "Assets/Art/remove.dds" },
    ]),
    /STALE_FILE_TRANSACTION/,
  );
  assert.equal(changed, true);
  assert.equal(
    await fs.readFile(path.join(f.target.root, "Assets/Art/old.dds"), "utf8"),
    "old texture",
  );
  assert.equal(
    await fs.readFile(path.join(f.target.root, "Assets/Art/remove.dds"), "utf8"),
    "unused texture",
  );
  assert.equal(await fs.readFile(source, "utf8"), "concurrent manual change");
});
