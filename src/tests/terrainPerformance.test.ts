import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { parseState, applyOperations } from "../modules/terrain/operations.js";
import type { TerrainOperation } from "../modules/terrain/types.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
test(
  "bounded brush halos preserve full-grid component bytes, diagnostics and visit order on native terrain references",
  {
    skip:
      !existsSync("src/tests/fixtures/terrain-native/nydus/t3HeightMap.gz") &&
      "Private native terrain inputs are not part of the source distribution",
  },
  async () => {
    const reference = JSON.parse(
      await fs.readFile("docs/verification/terrain-performance-reference.json", "utf8"),
    ) as {
      cases: Array<{
        id: string;
        operations: TerrainOperation[];
        componentManifestSha256: string;
        result: unknown;
        visits: number;
        visitsSha256: string;
      }>;
    };
    for (const fixture of reference.cases) {
      const directory = "src/tests/fixtures/terrain-native/" + fixture.id,
        sources = new Map<string, Buffer>();
      for (const file of await fs.readdir(directory))
        if (file.endsWith(".gz"))
          sources.set(file.slice(0, -3), gunzipSync(await fs.readFile(directory + "/" + file)));
      const visits: number[][] = [],
        result = applyOperations(parseState(sources), fixture.operations, undefined, {
          height: (x, y) => {
            visits.push([x, y]);
          },
          texture: () => {},
        });
      const manifest = Object.fromEntries([...sources].map(([name, bytes]) => [name, sha(bytes)]));
      assert.equal(sha(JSON.stringify(manifest)), fixture.componentManifestSha256, fixture.id);
      assert.deepEqual(result, fixture.result, fixture.id);
      assert.equal(visits.length, fixture.visits, fixture.id);
      assert.equal(sha(JSON.stringify(visits)), fixture.visitsSha256, fixture.id);
    }
  },
);
