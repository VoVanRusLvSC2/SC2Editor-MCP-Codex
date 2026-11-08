import { decodeXmlValue, scanXml } from "../../core/xmlScanner.js";
import { liveDigest } from "./identity.js";
export const layoutXmlLimit = 1024 * 1024;
/** No field sorting: layout/animation/property order and exact leaf values matter. */
export function layoutXmlSignature(source: string) {
  if (Buffer.byteLength(source) > layoutXmlLimit) throw Error("LIVE_UI_XML_BYTE_LIMIT");
  const p = scanXml(source),
    root = p.nodes[p.rootIds[0]];
  if (
    p.rootIds.length !== 1 ||
    root?.tag !== "Desc" ||
    p.diagnostics.some((d) => d.severity === "error")
  )
    throw Error("LIVE_UI_INVALID_LAYOUT_XML");
  const render = (id: number): unknown => {
    const n = p.nodes[id],
      attrs = Object.entries(n.attrs).sort(([a], [b]) => a.localeCompare(b));
    if (!n.childIds.length)
      return [
        n.tag,
        attrs,
        n.selfClosing
          ? ""
          : decodeXmlValue(source.slice(n.startTagEnd, n.endTagStart)).replaceAll("\r\n", "\n"),
      ];
    const values: unknown[] = [];
    let cursor = n.startTagEnd;
    for (const childId of n.childIds) {
      const child = p.nodes[childId],
        gap = source.slice(cursor, child.start).trim();
      if (gap) values.push(gap);
      values.push(render(childId));
      cursor = child.end;
    }
    const tail = source.slice(cursor, n.endTagStart).trim();
    if (tail) values.push(tail);
    return [n.tag, attrs, values];
  };
  return liveDigest(JSON.stringify(render(root.id)));
}
