import path from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";

/** Each client pins one verified immutable helper; active clients need no restart. */
export function resolveLiveBridge(base: string, override?: string): string {
  if (override) return override;
  const manifest = path.join(base, "sc2-mcp-live-bridge.json");
  if (!existsSync(manifest)) return path.join(base, "sc2-mcp-live.exe");
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(manifest, "utf8"));
  } catch {
    throw Error("LIVE_BRIDGE_MANIFEST_INVALID");
  }
  const r = record as { protocol?: unknown; home?: unknown; files?: Record<string, unknown> };
  if (
    !r ||
    r.protocol !== 1 ||
    typeof r.home !== "string" ||
    !/^live-bridge\/[a-f0-9]{16}-[a-f0-9]{8}$/.test(r.home)
  )
    throw Error("LIVE_BRIDGE_MANIFEST_INVALID");
  const home = path.join(base, r.home),
    executable = path.join(home, "sc2-mcp-live.exe"),
    expected = r.files?.["sc2-mcp-live.exe"];
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    throw Error("LIVE_BRIDGE_MANIFEST_INVALID");
  try {
    if (realpathSync(home).toLowerCase() !== path.resolve(home).toLowerCase())
      throw Error("outside home");
    const digest = createHash("sha256").update(readFileSync(executable)).digest("hex");
    if (digest !== expected) throw Error("binary changed");
  } catch {
    throw Error("LIVE_BRIDGE_BINARY_MISMATCH");
  }
  return executable;
}
