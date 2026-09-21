import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { scanXml } from "../../core/xmlScanner.js";
import { classifyNativeType } from "./schemaRegistry.js";
import type { CutsceneSchemaData, CutsceneSchemaNode, CutsceneSchemaProperty, CutsceneValueKind } from "./types.js";

function inferValueType(name: string, values: string[]): CutsceneValueKind {
  if (/guid$/i.test(name)) return name.toLowerCase() === "guid" ? "String" : "ObjectRef";
  if (/^(start|end|duration|time|blendTime|blendOutTime|originalDuration|startOffset)$/i.test(name)) return "Time";
  if (/color|tint/i.test(name) && values.some((value) => value.split(",").length >= 3)) return "Color";
  if (/asset|link|path|file|model|sound|texture|lightID/i.test(name)) return "AssetRef";
  if (values.length && values.every((value) => /^(?:0|1|true|false)$/i.test(value))) return "Bool";
  if (values.length && values.every((value) => /^-?\d+$/.test(value))) return "Int";
  if (values.length && values.every((value) => /^-?(?:\d+\.\d+|\d+)$/.test(value))) return "Decimal";
  if (values.some((value) => value.includes(","))) return "Struct";
  return "String";
}

const provenanceLimit = 12;

function compactSources(sources: Set<string>): { discoveredFrom: string[]; discoveredFromTotal: number; discoveredFromTruncated: boolean } {
  const all = [...sources].sort();
  return {
    discoveredFrom: all.slice(0, provenanceLimit),
    discoveredFromTotal: all.length,
    discoveredFromTruncated: all.length > provenanceLimit,
  };
}

async function collectFiles(inputs: string[]): Promise<string[]> {
  const output: string[] = [];
  const visit = async (candidate: string): Promise<void> => {
    let stat;
    try { stat = await fs.stat(candidate); } catch { return; }
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(candidate)) await visit(path.join(candidate, entry));
    } else if (/\.(?:SC2Cutscene|StormCutscene)$/i.test(candidate)) output.push(path.resolve(candidate));
  };
  for (const input of inputs) await visit(path.resolve(input));
  return [...new Set(output)].sort();
}

export async function discoverCutsceneSchema(inputs: string[], options: { gameBuild?: string; editorBuild?: string; discoveredPaths?: string[] } = {}): Promise<CutsceneSchemaData> {
  const files = await collectFiles(inputs);
  const nodes = new Map<string, { count: number; parents: Set<string>; children: Set<string>; sources: Set<string> }>();
  const properties = new Map<string, { objectType: string; name: string; values: Set<string>; count: number; sources: Set<string> }>();
  const corpus: CutsceneSchemaData["corpus"]["files"] = (options.discoveredPaths ?? []).map((file) => ({ file, status: "SKIPPED_NOT_AVAILABLE_LOCALLY" }));
  let failedFiles = 0;

  for (const file of files) {
    const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
    try {
      const parsed = scanXml(await fs.readFile(file, "utf8"));
      const errors = parsed.diagnostics.filter((entry) => entry.severity === "error");
      if (errors.length) {
        failedFiles++;
        corpus.push({ file: relative, status: "FAIL", diagnostics: errors.map((entry) => entry.message) });
        continue;
      }
      corpus.push({ file: relative, status: "PASS" });
      for (const node of parsed.nodes) {
        const record = nodes.get(node.tag) ?? { count: 0, parents: new Set<string>(), children: new Set<string>(), sources: new Set<string>() };
        record.count++;
        record.sources.add(relative);
        if (node.parentId !== null) record.parents.add(parsed.nodes[node.parentId].tag);
        for (const childId of node.childIds) record.children.add(parsed.nodes[childId].tag);
        nodes.set(node.tag, record);
        for (const [name, value] of Object.entries(node.attrs)) {
          const key = `${node.tag}\u0000${name}`;
          const property = properties.get(key) ?? { objectType: node.tag, name, values: new Set<string>(), count: 0, sources: new Set<string>() };
          property.count++;
          property.values.add(value);
          property.sources.add(relative);
          properties.set(key, property);
        }
      }
    } catch (error) {
      failedFiles++;
      corpus.push({ file: relative, status: "FAIL", diagnostics: [String(error)] });
    }
  }

  const nodeEntries: CutsceneSchemaNode[] = [...nodes.entries()].map(([nativeType, entry]) => ({
    nativeType,
    category: classifyNativeType(nativeType),
    parentTypes: [...entry.parents].sort(),
    childTypes: [...entry.children].sort(),
    observedInCorpus: entry.count,
    ...compactSources(entry.sources),
    confidence: "confirmed" as const,
    coverage: "SUPPORTED" as const,
  })).sort((a, b) => a.nativeType.localeCompare(b.nativeType));

  const propertyEntries: CutsceneSchemaProperty[] = [...properties.values()].map((entry) => ({
    objectType: entry.objectType,
    property: entry.name,
    xmlName: entry.name,
    valueType: inferValueType(entry.name, [...entry.values]),
    enumValues: entry.name === "propertyName" ? [...entry.values].sort() : undefined,
    keyframeable: /element|key|curve/i.test(entry.objectType),
    required: false,
    observedInCorpus: entry.count,
    ...compactSources(entry.sources),
    confidence: "confirmed" as const,
    coverage: "SUPPORTED" as const,
  })).sort((a, b) => `${a.objectType}.${a.property}`.localeCompare(`${b.objectType}.${b.property}`));

  const data: CutsceneSchemaData = {
    schemaVersion: "0.1.0-discovery",
    generatedAt: new Date().toISOString(),
    gameBuild: options.gameBuild,
    editorBuild: options.editorBuild,
    sources: inputs.map((location) => ({ kind: "cutscene-corpus", location: path.resolve(location), available: true })),
    nodes: nodeEntries,
    properties: propertyEntries,
    enums: [],
    runtime: { functions: [], constants: [] },
    corpus: { discoveredPaths: (options.discoveredPaths ?? []).length + files.length, parsedFiles: files.length - failedFiles, failedFiles, files: corpus },
  };
  data.schemaHash = createHash("sha256").update(JSON.stringify({ nodes: data.nodes, properties: data.properties, enums: data.enums })).digest("hex");
  return data;
}

export async function indexGalaxyRuntime(files: string[]): Promise<CutsceneSchemaData["runtime"]> {
  const runtime: CutsceneSchemaData["runtime"] = { functions: [], constants: [] };
  const names = new Set<string>();
  const constants = new Set<string>();
  for (const file of files) {
    let source: string;
    try { source = await fs.readFile(file, "utf8"); } catch { continue; }
    for (const line of source.split(/\r?\n/)) {
      if (!/(Cutscene|Cinematic|Camera|Conversation)/i.test(line)) continue;
      const fn = line.match(/^\s*(?:native\s+)?[A-Za-z_]\w*(?:\s*\[\s*\])?\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*;/);
      if (fn && !names.has(fn[1])) {
        names.add(fn[1]);
        runtime.functions.push({ name: fn[1], signature: line.trim(), source: file });
      }
      const constant = line.match(/^\s*(?:const\s+)?[A-Za-z_]\w*\s+(c_(?:camera|cutscene|cinematic|conversation)\w*)\s*(?:=\s*([^;]+))?;/i);
      if (constant && !constants.has(constant[1])) {
        constants.add(constant[1]);
        runtime.constants.push({ name: constant[1], value: constant[2]?.trim(), source: file });
      }
    }
  }
  return runtime;
}
