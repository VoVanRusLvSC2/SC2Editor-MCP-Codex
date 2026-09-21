import { promises as fs } from "node:fs";
import path from "node:path";
import { CutsceneSchemaRegistry } from "../src/modules/cutscene/schemaRegistry.js";

const output = path.resolve(process.argv[2] ?? "generated/cutscene-property-matrix.json");
const schema = await CutsceneSchemaRegistry.load();
const entries = schema.data.properties.map((property) => ({
  objectType: property.objectType,
  property: property.property,
  nativeName: property.xmlName,
  valueType: property.valueType,
  coverage: property.coverage,
  parse: property.observedInCorpus > 0 ? "PASS" : "NOT_RUN",
  write: property.coverage === "SUPPORTED" ? "PASS_GENERIC_ATTRIBUTE_PATCH" : property.coverage === "RUNTIME_ONLY" ? "NOT_APPLICABLE" : "PRESERVE_ONLY",
  editor: "NOT_RUN",
  runtime: property.coverage === "RUNTIME_ONLY" ? "INDEXED_NOT_EXECUTED" : "NOT_RUN",
  sources: property.discoveredFrom,
}));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), schemaHash: schema.data.schemaHash, entries }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, properties: entries.length, editorPass: 0, runtimePass: 0 }, null, 2));

