import path from "node:path";
import { decodeUtf8, readSnapshot } from "../../core/fileTransactions.js";
import { scanXml } from "../../core/xmlScanner.js";

export const cutsceneComponentFile = "ComponentList.SC2Components";
export const cutsceneVersionFile = "Base.SC2Data/Cutscenes/Index.version";
const logicalRoot = "Cutscenes/Index";

/** Index is a logical component, not an XML listing to invent alongside scene files. */
export function registerCutsceneComponent(source: string): { source: string; changed: boolean } {
  const parsed = scanXml(source);
  const root = parsed.rootIds.length === 1 ? parsed.nodes[parsed.rootIds[0]] : undefined;
  if (parsed.diagnostics.some(d => d.severity === "error") || root?.tag !== "Components" || root.selfClosing)
    throw new Error("CUTSCENE_COMPONENT_MANIFEST_INVALID");
  const components = parsed.nodes.filter(n => n.parentId === root.id && n.tag === "DataComponent" && n.attrs.Type === "cuts");
  if (components.length > 1) throw new Error("CUTSCENE_COMPONENT_DUPLICATE");
  if (components.length) {
    const node = components[0];
    if (source.slice(node.startTagEnd, node.endTagStart).trim() !== logicalRoot)
      throw new Error("CUTSCENE_COMPONENT_ROOT_UNSUPPORTED");
    return { source, changed: false };
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const closingLine = source.lastIndexOf("\n", root.endTagStart - 1) + 1;
  const indent = source.slice(closingLine, root.endTagStart);
  const offset = /^\s*$/.test(indent) ? closingLine : root.endTagStart;
  const prefix = offset > 0 && source[offset - 1] !== "\n" ? newline : "";
  const addition = `${prefix}    <DataComponent Type="cuts">${logicalRoot}</DataComponent>${newline}`;
  return { source: source.slice(0, offset) + addition + source.slice(offset), changed: true };
}

/** Opaque Editor-produced version metadata: preserve existing bytes, never fabricate counters. */
export function requireNativeCutsceneVersion(bytes: Buffer): void {
  if (bytes.length < 12 || bytes.subarray(0, 8).toString("ascii") !== "cdesstuc" || bytes.readUInt32LE(8) !== 2)
    throw new Error("CUTSCENE_VERSION_TEMPLATE_UNSUPPORTED: supply an Editor-produced cuts Index.version");
}

/** Fail closed before export: imported scene assets alone do not register Editor document scenes. */
export async function requireCutsceneDocumentRegistration(root: string, files: readonly { file: string }[]): Promise<void> {
  if (!files.some(f => /^Base\.SC2Data\/Cutscenes\/.+\.(?:SC2Cutscene|StormCutscene)$/i.test(f.file))) return;
  const component = await readSnapshot(path.join(root, cutsceneComponentFile));
  if (!component.exists || registerCutsceneComponent(decodeUtf8(component.bytes, cutsceneComponentFile)).changed)
    throw new Error("CUTSCENE_DOCUMENT_NOT_REGISTERED: use cutscene.register_document before archive export");
  const version = await readSnapshot(path.join(root, cutsceneVersionFile));
  if (!version.exists) throw new Error("CUTSCENE_VERSION_MISSING: use cutscene.register_document with an exact native versionTemplate");
  requireNativeCutsceneVersion(version.bytes);
}
