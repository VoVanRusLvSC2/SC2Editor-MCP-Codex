import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { LiveTriggers } from "../modules/editorLive/triggers.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

test("GUI rename keeps the tree structure and refuses ambiguous paths", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-trigger-rename-"));
  const archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "map");
  const window = { windowId: "123", processId: 929222, processStart: "55", enabled: true,
    acceptsFiles: true, title: `Triggers - [${archive}] - StarCraft II Editor` };
  const items = [{ handle: "1", parent: "0", depth: 0, text: "MAIN" },
    { handle: "2", parent: "1", depth: 1, text: "Start" }];
  let submissions = 0;
  const desktop: MemoryDesktop = {
    windows: async () => [window],
    command: async (_window, op, args) => {
      if (op === 50) return { trees: [{ id: 28, count: items.length, fingerprint: "one", truncated: false, items }] };
      if (op === 66) { submissions++; assert.equal(args?.field, "2"); items[1].text = args!.value!; return { submitted: true }; }
      throw Error("Unexpected command");
    },
  };
  const live = new LiveTriggers(new Workspace(root), () => undefined, desktop);
  t.after(async () => { await live.close(); await fs.rm(root, { recursive: true, force: true }); });
  const target = { archive, windowId: "123" };
  items.push({ handle: "3", parent: "0", depth: 0, text: "MAIN" });
  await assert.rejects(live.rename({ ...target, path: "MAIN/Start", name: "Launch" }), /PATH_NOT_UNIQUE/);
  assert.equal(submissions, 0);
  items.pop();
  const result = await live.rename({ ...target, path: "MAIN/Start", name: "Launch" });
  assert.equal(result.status, "applied");
  assert.equal(result.nativeTreeVerified, true);
  assert.equal(submissions, 1);
});

test("GUI variable rename verifies the editor-reported type suffix", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-trigger-rename-var-"));
  const archive = path.join(root, "Current.SC2Map");
  await fs.writeFile(archive, "map");
  const window = { windowId: "124", processId: 929223, processStart: "55", enabled: true,
    acceptsFiles: true, title: `Triggers - [${archive}] - StarCraft II Editor` };
  const items = [{ handle: "1", parent: "0", depth: 0, text: "Variables" },
    { handle: "2", parent: "1", depth: 1, text: "Life <Integer[5]>" },
    { handle: "3", parent: "1", depth: 1, text: "Health <Integer>" }];
  let submissions = 0;
  const desktop: MemoryDesktop = { windows: async () => [window], command: async (_w, op, args) => {
    if (op === 50) return { trees: [{ id: 28, count: items.length, fingerprint: "one", truncated: false, items }] };
    if (op === 66) { submissions++; items[1].text = args!.value! + " <Integer[5]>"; return { submitted: true, displaySuffix: " <Integer[5]>" }; }
    throw Error("Unexpected command");
  } };
  const live = new LiveTriggers(new Workspace(root), () => undefined, desktop);
  t.after(async () => { await live.close(); await fs.rm(root, { recursive: true, force: true }); });
  const target = { archive, windowId: "124", path: "Variables/Life <Integer[5]>" };
  await assert.rejects(live.rename({ ...target, name: "Health" }), /NAME_EXISTS/);
  const result = await live.rename({ ...target, name: "Shields" });
  assert.equal(result.status, "applied");
  assert.equal(submissions, 1);
});
