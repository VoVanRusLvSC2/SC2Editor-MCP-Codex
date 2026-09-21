import { promises as fs } from "node:fs";
import path from "node:path";
import { LayoutDocument } from "../src/core/layoutDocument.js";
import { StyleDocument } from "../src/core/styleDocument.js";

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(?:SC2Layout|StormLayout|SC2Style)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node --import tsx scripts/verify-corpus.ts <UI directory>");

let layouts = 0;
let styles = 0;
let frames = 0;
let diagnostics = 0;
let roundTripFailures = 0;
const failures: string[] = [];

for (const file of await walk(root)) {
  const source = await fs.readFile(file, "utf8");
  const doc = /\.SC2Style$/i.test(file) ? new StyleDocument(source) : new LayoutDocument(source);
  if (doc.source !== source) {
    roundTripFailures++;
    failures.push(`round-trip: ${path.relative(root, file)}`);
  }
  const errors = doc.diagnostics.filter((item) => item.severity === "error");
  diagnostics += errors.length;
  if (errors.length) failures.push(`parse: ${path.relative(root, file)}: ${errors.map((item) => item.message).join("; ")}`);
  if (doc instanceof LayoutDocument) {
    layouts++;
    frames += doc.listFrames().length;
  } else {
    styles++;
  }
}

const report = { root: path.basename(root), layouts, styles, frames, diagnostics, roundTripFailures, failures };
console.log(JSON.stringify(report, null, 2));
if (diagnostics || roundTripFailures) process.exitCode = 1;
