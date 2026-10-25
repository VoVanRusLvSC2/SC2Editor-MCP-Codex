import { promises as fs } from "node:fs";
import path from "node:path";
import { bytesHash } from "../../core/binaryTransactions.js";
import { decodeUtf8 } from "../../core/fileTransactions.js";
import { decodeXmlValue, scanXml } from "../../core/xmlScanner.js";
import { safeArchivePath, type DirectoryEntry } from "../../archive/archiveAdapter.js";
import { readDocumentHeader, readDocumentInfo, readVersion } from "../document/codecs/metadata.js";

/** Validate authored local mods without treating the original empty foundation as current content. */
export async function inspectModExport(root: string, files: DirectoryEntry[]) {
  const entries = new Map(files.map(file => [file.file, file]));
  const read = async (file: string) => {
    const entry = entries.get(file);
    if (!entry) throw new Error("MOD_EXPORT_COMPONENT_MISSING: " + file);
    const bytes = await fs.readFile(path.join(root, file));
    if (bytes.length !== entry.size || bytesHash(bytes) !== entry.sha256) throw new Error("STALE_MAP_SNAPSHOT: " + file);
    return bytes;
  };
  const header = readDocumentHeader(await read("DocumentHeader"));
  if (header.kind !== 2) throw new Error("DOCUMENT_EXPORT_KIND_MISMATCH: .SC2Mod requires a mod DocumentHeader");
  if (header.buildFlag !== 1 || header.build2 !== header.build || header.identity2 !== header.identity || header.players !== 0 || header.reserved !== 0)
    throw new Error("MOD_EXPORT_HEADER_INVALID");
  if (files.some(file => /^(?:MapInfo(?:\.version)?|t3Terrain\.xml)$/i.test(file.file))) throw new Error("MOD_EXPORT_MAP_COMPONENT_PRESENT");
  const infoBytes = await read("DocumentInfo"), info = readDocumentInfo(infoBytes), infoXml = scanXml(decodeUtf8(infoBytes,"DocumentInfo"));
  for (const section of ["ModType", "Dependencies", "Flags"]) {
    const nodes = infoXml.nodes.filter(node => node.tag === section);
    if ((section === "Flags" ? nodes.length > 1 : nodes.length !== 1) || nodes.some(node => node.parentId !== infoXml.rootIds[0] || node.childIds.some(id => infoXml.nodes[id].tag !== "Value" || infoXml.nodes[id].childIds.length)))
      throw new Error("MOD_EXPORT_INFO_PROFILE");
  }
  if (JSON.stringify(info.dependencies) !== JSON.stringify(header.dependencies)) throw new Error("DOCUMENT_DEPENDENCY_SECTIONS_DISAGREE");
  if (info.modType.length !== 1 || info.modType[0] !== "Interface" || info.flags.some(flag => flag !== "ExtensionMod") || info.flags.length > 1)
    throw new Error("MOD_EXPORT_INFO_PROFILE");
  if (info.dependencies.some(dependency => !dependency.trim()) || new Set(info.dependencies).size !== info.dependencies.length)
    throw new Error("MOD_EXPORT_DEPENDENCIES_INVALID");
  const source = decodeUtf8(await read("ComponentList.SC2Components"), "ComponentList.SC2Components"), xml = scanXml(source);
  if (xml.diagnostics.some(diagnostic => diagnostic.severity === "error") || xml.rootIds.length !== 1 || xml.nodes[xml.rootIds[0]].tag !== "Components")
    throw new Error("DOCUMENT_COMPONENT_LIST_INVALID");
  const registrations = xml.nodes.filter(node => node.id !== xml.rootIds[0]);
  const identities = new Set<string>();
  let infoRegistered = false;
  for (const node of registrations) {
    if (node.parentId !== xml.rootIds[0] || !["DataComponent", "Component"].includes(node.tag) || !/^[a-z0-9]{4}$/.test(node.attrs.Type ?? ""))
      throw new Error("MOD_EXPORT_COMPONENT_REGISTRATION_INVALID");
    const type = node.attrs.Type, componentRoot = safeArchivePath(decodeXmlValue(source.slice(node.startTagEnd, node.endTagStart).trim()));
    if (type === "mapi" || type === "terr") throw new Error("MOD_EXPORT_MAP_COMPONENT_PRESENT");
    if (node.attrs.Locale !== undefined && !/^[a-z]{2}[A-Z]{2}$/.test(node.attrs.Locale)) throw new Error("DOCUMENT_LOCALE_INVALID");
    const identity = type + ":" + (node.attrs.Locale ?? "");
    if (identities.has(identity)) throw new Error("MOD_EXPORT_COMPONENT_DUPLICATE");
    identities.add(identity);
    if (type === "info") {
      if (componentRoot !== "DocumentInfo") throw new Error("MOD_EXPORT_INFO_ROOT_INVALID");
      infoRegistered = true;
    }
    if (!["gada", "text"].includes(type) && !entries.has(componentRoot)) throw new Error("MOD_EXPORT_COMPONENT_MISSING: " + componentRoot);
    const version = readVersion(await read(componentRoot + ".version"));
    if (version.tag !== type || version.build2 !== version.build || version.terminal !== 1 || [version.major, version.minor, version.patch].some(value => value > 255))
      throw new Error("DOCUMENT_VERSION_MISMATCH: " + componentRoot);
  }
  if (!infoRegistered) throw new Error("MOD_EXPORT_INFO_NOT_REGISTERED");
  return {
    files, valid: true,
    validationScope: "Authored local mod H2CS v8 metadata, matching ordered dependency sections and registered v2 component markers; authored content is preserved without empty-foundation or engine certification",
  };
}
