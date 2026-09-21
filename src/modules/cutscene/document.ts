import { createHash, randomBytes } from "node:crypto";
import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import type { CutsceneDocumentIR, CutsceneNodeSelector, CutsceneObjectIR, NativeNodeSpec } from "./types.js";
import { CutsceneSchemaRegistry } from "./schemaRegistry.js";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function scalar(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return source.slice(lineStart, offset).match(/^\s*/)?.[0] ?? "";
}

function nativeGuid(): string {
  return BigInt(`0x${randomBytes(8).toString("hex")}`).toString(10);
}

function serializeSpec(spec: NativeNodeSpec, indent: string, newline: string): string {
  if (spec.nativeType === "CCutsceneNodeActor" && !spec.children?.some(child => child.nativeType === "CCutsceneNodeAnimLayer")) {
    spec = { ...spec, children: [...(spec.children ?? []), {
      nativeType: "CCutsceneNodeAnimLayer", attrs: { guid: nativeGuid(), name: "Animation Layer", enabled: true },
    }] };
  }
  if (!/^[A-Za-z_][\w:.-]*$/.test(spec.nativeType)) throw new Error(`Invalid native XML element '${spec.nativeType}'`);
  const attrs = Object.entries(spec.attrs ?? {}).map(([name, value]) => {
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`Invalid native XML attribute '${name}'`);
    return ` ${name}="${escapeXml(scalar(value))}"`;
  }).join("");
  if (!spec.children?.length) return `${indent}<${spec.nativeType}${attrs}/>`;
  const children = spec.children.map((child) => serializeSpec(child, `${indent}    `, newline)).join(newline);
  return `${indent}<${spec.nativeType}${attrs}>${newline}${children}${newline}${indent}</${spec.nativeType}>`;
}

export class CutsceneDocument {
  private parsed = scanXml("");

  constructor(public source: string, readonly sourceFile?: string) {
    this.reparse();
  }

  static create(options: { version?: string; name?: string } = {}): CutsceneDocument {
    const version = options.version ?? "1.300000";
    const name = options.name ? ` name="${escapeXml(options.name)}"` : "";
    return new CutsceneDocument(`<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="${escapeXml(version)}"${name}>\n</CutsceneState>\n`);
  }

  get sha256(): string {
    return createHash("sha256").update(this.source, "utf8").digest("hex");
  }

  get diagnostics() {
    return this.parsed.diagnostics;
  }

  get nodes(): readonly XmlNode[] {
    return this.parsed.nodes;
  }

  private reparse(): void {
    this.parsed = scanXml(this.source);
  }

  private replace(start: number, end: number, text: string): void {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > this.source.length) throw new Error(`Invalid source patch range ${start}:${end}`);
    this.source = this.source.slice(0, start) + text + this.source.slice(end);
    this.reparse();
  }

  root(): XmlNode {
    const roots = this.parsed.rootIds.map((id) => this.parsed.nodes[id]);
    const root = roots.find((node) => node.tag === "CutsceneState") ?? roots[0];
    if (!root) throw new Error("Cutscene XML has no root element");
    return root;
  }

  private publicId(node: XmlNode): string {
    return node.attrs.guid ? `guid:${node.attrs.guid}` : node.attrs.name ? `name:${node.attrs.name}` : `node:${node.id}`;
  }

  resolve(selector: CutsceneNodeSelector | string): XmlNode {
    if (typeof selector === "string") {
      if (selector.startsWith("guid:")) selector = { guid: selector.slice(5) };
      else if (selector.startsWith("name:")) selector = { name: selector.slice(5) };
      else if (selector.startsWith("node:")) selector = { nodeId: Number(selector.slice(5)) };
      else selector = { id: selector };
    }
    if (selector.id) {
      if (selector.id.startsWith("guid:")) selector = { ...selector, guid: selector.id.slice(5), id: undefined };
      else if (selector.id.startsWith("name:")) selector = { ...selector, name: selector.id.slice(5), id: undefined };
      else if (selector.id.startsWith("node:")) selector = { ...selector, nodeId: Number(selector.id.slice(5)), id: undefined };
    }
    let matches = this.parsed.nodes.filter((node) =>
      (selector.nodeId === undefined || node.id === selector.nodeId) &&
      (selector.guid === undefined || node.attrs.guid === selector.guid) &&
      (selector.name === undefined || node.attrs.name === selector.name || node.attrs.bookmarkName === selector.name) &&
      (selector.nativeType === undefined || node.tag === selector.nativeType));
    const occurrence = selector.occurrence ?? 0;
    if (!matches.length && selector.nodeId !== undefined) throw new Error(`Cutscene node ${selector.nodeId} not found`);
    matches = matches.sort((a, b) => a.start - b.start);
    if (!matches[occurrence]) throw new Error(`Cutscene selector matched ${matches.length} nodes; occurrence ${occurrence} is unavailable`);
    return matches[occurrence];
  }

  list(query: { nativeType?: string; category?: string; name?: string; limit?: number } = {}, schema?: CutsceneSchemaRegistry): CutsceneObjectIR[] {
    const registry = schema;
    return this.parsed.nodes
      .filter((node) => (!query.nativeType || node.tag === query.nativeType) && (!query.name || node.attrs.name === query.name || node.attrs.bookmarkName === query.name) && (!query.category || registry?.category(node.tag) === query.category))
      .slice(0, query.limit ?? 2000)
      .map((node) => this.toObject(node, registry));
  }

  private toObject(node: XmlNode, schema?: CutsceneSchemaRegistry): CutsceneObjectIR {
    const described = schema?.describe(node.tag);
    const known = new Set(described?.properties.map((entry) => entry.xmlName) ?? []);
    const unknownAttributes = Object.entries(node.attrs).filter(([name]) => !known.has(name)).map(([name, value]) => ({ name, value }));
    const childIds = node.childIds.map((id) => this.publicId(this.parsed.nodes[id]));
    const unknownChildren = node.childIds.filter((id) => !schema?.getNode(this.parsed.nodes[id].tag));
    return {
      id: this.publicId(node),
      nodeId: node.id,
      nativeType: node.tag,
      category: schema?.category(node.tag) ?? "unknown-native-type",
      nativeId: node.attrs.guid,
      displayName: node.attrs.name ?? node.attrs.bookmarkName,
      asset: node.attrs.modelLink ? { catalog: "Model", id: node.attrs.modelLink } : undefined,
      attributes: { ...node.attrs },
      childIds,
      extensions: { unknownAttributes, unknownChildren, unknownProperties: [] },
      rawSource: this.source.slice(node.start, node.end),
    };
  }

  toIR(schema: CutsceneSchemaRegistry, preserveNative = true): CutsceneDocumentIR {
    const root = this.root();
    const objects = this.parsed.nodes.filter((node) => node.id !== root.id).map((node) => this.toObject(node, schema));
    return {
      formatVersion: root.attrs.cutsceneVersion,
      id: root.attrs.guid ?? this.sha256.slice(0, 16),
      name: root.attrs.name,
      sourceFile: this.sourceFile,
      rootNativeType: root.tag,
      sceneProperties: { ...root.attrs },
      objects,
      timeline: objects.filter((entry) => /timeline|track|element|keyframe|animation|director/.test(entry.category)),
      bookmarks: objects.filter((entry) => entry.category === "bookmark"),
      filters: objects.filter((entry) => entry.category === "filter"),
      metadata: {},
      diagnostics: [...this.diagnostics],
      unknownAttributes: Object.entries(root.attrs).filter(([name]) => !schema.getProperty(root.tag, name)).map(([name, value]) => ({ name, value })),
      unknownChildren: root.childIds.filter((id) => !schema.getNode(this.parsed.nodes[id].tag)),
      preserveNative,
    };
  }

  setAttribute(selector: CutsceneNodeSelector | string, name: string, value: string | number | boolean): void {
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`Invalid native XML attribute '${name}'`);
    const node = this.resolve(selector);
    const found = node.attrSpans.find((span) => span.name === name);
    const encoded = escapeXml(scalar(value));
    if (found) this.replace(found.valueStart, found.valueEnd, encoded);
    else {
      const insertion = node.startTagEnd - (node.selfClosing ? 2 : 1);
      this.replace(insertion, insertion, ` ${name}="${encoded}"`);
    }
  }

  removeAttribute(selector: CutsceneNodeSelector | string, name: string): void {
    const node = this.resolve(selector);
    const found = node.attrSpans.find((span) => span.name === name);
    if (!found) return;
    let start = found.start;
    while (start > node.start && /[ \t]/.test(this.source[start - 1])) start--;
    this.replace(start, found.end, "");
  }

  addNode(parentSelector: CutsceneNodeSelector | string | undefined, spec: NativeNodeSpec): string {
    const parent = parentSelector ? this.resolve(parentSelector) : this.root();
    const newline = this.source.includes("\r\n") ? "\r\n" : "\n";
    const parentIndent = indentAt(this.source, parent.start);
    const childIndent = `${parentIndent}    `;
    let insertion = parent.selfClosing ? parent.startTagEnd - 2 : parent.endTagStart;
    if (parent.selfClosing) {
      const expanded = `>${newline}${serializeSpec(spec, childIndent, newline)}${newline}${parentIndent}</${parent.tag}>`;
      this.replace(insertion, parent.startTagEnd, expanded);
    } else {
      const closingLineStart = this.source.lastIndexOf("\n", Math.max(0, parent.endTagStart - 1)) + 1;
      if (/^[ \t]*$/.test(this.source.slice(closingLineStart, parent.endTagStart))) insertion = closingLineStart;
      const text = `${serializeSpec(spec, childIndent, newline)}${newline}`;
      this.replace(insertion, insertion, text);
    }
    const candidates = this.parsed.nodes.filter((node) => node.tag === spec.nativeType && node.start >= insertion);
    const created = candidates[0] ?? this.parsed.nodes.filter((node) => node.tag === spec.nativeType).at(-1);
    if (!created) throw new Error(`Failed to locate created ${spec.nativeType}`);
    return this.publicId(created);
  }

  removeNode(selector: CutsceneNodeSelector | string): void {
    const node = this.resolve(selector);
    if (node.id === this.root().id) throw new Error("Cannot remove CutsceneState root");
    let start = node.start;
    const lineStart = this.source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    if (/^\s*$/.test(this.source.slice(lineStart, start))) start = lineStart;
    let end = node.end;
    if (this.source.startsWith("\r\n", end)) end += 2;
    else if (this.source[end] === "\n") end += 1;
    this.replace(start, end, "");
  }

  cloneNode(selector: CutsceneNodeSelector | string, parentSelector?: CutsceneNodeSelector | string, name?: string): string {
    const node = this.resolve(selector);
    const parent = parentSelector ? this.resolve(parentSelector) : node.parentId === null ? this.root() : this.parsed.nodes[node.parentId];
    let raw = this.source.slice(node.start, node.end);
    const newline = this.source.includes("\r\n") ? "\r\n" : "\n";
    const cloned = scanXml(raw);
    if (cloned.diagnostics.some(d => d.severity === "error")) throw new Error("CUTSCENE_CLONE_SOURCE_INVALID");
    const counts = new Map<string, number>();
    for (const candidate of this.parsed.nodes) if (candidate.attrs.guid) counts.set(candidate.attrs.guid, (counts.get(candidate.attrs.guid) ?? 0) + 1);
    const used = new Set(counts.keys());
    const allocate = () => { let value = nativeGuid(); while (used.has(value)) value = nativeGuid(); used.add(value); return value; };
    const identities = new Map<string, string>();
    for (const candidate of cloned.nodes) if (candidate.attrs.guid) {
      if (identities.has(candidate.attrs.guid)) throw new Error("CUTSCENE_CLONE_DUPLICATE_SOURCE_GUID");
      identities.set(candidate.attrs.guid, allocate());
    }
    const edits: Array<{ start: number; end: number; value: string }> = [];
    for (const candidate of cloned.nodes) {
      for (const span of candidate.attrSpans) {
        const value = candidate.attrs[span.name]!;
        if (!/guid$/i.test(span.name) || !identities.has(value)) continue;
        if (span.name.toLowerCase() !== "guid" && (counts.get(value) ?? 0) > 1) throw new Error("CUTSCENE_CLONE_AMBIGUOUS_REFERENCE");
        edits.push({ start: span.valueStart, end: span.valueEnd, value: identities.get(value)! });
      }
      if (candidate.tag !== "CCutsceneNodeActor" || candidate.childIds.some(id => cloned.nodes[id].tag === "CCutsceneNodeAnimLayer")) continue;
      const actorIndent = indentAt(raw, candidate.start);
      const layer = serializeSpec({ nativeType: "CCutsceneNodeAnimLayer", attrs: { guid: allocate(), name: "Animation Layer", enabled: true } }, actorIndent + "    ", newline);
      if (candidate.selfClosing) edits.push({ start: candidate.startTagEnd - 2, end: candidate.startTagEnd, value: `>${newline}${layer}${newline}${actorIndent}</${candidate.tag}>` });
      else edits.push({ start: candidate.endTagStart, end: candidate.endTagStart, value: `${newline}${layer}${newline}${actorIndent}` });
    }
    const root = cloned.rootIds.map(id => cloned.nodes[id])[0];
    const nameSpan = root?.attrSpans.find(span => span.name === "name");
    if (name && nameSpan) edits.push({ start: nameSpan.valueStart, end: nameSpan.valueEnd, value: escapeXml(name) });
    const chunks: string[] = []; let cursor = 0;
    for (const edit of edits.sort((a, b) => a.start - b.start)) {
      if (edit.start < cursor) throw new Error("CUTSCENE_CLONE_OVERLAPPING_EDITS");
      chunks.push(raw.slice(cursor, edit.start), edit.value); cursor = edit.end;
    }
    chunks.push(raw.slice(cursor)); raw = chunks.join("");
    const indentation = `${indentAt(this.source, parent.start)}    `;
    const oldIndentation = indentAt(this.source, node.start);
    const reindented = raw.split(/\r?\n/).map((line, index) => index === 0 ? `${indentation}${line.trimStart()}` : `${indentation}${line.startsWith(oldIndentation) ? line.slice(oldIndentation.length) : line}`).join(newline);
    const closingLineStart = this.source.lastIndexOf("\n", Math.max(0, parent.endTagStart - 1)) + 1;
    const insertion = /^[ \t]*$/.test(this.source.slice(closingLineStart, parent.endTagStart)) ? closingLineStart : parent.endTagStart;
    this.replace(insertion, insertion, `${reindented}${newline}`);
    const created = this.parsed.nodes.find((candidate) => candidate.start >= insertion && candidate.tag === node.tag) ?? this.parsed.nodes.filter((candidate) => candidate.tag === node.tag).at(-1);
    if (!created) throw new Error("Cloned node was not found after insertion");
    return this.publicId(created);
  }

  rawPatch(start: number, end: number, text: string): void {
    const original = this.source;
    this.replace(start, end, text);
    if (this.diagnostics.some((entry) => entry.severity === "error")) {
      this.source = original;
      this.reparse();
      throw new Error("raw.patch would make XML malformed; transaction rolled back");
    }
  }
}
