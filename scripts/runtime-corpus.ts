import path from "node:path";
import { SchemaRegistry } from "../src/schema/schemaRegistry.js";
import { generateRuntimeCorpus, runRuntimeAdapter } from "../src/runtime/runtimeHarness.js";

const output = path.resolve(process.argv[2] ?? "runtime-corpus");
const shouldRun = process.argv.includes("--run");
const schema = await SchemaRegistry.loadBundled();
const manifest = await generateRuntimeCorpus(schema, output);
console.log(JSON.stringify({ generated: output, frameTypes: manifest.frameTypes, manifest: path.join(output, "runtime-corpus.json") }, null, 2));
if (shouldRun) {
  const report = await runRuntimeAdapter(output, path.join(output, "runtime-corpus.json"));
  console.log(JSON.stringify(report, null, 2));
  if (report.timedOut || report.exitCode !== 0) process.exitCode = 1;
}
