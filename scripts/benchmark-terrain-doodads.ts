import { promises as fs } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PlacementDocument } from "../src/modules/placement/document.js";
import { planPositions } from "../src/modules/placement/planner.js";
import {
  applyOperations,
  parseState,
} from "../src/modules/terrain/operations.js";
import type { PlacementMutation } from "../src/modules/placement/types.js";

interface Measurement {
  milliseconds: number;
  sha256: string;
  texture?: string;
}
const report: Record<string, Measurement> = {};
const ops: PlacementMutation[] = Array.from({ length: 1000 }, (_, i) => ({
  op: "add",
  object: {
    kind: "Doodad",
    catalogId: "AgriaTree",
    position: { x: i % 100, y: Math.floor(i / 100), z: 8 },
  },
}));
let start = performance.now();
const document = PlacementDocument.create();
document.apply(ops);
report.objects = {
  milliseconds: performance.now() - start,
  sha256: document.sha256,
};
start = performance.now();
const points = planPositions({ x: 0, y: 0, z: 0 }, 5000, {
  type: "scatter",
  area: { type: "rectangle", minX: 0, minY: 0, maxX: 200, maxY: 200, z: 0 },
  minimumDistance: 1,
  seed: 42,
});
report.scatter = {
  milliseconds: performance.now() - start,
  sha256: createHash("sha256").update(JSON.stringify(points)).digest("hex"),
};
const sources = new Map<string, Buffer>();
for (const f of await fs.readdir("src/tests/fixtures/terrain-native/ant"))
  sources.set(
    f.slice(0, -3),
    gunzipSync(await fs.readFile("src/tests/fixtures/terrain-native/ant/" + f)),
  );
const state = parseState(sources),
  texture = state.descriptor.textures.find(
    (t) => t.id && Math.floor(t.slot / 8) === state.descriptor.blockSet(68, 68),
  )!.id;
start = performance.now();
applyOperations(state, [
  {
    op: "height.noise",
    area: { type: "circle", center: { x: 68, y: 68 }, radius: 6 },
    seed: 42,
    amplitude: 0.2,
  },
  {
    op: "texture.paint",
    area: { type: "circle", center: { x: 68, y: 68 }, radius: 6 },
    texture,
    strength: 0.5,
  },
]);
report.terrain = {
  milliseconds: performance.now() - start,
  sha256: createHash("sha256")
    .update(Buffer.concat([...sources.values()]))
    .digest("hex"),
  texture,
};
const baseline: Record<string, Measurement> | undefined = process.argv[2]
  ? JSON.parse(await fs.readFile(process.argv[2], "utf8"))
  : undefined;
const comparison = baseline
  ? Object.fromEntries(
      Object.entries(report).map(([key, result]) => [
        key,
        {
          beforeMilliseconds: baseline[key].milliseconds,
          afterMilliseconds: result.milliseconds,
          speedup: baseline[key].milliseconds / result.milliseconds,
          exactOutputMatch: baseline[key].sha256 === result.sha256,
        },
      ]),
    )
  : undefined;
if (comparison && Object.values(comparison).some((c) => !c.exactOutputMatch))
  throw new Error("Benchmark output differs from baseline");
const result = {
  version: "1.1.0-alpha.11",
  methodology:
    "One local measured run per task, excluding imports/fixture read. Baseline collected on alpha.8 in this session. Timing depends on workload, machine, JIT and load; not a production throughput guarantee.",
  tasks: {
    objects: "1000 consecutive Doodad XML adds",
    scatter: "5000 seeded centers, distance 1 in 200x200 area",
    terrain:
      "local radius-6 height noise + texture paint on native 137x137 vertex map",
  },
  measurements: report,
  comparison,
  nativeEditorRuntime: "NOT_EXECUTED",
};
await fs.mkdir("generated", { recursive: true });
await fs.writeFile(
  "generated/terrain-doodads-performance.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
