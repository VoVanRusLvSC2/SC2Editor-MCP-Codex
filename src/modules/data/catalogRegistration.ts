import { scanXml } from "../../core/xmlScanner.js";
import { normalizeCatalogPath as normalize } from "./catalogSupport.js";
export function componentListWithGameData(source: string): string {
  const initial =
    source || `<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n</Components>`;
  const parsed = scanXml(initial);
  const root = parsed.rootIds
    .map((id) => parsed.nodes[id])
    .find((node) => node.tag === "Components");
  if (!root) throw new Error("ComponentList.SC2Components must have a <Components> root");
  if (
    root.childIds
      .map((id) => parsed.nodes[id])
      .some((node) => node.tag === "DataComponent" && node.attrs.Type?.toLowerCase() === "gada")
  )
    return initial;
  const newline = initial.includes("\r\n") ? "\r\n" : "\n";
  const rendered = `    <DataComponent Type="gada">GameData</DataComponent>`;
  if (root.selfClosing) {
    const opening = initial.slice(root.start, root.startTagEnd).replace(/\/\s*>$/, ">");
    return (
      initial.slice(0, root.start) +
      `${opening}${newline}${rendered}${newline}</Components>` +
      initial.slice(root.end)
    );
  }
  return (
    initial.slice(0, root.endTagStart) +
    `${newline}${rendered}${newline}` +
    initial.slice(root.endTagStart)
  );
}
export function gameDataIndexWithCatalog(source: string, catalogPath: string): string {
  const initial = source || `<?xml version="1.0" encoding="utf-8"?>\r\n<Includes>\r\n</Includes>`;
  const parsed = scanXml(initial);
  const root = parsed.rootIds.map((id) => parsed.nodes[id]).find((node) => node.tag === "Includes");
  if (!root) throw new Error("Base.SC2Data/GameData.xml must have an <Includes> root");
  const canonical = normalize(catalogPath).replace(/^Base\.SC2Data\//i, "");
  if (
    root.childIds
      .map((id) => parsed.nodes[id])
      .some(
        (node) =>
          node.tag === "Catalog" &&
          normalize(node.attrs.path ?? "").toLowerCase() === canonical.toLowerCase(),
      )
  )
    return initial;
  const newline = initial.includes("\r\n") ? "\r\n" : "\n";
  const rendered = `    <Catalog path="${canonical.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"/>`;
  if (root.selfClosing) {
    const opening = initial.slice(root.start, root.startTagEnd).replace(/\/\s*>$/, ">");
    return (
      initial.slice(0, root.start) +
      `${opening}${newline}${rendered}${newline}</Includes>` +
      initial.slice(root.end)
    );
  }
  return (
    initial.slice(0, root.endTagStart) +
    `${newline}${rendered}${newline}` +
    initial.slice(root.endTagStart)
  );
}
