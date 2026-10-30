import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { directoryManifest } from "../archive/archiveAdapter.js";

test("archive manifest preserves sorted complete hashes while bounding and draining reads", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "archive-manifest-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const expected = [];
  for (let i = 0; i < 11; i++) {
    const file = `${String(i).padStart(2, "0")}.bin`,
      bytes = Buffer.from(`source ${i}`);
    await fs.writeFile(path.join(root, file), bytes);
    expected.push({
      file,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const original = fs.readFile;
  let active = 0,
    maximum = 0,
    fail = false;
  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, String(args[0]).endsWith("00.bin") ? 12 : 2),
      );
      if (fail && /0[01]\.bin$/.test(String(args[0]))) throw Error(path.basename(String(args[0])));
      return await original(...args);
    } finally {
      active--;
    }
  }) as typeof fs.readFile;
  try {
    assert.deepEqual(await directoryManifest(root), expected);
    assert.ok(maximum > 1 && maximum <= 4);
    assert.equal(active, 0);
    fail = true;
    await assert.rejects(directoryManifest(root), /^Error: 00\.bin$/);
    assert.equal(active, 0);
  } finally {
    fs.readFile = original;
  }
});
