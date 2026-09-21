import { createHash } from "node:crypto";
import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import { AiSchemaRegistry } from "./schemaRegistry.js";
import type { AiDocumentIR, AiEvidence, AiNativeNodeSpec, AiScalar, AiSelector } from "./types.js";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("'", "&apos;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function scalar(value: AiScalar): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function newlineOf(source: string): string { return source.includes("\r\n") ? "\r\n" : "\n"; }

function indentAt(source: string, offset: number): string {
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return source.slice(start, offset).match(/^\s*/)?.[0] ?? "";
}

function serializeNode(spec: AiNativeNodeSpec, indent: string, newline: string): string {
  if (!/^[A-Za-z_][\w:.-]*$/.test(spec.nativeType)) throw new Error(`Invalid native AI element '${spec.nativeType}'`);
  const attrs = Object.entries(spec.attrs ?? {}).map(([name, value]) => {
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`Invalid native AI attribute '${name}'`);
    return ` ${name}="${escapeXml(scalar(value))}"`;
  }).join("");
  const valueAttr = spec.value === undefined ? "" : ` Value="${escapeXml(scalar(spec.value))}"`;
  if (!spec.children?.length) return `${indent}<${spec.nativeType}${attrs}${valueAttr}/>`;
  const children = spec.children.map((child) => serializeNode(child, `${indent}    `, newline)).join(newline);
  return `${indent}<${spec.nativeType}${attrs}${valueAttr}>${newline}${children}${newline}${indent}</${spec.nativeType}>`;
}

export class AiDocument {
  private parsed = scanXml("");

  constructor(public source: string, readonly sourceFile = "CustomAI") { this.reparse(); }

  static create(): AiDocument {
    return new AiDocument(`<?xml version="1.0" encoding="utf-8"?>\r\n<AIData>\r\n</AIData>`);
  }

  get sha256(): string { return createHash("sha256").update(this.source, "utf8").digest("hex"); }
  get diagnostics() { return this.parsed.diagnostics; }
  get nodes(): readonly XmlNode[] { return this.parsed.nodes; }

  private reparse(): void { this.parsed = scanXml(this.source); }

  private replace(start: number, end: number, text: string): void {
    if (start < 0 || end < start || end > this.source.length) throw new Error(`Invalid AI source patch ${start}:${end}`);
    this.source = this.source.slice(0, start) + text + this.source.slice(end);
    this.reparse();
  }

  root(): XmlNode {
    const roots = this.parsed.rootIds.map((id) => this.parsed.nodes[id]);
    const root = roots.find((node) => node.tag === "AIData") ?? roots[0];
    if (!root) throw new Error("CustomAI XML has no root element");
    return root;
  }

  value(node: XmlNode): string | undefined {
    const attr = node.attrs.Value ?? node.attrs.value ?? node.attrs.val;
    if (attr !== undefined) return attr;
    if (node.selfClosing || node.childIds.length || node.endTagStart < node.startTagEnd) return undefined;
    return this.source.slice(node.startTagEnd, node.endTagStart).trim() || undefined;
  }

  publicId(node: XmlNode): string {
    const id = node.attrs.Id ?? node.attrs.id ?? node.attrs.Name ?? node.attrs.name;
    return id ? `${node.tag}:${id}` : `node:${node.id}`;
  }

  pathOf(node: XmlNode): string {
    const parts: string[] = [];
    let current: XmlNode | undefined = node;
    while (current) {
      const id = current.attrs.Id ?? current.attrs.id ?? current.attrs.Name ?? current.attrs.name;
      const siblings = current.parentId === null ? [] : this.parsed.nodes[current.parentId].childIds.map((child) => this.parsed.nodes[child]).filter((child) => child.tag === current!.tag);
      const suffix = id ? `[@Id='${id}']` : siblings.length > 1 ? `[${siblings.indexOf(current)}]` : "";
      parts.unshift(`${current.tag}${suffix}`);
      current = current.parentId === null ? undefined : this.parsed.nodes[current.parentId];
    }
    return parts.join("/");
  }

  resolve(selector: AiSelector): XmlNode {
    if (typeof selector === "string") {
      if (selector.startsWith("node:")) selector = { nodeId: Number(selector.slice(5)) };
      else if (selector.includes(":")) {
        const split = selector.indexOf(":");
        selector = { nativeType: selector.slice(0, split), id: selector.slice(split + 1) };
      } else selector = { id: selector };
    }
    let matches = this.parsed.nodes.filter((node) =>
      (selector.nodeId === undefined || node.id === selector.nodeId) &&
      (selector.nativeType === undefined || node.tag.toLowerCase() === selector.nativeType.toLowerCase()) &&
      (selector.id === undefined || [node.attrs.Id, node.attrs.id, node.attrs.Name, node.attrs.name].includes(selector.id)));
    matches = matches.sort((a, b) => a.start - b.start);
    if (matches.length > 1 && selector.occurrence === undefined) throw new Error("Ambiguous AI selector; supply nativeType/nodeId or explicit occurrence");
    const occurrence = selector.occurrence ?? 0;
    if (!matches[occurrence]) throw new Error(`AI selector matched ${matches.length} nodes; occurrence ${occurrence} is unavailable`);
    return matches[occurrence];
  }

  descendants(parent: XmlNode): XmlNode[] {
    const output: XmlNode[] = [];
    const visit = (node: XmlNode) => {
      for (const id of node.childIds) { const child = this.parsed.nodes[id]; output.push(child); visit(child); }
    };
    visit(parent);
    return output;
  }

  setAttribute(selector: AiSelector, name: string, value: AiScalar): void {
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`Invalid native AI attribute '${name}'`);
    const node = this.resolve(selector);
    const existing = node.attrSpans.find((entry) => entry.name === name);
    const next = escapeXml(scalar(value));
    if (existing) this.replace(existing.valueStart, existing.valueEnd, next);
    else {
      const offset = node.startTagEnd - (node.selfClosing ? 2 : 1);
      this.replace(offset, offset, ` ${name}="${next}"`);
    }
  }

  setProperty(parentSelector: AiSelector, property: string, value: AiScalar): void {
    const parent = this.resolve(parentSelector);
    const existing = parent.childIds.map((id) => this.parsed.nodes[id]).find((node) => node.tag.toLowerCase() === property.toLowerCase());
    if (!existing) {
      this.addNode(this.publicId(parent), { nativeType: property, value });
      return;
    }
    const attr = existing.attrSpans.find((entry) => ["Value", "value", "val"].includes(entry.name));
    const next = escapeXml(scalar(value));
    if (attr) this.replace(attr.valueStart, attr.valueEnd, next);
    else if (!existing.selfClosing && !existing.childIds.length) this.replace(existing.startTagEnd, existing.endTagStart, next);
    else this.setAttribute(this.publicId(existing), "Value", value);
  }

  addNode(parentSelector: AiSelector | undefined, spec: AiNativeNodeSpec): XmlNode {
    const parent = parentSelector === undefined ? this.root() : this.resolve(parentSelector);
    const newline = newlineOf(this.source);
    const parentIndent = indentAt(this.source, parent.start);
    const childIndent = `${parentIndent}    `;
    const rendered = serializeNode(spec, childIndent, newline);
    if (parent.selfClosing) {
      const open = this.source.slice(parent.start, parent.startTagEnd).replace(/\/\s*>$/, ">");
      this.replace(parent.start, parent.end, `${open}${newline}${rendered}${newline}${parentIndent}</${parent.tag}>`);
      const matches = this.parsed.nodes.filter((node) => node.tag === spec.nativeType && (spec.attrs?.Id === undefined || node.attrs.Id === scalar(spec.attrs.Id)));
      return matches[matches.length - 1];
    }
    const hasChildren = parent.childIds.length > 0;
    const offset = hasChildren ? this.parsed.nodes[parent.childIds[parent.childIds.length - 1]].end : parent.endTagStart;
    const lineStart = this.source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const needsLeadingNewline = !hasChildren && this.source.slice(lineStart, offset).trim().length > 0;
    const insertion = hasChildren ? `${newline}${rendered}` : `${needsLeadingNewline ? newline : ""}${rendered}${newline}${parentIndent}`;
    this.replace(offset, offset, insertion);
    const matches = this.parsed.nodes.filter((node) => node.tag === spec.nativeType && (spec.attrs?.Id === undefined || node.attrs.Id === scalar(spec.attrs.Id)));
    return matches[matches.length - 1];
  }

  removeNode(selector: AiSelector): void {
    const node = this.resolve(selector);
    if (node === this.root()) throw new Error("Cannot remove the AIData root");
    let start = node.start;
    let end = node.end;
    const newline = newlineOf(this.source);
    if (this.source.slice(end, end + newline.length) === newline) end += newline.length;
    else {
      const lineStart = this.source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      if (/^\s*$/.test(this.source.slice(lineStart, start))) start = lineStart;
    }
    this.replace(start, end, "");
  }

  cloneNode(selector: AiSelector, id: string, parentSelector?: AiSelector): XmlNode {
    const node = this.resolve(selector);
    const raw = this.source.slice(node.start, node.end);
    const idSpan = node.attrSpans.find((entry) => entry.name === "Id" || entry.name === "id");
    const cloned = idSpan
      ? raw.slice(0, idSpan.valueStart - node.start) + escapeXml(id) + raw.slice(idSpan.valueEnd - node.start)
      : raw.replace(/^<([\w:.-]+)/, `<$1 Id="${escapeXml(id)}"`);
    const parent = parentSelector ? this.resolve(parentSelector) : node.parentId === null ? this.root() : this.parsed.nodes[node.parentId];
    const newline = newlineOf(this.source);
    const offset = parent.endTagStart;
    const indent = indentAt(this.source, node.start);
    this.replace(offset, offset, `${newline}${indent}${cloned.trimStart()}${newline}${indentAt(this.source, parent.start)}`);
    return this.resolve({ nativeType: node.tag, id });
  }

  moveNode(selector: AiSelector, anchor: AiSelector, position: "before" | "after"): void {
    const node = this.resolve(selector);
    const target = this.resolve(anchor);
    if (node.parentId !== target.parentId) throw new Error("AI reorder requires siblings with the same parent");
    if (node.id === target.id) return;
    const raw = this.source.slice(node.start, node.end);
    this.removeNode(this.publicId(node));
    const refreshed = this.resolve(this.publicId(target));
    const offset = position === "before" ? refreshed.start : refreshed.end;
    const newline = newlineOf(this.source);
    this.replace(offset, offset, position === "before" ? `${raw}${newline}${indentAt(this.source, refreshed.start)}` : `${newline}${indentAt(this.source, refreshed.start)}${raw}`);
  }

  updateTypedReferences(oldValue: string, newValue: string, schema: AiSchemaRegistry, kind: "personality" | "wave"): number {
    let changed = 0;
    const candidates = this.parsed.nodes.filter((node) => schema.property(node.tag)?.referenceKind === kind && this.value(node) === oldValue).sort((a, b) => b.start - a.start);
    for (const node of candidates) { this.setProperty(this.publicId(this.parsed.nodes[node.parentId!]), node.tag, newValue); changed++; }
    return changed;
  }

  incomingReferences(value: string, schema: AiSchemaRegistry, kind: "personality" | "wave") {
    return this.parsed.nodes.filter((node) => schema.property(node.tag)?.referenceKind === kind && this.value(node) === value).map((node) => ({ path: this.pathOf(node), nativeType: node.tag }));
  }

  toIR(schema: AiSchemaRegistry, includeRaw = false): AiDocumentIR {
    const root = this.root();
    const nativeNodes = this.parsed.nodes.map((node) => ({
      id: this.publicId(node), nodeId: node.id, nativeType: node.tag,
      parentId: node.parentId === null ? undefined : this.publicId(this.parsed.nodes[node.parentId]),
      attrs: { ...node.attrs }, value: this.value(node), children: node.childIds.map((id) => this.publicId(this.parsed.nodes[id])),
      path: this.pathOf(node), evidence: (schema.node(node.tag)?.evidence ?? schema.property(node.tag)?.evidence ?? "UNKNOWN_NEEDS_RESEARCH") as AiEvidence,
      rawSource: includeRaw ? this.source.slice(node.start, node.end) : undefined,
    }));
    const definitions = root.childIds.map((id) => this.parsed.nodes[id]).filter((node) => node.tag === "Definition").map((definition, index) => {
      const id = definition.attrs.Id ?? definition.attrs.id ?? `__anonymous_${index}`;
      const children = definition.childIds.map((child) => this.parsed.nodes[child]);
      const waves = this.descendants(definition).filter((node) => node.tag === "Wave");
      return {
        id, nodeId: definition.id,
        properties: Object.fromEntries(children.filter((child) => child.tag !== "Wave").map((child) => [child.tag, this.value(child)])),
        waveIds: waves.map((wave, waveIndex) => wave.attrs.Id ?? wave.attrs.id ?? `__anonymous_${waveIndex}`),
        unknownChildren: children.filter((child) => !schema.node(child.tag) && !schema.property(child.tag)).map((child) => child.tag),
        rawSource: includeRaw ? this.source.slice(definition.start, definition.end) : undefined,
      };
    });
    const waves = definitions.flatMap((definition) => {
      const node = this.parsed.nodes[definition.nodeId];
      return this.descendants(node).filter((candidate) => candidate.tag === "Wave").map((wave, order) => {
        const id = wave.attrs.Id ?? wave.attrs.id ?? `__anonymous_${order}`;
        const children = wave.childIds.map((child) => this.parsed.nodes[child]);
        const composition = this.descendants(wave).filter((child) => /unit/i.test(child.tag) && Boolean(child.attrs.Type ?? child.attrs.type ?? child.attrs.Unit ?? child.attrs.unit ?? child.attrs.Link ?? child.attrs.link)).map((child) => ({
          unit: child.attrs.Type ?? child.attrs.type ?? child.attrs.Unit ?? child.attrs.unit ?? child.attrs.Link ?? child.attrs.link,
          quantity: Number.isFinite(Number(child.attrs.Count ?? child.attrs.count ?? child.attrs.Quantity ?? child.attrs.quantity)) ? Number(child.attrs.Count ?? child.attrs.count ?? child.attrs.Quantity ?? child.attrs.quantity) : undefined,
          nativeType: child.tag, path: this.pathOf(child), evidence: (schema.node(child.tag)?.evidence ?? "UNKNOWN_NEEDS_RESEARCH") as AiEvidence,
        }));
        return {
          id, nodeId: wave.id, personalityId: definition.id, order,
          properties: Object.fromEntries(children.map((child) => [child.tag, this.value(child)])), composition,
          unknownChildren: children.filter((child) => !schema.node(child.tag) && !schema.property(child.tag)).map((child) => child.tag),
          rawSource: includeRaw ? this.source.slice(wave.start, wave.end) : undefined,
        };
      });
    });
    const diagnostics = this.parsed.diagnostics.map((entry) => ({ severity: entry.severity, code: "AI_XML_PARSE", message: entry.message, path: `${this.sourceFile}@${entry.offset}` }));
    if (root.tag !== "AIData") diagnostics.push({ severity: "error", code: "AI_ROOT_INVALID", message: `Expected <AIData>, found <${root.tag}>`, path: this.sourceFile });
    return { root: root.tag, definitions, waves, nativeNodes, diagnostics };
  }
}
