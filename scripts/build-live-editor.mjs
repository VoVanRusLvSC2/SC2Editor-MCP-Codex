/* global process */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLiveRuntimeBuild } from "./live-runtime-lease.mjs";
import { cachedLiveBridge, liveDigest } from "./live-runtime-cache.mjs";

if (process.platform !== "win32") throw Error("LIVE_WINDOWS_REQUIRED");
const release = acquireLiveRuntimeBuild();
try {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const compiler = path.join(
    process.env.WINDIR ?? "C:/Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  );
  const base = path.join(root, "native/bin/windows-x64"),
    names = ["Program.cs", "MemoryData.cs", "ArchiveIdentity.cs", "DesktopContext.cs"];
  const sources = new Map(
    names.map((name) => [name, readFileSync(path.join(root, "native/live-editor", name))]),
  );
  const hash = createHash("sha256");
  for (const [name, bytes] of sources) hash.update(name + "\0").update(bytes);
  const sourceSha256 = hash.digest("hex"),
    cached = process.argv.includes("--force") ? undefined : cachedLiveBridge(base, sourceSha256);
  if (cached) {
    process.stdout.write(
      JSON.stringify({
        built: path.join(cached.home, "sc2-mcp-live.exe"),
        reused: true,
        sourceSha256,
      }) + "\n",
    );
  } else {
    const tag = sourceSha256.slice(0, 16) + "-" + randomBytes(4).toString("hex"),
      relative = "live-bridge/" + tag;
    const home = path.join(base, relative),
      output = path.join(home, "sc2-mcp-live.exe"),
      snapshot = path.join(root, "work/live-bridge-build", tag);
    mkdirSync(home, { recursive: true });
    mkdirSync(snapshot, { recursive: true });
    for (const [name, bytes] of sources)
      writeFileSync(path.join(snapshot, name), bytes, { flag: "wx" });
    execFileSync(
      compiler,
      [
        "/nologo",
        "/target:exe",
        "/platform:x64",
        "/optimize+",
        "/reference:System.Web.Extensions.dll",
        "/out:" + output,
        ...names.map((name) => path.join(snapshot, name)),
      ],
      { stdio: "inherit", windowsHide: true },
    );
    const record = {
      protocol: 1,
      sourceSha256,
      home: relative,
      sourceFiles: Object.fromEntries(
        [...sources].map(([name, bytes]) => [name, liveDigest(bytes)]),
      ),
      files: { "sc2-mcp-live.exe": liveDigest(readFileSync(output)) },
    };
    writeFileSync(path.join(home, "BUILD.json"), JSON.stringify(record, null, 2) + "\n");
    const manifest = path.join(base, "sc2-mcp-live-bridge.json"),
      temporary = manifest + "." + tag + ".tmp";
    writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    renameSync(temporary, manifest);
    process.stdout.write(
      JSON.stringify({
        built: output,
        scope:
          "Inventory/file-drop without DLL; explicit memory commands require the separately built visible Data adapter",
      }) + "\n",
    );
  }
} finally {
  release();
}
