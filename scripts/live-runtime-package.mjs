import { promises as fs } from "node:fs";
import path from "node:path";
import {
  cachedLiveBridge,
  cachedLiveRuntime,
  liveBinaryNames,
  liveDigest,
} from "./live-runtime-cache.mjs";

/** Copy only the activated immutable visible adapters, never old loaded versions. */
export async function copyLiveRuntimes(source, destination) {
  for (const [manifest, resolve, names] of [
    ["sc2-mcp-live-bridge.json", cachedLiveBridge, ["sc2-mcp-live.exe"]],
    ["sc2-mcp-live-memory.json", cachedLiveRuntime, liveBinaryNames],
  ]) {
    let bytes;
    try {
      bytes = await fs.readFile(path.join(source, manifest));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const record = JSON.parse(bytes.toString("utf8"));
    const runtime = resolve(source, record.sourceSha256);
    if (!runtime) throw Error("LIVE_PORTABLE_RUNTIME_INVALID: " + manifest);
    const target = path.join(destination, record.home);
    await fs.mkdir(target, { recursive: true });
    for (const name of names) {
      await fs.copyFile(path.join(runtime.home, name), path.join(target, name));
      if (liveDigest(await fs.readFile(path.join(target, name))) !== record.files[name])
        throw Error("LIVE_PORTABLE_RUNTIME_COPY_MISMATCH");
    }
    // Verify the complete copied set before activating its manifest.
    await fs.writeFile(path.join(destination, manifest), bytes, { flag: "wx" });
    if (!resolve(destination, record.sourceSha256))
      throw Error("LIVE_PORTABLE_RUNTIME_COPY_MISMATCH");
  }
}
