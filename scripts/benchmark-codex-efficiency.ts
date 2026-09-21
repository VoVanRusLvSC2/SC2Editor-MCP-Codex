import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { benchmarkCodexWorkflow } from "../src/benchmark/codexEfficiency.js";
import { Workspace } from "../src/core/workspace.js";
import { SchemaRegistry } from "../src/schema/schemaRegistry.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ui-benchmark-"));
const file = "Benchmark.SC2Layout";
await fs.writeFile(path.join(root, file), "<?xml version=\"1.0\"?>\n<Desc>\n</Desc>\n", "utf8");
try {
  const schema = await SchemaRegistry.loadBundled();
  const result = await benchmarkCodexWorkflow(new Workspace(root, schema), file);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
