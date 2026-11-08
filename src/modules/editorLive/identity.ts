import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import type { EditorWindow } from "./desktop.js";
import { currentDocumentMatches } from "./documentIdentity.js";
import type { MemoryDesktop } from "./memoryDesktop.js";

export const liveDigest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
/** Hash large map archives without allocating a buffer the size of the map. */
export async function liveFileDigest(file: string): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 1024 ** 3) throw Error("LIVE_FILE_HASH_INVALID");
    const hash = createHash("sha256"),
      buffer = Buffer.allocUnsafe(256 * 1024);
    let count = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      count += bytesRead;
      if (count > 1024 ** 3) throw Error("LIVE_FILE_CHANGED_DURING_HASH");
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat(),
      named = await fs.lstat(file);
    if (
      !named.isFile() ||
      named.isSymbolicLink() ||
      count !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      named.dev !== before.dev ||
      named.ino !== before.ino ||
      named.size !== after.size ||
      named.mtimeMs !== after.mtimeMs ||
      named.ctimeMs !== after.ctimeMs
    )
      throw Error("LIVE_FILE_CHANGED_DURING_HASH");
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
export async function currentArchive(
  root: string,
  file: string,
  error = "LIVE_CURRENT_ARCHIVE_INVALID",
) {
  const archive = path.resolve(root, file),
    stat = await fs.lstat(archive);
  if (
    !/\.(SC2Map|SC2Mod)$/i.test(archive) ||
    archive.startsWith("\\\\") ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 1024 ** 3 ||
    normalize(await fs.realpath(archive)) !== normalize(archive)
  )
    throw Error(error);
  return { archive, sha256: await liveFileDigest(archive) };
}
export async function currentModuleWindow(
  desktop: MemoryDesktop,
  target: { archive: string; windowId: string },
  module: string,
  previous?: EditorWindow,
) {
  const w = desktop.window
    ? await desktop.window(target.windowId)
    : (await desktop.windows()).find((w) => w.windowId === target.windowId);
  if (
    !w ||
    !w.enabled ||
    !w.title.startsWith(module + " - [") ||
    !(await currentDocumentMatches(desktop, w, target.archive)) ||
    (previous && (previous.processId !== w.processId || previous.processStart !== w.processStart))
  )
    throw Error("LIVE_CURRENT_MODULE_WINDOW_CHANGED");
  return w;
}
