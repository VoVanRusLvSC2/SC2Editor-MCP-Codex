import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanXml } from "../src/core/xmlScanner.js";
import type { XmlNode } from "../src/core/types.js";
import type { DataXsdField, DataXsdManifest, DataXsdType } from "../src/modules/data/xsdRegistry.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const input = args.find((entry) => !entry.startsWith("--"));
const outputArg = args.find((entry) => entry.startsWith("--output="))?.slice("--output=".length);
if (!input) throw new Error("Usage: npm run data:xsd:index -- <catalogsData.xsd> [--output=generated/data-xsd-index]");
const inputFile = path.resolve(input), output = path.resolve(projectRoot, outputArg ?? "generated/data-xsd-index");
const staging = `${output}.tmp-${process.pid}`;
const source = await fs.readFile(inputFile, "utf8"), parsed = scanXml(source);
if (parsed.diagnostics.length) throw new Error(`XSD_XML_INVALID ${JSON.stringify(parsed.diagnostics.slice(0, 20))}`);

const nodes = parsed.nodes;
const local = (tag: string) => tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
const attr = (node: XmlNode, name: string) => node.attrs[name];
const facets = new Set(["length", "minLength", "maxLength", "pattern", "minInclusive", "maxInclusive", "minExclusive", "maxExclusive", "totalDigits", "fractionDigits", "whiteSpace"]);
const definitions = nodes.filter((node) => ["complexType", "simpleType"].includes(local(node.tag)) && attr(node, "name"));
const types: DataXsdType[] = [];

for (const definition of definitions) {
  const kind = local(definition.tag) === "complexType" ? "complex" : "simple";
  const value: DataXsdType = {
    name: attr(definition, "name"), kind,
    abstract: attr(definition, "abstract") === "true" || undefined,
    mixed: attr(definition, "mixed") === "true" || undefined,
    fields: [], enumValues: [], facets: [],
  };
  const stack = [...definition.childIds].reverse();
  while (stack.length) {
    const node = nodes[stack.pop()!], tag = local(node.tag);
    if ((tag === "complexType" || tag === "simpleType") && attr(node, "name")) continue;
    if ((tag === "extension" || tag === "restriction") && !value.base && attr(node, "base")) value.base = attr(node, "base");
    if (tag === "element" || tag === "attribute") {
      const field: DataXsdField = { kind: tag };
      for (const key of ["name", "ref", "type", "minOccurs", "maxOccurs", "use", "default", "fixed"] as const) if (attr(node, key) !== undefined) field[key] = attr(node, key);
      value.fields.push(field);
    } else if (tag === "enumeration" && attr(node, "value") !== undefined) value.enumValues.push(attr(node, "value"));
    else if (facets.has(tag) && attr(node, "value") !== undefined) value.facets.push({ kind: tag, value: attr(node, "value") });
    for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i]);
  }
  value.fields.sort((a, b) => `${a.kind}:${a.name ?? a.ref ?? ""}`.localeCompare(`${b.kind}:${b.name ?? b.ref ?? ""}`));
  value.enumValues = [...new Set(value.enumValues)].sort();
  types.push(value);
}
types.sort((a, b) => a.name.localeCompare(b.name));

await fs.rm(staging, { recursive: true, force: true });
await fs.mkdir(path.join(staging, "types"), { recursive: true });
const manifestTypes: DataXsdManifest["types"] = [];
for (const type of types) {
  const shard = `types/${createHash("sha256").update(type.name).digest("hex").slice(0, 20)}.json`;
  await fs.writeFile(path.join(staging, shard), `${JSON.stringify(type)}\n`);
  manifestTypes.push({ name: type.name, kind: type.kind, base: type.base, fields: type.fields.length, enumValues: type.enumValues.length, shard });
}
const manifest: DataXsdManifest = {
  schemaVersion: "1",
  source: { file: path.basename(inputFile), bytes: Buffer.byteLength(source), sha256: createHash("sha256").update(source).digest("hex") },
  statistics: {
    complexTypes: types.filter((entry) => entry.kind === "complex").length,
    simpleTypes: types.filter((entry) => entry.kind === "simple").length,
    fields: types.reduce((sum, entry) => sum + entry.fields.length, 0),
    enumValues: types.reduce((sum, entry) => sum + entry.enumValues.length, 0),
  },
  types: manifestTypes,
};
await fs.writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest)}\n`);
await fs.rm(output, { recursive: true, force: true });
await fs.rename(staging, output);
console.log(JSON.stringify({ output, ...manifest.statistics, source: manifest.source }, null, 2));
