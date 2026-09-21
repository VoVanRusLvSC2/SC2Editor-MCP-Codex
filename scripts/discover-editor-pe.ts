import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { discoverEditorPe, editorEvidenceSchema } from "../src/modules/cutscene/peDiscovery.js";
import { classifyNativeType } from "../src/modules/cutscene/schemaRegistry.js";
import { SchemaRegistry } from "../src/schema/schemaRegistry.js";
import type { CutsceneSchemaData, CutsceneSchemaNode, CutsceneSchemaProperty } from "../src/modules/cutscene/types.js";

const args = process.argv.slice(2);
const executable = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? "SC2Editor_x64.exe");
const generated = path.resolve("generated");
const schemaFile = path.resolve("generated/cutscene-schema.json");

function withoutPreviousEditorSources<T extends { discoveredFrom: string[] }>(entries: T[]): T[] {
  return entries.flatMap((entry) => {
    const discoveredFrom = entry.discoveredFrom.filter((source) => !source.startsWith("SC2Editor "));
    return discoveredFrom.length ? [{ ...entry, discoveredFrom }] : [];
  });
}

const schema = JSON.parse(await fs.readFile(schemaFile, "utf8")) as CutsceneSchemaData;
schema.nodes = withoutPreviousEditorSources(schema.nodes);
schema.properties = withoutPreviousEditorSources(schema.properties);
schema.enums = schema.enums.map((entry) => ({
  ...entry,
  discoveredFrom: entry.discoveredFrom.filter((source) => !source.startsWith("SC2Editor ")),
})).filter((entry) => entry.discoveredFrom.length);
const discovery = await discoverEditorPe(executable, schema);
const evidence = editorEvidenceSchema(discovery, schema);
const uiSchema = await SchemaRegistry.loadBundled();
const uiCoverage = uiSchema.auditCoverage();
const uiClassNames = new Set(uiSchema.frameClasses.keys());

function mergeNodes(current: CutsceneSchemaNode[], extra: CutsceneSchemaNode[]): CutsceneSchemaNode[] {
  const result = new Map(current.map((entry) => [entry.nativeType, entry]));
  for (const entry of extra) {
    const prior = result.get(entry.nativeType);
    result.set(entry.nativeType, prior ? {
      ...entry,
      ...prior,
      discoveredFrom: [...new Set([...prior.discoveredFrom, ...entry.discoveredFrom])],
    } : entry);
  }
  return [...result.values()].sort((a, b) => a.nativeType.localeCompare(b.nativeType));
}

function mergeProperties(current: CutsceneSchemaProperty[], extra: CutsceneSchemaProperty[]): CutsceneSchemaProperty[] {
  const result = new Map(current.map((entry) => [`${entry.objectType}\0${entry.xmlName}`, entry]));
  for (const entry of extra) {
    const key = `${entry.objectType}\0${entry.xmlName}`;
    const prior = result.get(key);
    result.set(key, prior ? {
      ...entry,
      ...prior,
      enumValues: [...new Set([...(prior.enumValues ?? []), ...(entry.enumValues ?? [])])],
      discoveredFrom: [...new Set([...prior.discoveredFrom, ...entry.discoveredFrom])],
    } : entry);
  }
  return [...result.values()].sort((a, b) => `${a.objectType}.${a.xmlName}`.localeCompare(`${b.objectType}.${b.xmlName}`));
}

schema.nodes = mergeNodes(schema.nodes, evidence.nodes);
schema.nodes = schema.nodes.map((entry) => ({ ...entry, category: classifyNativeType(entry.nativeType) }));
schema.properties = mergeProperties(schema.properties, evidence.properties);
for (const candidate of evidence.enums) {
  const prior = schema.enums.find((entry) => entry.name === candidate.name);
  if (prior) {
    prior.values = [...new Set([...prior.values, ...candidate.values])];
    prior.discoveredFrom = [...new Set([...prior.discoveredFrom, ...candidate.discoveredFrom])];
  } else schema.enums.push(candidate);
}
const tangentValues = evidence.enums.find((entry) => entry.name === "TangentType")?.values;
if (tangentValues?.length) {
  schema.properties = schema.properties.map((entry) => /curve(?:In|Out)Type/i.test(entry.xmlName)
    ? { ...entry, valueType: "Enum", enumValues: tangentValues }
    : entry);
}
schema.editorBuild = discovery.build.fileVersion;
schema.sources = schema.sources.filter((entry) => entry.kind !== "editor-executable");
schema.sources.push({
  kind: "editor-executable",
  location: discovery.build.fileName,
  available: true,
  note: `Read-only static discovery; sha256=${discovery.build.sha256}`,
});
schema.editorEvidence = {
  scannedFiles: 1,
  skippedBinaryFiles: 0,
  keywords: Object.fromEntries(["Cutscene", "Camera", "Director", "Tangent", "Light"].map((keyword) => [keyword, discovery.strings.filter((entry) => entry.text.toLowerCase().includes(keyword.toLowerCase())).length])),
  identifiers: discovery.objectTypes.map((entry) => ({ name: entry.nativeId, count: entry.fileOffsets.length + Number(entry.representations.includes("rtti")), files: [discovery.build.fileName] })),
};
schema.schemaHash = createHash("sha256").update(JSON.stringify({ nodes: schema.nodes, properties: schema.properties, enums: schema.enums })).digest("hex");

const cameraProperties = discovery.properties.filter((entry) => entry.category === "Camera");
const cameraNativeTypes = schema.nodes.filter((entry) => entry.category === "camera").map((entry) => entry.nativeType);
const cameraRelevantObjectTypes = new Set(["*", "Camera", "@Category:Commandable", "@Category:Node", "@Category:Object", "@Category:Camera", ...cameraNativeTypes]);
const cameraEffectiveGroups = new Map<string, CutsceneSchemaProperty[]>();
for (const property of schema.properties.filter((entry) => cameraRelevantObjectTypes.has(entry.objectType))) {
  const group = cameraEffectiveGroups.get(property.xmlName) ?? [];
  group.push(property);
  cameraEffectiveGroups.set(property.xmlName, group);
}
const cameraMatrix = [...cameraEffectiveGroups.entries()].map(([property, definitions]) => {
  const editor = cameraProperties.find((entry) => entry.xmlNameCandidate.toLowerCase() === property.toLowerCase());
  const observed = definitions.reduce((sum, entry) => sum + entry.observedInCorpus, 0);
  const runtimeProperty = property.toLowerCase() === "fov" ? "FieldOfView" : property;
  const runtimeConstant = schema.runtime.constants.find((entry) => entry.name.toLowerCase() === `c_cameravalue${runtimeProperty}`.toLowerCase());
  return {
    property,
    nativeTypes: definitions.map((entry) => entry.objectType),
    valueTypes: [...new Set(definitions.map((entry) => entry.valueType))],
    editorDescriptor: editor ? "FOUND_STRING_CLUSTER" : "NOT_FOUND_IN_CAMERA_LOCALIZATION_CLUSTER",
    editorEvidence: editor,
    corpus: observed > 0 ? { status: "FOUND", observations: observed } : { status: "NOT_OBSERVED", observations: 0 },
    runtimeMapping: runtimeConstant ? { status: "CANDIDATE_NAME_MATCH_NOT_PROVEN_EQUIVALENT", constant: runtimeConstant.name } : "NOT_PROVEN",
    status: observed > 0 ? "SUPPORTED_TYPED" : editor && editor.xmlNameStatus !== "display-derived" ? "SUPPORTED_GENERIC" : runtimeConstant ? "RUNTIME_ONLY" : "PRESERVE_ONLY",
  };
}).sort((a, b) => a.property.localeCompare(b.property));
const directorProperties = discovery.properties.filter((entry) => entry.category === "Director" || entry.category === "ActiveCamera" || entry.category === "ActiveShot");
const knownSchemaNames = new Set(schema.properties.map((entry) => `${entry.objectType}\0${entry.xmlName}`));
const gaps = discovery.properties.map((entry) => ({
  category: entry.category,
  objectType: entry.schemaObjectType,
  property: entry.xmlNameCandidate,
  xmlNameStatus: entry.xmlNameStatus,
  editorConfidence: entry.confidence,
  mcpStatus: knownSchemaNames.has(`${entry.schemaObjectType}\0${entry.xmlNameCandidate}`) ? (entry.xmlNameStatus === "display-derived" ? "SUPPORTED_GENERIC_NAME_NEEDS_SERIALIZER_PROOF" : "SUPPORTED_GENERIC") : "MISSING",
}));
const tangent = discovery.enums.find((entry) => entry.name === "TangentType");

await fs.mkdir(generated, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(generated, "editor-build.json"), `${JSON.stringify(discovery.build, null, 2)}\n`),
  fs.writeFile(path.join(generated, "cutscene-object-types.json"), `${JSON.stringify({ build: discovery.build.fileVersion, sha256: discovery.build.sha256, types: discovery.objectTypes }, null, 2)}\n`),
  fs.writeFile(path.join(generated, "cutscene-properties.json"), `${JSON.stringify({ build: discovery.build.fileVersion, sha256: discovery.build.sha256, properties: discovery.properties }, null, 2)}\n`),
  fs.writeFile(path.join(generated, "editor-rtti-cutscene.json"), `${JSON.stringify({ build: discovery.build.fileVersion, sha256: discovery.build.sha256, classes: discovery.rtti }, null, 2)}\n`),
  fs.writeFile(path.join(generated, "cutscene-tangent-modes.json"), `${JSON.stringify({ build: discovery.build.fileVersion, enum: tangent ?? null, serializationFields: ["curveInType", "curveOutType", "curveInValue", "curveOutValue"], nativeIntegerIds: "UNKNOWN_NEEDS_RESEARCH", warning: "Tokens are EXE-confirmed. Integer IDs were not inferred from display-string order." }, null, 2)}\n`),
  fs.writeFile(path.join(generated, "camera-property-matrix.json"), `${JSON.stringify({ build: discovery.build.fileVersion, sha256: discovery.build.sha256, cameraTypes: discovery.objectTypes.filter((entry) => entry.category.includes("camera")), editorPropertyCluster: cameraProperties, properties: cameraMatrix }, null, 2)}\n`),
  fs.writeFile(path.join(generated, "cutscene-schema-gap.json"), `${JSON.stringify({ build: discovery.build.fileVersion, summary: { editorTypes: discovery.objectTypes.length, editorProperties: discovery.properties.length, cameraProperties: cameraProperties.length, directorProperties: directorProperties.length, gapsByStatus: Object.fromEntries([...new Set(gaps.map((entry) => entry.mcpStatus))].map((status) => [status, gaps.filter((entry) => entry.mcpStatus === status).length])) }, gaps }, null, 2)}\n`),
  fs.writeFile(path.join(generated, "ui-editor-evidence.json"), `${JSON.stringify({
    build: discovery.build.fileVersion,
    sha256: discovery.build.sha256,
    schemaCoverage: uiCoverage,
    editorFrameClassCandidates: discovery.uiFrameClasses.length,
    matchedSchemaClasses: discovery.uiFrameClasses.filter((entry) => uiClassNames.has(entry.className)).length,
    note: "Supplementary EXE string/RTTI evidence only. The StormLayout schema plus Blizzard UI corpus remains the authoritative UI registry source.",
    classes: discovery.uiFrameClasses.map((entry) => ({ ...entry, schemaClass: uiClassNames.has(entry.className) })),
  }, null, 2)}\n`),
  fs.writeFile(schemaFile, `${JSON.stringify(schema, null, 2)}\n`),
]);

console.log(JSON.stringify({
  editor: discovery.build,
  objectTypes: discovery.objectTypes.length,
  properties: discovery.properties.length,
  cameraProperties: cameraProperties.length,
  directorProperties: directorProperties.length,
  enums: discovery.enums.map((entry) => ({ name: entry.name, values: entry.values.map((value) => value.token) })),
  rttiClasses: discovery.rtti.length,
}, null, 2));
