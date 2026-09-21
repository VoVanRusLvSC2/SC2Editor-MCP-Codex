import { promises as fs } from "node:fs";
import path from "node:path";
import { attachAddresses, discoverEditorPe, extractAsciiStrings, extractUtf16Strings, parsePe } from "../src/modules/cutscene/peDiscovery.js";
import { dataDomainFromType } from "../src/modules/data/domains.js";

const executable = path.resolve(process.argv[2] ?? "SC2Editor_x64.exe");
const output = path.resolve(process.argv[3] ?? "generated/data-editor-schema.json");
const discovery = await discoverEditorPe(executable);
const executableBytes = await fs.readFile(executable);
const unique = <T>(values: T[]) => [...new Set(values)];
const allStrings = [...extractAsciiStrings(executableBytes), ...extractUtf16Strings(executableBytes)];
const exact = allStrings.filter((entry) => /^[A-Za-z_$][A-Za-z0-9_$.:/-]{2,127}$/.test(entry.text));
const pe = parsePe(executableBytes);
attachAddresses(exact, executableBytes, pe.imageBase, pe.sections);
const byText = new Map<string, typeof exact>();
for (const entry of exact) byText.set(entry.text, [...(byText.get(entry.text) ?? []), entry]);
const offsetRva = (offset: number) => {
  const section = discovery.build.sections.find((entry) => offset >= entry.rawOffset && offset < entry.rawOffset + entry.rawSize);
  return section ? section.virtualAddress + offset - section.rawOffset : undefined;
};
const evidence = (text: string) => (byText.get(text) ?? []).map((entry) => ({
  encoding: entry.encoding, fileOffset: `0x${entry.fileOffset.toString(16).toUpperCase()}`,
  rva: offsetRva(entry.fileOffset) === undefined ? undefined : `0x${offsetRva(entry.fileOffset)!.toString(16).toUpperCase()}`,
  pointerRvas: entry.pointerRvas.slice(0, 32).map((value) => `0x${value.toString(16).toUpperCase()}`),
  xrefRvas: entry.xrefRvas.slice(0, 32).map((value) => `0x${value.toString(16).toUpperCase()}`),
  functions: entry.containingFunctions.slice(0, 16).map((value) => ({ beginRva: `0x${value.beginRva.toString(16).toUpperCase()}`, endRva: `0x${value.endRva.toString(16).toUpperCase()}` })),
}));

const linkTypes = unique(exact.map((entry) => entry.text).filter((value) => /^C[A-Z][A-Za-z0-9_]+Link$/.test(value))).sort();
const fieldTypes = unique(exact.map((entry) => entry.text).filter((value) => /^(?:T|C)(?:CatalogField|CatalogGameLink|CatalogReference)[A-Za-z0-9_]*$/.test(value))).sort();
const runtimeApi = unique(exact.map((entry) => entry.text).filter((value) => /^Catalog(?:Entry|Field|Reference)[A-Za-z0-9_]+$/.test(value))).sort();
const editorSettings = unique(exact.map((entry) => entry.text).filter((value) => /^ObjectEditor(?:\.|[A-Z])[A-Za-z0-9_.]+$/.test(value))).sort();
const localizationKeys = unique(exact.map((entry) => entry.text).filter((value) => /^EDSTR_(?:FIELD|OBJECT|CATALOG|OBJECTEDITOR|FIELDTYPE|FIELDVALUE)[A-Z0-9_]+$/.test(value))).sort();
const catalogTokens = unique(exact.map((entry) => entry.text).filter((value) => {
  if (!/^C[A-Z][A-Za-z0-9_]{1,79}$/.test(value) || value.endsWith("Link")) return false;
  if (!dataDomainFromType(value)) return false;
  return !/(?:Frame|Dialog|Panel|Widget|Control|Tooltip|Renderer|Manager|Editor|View|Window)$/.test(value);
})).sort();
const catalogClassCandidates = catalogTokens.filter((value) => !value.includes("_"));
const qualifiedFieldCandidates = catalogTokens.filter((value) => value.includes("_")).map((name) => {
  const split = name.indexOf("_");
  const owner = name.slice(0, split);
  const internalPath = name.slice(split + 1);
  return { name, owner, domain: dataDomainFromType(owner), internalPath, xmlPathCandidate: internalPath.split("_").join("."), evidence: evidence(name), status: "EXE_INTERNAL_DESCRIPTOR_PATH_NOT_XML_PROVEN" };
});
const rtti = allStrings.filter((entry) => /^\.\?A[UV].*@@$/.test(entry.text) && /(?:Catalog|ObjectEditor|GameData|DataEditor)/i.test(entry.text)).map((entry) => ({
  mangled: entry.text, className: entry.text.replace(/^\.\?A[UV]/, "").replace(/@@$/, ""),
  fileOffset: `0x${entry.fileOffset.toString(16).toUpperCase()}`, rva: offsetRva(entry.fileOffset) === undefined ? undefined : `0x${offsetRva(entry.fileOffset)!.toString(16).toUpperCase()}`,
}));

const result = {
  schemaVersion: "1.0.0-exe-discovery",
  editor: discovery.build,
  sourcePolicy: "Read-only PE strings/RTTI/xref discovery. Exact tokens are not promoted to XML fields without catalog or Editor-output evidence.",
  serialization: {
    root: "Catalog", objectIdentity: "id", inheritance: "parent", scalarCarrier: "value", linkCarrier: "Link", arrayCarrier: "index",
    evidence: "EDITOR_XML_AND_PUBLIC_CORPUS",
  },
  catalogClassCandidates: catalogClassCandidates.map((name) => ({ name, domain: dataDomainFromType(name), evidence: evidence(name), status: "EXE_TOKEN_CANDIDATE" })),
  qualifiedFieldCandidates,
  linkTypes: linkTypes.map((name) => ({ name, targetDomainCandidate: name.slice(1, -4), evidence: evidence(name), status: "EXE_EXACT_TYPE_TOKEN" })),
  fieldTypes: fieldTypes.map((name) => ({ name, evidence: evidence(name), status: "EXE_EXACT_TYPE_TOKEN" })),
  runtimeApi: runtimeApi.map((name) => ({ name, evidence: evidence(name), status: "EXE_EXACT_API_TOKEN" })),
  editorSettings: editorSettings.map((name) => ({ name, evidence: evidence(name), status: "EXE_EXACT_SETTING_TOKEN" })),
  localizationKeys: localizationKeys.map((name) => ({ name, evidence: evidence(name), status: "EXE_EXACT_LOCALIZATION_KEY" })),
  rtti,
  limitations: [
    "The supplied retail PE has no bundled PDB; its debug record points to Blizzard's internal SC2Editor_x64.pdb path.",
    "A string/RTTI/xref hit proves an internal token exists, not that it is an XML element or a writable field.",
    "Owner/field/default/enum mappings require Editor-produced XML, loaded GameData metadata, or function-level reverse engineering and remain UNKNOWN_NEEDS_RESEARCH when not proven.",
  ],
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  editor: { version: discovery.build.fileVersion, sha256: discovery.build.sha256, pdbPath: discovery.build.pdbPath },
  catalogClassCandidates: catalogClassCandidates.length, qualifiedFieldCandidates: qualifiedFieldCandidates.length, linkTypes: linkTypes.length, fieldTypes: fieldTypes.length,
  runtimeApi: runtimeApi.length, editorSettings: editorSettings.length, localizationKeys: localizationKeys.length, rtti: rtti.length,
  output,
}, null, 2));
