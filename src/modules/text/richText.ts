import { findTagEnd, decodeXmlValue } from "../../core/xmlScanner.js";
import type { RichTextAttribute, RichTextDocument, RichTextNode } from "./types.js";

export const CONFIRMED_RICH_TEXT_TAGS = new Set(["s", "c", "n", "w", "img", "ul", "li", "a", "d", "h", "k", "lang", "sp", "player", "time", "hour", "min2", "sec2"]);

function parseAttributes(raw: string): RichTextAttribute[] {
  const out: RichTextAttribute[] = [];
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const quote = match[2] === undefined ? "'" : "\"";
    out.push({ name: match[1], value: decodeXmlValue(match[2] ?? match[3] ?? ""), quote });
  }
  return out;
}

export function parseRichText(source: string, knownTags = CONFIRMED_RICH_TEXT_TAGS): RichTextDocument {
  const root: RichTextNode[] = [];
  const stack: Array<{ node: Extract<RichTextNode, { kind: "tag" }>; name: string; offset: number }> = [];
  const diagnostics: RichTextDocument["diagnostics"] = [];
  const append = (node: RichTextNode) => (stack.at(-1)?.node.children ?? root).push(node);
  let cursor = 0;
  const tagRe = /<\/?[A-Za-z]/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(source)) !== null) {
    if (match.index > cursor) append({ kind: "text", raw: source.slice(cursor, match.index) });
    const end = findTagEnd(source, match.index);
    if(end < 0) { append({kind:"raw",raw:source.slice(match.index),reason:"unclosed-tag"});diagnostics.push({severity:"error",offset:match.index,message:"Unclosed rich-text tag"});cursor=source.length;break; }
    const raw = source.slice(match.index, end);
    tagRe.lastIndex=end;
    const closing = /^<\//.test(raw);
    const name = raw.match(/^<\/?\s*([A-Za-z][\w:.-]*)/)?.[1] ?? "";
    const normalized = name.toLowerCase();
    if (closing) {
      const open = stack.at(-1);
      if (!open || open.name.toLowerCase() !== normalized) {
        append({ kind: "raw", raw, reason: "unmatched-close-tag" });
        diagnostics.push({ severity: "error", offset: match.index, message: `Unmatched rich-text closing tag </${name}>` });
      } else {
        open.node.rawClose = raw;
        stack.pop();
      }
    } else {
      const selfClosing = /\/\s*>$/.test(raw);
      const node: Extract<RichTextNode, { kind: "tag" }> = {
        kind: "tag",
        nativeName: name,
        attrs: parseAttributes(raw),
        selfClosing,
        children: [],
        rawOpen: raw,
        known: knownTags.has(normalized),
      };
      append(node);
      if (!selfClosing) stack.push({ node, name, offset: match.index });
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) append({ kind: "text", raw: source.slice(cursor) });
  for (const open of stack) diagnostics.push({ severity: "error", offset: open.offset, message: `Unclosed rich-text tag <${open.name}>` });
  return { source, nodes: root, diagnostics };
}

function serializeNode(node: RichTextNode): string {
  if (node.kind === "text" || node.kind === "raw") return node.raw;
  return node.rawOpen + node.children.map(serializeNode).join("") + (node.selfClosing ? "" : (node.rawClose ?? ""));
}

export function serializeRichText(document: RichTextDocument): string {
  return document.nodes.map(serializeNode).join("");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function wrapRichTextRange(source: string, start: number, end: number, tag: "s" | "c" | "w", value?: string): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) throw new Error("Invalid rich-text range");
  const open = value === undefined ? `<${tag}>` : `<${tag} val="${escapeAttribute(value)}">`;
  return source.slice(0, start) + open + source.slice(start, end) + `</${tag}>` + source.slice(end);
}
