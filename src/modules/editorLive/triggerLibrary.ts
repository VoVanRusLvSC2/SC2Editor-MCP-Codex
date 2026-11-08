import { createHash } from "node:crypto";
import { decodeXmlValue, scanXml } from "../../core/xmlScanner.js";

const encode = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export const libraryLimit = 1024 * 1024;

/** Native library transfer embeds display names instead of external TriggerStrings.
 * Only a self-contained map-root graph and the implicit Core library are accepted.
 * Other localization forms refuse before import rather than silently losing text.
 */
export function createTriggerLibrary(source: string, strings: string, name: string) {
  const parsed = scanXml(source);
  const root = parsed.nodes[parsed.rootIds[0]];
  if (
    Buffer.byteLength(source) > libraryLimit ||
    parsed.rootIds.length !== 1 ||
    root?.tag !== "TriggerData" ||
    parsed.diagnostics.some((d) => d.severity === "error")
  )
    throw Error("LIVE_TRIGGER_INVALID_GRAPH");
  if (
    parsed.nodes.some(
      (n) =>
        ["Library", "Standard", "ScriptCode", "CustomScript", "FlagCustomScript"].includes(n.tag) ||
        n.attrs.Type === "CustomScript" ||
        (n.attrs.Library && n.attrs.Library !== "Ntve"),
    )
  )
    throw Error("LIVE_TRIGGER_SELF_CONTAINED_GUI_REQUIRED");
  const names = new Map<string, string>();
  for (const line of strings.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const equals = line.indexOf("=");
    if (equals < 1) throw Error("LIVE_TRIGGER_STRINGS_INVALID");
    const key = line.slice(0, equals);
    if (!/^[A-Za-z]+\/Name\/[A-Fa-f0-9]{8}$/.test(key))
      throw Error("LIVE_TRIGGER_LOCALIZATION_UNSUPPORTED: " + key);
    if (names.has(key)) throw Error("LIVE_TRIGGER_STRINGS_DUPLICATE");
    names.set(key, line.slice(equals + 1));
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const rootName = parsed.nodes.find((n) => n.parentId === root.id && n.tag === "Name");
  if (rootName) throw Error("LIVE_TRIGGER_LIBRARY_NAME_ALREADY_PRESENT");
  edits.push({
    start: root.startTagEnd,
    end: root.startTagEnd,
    text: "\n<Name>" + encode(name) + "</Name>",
  });
  for (const node of parsed.nodes.filter((n) => n.tag === "Element")) {
    if (node.selfClosing) throw Error("LIVE_TRIGGER_EMPTY_ELEMENT_UNSUPPORTED");
    const key = node.attrs.Type + "/Name/" + node.attrs.Id;
    const identifier = node.childIds
      .map((id) => parsed.nodes[id])
      .find((n) => n.tag === "Identifier");
    const value =
      names.get(key) ??
      (identifier
        ? decodeXmlValue(source.slice(identifier.startTagEnd, identifier.endTagStart))
        : "");
    names.delete(key);
    if (node.childIds.some((id) => parsed.nodes[id].tag === "Name"))
      throw Error("LIVE_TRIGGER_EMBEDDED_NAME_ALREADY_PRESENT");
    edits.push({
      start: node.startTagEnd,
      end: node.startTagEnd,
      text: "\n<Name>" + encode(value) + "</Name>",
    });
  }
  if (names.size) throw Error("LIVE_TRIGGER_ORPHAN_LOCALIZATION");
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (Buffer.byteLength(output) > libraryLimit) throw Error("LIVE_TRIGGER_LIBRARY_BYTE_LIMIT");
  return output;
}

/** Native serialization reorders definitions and unique scalar metadata. Executable
 * reference lists, IDs, duplicate fields and exact leaf values remain significant. */
export function triggerLibrarySignature(source: string) {
  const parsed = scanXml(source);
  if (
    Buffer.byteLength(source) > libraryLimit ||
    parsed.rootIds.length !== 1 ||
    parsed.nodes[parsed.rootIds[0]]?.tag !== "TriggerData" ||
    parsed.diagnostics.some((d) => d.severity === "error")
  )
    throw Error("LIVE_TRIGGER_LIBRARY_INVALID");
  const render = (id: number): unknown => {
    const node = parsed.nodes[id],
      values: unknown[] = [];
    if (!node.childIds.length)
      return [
        node.tag,
        Object.entries(node.attrs).sort(([a], [b]) => a.localeCompare(b)),
        node.selfClosing
          ? ""
          : decodeXmlValue(source.slice(node.startTagEnd, node.endTagStart)).replaceAll(
              "\r\n",
              "\n",
            ),
      ];
    let children = node.childIds;
    if (node.tag === "TriggerData") {
      const definitions = children.filter((id) => parsed.nodes[id].tag === "Element");
      const key = (id: number) => parsed.nodes[id].attrs.Type + ":" + parsed.nodes[id].attrs.Id;
      if (new Set(definitions.map(key)).size !== definitions.length)
        throw Error("LIVE_TRIGGER_DUPLICATE_DEFINITION");
      children = [
        ...children.filter((id) => parsed.nodes[id].tag !== "Element"),
        ...definitions.sort((a, b) => key(a).localeCompare(key(b))),
      ];
    }
    if (node.tag === "Element") {
      const scalarTags = new Set(["Name", "Identifier", "ValueType", "Value"]);
      const metadata = children.filter((id) => scalarTags.has(parsed.nodes[id].tag));
      if (new Set(metadata.map((id) => parsed.nodes[id].tag)).size === metadata.length)
        children = [
          ...metadata.sort((a, b) => parsed.nodes[a].tag.localeCompare(parsed.nodes[b].tag)),
          ...children.filter((id) => !scalarTags.has(parsed.nodes[id].tag)),
        ];
    }
    // Source gaps carry comments/formatting, not graph fields. Keep non-whitespace
    // gaps in original order, then canonicalize only the explicitly known groups.
    let cursor = node.startTagEnd;
    for (const childId of node.childIds) {
      const child = parsed.nodes[childId],
        text = decodeXmlValue(source.slice(cursor, child.start)).trim();
      if (text) values.push(text);
      cursor = child.end;
    }
    if (!node.selfClosing) {
      const tail = decodeXmlValue(source.slice(cursor, node.endTagStart)).trim();
      if (tail) values.push(tail);
    }
    values.push(...children.map(render));
    return [node.tag, Object.entries(node.attrs).sort(([a], [b]) => a.localeCompare(b)), values];
  };
  return createHash("sha256")
    .update(JSON.stringify(render(parsed.rootIds[0])))
    .digest("hex");
}
