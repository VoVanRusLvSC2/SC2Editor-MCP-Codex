import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const { acquireLiveRuntimeBuild } = await import(
  new URL("../../scripts/live-runtime-lease.mjs", import.meta.url).href
);
const { cachedLiveRuntime, liveDigest } = await import(
  new URL("../../scripts/live-runtime-cache.mjs", import.meta.url).href
);

test("runtime builds refuse existing GUI leases without stealing or deleting them", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-runtime-build-"));
  try {
    await fs.writeFile(path.join(directory, "123-456.lock"), "existing native workflow");
    assert.throws(() => acquireLiveRuntimeBuild(directory), /LIVE_RUNTIME_IN_USE/);
    assert.deepEqual(await fs.readdir(directory), ["123-456.lock"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("runtime build activation is exclusive and releases only its own marker", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-runtime-build-"));
  try {
    const release = acquireLiveRuntimeBuild(directory);
    assert.throws(() => acquireLiveRuntimeBuild(directory), /LIVE_RUNTIME_BUILD_BUSY/);
    release();
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("immutable native runtime reuse requires matching source, pinned binaries and a contained home", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-runtime-cache-"));
  try {
    const relative = "live-memory/1234567890abcdef-12345678",
      home = path.join(base, relative);
    await fs.mkdir(home, { recursive: true });
    const files = {
      "sc2-mcp-live-data.dll": Buffer.from("pinned dll"),
      "sc2-mcp-live-loader.exe": Buffer.from("pinned loader"),
    };
    for (const [name, bytes] of Object.entries(files))
      await fs.writeFile(path.join(home, name), bytes);
    const record = {
      protocol: 1,
      sourceSha256: "a".repeat(64),
      home: relative,
      message: "SC2EditorToolkit.LiveData.v1.1234567890abcdef-12345678",
      files: Object.fromEntries(
        Object.entries(files).map(([name, bytes]) => [name, liveDigest(bytes)]),
      ),
    };
    const manifest = path.join(base, "sc2-mcp-live-memory.json");
    await fs.writeFile(manifest, JSON.stringify(record));
    assert.ok(cachedLiveRuntime(base, record.sourceSha256));
    assert.equal(cachedLiveRuntime(base, "b".repeat(64)), undefined);
    await fs.writeFile(path.join(home, "sc2-mcp-live-data.dll"), "changed binary");
    assert.equal(cachedLiveRuntime(base, record.sourceSha256), undefined);
    await fs.writeFile(manifest, JSON.stringify({ ...record, home: "../outside" }));
    assert.equal(cachedLiveRuntime(base, record.sourceSha256), undefined);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
