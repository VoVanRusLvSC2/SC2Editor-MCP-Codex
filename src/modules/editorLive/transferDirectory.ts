import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MemoryDesktop } from "./memoryDesktop.js";
import type { EditorWindow } from "./desktop.js";

/** Component files must use the target Editor's temp root, not the MCP process's. */
export async function transferDirectory(
  desktop: MemoryDesktop,
  window: EditorWindow,
  namespace: "ui" | "data" | "components",
) {
  // In-process test backends have no native process context.
  const root = desktop.temporaryDirectory ? await desktop.temporaryDirectory(window) : os.tmpdir();
  if (!root || root.includes("\0") || !path.isAbsolute(root))
    throw Error("LIVE_TRANSFER_TEMP_ROOT_INVALID");
  const directory =
    namespace === "components" && desktop.componentDirectory
      ? await desktop.componentDirectory(window)
      : path.join(root, "SC2EditorToolkit-live-" + namespace);
  if (!directory || directory.includes("\0") || !path.isAbsolute(directory))
    throw Error("LIVE_TRANSFER_COMPONENT_ROOT_INVALID");
  await fs.mkdir(directory, { recursive: true });
  if (
    !(await fs.lstat(directory)).isDirectory() ||
    (await fs.lstat(directory)).isSymbolicLink() ||
    path.resolve(await fs.realpath(directory)).toLowerCase() !==
      path.resolve(directory).toLowerCase()
  )
    throw Error("LIVE_TRANSFER_DIRECTORY_INVALID");
  return directory;
}
