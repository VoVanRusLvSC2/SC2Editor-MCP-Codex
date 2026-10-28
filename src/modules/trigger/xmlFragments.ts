import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import { guiTypeXml, resolveGuiType } from "./typeSystem.js";
import type { GuiType, Registry } from "./authoring.js";

export const encode = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const localRef = (library: string, currentLibrary = "") =>
  library ? ` Library="${encode(library)}"` : currentLibrary ? ' Library=""' : "";

export function guiContainer(xml: string, library: string): XmlNode {
  const parsed = scanXml(xml);
  const nodes = library
    ? parsed.nodes.filter((node) => node.tag === "Library" && node.attrs.Id === library)
    : parsed.rootIds.map((id) => parsed.nodes[id]).filter((node) => node.tag === "TriggerData");
  if (nodes.length !== 1)
    throw new Error(library ? "GUI_LIBRARY_NOT_UNIQUE" : "GUI_ROOT_NOT_UNIQUE");
  return nodes[0];
}

export function appendGui(xml: string, node: XmlNode, fragment: string): string {
  return node.selfClosing
    ? xml.slice(0, node.start) +
        xml.slice(node.start, node.startTagEnd).replace(/\/\s*>$/, ">") +
        fragment +
        `</${node.tag}>` +
        xml.slice(node.end)
    : xml.slice(0, node.endTagStart) + fragment + xml.slice(node.endTagStart);
}

export function typeElementFragment(
  type: GuiType,
  xml: string,
  library: string,
  registry: Registry,
): string {
  const resolved = resolveGuiType(type, xml, library, registry);
  const element = guiTypeXml(resolved).typeElement;
  return (
    `<Type Value="${encode(resolved.type)}"/>` +
    (resolved.gameType ? `<GameType Value="${encode(resolved.gameType)}"/>` : "") +
    (element
      ? `<TypeElement Type="${element.type}"${localRef(element.library ?? library)} Id="${element.id}"/>`
      : "")
  );
}
