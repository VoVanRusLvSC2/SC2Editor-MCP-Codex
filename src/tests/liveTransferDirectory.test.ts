import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { transferDirectory } from "../modules/editorLive/transferDirectory.js";
import type { MemoryDesktop } from "../modules/editorLive/memoryDesktop.js";

const window = {
  windowId: "12",
  processId: 999999,
  processStart: "444",
  title: "UI - [Current.SC2Map] - StarCraft II Editor",
  enabled: true,
  acceptsFiles: true,
};
test("component transfer refuses invalid native temp roots without falling back to client temp", async () => {
  for (const root of ["", "relative-temp", "bad\0path"]) {
    const desktop: MemoryDesktop = {
      windows: async () => [window],
      command: async () => ({}),
      temporaryDirectory: async () => root,
    };
    await assert.rejects(transferDirectory(desktop, window, "ui"), /TEMP_ROOT_INVALID/);
  }
});
test("component transfer rejects redirected transfer directories", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-transfer-root-"));
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-transfer-target-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(target, { recursive: true, force: true });
  });
  await fs.symlink(
    target,
    path.join(root, "SC2EditorToolkit-live-ui"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const desktop: MemoryDesktop = {
    windows: async () => [window],
    command: async () => ({}),
    temporaryDirectory: async () => root,
  };
  await assert.rejects(transferDirectory(desktop, window, "ui"), /TRANSFER_DIRECTORY_INVALID/);
});

test("legacy dialog files use the process-reported short store while XML remains in Editor temp", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-transfer-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const editorTemp = path.join(root, "private", "deep-editor-temp"),
    components = path.join(root, "short-components");
  const desktop: MemoryDesktop = {
    windows: async () => [window],
    command: async () => ({}),
    temporaryDirectory: async () => editorTemp,
    componentDirectory: async () => components,
  };
  assert.equal(await transferDirectory(desktop, window, "components"), components);
  assert.equal(
    await transferDirectory(desktop, window, "ui"),
    path.join(editorTemp, "SC2EditorToolkit-live-ui"),
  );
});
