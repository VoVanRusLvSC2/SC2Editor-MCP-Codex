import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveImports, importPrepareSchema } from "../modules/editorLive/imports.js";
import { liveDigest } from "../modules/editorLive/identity.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

let sequence = 0;
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-import-")),
    archive = path.join(root, "Current.SC2Map"),
    source = path.join(root, "Effect.txt"),
    bytes = Buffer.from("Native asset fixture\r\n");
  await fs.writeFile(archive, "before");
  await fs.writeFile(source, bytes);
  const w = {
    windowId: "72",
    processId: 999991,
    processStart: String(Date.now()) + ++sequence,
    title: `Import - [${archive}] - StarCraft II Editor`,
    enabled: true,
    acceptsFiles: true,
  };
  const state = {
    changed: false,
    lose: false,
    dropOthers: false,
    manual: false,
    imports: 0,
    treeHash: "before",
    existing: [] as string[],
    saved: new Map<string, Buffer>(),
    staged: "",
    prefix: "",
  };
  let dialog = "",
    fingerprint = 0;
  const tree = () => {
    const items: Array<{ handle: string; parent: string; text: string }> = [];
    for (const entry of state.existing) {
      let parent = "0",
        prefix = "";
      for (const part of entry.split("/")) {
        prefix += "/" + part;
        let node = items.find((i) => i.handle === prefix);
        if (!node) {
          node = { handle: prefix, parent, text: part };
          items.push(node);
        }
        parent = node.handle;
      }
    }
    return {
      trees: [
        { id: 15, count: items.length, fingerprint: state.treeHash, truncated: false, items },
      ],
    };
  };
  const desktop: MemoryDesktop = {
    windows: async () => [w],
    window: async () => w,
    command: async (_w, op, args = {}) => {
      if (op === 50) return tree();
      if (op === 51) {
        state.staged = path.join(
          os.tmpdir(),
          "SC2EditorToolkit-live-components",
          args.unit + ".SC2Lib",
        );
        assert.equal(liveDigest(await fs.readFile(state.staged + ".assets")), args.expected);
        dialog = "Import Files";
        return { status: "pending" };
      }
      if (op === 52)
        return {
          title: dialog,
          fingerprint: String(fingerprint),
          initial: String(fingerprint),
          manualInput: state.manual,
        };
      if (op === 57) {
        dialog = "Browse For Folder";
        fingerprint++;
        return { browseRequested: true };
      }
      if (op === 53) {
        fingerprint++;
        if (args.field === "selectFolder") return { folderSelected: true };
        dialog = "Import Files";
        return { submitted: true };
      }
      if (op === 59) {
        state.prefix = args.value!;
        fingerprint++;
        return { optionsSet: true };
      }
      if (op === 58) {
        state.imports++;
        if (state.dropOthers) state.existing = [];
        for (const name of await fs.readdir(state.staged)) {
          state.existing.push(state.prefix + name);
          state.saved.set(state.prefix + name, await fs.readFile(path.join(state.staged, name)));
        }
        state.treeHash = "after";
        state.changed = true;
        w.title = `Import - [${archive}*] - StarCraft II Editor`;
        if (state.lose) throw Error("lost native acknowledgement");
        dialog = "";
        return { submitted: true };
      }
      if (op === 54) {
        dialog = "";
        return { cancelRequested: true };
      }
      throw Error("Unexpected operation " + op);
    },
  };
  const reader = {
    names: async () => [...state.saved.keys()],
    read: async (_archive: string, entry: string) => state.saved.get(entry)!,
  };
  const create = () =>
      new LiveImports(new Workspace(root), desktop, undefined, reader, async () => {}),
    live = create(),
    target = { archive, windowId: w.windowId },
    args = { ...target, prefix: "Assets/LiveTest/", files: [{ source, name: "Effect.txt" }] };
  t.after(async () => {
    await live.close();
    const journal = path.join(
      os.tmpdir(),
      "SC2EditorToolkit-live-memory",
      "pending-imports",
      liveDigest(
        JSON.stringify([w.processId, w.processStart, path.resolve(archive).toLowerCase()]),
      ) + ".json",
    );
    await fs.unlink(journal).catch(() => {});
    if (state.staged) {
      await fs.rm(state.staged, { recursive: true, force: true });
      await fs.unlink(state.staged + ".assets").catch(() => {});
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  return { live, create, state, w, target, args, bytes, archive, source };
}

test("original asset import is single-use, pending across sessions, and verifies exact saved bytes", async (t) => {
  const f = await fixture(t),
    plan = await f.live.prepare(f.args),
    applied = await f.live.apply({ snapshotId: plan.snapshotId });
  assert.equal(applied.status, "import_submitted");
  assert.equal(applied.nativeTreeVerified, true);
  assert.equal(f.state.imports, 1);
  assert.equal(await fs.readFile(f.archive, "utf8"), "before");
  await assert.rejects(f.live.apply({ snapshotId: plan.snapshotId }), /SNAPSHOT_EXPIRED/);
  const another = f.create();
  try {
    await assert.rejects(another.prepare(f.args), /PENDING_SAVE_OR_VERIFY/);
    assert.equal(
      (await another.verify({ ...f.target, pendingId: applied.pendingId })).status,
      "pending_save",
    );
    await fs.writeFile(f.archive, "saved by original editor");
    f.w.title = `Import - [${f.archive}] - StarCraft II Editor`;
    const verified = await another.verify({ ...f.target, pendingId: applied.pendingId });
    assert.equal(verified.status, "verified");
    assert.equal(verified.saved, true);
    assert.equal(f.state.imports, 1);
    await assert.rejects(another.prepare(f.args), /DESTINATION_EXISTS/);
  } finally {
    await another.close();
  }
});
test("unknown import is retained across sessions and never cancelled or replayed", async (t) => {
  const f = await fixture(t),
    plan = await f.live.prepare(f.args);
  f.state.lose = true;
  const applied = await f.live.apply({ snapshotId: plan.snapshotId });
  assert.equal(applied.status, "unknown");
  assert.equal(applied.retryMutation, false);
  const another = f.create();
  try {
    await assert.rejects(another.prepare(f.args), /PENDING_SAVE_OR_VERIFY/);
    assert.equal(f.state.imports, 1);
  } finally {
    await another.close();
  }
});
test("stale original trees, manual dialogs, collisions and unsafe files refuse", async (t) => {
  const f = await fixture(t),
    plan = await f.live.prepare(f.args);
  f.state.treeHash = "manual change";
  await assert.rejects(f.live.apply({ snapshotId: plan.snapshotId }), /STALE_COMPONENT/);
  assert.equal(f.state.imports, 0);
  f.state.treeHash = "before";
  f.state.manual = true;
  const result = await f.live.apply({ snapshotId: plan.snapshotId });
  assert.equal(result.status, "unknown");
  assert.equal(f.state.imports, 0);
  assert.throws(() => importPrepareSchema.parse({ ...f.args, prefix: "Base.SC2Data/" }));
  assert.throws(() =>
    importPrepareSchema.parse({ ...f.args, files: [{ source: f.source, name: "private.dll" }] }),
  );
});
test("saved mismatches remain failed and release only the resolved submission", async (t) => {
  const f = await fixture(t),
    plan = await f.live.prepare(f.args),
    applied = await f.live.apply({ snapshotId: plan.snapshotId });
  await fs.writeFile(f.archive, "saved conflict");
  f.w.title = `Import - [${f.archive}] - StarCraft II Editor`;
  f.state.saved.set("Assets/LiveTest/Effect.txt", Buffer.from("manual replacement"));
  const result = await f.live.verify({ ...f.target, pendingId: applied.pendingId });
  assert.equal(result.status, "verification_failed");
  assert.equal(result.retryMutation, false);
  assert.equal(f.state.imports, 1);
});
test("resource import does not accept collateral removal of an existing original path", async (t) => {
  const f = await fixture(t);
  f.state.existing = ["Scripts/Manual.galaxy"];
  const plan = await f.live.prepare(f.args);
  f.state.dropOthers = true;
  const applied = await f.live.apply({ snapshotId: plan.snapshotId });
  assert.equal(applied.status, "verification_failed");
  assert.equal(applied.nativeTreeVerified, true);
  assert.equal(applied.previousPathsPreserved, false);
  assert.equal(f.state.imports, 1);
});
test("executable bytes and oversized resources refuse before original import", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.source, Buffer.from("MZnot a resource"));
  await assert.rejects(f.live.prepare(f.args), /SOURCE_INVALID/);
  await fs.writeFile(f.source, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(f.live.prepare(f.args), /SOURCE_INVALID/);
  assert.equal(f.state.imports, 0);
});
