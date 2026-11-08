import {
  mkdirSync,
  openSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Do not replace the helper/manifest while a native workflow owns GUI state. */
export function acquireLiveRuntimeBuild(
  directory = path.join(os.tmpdir(), "SC2EditorToolkit-live-memory"),
) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "build.lock"),
    owner = randomUUID();
  let fd;
  try {
    fd = openSync(file, "wx");
  } catch {
    throw Error("LIVE_RUNTIME_BUILD_BUSY");
  }
  writeFileSync(fd, owner);
  const release = () => {
    closeSync(fd);
    if (readFileSync(file, "utf8") === owner) unlinkSync(file);
  };
  try {
    if (readdirSync(directory).some((name) => name.endsWith(".lock") && name !== "build.lock"))
      throw Error(
        "LIVE_RUNTIME_IN_USE: finish the existing native workflow before building; leases are never stolen",
      );
  } catch (error) {
    release();
    throw error;
  }
  return release;
}
