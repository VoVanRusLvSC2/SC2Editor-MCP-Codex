import { createHash } from "node:crypto";
import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import { dataDomainFromType, isDataObjectType } from "./domains.js";
import { formatDataFieldPath, parseDataFieldPath } from "./fieldPath.js";
import type { DataField, DataFieldPathSegment, DataNativeFieldSpec, DataObject, DataObjectSelector, DataScalar } from "./types.js";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
}

function scalar(value: DataScalar): string { return typeof value === "boolean" ? (value ? "1" : "0") : String(value); }
function newlineOf(source: string): string { return source.includes("\r\n") ? "\r\n" : "\n"; }
function indentAt(source: string, offset: number): string {
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return source.slice(start, offset).match(/^\s*/)?.[0] ?? "";
}

function renderField(spec: DataNativeFieldSpec, indent: string, newline: string): string {
  if (!/^[A-Za-z_][\w:.-]*$/.test(spec.name)) throw new Error(`Invalid GameData field name '${spec.name}'`);
  const attributes: Array<[string, DataScalar]> = [];
  if (spec.index !== undefined) attributes.push(["index", spec.index]);
  if (spec.value !== undefined) attributes.push(["value", spec.value]);
  if (spec.link !== undefined) attributes.push(["Link", spec.link]);
  for (const [name, value] of Object.entries(spec.attrs ?? {})) {
    if (["index", "value", "Link"].includes(name)) throw new Error(`Use the dedicated '${name}' field property`);
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`Invalid XML attribute '${name}'`);
    attributes.push([name, value]);
  }
  const attrs = attributes.map(([name, value]) => ` ${name}="${escapeXml(scalar(value))}"`).join("");
  if (!spec.children?.length) return `${indent}<${spec.name}${attrs}/>`;
  const childIndent = `${indent}    `;
  const children = spec.children.map((child) => renderField(child, childIndent, newline)).join(newline);
  return `${indent}<${spec.name}${attrs}>${newline}${children}${newline}${indent}</${spec.name}>`;
}

export class DataDocument {
  private parsed = scanXml("");

  constructor(public source: string, readonly sourceFile = "Base.SC2Data/GameData/UnitData.xml") { this.reparse(); }

  static create(sourceFile = "Base.SC2Data/GameData/UnitData.xml"): DataDocument {
    return new DataDocument(`<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n</Catalog>`, sourceFile);
  }

  get sha256(): string { return createHash("sha256").update(this.source, "utf8").digest("hex"); }
  get diagnostics() { return this.parsed.diagnostics; }
  get nodes(): readonly XmlNode[] { return this.parsed.nodes; }

  private reparse(): void { this.parsed = scanXml(this.source); }
  private replace(start: number, end: number, text: string): void {
    if(this.diagnostics.some(d=>d.severity==="error"))throw new Error("INVALID_XML_SOURCE: cannot edit malformed GameData");
    if (start < 0 || end < start || end > this.source.length) throw new Error(`Invalid GameData source patch ${start}:${end}`);
    this.source = this.source.slice(0, start) + text + this.source.slice(end);
    this.reparse();
  }

  root(): XmlNode {
    const root = this.parsed.rootIds.map((id) => this.parsed.nodes[id]).find((node) => node.tag === "Catalog") ?? this.parsed.rootIds.map((id) => this.parsed.nodes[id])[0];
    if (!root) throw new Error(`${this.sourceFile} has no XML root`);
    return root;
  }

  entries(): XmlNode[] {
    const root = this.root();
    return root.childIds.map((id) => this.parsed.nodes[id]).filter((node) => isDataObjectType(node.tag));
  }

  resolve(selector: DataObjectSelector): XmlNode {
    let id: string; let ctype: string | undefined; let domain: string | undefined;
    if (typeof selector === "string") {
      const split = selector.indexOf(":");
      if (split > 0 && selector.slice(0, split).startsWith("C")) { ctype = selector.slice(0, split); id = selector.slice(split + 1); }
      else id = selector;
    } else ({ id, ctype, domain } = selector);
    const matches = this.entries().filter((node) => node.attrs.id === id && (!ctype || node.tag === ctype) && (!domain || dataDomainFromType(node.tag) === domain));
    if (matches.length !== 1) throw new Error(`Data selector '${typeof selector === "string" ? selector : JSON.stringify(selector)}' matched ${matches.length} objects`);
    return matches[0];
  }

  objectKey(node: XmlNode): string { return `${node.tag}:${node.attrs.id ?? `default@${node.id}`}`; }

  private children(node: XmlNode): XmlNode[] { return node.childIds.map((id) => this.parsed.nodes[id]); }

  private fieldNode(entry: XmlNode, path: string): XmlNode | undefined {
    const segments = parseDataFieldPath(path);
    let parent = entry;
    for (const segment of segments) {
      const next = this.children(parent).find((node) => node.tag === segment.name && (node.attrs.index ?? node.attrs.Index) === segment.index);
      if (!next) return undefined;
      parent = next;
    }
    return parent;
  }

  private appendTo(parent: XmlNode, renderedWithoutIndent: string): void {
    const newline = newlineOf(this.source);
    const parentIndent = indentAt(this.source, parent.start);
    const childIndent = `${parentIndent}    `;
    const rendered = renderedWithoutIndent.split(/\r?\n/).map((line) => `${childIndent}${line}`).join(newline);
    if (parent.selfClosing) {
      const opening = this.source.slice(parent.start, parent.startTagEnd).replace(/\/\s*>$/, ">");
      this.replace(parent.start, parent.end, `${opening}${newline}${rendered}${newline}${parentIndent}</${parent.tag}>`);
      return;
    }
    const closingLineStart = this.source.lastIndexOf("\n", Math.max(0, parent.endTagStart - 1)) + 1;
    if (/^[ \t]*$/.test(this.source.slice(closingLineStart, parent.endTagStart))) {
      this.replace(closingLineStart, parent.endTagStart, `${rendered}${newline}${parentIndent}`);
    } else {
      this.replace(parent.endTagStart, parent.endTagStart, `${newline}${rendered}${newline}${parentIndent}`);
    }
  }

  private setAttributeOn(node: XmlNode, name: string, value: DataScalar): void {
    if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`Invalid XML attribute '${name}'`);
    const existing = node.attrSpans.find((entry) => entry.name === name);
    const encoded = escapeXml(scalar(value));
    if (existing) {
      if (this.source.slice(existing.valueStart, existing.valueEnd) !== encoded) this.replace(existing.valueStart, existing.valueEnd, encoded);
      return;
    }
    const offset = node.startTagEnd - (node.selfClosing ? 2 : 1);
    this.replace(offset, offset, ` ${name}="${encoded}"`);
  }

  private removeAttributeOn(node: XmlNode, name: string): void {
    const existing = node.attrSpans.find((entry) => entry.name === name);
    if (!existing) return;
    let start = existing.start;
    while (start > node.start && /[ \t]/.test(this.source[start - 1])) start--;
    this.replace(start, existing.end, "");
  }

  private ensureParent(entrySelector: DataObjectSelector, segments: DataFieldPathSegment[]): XmlNode {
    let entry = this.resolve(entrySelector);
    let parent = entry;
    for (const segment of segments) {
      let next = this.children(parent).find((node) => node.tag === segment.name && (node.attrs.index ?? node.attrs.Index) === segment.index);
      if (!next) {
        this.appendTo(parent, renderField({ name: segment.name, index: segment.index }, "", newlineOf(this.source)));
        entry = this.resolve(entrySelector);
        const parentPath = formatDataFieldPath(segments.slice(0, segments.indexOf(segment) + 1));
        next = this.fieldNode(entry, parentPath);
      }
      if (!next) throw new Error(`Could not create GameData container ${segment.name}`);
      parent = next;
    }
    return parent;
  }

  createObject(ctype: string, id: string, options: { parent?: string; attrs?: Record<string, DataScalar>; fields?: DataNativeFieldSpec[] } = {}): XmlNode {
    if (!isDataObjectType(ctype)) throw new Error(`GameData object type must start with C + uppercase letter: '${ctype}'`);
    if (this.entries().some((node) => node.attrs.id === id && dataDomainFromType(node.tag) === dataDomainFromType(ctype))) throw new Error(`Data object already exists in domain ${dataDomainFromType(ctype) ?? ctype}: ${id}`);
    const attrs = [`id="${escapeXml(id)}"`];
    if (options.parent !== undefined) attrs.push(`parent="${escapeXml(options.parent)}"`);
    for (const [name, value] of Object.entries(options.attrs ?? {})) {
      if (["id", "parent"].includes(name)) throw new Error(`Use the dedicated '${name}' object property`);
      if (!/^[A-Za-z_][\w:.-]*$/.test(name)) throw new Error(`Invalid XML attribute '${name}'`);
      attrs.push(`${name}="${escapeXml(scalar(value))}"`);
    }
    const newline = newlineOf(this.source);
    const fields = options.fields ?? [];
    const body = fields.length ? `>${newline}${fields.map((field) => renderField(field, "    ", newline)).join(newline)}${newline}</${ctype}>` : "/>";
    this.appendTo(this.root(), `<${ctype} ${attrs.join(" ")}${body}`);
    return this.resolve({ id, ctype });
  }

  cloneObject(selector: DataObjectSelector, id: string, parent?: string): XmlNode {
    const original = this.resolve(selector);
    if (this.entries().some((node) => node.attrs.id === id && dataDomainFromType(node.tag) === dataDomainFromType(original.tag))) throw new Error(`Data object already exists: ${id}`);
    let raw = this.source.slice(original.start, original.end);
    const idSpan = original.attrSpans.find((entry) => entry.name === "id");
    if (!idSpan) throw new Error(`Cannot clone ${this.objectKey(original)} without id`);
    raw = raw.slice(0, idSpan.valueStart - original.start) + escapeXml(id) + raw.slice(idSpan.valueEnd - original.start);
    if (parent !== undefined) {
      const clone = new DataDocument(`<Catalog>${raw}</Catalog>`).entries()[0];
      const parentSpan = clone.attrSpans.find((entry) => entry.name === "parent");
      if (parentSpan) raw = raw.slice(0, parentSpan.valueStart - clone.start) + escapeXml(parent) + raw.slice(parentSpan.valueEnd - clone.start);
      else raw = raw.replace(/^<[^\s/>]+/, (opening) => `${opening} parent="${escapeXml(parent)}"`);
    }
    const newline = newlineOf(this.source);
    const indent = indentAt(this.source, original.start);
    this.replace(original.end, original.end, `${newline}${indent}${raw}`);
    return this.resolve({ id, ctype: original.tag });
  }

  renameObject(selector: DataObjectSelector, newId: string): { oldId: string; ctype: string; domain?: string } {
    const node = this.resolve(selector);
    const oldId = node.attrs.id;
    if (!oldId) throw new Error(`Cannot rename ${this.objectKey(node)} without id`);
    if (this.entries().some((entry) => entry.id !== node.id && entry.attrs.id === newId && dataDomainFromType(entry.tag) === dataDomainFromType(node.tag))) throw new Error(`Data object already exists: ${newId}`);
    this.setAttributeOn(node, "id", newId);
    return { oldId, ctype: node.tag, domain: dataDomainFromType(node.tag) };
  }

  setParent(selector: DataObjectSelector, parent?: string): void {
    const node = this.resolve(selector);
    if (parent === undefined) this.removeAttributeOn(node, "parent");
    else this.setAttributeOn(node, "parent", parent);
  }

  setObjectAttribute(selector: DataObjectSelector, name: string, value: DataScalar): void {
    if (["id", "parent"].includes(name)) throw new Error(`Use the dedicated object operation for '${name}'`);
    this.setAttributeOn(this.resolve(selector), name, value);
  }

  removeObjectAttribute(selector: DataObjectSelector, name: string): void {
    if (name === "id") throw new Error("Cannot remove a Data object id; use object.delete for removal");
    if (name === "parent") { this.setParent(selector); return; }
    this.removeAttributeOn(this.resolve(selector), name);
  }

  removeObject(selector: DataObjectSelector): void { this.removeNode(this.resolve(selector)); }

  private removeNode(node: XmlNode): void {
    let start = node.start; let end = node.end;
    const newline = newlineOf(this.source);
    if (this.source.slice(end, end + newline.length) === newline) end += newline.length;
    else {
      const lineStart = this.source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      if (/^\s*$/.test(this.source.slice(lineStart, start))) start = lineStart;
    }
    this.replace(start, end, "");
  }

  setField(selector: DataObjectSelector, path: string, carrier: "value" | "Link" | string, value: DataScalar): void {
    const segments = parseDataFieldPath(path);
    const entry = this.resolve(selector);
    const field = this.fieldNode(entry, path);
    if (!field) {
      const holderSegments = segments.slice(0, -1);
      const holder = this.ensureParent(selector, holderSegments);
      const last = segments[segments.length - 1];
      const spec: DataNativeFieldSpec = { name: last.name, index: last.index };
      if (carrier === "value") spec.value = value;
      else if (carrier === "Link") spec.link = scalar(value);
      else spec.attrs = { [carrier]: value };
      this.appendTo(holder, renderField(spec, "", newlineOf(this.source)));
      return;
    }
    this.setAttributeOn(field, carrier, value);
  }

  removeField(selector: DataObjectSelector, path: string): void {
    const field = this.fieldNode(this.resolve(selector), path);
    if (field) this.removeNode(field);
  }

  removeFieldAttribute(selector: DataObjectSelector, path: string, name: string): void {
    const field = this.fieldNode(this.resolve(selector), path);
    if (!field) throw new Error(`GameData field not found: ${path}`);
    this.removeAttributeOn(field, name);
  }

  appendArray(selector: DataObjectSelector, path: string, options: { value?: DataScalar; link?: string; attrs?: Record<string, DataScalar> }): string {
    const segments = parseDataFieldPath(path);
    const last = segments[segments.length - 1];
    if (last.index !== undefined) throw new Error(`array.append path must omit its final index: '${path}'`);
    const holder = this.ensureParent(selector, segments.slice(0, -1));
    const indexes = this.children(holder).filter((node) => node.tag === last.name).map((node) => Number.parseInt(node.attrs.index ?? "", 10)).filter(Number.isSafeInteger);
    const index = indexes.length ? Math.max(...indexes) + 1 : 0;
    this.appendTo(holder, renderField({ name: last.name, index, ...options }, "", newlineOf(this.source)));
    return `${formatDataFieldPath(segments.slice(0, -1))}${segments.length > 1 ? "." : ""}${last.name}[${index}]`;
  }

  addNative(selector: DataObjectSelector, parentPath: string | undefined, field: DataNativeFieldSpec): void {
    const parent = parentPath ? this.fieldNode(this.resolve(selector), parentPath) : this.resolve(selector);
    if (!parent) throw new Error(`Native parent field not found: ${parentPath}`);
    this.appendTo(parent, renderField(field, "", newlineOf(this.source)));
  }

  references(): Array<{ object: string; path: string; carrier: "parent" | "Link"; value: string }> {
    const references: Array<{ object: string; path: string; carrier: "parent" | "Link"; value: string }> = [];
    for (const entry of this.entries()) {
      if (entry.attrs.parent) references.push({ object: this.objectKey(entry), path: `${this.objectKey(entry)}@parent`, carrier: "parent", value: entry.attrs.parent });
      const walk = (node: XmlNode, prefix: DataFieldPathSegment[]) => {
        for (const child of this.children(node)) {
          const segment = { name: child.tag, index: child.attrs.index ?? child.attrs.Index };
          const current = [...prefix, segment];
          if (child.attrs.Link) references.push({ object: this.objectKey(entry), path: `${this.objectKey(entry)}.${formatDataFieldPath(current)}@Link`, carrier: "Link", value: child.attrs.Link });
          walk(child, current);
        }
      };
      walk(entry, []);
    }
    return references;
  }

  patchReferences(oldId: string, newId: string, targetDomain?: string, updateLinks = true): number {
    let count = 0;
    const candidates = this.entries().flatMap((entry) => {
      const nodes: Array<{ node: XmlNode; attr: "parent" | "Link" }> = [];
      if (entry.attrs.parent === oldId && (!targetDomain || dataDomainFromType(entry.tag) === targetDomain)) nodes.push({ node: entry, attr: "parent" });
      const visit = (node: XmlNode) => { for (const child of this.children(node)) { if (updateLinks && child.attrs.Link === oldId) nodes.push({ node: child, attr: "Link" }); visit(child); } };
      visit(entry);
      return nodes;
    }).sort((left, right) => right.node.start - left.node.start);
    for (const candidate of candidates) { this.setAttributeOn(this.parsed.nodes.find((node) => node.start === candidate.node.start) ?? candidate.node, candidate.attr, newId); count++; }
    return count;
  }

  private toField(node: XmlNode, prefix: DataFieldPathSegment[], includeRaw: boolean): DataField {
    const segment = { name: node.tag, index: node.attrs.index ?? node.attrs.Index };
    const path = formatDataFieldPath([...prefix, segment]);
    return {
      path, name: node.tag, index: segment.index, value: node.attrs.value ?? node.attrs.Value, link: node.attrs.Link ?? node.attrs.link,
      attrs: { ...node.attrs }, children: this.children(node).map((child) => this.toField(child, [...prefix, segment], includeRaw)),
      sourcePath: `${this.sourceFile}:${path}`, rawSource: includeRaw ? this.source.slice(node.start, node.end) : undefined,
    };
  }

  objects(includeRaw = false): DataObject[] {
    return this.entries().map((node) => ({
      ctype: node.tag, domain: dataDomainFromType(node.tag), id: node.attrs.id, parent: node.attrs.parent,
      isDefault: node.attrs.default === "1", attrs: { ...node.attrs }, fields: this.children(node).map((child) => this.toField(child, [], includeRaw)),
      sourcePath: this.sourceFile, rawSource: includeRaw ? this.source.slice(node.start, node.end) : undefined,
    }));
  }
}
