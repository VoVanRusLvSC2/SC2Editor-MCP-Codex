import { promises as fs } from "node:fs";
import path from "node:path";
import { CutsceneDocument } from "../src/modules/cutscene/document.js";
import { CutsceneSchemaRegistry } from "../src/modules/cutscene/schemaRegistry.js";

async function walk(candidate: string): Promise<string[]> {
  const stat = await fs.stat(candidate);
  if (stat.isFile()) return /\.(?:SC2Cutscene|StormCutscene)$/i.test(candidate) ? [candidate] : [];
  const output: string[] = [];
  for (const entry of await fs.readdir(candidate, { withFileTypes: true })) {
    const full = path.join(candidate, entry.name);
    if (entry.isDirectory()) output.push(...await walk(full));
    else if (/\.(?:SC2Cutscene|StormCutscene)$/i.test(entry.name)) output.push(full);
  }
  return output;
}

const input = process.argv[2];
if (!input) throw new Error("Usage: npm run cutscene:corpus:verify -- <Cutscene directory>");
const root = path.resolve(input);
const files = await walk(root);
const schema = await CutsceneSchemaRegistry.load();
let parseFailures = 0;
let byteRoundTripFailures = 0;
let objects = 0;
let animationBlocks = 0;
let lights = 0;
const failures: Array<{ file: string; reason: string }> = [];

for (const file of files) {
  try {
    const source = await fs.readFile(file, "utf8");
    const document = new CutsceneDocument(source, file);
    const errors = document.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length) {
      parseFailures++;
      failures.push({ file: path.relative(root, file), reason: errors.map((entry) => entry.message).join("; ") });
      continue;
    }
    if (document.source !== source) {
      byteRoundTripFailures++;
      failures.push({ file: path.relative(root, file), reason: "no-op source changed" });
    }
    const ir = document.toIR(schema, true);
    objects += ir.objects.length;
    animationBlocks += ir.objects.filter((entry) => entry.nativeType === "CCutsceneElementAnim").length;
    lights += ir.objects.filter((entry) => entry.nativeType === "CCutsceneNodeLight").length;
  } catch (error) {
    parseFailures++;
    failures.push({ file: path.relative(root, file), reason: String(error) });
  }
}

const report = { root: path.basename(root), files: files.length, objects, animationBlocks, lights, parseFailures, byteRoundTripFailures, failures: failures.slice(0, 100) };
console.log(JSON.stringify(report, null, 2));
if (parseFailures || byteRoundTripFailures) process.exitCode = 1;
