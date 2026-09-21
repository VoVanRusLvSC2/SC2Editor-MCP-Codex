import type { ParsedXml, ParseDiagnostic, XmlAttrs, XmlAttrSpan, XmlNode } from "./types.js";

export function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i + 1;
  }
  return -1;
}

export function decodeXmlValue(raw: string, diagnostics?: ParseDiagnostic[], offset = 0): string {
  return raw.replace(/&([^;\s<&]*);?|[<]/g, (token, entity: string | undefined, index: number) => {
    const predefined: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (token.endsWith(";") && entity !== undefined) {
      if (Object.hasOwn(predefined, entity)) return predefined[entity];
      if (/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) {
        const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)) return String.fromCodePoint(code);
      }
    }
    diagnostics?.push({ severity: "error", offset: offset + index, message: `Invalid XML value token ${token}` });
    return token;
  });
}

function parseAttrs(text: string, absoluteStart: number, diagnostics: ParseDiagnostic[]): { attrs: XmlAttrs; attrSpans: XmlAttrSpan[] } {
  const attrs: XmlAttrs = {};
  const attrSpans: XmlAttrSpan[] = [];
  const attrRe = /([A-Za-z_][\w:.-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/gy;
  let cursor = 0;
  while (cursor < text.length) {
    const start = cursor;
    while (/[ \t\r\n]/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
    if (cursor === text.length) break;
    if (cursor === start) diagnostics.push({ severity: "error", offset: absoluteStart + cursor, message: "XML attributes must be separated by whitespace" });
    attrRe.lastIndex = cursor;
    const m = attrRe.exec(text);
    if (!m) {
      diagnostics.push({ severity: "error", offset: absoluteStart + cursor, message: "Invalid XML attribute: expected name and quoted value" });
      break;
    }
    const rawValue = m[2] ?? m[3] ?? "";
    const quoteIndex = m[0].search(/["']/);
    const valueStart = absoluteStart + m.index + quoteIndex + 1;
    if (Object.hasOwn(attrs, m[1])) diagnostics.push({ severity: "error", offset: absoluteStart + cursor, message: `Duplicate XML attribute ${m[1]}` });
    attrs[m[1]] = decodeXmlValue(rawValue, diagnostics, valueStart);
    attrSpans.push({ name: m[1], start: absoluteStart + m.index, end: absoluteStart + attrRe.lastIndex,
      valueStart, valueEnd: valueStart + rawValue.length, quote: m[0][quoteIndex] as "\"" | "'" });
    cursor = attrRe.lastIndex;
  }
  return { attrs, attrSpans };
}

export function scanXml(source: string): ParsedXml {
  const nodes: XmlNode[] = [];
  const rootIds: number[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const stack: number[] = [];
  for(let offset=0;offset<source.length;offset++){
    const code=source.charCodeAt(offset);
    if(code===9||code===10||code===13||(code>=0x20&&code<=0xd7ff)||(code>=0xe000&&code<=0xfffd))continue;
    const next=source.charCodeAt(offset+1);
    if(code>=0xd800&&code<=0xdbff&&next>=0xdc00&&next<=0xdfff){offset++;continue;}
    diagnostics.push({severity:"error",offset,message:"Invalid literal XML character"});
  }

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    const textEnd = lt < 0 ? source.length : lt;
    const content = source.slice(i, textEnd);
    if (!stack.length && content.trim().replace(/^\uFEFF/, "").trim()) diagnostics.push({severity:"error",offset:i,message:"Text outside XML root"});
    if (stack.length) { decodeXmlValue(content, diagnostics, i); if(content.includes("]]>") ) diagnostics.push({severity:"error",offset:i+content.indexOf("]]>"),message:"CDATA closing delimiter in XML text"}); }
    if (lt < 0) break;

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end < 0) {
        diagnostics.push({ severity: "error", offset: lt, message: "Unclosed XML comment" });
        break;
      }
      const comment = source.slice(lt + 4, end);
      if(comment.includes("--") || comment.endsWith("-")) diagnostics.push({severity:"error",offset:lt,message:"Invalid XML comment body"});
      i = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end < 0) {
        diagnostics.push({ severity: "error", offset: lt, message: "Unclosed CDATA" });
        break;
      }
      if(!stack.length) diagnostics.push({severity:"error",offset:lt,message:"CDATA outside XML root"});
      i = end + 3;
      continue;
    }
    if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      if (end < 0) {
        diagnostics.push({ severity: "error", offset: lt, message: "Unclosed processing instruction" });
        break;
      }
      i = end + 2;
      continue;
    }
    if (source.startsWith("<!", lt)) {
      diagnostics.push({severity:"error",offset:lt,message:"XML DTD/entity declarations are unsupported"});
      break;
    }

    const tagEnd = findTagEnd(source, lt);
    if (tagEnd <= lt || tagEnd > source.length) {
      diagnostics.push({ severity: "error", offset: lt, message: "Unclosed XML tag" });
      break;
    }

    const raw = source.slice(lt + 1, tagEnd - 1);
    if (!raw) {
      diagnostics.push({severity:"error",offset:lt,message:"Empty XML tag"});
      i = tagEnd;
      continue;
    }

    if (raw.startsWith("/")) {
      const closing = raw.match(/^\/([A-Za-z_][\w:.-]*)[ \t\r\n]*$/);
      if (!closing) diagnostics.push({severity:"error",offset:lt,message:"Invalid closing XML tag"});
      const tag = closing?.[1] ?? raw.slice(1).trim();
      if (stack.length === 0) {
        diagnostics.push({ severity: "error", offset: lt, message: `Unexpected closing tag </${tag}>` });
      } else {
        let matched = false;
        while (stack.length > 0) {
          const nodeId = stack.pop()!;
          const node = nodes[nodeId];
          if (node.tag === tag) {
            node.endTagStart = lt;
            node.end = tagEnd;
            matched = true;
            break;
          }
          diagnostics.push({
            severity: "error",
            offset: lt,
            message: `Mismatched closing tag </${tag}> while <${node.tag}> was open`,
          });
        }
        if (!matched) {
          diagnostics.push({ severity: "error", offset: lt, message: `No opening tag for </${tag}>` });
        }
      }
      i = tagEnd;
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const clean = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = clean.match(/^([A-Za-z_][\w:.-]*)/);
    if (!nameMatch) {
      diagnostics.push({ severity: "error", offset: lt, message: "Could not parse tag name" });
      i = tagEnd;
      continue;
    }
    const tag = nameMatch[1];
    const attrTextOffset = lt + 1 + nameMatch[0].length;
    const { attrs, attrSpans } = parseAttrs(clean.slice(nameMatch[0].length), attrTextOffset, diagnostics);
    const parentId = stack.length ? stack[stack.length - 1] : null;
    const id = nodes.length;
    const node: XmlNode = {
      id,
      tag,
      attrs,
      attrSpans,
      start: lt,
      startTagEnd: tagEnd,
      endTagStart: selfClosing ? tagEnd : -1,
      end: selfClosing ? tagEnd : -1,
      selfClosing,
      parentId,
      childIds: [],
    };
    nodes.push(node);
    if (parentId === null) {
      if(rootIds.length) diagnostics.push({severity:"error",offset:lt,message:"Multiple XML roots"});
      rootIds.push(id);
    }
    else nodes[parentId].childIds.push(id);
    if (!selfClosing) stack.push(id);
    i = tagEnd;
  }

  for (const id of stack.reverse()) {
    const node = nodes[id];
    diagnostics.push({ severity: "error", offset: node.start, message: `Unclosed tag <${node.tag}>` });
    node.endTagStart = source.length;
    node.end = source.length;
  }

  return { nodes, rootIds, diagnostics };
}
