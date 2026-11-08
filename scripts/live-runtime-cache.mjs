import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const liveBinaryNames = ["sc2-mcp-live-data.dll", "sc2-mcp-live-loader.exe"];
export const liveDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function cachedLiveBridge(base, sourceSha256) {
  try {
    const record = JSON.parse(readFileSync(path.join(base, "sc2-mcp-live-bridge.json"), "utf8"));
    if (
      record.protocol !== 1 ||
      record.sourceSha256 !== sourceSha256 ||
      !/^live-bridge\/[a-f0-9]{16}-[a-f0-9]{8}$/.test(record.home)
    )
      return;
    const home = path.join(base, record.home),
      name = "sc2-mcp-live.exe";
    if (
      realpathSync(home).toLowerCase() !== path.resolve(home).toLowerCase() ||
      !/^[a-f0-9]{64}$/.test(record.files?.[name] ?? "") ||
      liveDigest(readFileSync(path.join(home, name))) !== record.files[name]
    )
      return;
    return { home, record };
  } catch {
    return;
  }
}

/** Reuse verified immutable outputs; never relink a DLL already loaded by Editor. */
export function cachedLiveRuntime(base, sourceSha256) {
  let record;
  try {
    record = JSON.parse(readFileSync(path.join(base, "sc2-mcp-live-memory.json"), "utf8"));
    if (
      record.protocol !== 1 ||
      record.sourceSha256 !== sourceSha256 ||
      !/^live-memory\/[a-f0-9]{16}-[a-f0-9]{8}$/.test(record.home) ||
      record.message !== "SC2EditorToolkit.LiveData.v1." + path.basename(record.home)
    )
      return;
    const home = path.join(base, record.home);
    if (realpathSync(home).toLowerCase() !== path.resolve(home).toLowerCase()) return;
    for (const name of liveBinaryNames)
      if (
        !/^[a-f0-9]{64}$/.test(record.files?.[name] ?? "") ||
        liveDigest(readFileSync(path.join(home, name))) !== record.files[name]
      )
        return;
    return { home, record };
  } catch {
    return;
  }
}
