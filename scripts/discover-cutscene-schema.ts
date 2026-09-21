import { promises as fs } from "node:fs";
import path from "node:path";
import { discoverCutsceneSchema, indexGalaxyRuntime } from "../src/modules/cutscene/discovery.js";
import { scanEditorArtifacts } from "../src/modules/cutscene/editorDiscovery.js";

const args = process.argv.slice(2);
const inputs: string[] = [];
const natives: string[] = [];
let output = path.resolve("generated/cutscene-schema.json");
let gameBuild: string | undefined;
let editorBuild: string | undefined;
const pathManifests: string[] = [];
const editorDumps: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--out") output = path.resolve(args[++index]);
  else if (arg === "--natives") natives.push(path.resolve(args[++index]));
  else if (arg === "--path-manifest") pathManifests.push(path.resolve(args[++index]));
  else if (arg === "--editor-dump") editorDumps.push(path.resolve(args[++index]));
  else if (arg === "--game-build") gameBuild = args[++index];
  else if (arg === "--editor-build") editorBuild = args[++index];
  else inputs.push(path.resolve(arg));
}
if (!inputs.length) inputs.push(path.resolve("examples/cutscene"), path.resolve("src/tests/fixtures/cutscene"));
const discoveredPaths = (await Promise.all(pathManifests.map(async (file) => (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean)))).flat();
const schema = await discoverCutsceneSchema(inputs, { gameBuild, editorBuild, discoveredPaths });
if (natives.length) schema.runtime = await indexGalaxyRuntime(natives);
if (editorDumps.length) {
  const editor = await scanEditorArtifacts(editorDumps);
  schema.editorEvidence = editor.evidence;
  const existing = new Set(schema.nodes.map((entry) => entry.nativeType));
  schema.nodes.push(...editor.nodeCandidates.filter((entry) => !existing.has(entry.nativeType)));
  schema.sources.push(...editorDumps.map((location) => ({ kind: "editor-decompilation", location, available: true })));
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  nodes: schema.nodes.length,
  properties: schema.properties.length,
  corpus: {
    discoveredPaths: schema.corpus.discoveredPaths,
    parsedFiles: schema.corpus.parsedFiles,
    failedFiles: schema.corpus.failedFiles,
    skippedNotAvailable: schema.corpus.files.filter((entry) => entry.status === "SKIPPED_NOT_AVAILABLE_LOCALLY").length,
  },
  runtime: { functions: schema.runtime.functions.length, constants: schema.runtime.constants.length },
  editorEvidence: schema.editorEvidence ? { scannedFiles: schema.editorEvidence.scannedFiles, identifiers: schema.editorEvidence.identifiers.length } : undefined,
}, null, 2));
