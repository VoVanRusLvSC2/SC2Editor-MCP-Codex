import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { EditorWindow } from "./desktop.js";

/** All visible native authoring clients serialize by process creation identity. */
export async function withEditorLease<T>(window: EditorWindow, work: () => Promise<T>) {
  const directory = path.join(os.tmpdir(), "SC2EditorToolkit-live-memory");
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${window.processId}-${window.processStart}.lock`);
  const owner = randomUUID();
  const handle = await fs.open(file, "wx").catch(() => {
    throw Error("LIVE_MEMORY_EDITOR_LEASE_BUSY: " + file);
  });
  try {
    await handle.writeFile(owner);
    return await work();
  } finally {
    await handle.close();
    if ((await fs.readFile(file, "utf8").catch(() => "")) === owner)
      await fs.unlink(file).catch(() => {});
  }
}
