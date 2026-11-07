import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LiveMemory } from "../modules/live/memory.js";
import type { MemoryDesktop } from "../modules/live/memoryDesktop.js";
import type { EditorWindow } from "../modules/live/desktop.js";
import { compileAuthorScript } from "../app/authoringScript.js";

let identity = 810000;
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-memory-"));
  const archive = path.join(root, "Test.SC2Map");
  await fs.writeFile(archive, "saved bytes");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = {
    value: 1200,
    source: "Test.SC2Map",
    calls: [] as number[],
    blocked: false,
    uncertain: false,
    cancelFails: false,
    wrongIdentity: false,
    active: undefined as Parameters<MemoryDesktop["command"]>[2],
    window: {
      windowId: "123",
      processId: ++identity,
      processStart: "77",
      title: `Data - [${archive}] - StarCraft II Editor`,
      enabled: true,
      acceptsFiles: true,
    } as EditorWindow,
    hook: undefined as ((operation: number) => Promise<void>) | undefined,
  };
  const desktop: MemoryDesktop = {
    windows: async () => [structuredClone(state.window)],
    command: async (_window, operation, args) => {
      state.calls.push(operation);
      await state.hook?.(operation);
      if (operation === 1) return { prepared: true };
      if (operation === 2) return { selected: true, source: state.source };
      if (operation === 3) {
        if (state.active) throw Error("LIVE_MEMORY_EDIT_BUSY");
        state.active = args;
        state.window.title = `Data - [${archive}*] - StarCraft II Editor`;
        return { editOpened: true };
      }
      if (operation === 0) {
        if (state.active) throw Error("LIVE_MEMORY_EDIT_BUSY");
        return { controls: [] };
      }
      if (state.active?.token !== args?.token) throw Error("LIVE_MEMORY_OWNED_EDIT_REQUIRED");
      if (operation === 4)
        return {
          editor: "inline",
          unit: state.wrongIdentity ? "OtherUnit" : "Pilot",
          field: "LifeMax",
          value: String(state.value),
        };
      if (operation === 6) {
        if (state.cancelFails) throw Error("cancel transport lost");
        state.active = undefined;
        return { cancelRequested: true };
      }
      if (operation === 5) {
        assert.equal(Number(state.active?.expected), state.value);
        state.value = Number(state.active?.value);
        state.active = undefined;
        if (state.uncertain) return { status: "unknown", error: "commit reply lost" };
        return { commitRequested: true };
      }
      throw Error("unexpected native operation");
    },
  };
  const memory = new LiveMemory(
    root,
    desktop,
    () => state.blocked,
    async () => {},
  );
  t.after(() => memory.close());
  const target = { archive, windowId: "123", unit: "Pilot", field: "LifeMax" as const };
  return { memory, state, target, desktop, root };
}

test("memory edits the native field, reads it back and leaves archive bytes unchanged", async (t) => {
  const { memory, target, state } = await fixture(t);
  const snapshot = await memory.read(target);
  assert.equal(snapshot.value, 1200);
  const receipt = await memory.set(snapshot.snapshotId, 1250);
  assert.equal(receipt.status, "applied");
  assert.equal("after" in receipt && receipt.after, 1250);
  assert.equal("archiveUnchanged" in receipt && receipt.archiveUnchanged, true);
  assert.equal(state.active, undefined);
  assert.equal(state.calls.filter((c) => c === 5).length, 1);
  assert.equal(await fs.readFile(target.archive, "utf8"), "saved bytes");
  await assert.rejects(memory.set(snapshot.snapshotId, 1250), /SNAPSHOT_EXPIRED/);
});

test("manual field changes fail stale and cancel only the owned edit", async (t) => {
  const { memory, target, state } = await fixture(t);
  const snapshot = await memory.read(target);
  state.value = 1300;
  await assert.rejects(memory.set(snapshot.snapshotId, 1250), /STALE_FIELD/);
  assert.equal(state.value, 1300);
  assert.equal(state.calls.includes(5), false);
  assert.equal(state.active, undefined);
});

test("native ownership must be map-local, not an installed dependency", async (t) => {
  const { memory, target, state } = await fixture(t);
  state.source = "Liberty.SC2Mod";
  await assert.rejects(memory.read(target), /MAP_LOCAL_OBJECT_REQUIRED/);
  assert.equal(state.calls.includes(3), false);
});

test("archive edits invalidate snapshots before opening a native value editor", async (t) => {
  const { memory, target, state } = await fixture(t);
  const snapshot = await memory.read(target);
  state.calls.length = 0;
  await fs.writeFile(target.archive, "manual save");
  await assert.rejects(memory.set(snapshot.snapshotId, 1250), /ARCHIVE_CHANGED/);
  assert.deepEqual(state.calls, []);
});

test("reused PID/window with different process creation time refuses", async (t) => {
  const { memory, target, state } = await fixture(t);
  const snapshot = await memory.read(target);
  state.calls.length = 0;
  state.window.processStart = "88";
  await assert.rejects(memory.set(snapshot.snapshotId, 1250), /EDITOR_CHANGED/);
  assert.deepEqual(state.calls, []);
});

test("switching maps does not target the replacement document", async (t) => {
  const { memory, target, state } = await fixture(t);
  const snapshot = await memory.read(target);
  state.calls.length = 0;
  state.window.title = "Data - [C:/Other.SC2Map] - StarCraft II Editor";
  await assert.rejects(memory.set(snapshot.snapshotId, 1250), /EXACT_DATA_WINDOW_REQUIRED/);
  assert.deepEqual(state.calls, []);
});

test("lost commit reply remains unknown, consumes snapshot and is never replayed", async (t) => {
  const { memory, target, state } = await fixture(t);
  const snapshot = await memory.read(target);
  state.uncertain = true;
  const result = await memory.set(snapshot.snapshotId, 1250);
  assert.equal(result.status, "unknown");
  assert.equal(state.value, 1250);
  await assert.rejects(memory.set(snapshot.snapshotId, 1250), /SNAPSHOT_EXPIRED/);
  assert.equal(state.calls.filter((c) => c === 5).length, 1);
  assert.equal((await memory.read(target)).value, 1250);
});

test("cancel failure is not retried", async (t) => {
  const { memory, target, state } = await fixture(t);
  state.cancelFails = true;
  await assert.rejects(memory.read(target), /cancel transport lost/);
  assert.equal(state.calls.filter((c) => c === 6).length, 1);
});

test("wrong native field identity is cancelled without a write", async (t) => {
  const { memory, target, state } = await fixture(t);
  state.wrongIdentity = true;
  await assert.rejects(memory.read(target), /COMPLETE_VALUE_REQUIRED/);
  assert.equal(state.calls.includes(5), false);
  assert.equal(state.active, undefined);
});

test("checkpoint activity and user dialogs block direct memory requests", async (t) => {
  const { memory, target, state } = await fixture(t);
  state.blocked = true;
  await assert.rejects(memory.read(target), /WORKFLOW_BUSY/);
  state.blocked = false;
  state.window.enabled = false;
  await assert.rejects(memory.read(target), /USER_DIALOG_PRESENT/);
  assert.deepEqual(state.calls, []);
});

test("independent clients serialize by exact Editor process identity", async (t) => {
  const { memory, target, state, desktop, root } = await fixture(t);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  const held = new Promise<void>((r) => {
    release = r;
  });
  state.hook = async (op) => {
    if (op === 1) {
      enter();
      await held;
    }
  };
  const first = memory.read(target);
  await entered;
  const other = new LiveMemory(
    root,
    desktop,
    () => false,
    async () => {},
  );
  t.after(() => other.close());
  try {
    await assert.rejects(other.read(target), /EDITOR_LEASE_BUSY/);
  } finally {
    release();
  }
  await first;
  assert.equal(state.active, undefined);
});

test("compact memory commands require explicit stage and never add checkpoint/save steps", () => {
  const read =
    'live memory.read archive="D:/Maps/Current.SC2Map" windowId=123 unit=Pilot field=LifeMax';
  assert.throws(() => compileAuthorScript(read, "plan"), /AUTHOR_LIVE_REQUIRES_STAGE/);
  const steps = compileAuthorScript(read, "stage");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].tool, "live.memory.read");
  assert.equal(
    compileAuthorScript("live memory.capabilities", "plan")[0].tool,
    "live.memory.capabilities",
  );
  const write = compileAuthorScript("live memory.set snapshotId=abc value=250", "save");
  assert.equal(write.length, 1);
  assert.equal(write[0].tool, "live.memory.set");
  assert.equal(write[0].args?.value, 250);
});

test("a save during native field inspection prevents the commit", async (t) => {
  const { memory, target, state } = await fixture(t);
  const snapshot = await memory.read(target);
  state.hook = async (op) => {
    if (op === 4) await fs.writeFile(target.archive, "concurrent save");
  };
  await assert.rejects(memory.set(snapshot.snapshotId, 1250), /ARCHIVE_CHANGED/);
  assert.equal(state.calls.includes(5), false);
  assert.equal(state.active, undefined);
});
