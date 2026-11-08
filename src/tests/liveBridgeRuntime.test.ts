import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveLiveBridge } from "../modules/editorLive/bridgeRuntime.js";
const { cachedLiveBridge, liveDigest } = await import(
  new URL("../../scripts/live-runtime-cache.mjs", import.meta.url).href
);
const { copyLiveRuntimes } = await import(
  new URL("../../scripts/live-runtime-package.mjs", import.meta.url).href
);

test("live helper keeps legacy compatibility and an explicit override, but invalid activation never falls back", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-helper-"));
  try {
    assert.equal(resolveLiveBridge(base), path.join(base, "sc2-mcp-live.exe"));
    const manifest = path.join(base, "sc2-mcp-live-bridge.json");
    for (const invalid of [
      "bad json",
      "null",
      JSON.stringify({ protocol: 1, home: "../outside" }),
    ]) {
      await fs.writeFile(manifest, invalid);
      assert.throws(() => resolveLiveBridge(base), /LIVE_BRIDGE_MANIFEST_INVALID/);
      assert.equal(cachedLiveBridge(base, "a".repeat(64)), undefined);
    }
    assert.equal(resolveLiveBridge(base, "explicit-helper.exe"), "explicit-helper.exe");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("an immutable helper requires pinned bytes and source equality for build reuse", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-live-helper-"));
  try {
    const home = "live-bridge/1234567890abcdef-12345678";
    const directory = path.join(base, home);
    const executable = path.join(directory, "sc2-mcp-live.exe");
    await fs.mkdir(directory, { recursive: true });
    const bytes = Buffer.from("owned fixture helper");
    await fs.writeFile(executable, bytes);
    const record = {
      protocol: 1,
      home,
      sourceSha256: "a".repeat(64),
      files: { "sc2-mcp-live.exe": liveDigest(bytes) },
    };
    await fs.writeFile(path.join(base, "sc2-mcp-live-bridge.json"), JSON.stringify(record));
    assert.equal(resolveLiveBridge(base), executable);
    assert.ok(cachedLiveBridge(base, record.sourceSha256));
    const portable = path.join(base, "portable");
    await copyLiveRuntimes(base, portable);
    assert.deepEqual(await fs.readdir(path.join(portable, "live-bridge")), [path.basename(home)]);
    assert.equal(resolveLiveBridge(portable), path.join(portable, home, "sc2-mcp-live.exe"));
    assert.equal(cachedLiveBridge(base, "b".repeat(64)), undefined);
    await fs.writeFile(executable, "changed helper");
    assert.throws(() => resolveLiveBridge(base), /LIVE_BRIDGE_BINARY_MISMATCH/);
    assert.equal(cachedLiveBridge(base, record.sourceSha256), undefined);
    await assert.rejects(
      copyLiveRuntimes(base, path.join(base, "rejected-package")),
      /LIVE_PORTABLE_RUNTIME_INVALID/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
