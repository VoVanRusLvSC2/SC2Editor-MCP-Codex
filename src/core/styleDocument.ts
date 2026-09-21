import { createHash } from "node:crypto";
import { renderElement } from "./layoutDocument.js";
import { scanXml } from "./xmlScanner.js";
import type { ScalarValue, XmlNode } from "./types.js";

export interface StyleDetails {
  name: string;
  attrs: Record<string, string>;
  source: string;
}

export interface StyleConstantDetails {
  name: string;
  value: string;
  attrs: Record<string, string>;
  source: string;
}

export interface FontGroupDetails {
  name: string;
  attrs: Record<string, string>;
  ranges: Array<Record<string, string>>;
  source: string;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
}

function scalar(value: ScalarValue): string {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

function lineStart(source: string, offset: number): number {
  const value = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return value < 0 ? 0 : value + 1;
}

function indentAt(source: string, offset: number): string {
  return source.slice(lineStart(source, offset), offset).match(/^[\t ]*/)?.[0] ?? "";
}

function newlineOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

export class StyleDocument {
  private parsed;

  constructor(private sourceText: string) {
    this.parsed = scanXml(sourceText);
  }

  get source(): string {
    return this.sourceText;
  }

  get sha256(): string {
    return createHash("sha256").update(this.sourceText, "utf8").digest("hex");
  }

  get diagnostics() {
    return [...this.parsed.diagnostics];
  }

  clone(): StyleDocument {
    return new StyleDocument(this.sourceText);
  }

  private rebuild(source: string): void {
    this.sourceText = source;
    this.parsed = scanXml(source);
  }

  private root(): XmlNode {
    const root = this.parsed.nodes.find((node) => node.tag === "StyleFile" && node.parentId === null);
    if (!root) throw new Error("SC2 style root <StyleFile> not found");
    return root;
  }

  private styles(): XmlNode[] {
    const root = this.root();
    return root.childIds.map((id) => this.parsed.nodes[id]).filter((node) => node.tag === "Style");
  }

  private children(tag: string): XmlNode[] {
    const root = this.root();
    return root.childIds.map((id) => this.parsed.nodes[id]).filter((node) => node.tag === tag);
  }

  listStyles(): StyleDetails[] {
    return this.styles().map((node) => ({
      name: node.attrs.name ?? "",
      attrs: { ...node.attrs },
      source: this.sourceText.slice(node.start, node.end),
    }));
  }

  getStyle(name: string): StyleDetails | undefined {
    return this.listStyles().find((style) => style.name === name);
  }

  listConstants(): StyleConstantDetails[] {
    return this.children("Constant").map((node) => ({
      name: node.attrs.name ?? "",
      value: node.attrs.val ?? "",
      attrs: { ...node.attrs },
      source: this.sourceText.slice(node.start, node.end),
    }));
  }

  getConstant(name: string): StyleConstantDetails | undefined {
    return this.listConstants().find((entry) => entry.name === name);
  }

  listFontGroups(): FontGroupDetails[] {
    return this.children("FontGroup").map((node) => ({
      name: node.attrs.name ?? "",
      attrs: { ...node.attrs },
      ranges: node.childIds
        .map((id) => this.parsed.nodes[id])
        .filter((child) => child.tag === "CodepointRange")
        .map((child) => ({ ...child.attrs })),
      source: this.sourceText.slice(node.start, node.end),
    }));
  }

  upsertStyle(name: string, attrs: Record<string, ScalarValue>): void {
    if (!/^[A-Za-z_][\w.-]*$/.test(name)) throw new Error("Invalid style name");
    const node = this.styles().find((style) => style.attrs.name === name);
    if (node) {
      this.patchAttributes(node, attrs);
      return;
    }
    const root = this.root();
    const nl = newlineOf(this.sourceText);
    const unit = this.sourceText.includes("\t") ? "\t" : "    ";
    const offset = lineStart(this.sourceText, root.endTagStart);
    const indent = indentAt(this.sourceText, root.start) + unit;
    const insertion = renderElement({ tag: "Style", attrs: { name, ...attrs } }, indent, unit, nl) + nl;
    this.rebuild(this.sourceText.slice(0, offset) + insertion + this.sourceText.slice(offset));
  }

  cloneStyle(sourceName: string, name: string): void {
    if (this.getStyle(name)) throw new Error(`Style already exists: ${name}`);
    const source = this.getStyle(sourceName);
    if (!source) throw new Error(`Style not found: ${sourceName}`);
    const attrs = { ...source.attrs };
    delete attrs.name;
    this.upsertStyle(name, attrs);
  }

  renameStyle(oldName: string, newName: string): void {
    if (this.getStyle(newName)) throw new Error(`Style already exists: ${newName}`);
    const node = this.styles().find((entry) => entry.attrs.name === oldName);
    if (!node) throw new Error(`Style not found: ${oldName}`);
    this.patchAttributes(node, { name: newName });
    for (const style of [...this.styles()]) {
      if (style.attrs.template === oldName) this.patchAttributes(style, { template: newName });
    }
  }

  deleteStyle(name: string): void {
    const node = this.styles().find((entry) => entry.attrs.name === name);
    if (!node) throw new Error(`Style not found: ${name}`);
    const consumer = this.styles().find((entry) => entry.attrs.template === name);
    if (consumer) throw new Error(`Style '${name}' is used as template by '${consumer.attrs.name}'`);
    this.deleteNode(node);
  }

  upsertConstant(name: string, value: ScalarValue, attrs: Record<string, ScalarValue> = {}): void {
    if (!/^[A-Za-z_][\w.-]*$/.test(name)) throw new Error("Invalid constant name");
    const node = this.children("Constant").find((entry) => entry.attrs.name === name);
    if (node) {
      this.patchAttributes(node, { val: value, ...attrs });
      return;
    }
    this.insertRootChild({ tag: "Constant", attrs: { name, val: value, ...attrs } });
  }

  deleteConstant(name: string): void {
    const node = this.children("Constant").find((entry) => entry.attrs.name === name);
    if (!node) throw new Error(`Constant not found: ${name}`);
    const reference = `#${name}`;
    const consumers = [...this.styles(), ...this.children("Constant")]
      .filter((entry) => entry.id !== node.id)
      .filter((entry) => Object.values(entry.attrs).includes(reference));
    if (consumers.length) throw new Error(`Constant '${name}' is still referenced`);
    this.deleteNode(node);
  }

  upsertFontGroup(name: string, ranges: Array<Record<string, ScalarValue>>, attrs: Record<string, ScalarValue> = {}): void {
    if (!/^[A-Za-z_][\w.-]*$/.test(name)) throw new Error("Invalid font group name");
    const existing = this.children("FontGroup").find((entry) => entry.attrs.name === name);
    if (existing) this.deleteNode(existing);
    this.insertRootChild({
      tag: "FontGroup",
      attrs: { name, ...attrs },
      children: ranges.map((range) => ({ tag: "CodepointRange", attrs: range })),
    });
  }

  private insertRootChild(spec: { tag: string; attrs?: Record<string, ScalarValue>; children?: Array<{ tag: string; attrs?: Record<string, ScalarValue> }> }): void {
    const root = this.root();
    const nl = newlineOf(this.sourceText);
    const unit = this.sourceText.includes("\t") ? "\t" : "    ";
    const offset = lineStart(this.sourceText, root.endTagStart);
    const indent = indentAt(this.sourceText, root.start) + unit;
    const insertion = renderElement(spec, indent, unit, nl) + nl;
    this.rebuild(this.sourceText.slice(0, offset) + insertion + this.sourceText.slice(offset));
  }

  private deleteNode(node: XmlNode): void {
    let start = lineStart(this.sourceText, node.start);
    let end = node.end;
    const nl = newlineOf(this.sourceText);
    if (this.sourceText.startsWith(nl, end)) end += nl.length;
    else if (this.sourceText.slice(start, node.start).trim()) start = node.start;
    this.rebuild(this.sourceText.slice(0, start) + this.sourceText.slice(end));
  }

  private patchAttributes(node: XmlNode, attrs: Record<string, ScalarValue>): void {
    const patches: Array<{ start: number; end: number; text: string }> = [];
    const additions: Array<[string, ScalarValue]> = [];
    for (const [name, value] of Object.entries(attrs)) {
      const span = node.attrSpans.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (span) patches.push({ start: span.valueStart, end: span.valueEnd, text: xmlEscape(scalar(value)) });
      else additions.push([name, value]);
    }
    if (additions.length) {
      const raw = this.sourceText.slice(node.start, node.startTagEnd);
      const local = raw.lastIndexOf("/>") >= 0 ? raw.lastIndexOf("/>") : raw.lastIndexOf(">");
      const offset = node.start + local;
      const text = additions.map(([key, value]) => ` ${key}="${xmlEscape(scalar(value))}"`).join("");
      patches.push({ start: offset, end: offset, text });
    }
    let next = this.sourceText;
    for (const patch of patches.sort((a, b) => b.start - a.start)) {
      next = next.slice(0, patch.start) + patch.text + next.slice(patch.end);
    }
    this.rebuild(next);
  }
}
