import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";

export interface WaterMaterialPatch {
  id: string;
  parent?: string;
  stateIndex?: number;
  height?: number;
  color?: [number, number, number, number];
  uvRate?: [number, number, number, number];
  refractionDistortion?: number;
  reflectionDistortion?: number;
  framesPerSec?: number;
  isLava?: boolean;
}
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll("'", "&apos;");
export function waterName(id: string) {
  if (!id || Buffer.byteLength(id, "utf8") > 39 || [...id].some(c => c.charCodeAt(0) < 32))
    throw new Error("INVALID_WATER_TEMPLATE_NAME: UTF8 name must fit the native 40-byte NUL-terminated field");
  return id;
}
/** Span edits preserve unknown fields, comments, states and attribute/child encodings. */
export class WaterCatalog {
  readonly parsed;
  readonly root: XmlNode;
  constructor(readonly source: string) {
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("WATER_CATALOG_DTD_UNSUPPORTED");
    this.parsed = scanXml(source);
    this.root = this.parsed.nodes[this.parsed.rootIds[0]];
    if (this.parsed.rootIds.length !== 1 || this.root?.tag !== "Catalog" || this.parsed.diagnostics.some(d => d.severity === "error"))
      throw new Error("INVALID_WATER_CATALOG_XML");
    const ids = this.objects().map(n => n.attrs.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error("DUPLICATE_WATER_TEMPLATE_ID");
  }
  objects() { return this.parsed.nodes.filter(n => n.parentId === this.root.id && n.tag === "CWater"); }
  list() {
    return this.objects().filter(n => n.attrs.id).map(n => ({ id:n.attrs.id, parent:n.attrs.parent,
      states:this.parsed.nodes.filter(s => s.parentId === n.id && s.tag === "State").map((s,i) => ({ index:s.attrs.index ?? String(i),
        fields:{ ...Object.fromEntries(this.parsed.nodes.filter(f => f.parentId === s.id).map(f => [f.tag,f.attrs.value])), ...s.attrs } })) }));
  }
  patch(p: WaterMaterialPatch, allowOverride = false): string {
    waterName(p.id); if (p.parent) waterName(p.parent);
    if (p.parent === p.id) throw new Error("WATER_TEMPLATE_SELF_PARENT");
    const n = this.objects().find(n => n.attrs.id === p.id);
    if (!n && !p.parent && !allowOverride) throw new Error("NEW_WATER_MATERIAL_REQUIRES_PARENT");
    if (n && p.parent !== undefined && p.parent !== n.attrs.parent) throw new Error("WATER_MATERIAL_REPARENT_UNSUPPORTED");
    let result = this.source;
    if (!n) {
      result = this.insert(this.root, `<CWater id="${escape(p.id)}"${p.parent ? ` parent="${escape(p.parent)}"` : ""}/>`);
    }
    const stateValues: Record<string,string|undefined> = { Height:p.height?.toFixed(6), Color:p.color?.map(v => v.toFixed(6)).join(","),
      UvRate:p.uvRate?.map(v => v.toFixed(6)).join(","), RefractionDistortion:p.refractionDistortion?.toFixed(6), ReflectionDistortion:p.reflectionDistortion?.toFixed(6) };
    for (const [tag,value] of Object.entries({FramesPerSec:p.framesPerSec?.toFixed(6), IsLava:p.isLava === undefined ? undefined : p.isLava ? "1":"0"})) {
      if (value !== undefined) result = new WaterCatalog(result).field(p.id,undefined,tag,value);
    }
    for (const [tag,value] of Object.entries(stateValues)) {
      if (value !== undefined) result = new WaterCatalog(result).field(p.id,p.stateIndex ?? 0,tag,value);
    }
    if([...result].some(c => c.charCodeAt(0) > 127)) result = result.replace(/encoding=("|')us-ascii\1/i,'encoding="utf-8"');
    new WaterCatalog(result); return result;
  }
  private insert(n: XmlNode, text: string) {
    if (n.selfClosing) {
      const end = n.startTagEnd - 2;
      return this.source.slice(0,end) + `>${text}</${n.tag}>` + this.source.slice(n.end);
    }
    return this.source.slice(0,n.endTagStart) + text + this.source.slice(n.endTagStart);
  }
  private field(id: string, stateIndex: number|undefined, tag: string, value: string): string {
    const object = this.objects().find(n => n.attrs.id === id)!;
    let container = object;
    if (stateIndex !== undefined) {
      const states = this.parsed.nodes.filter(n => n.parentId === object.id && n.tag === "State");
      const matches = states.filter((n,i) => Number(n.attrs.index ?? i) === stateIndex);
      if (matches.length > 1) throw new Error("AMBIGUOUS_WATER_STATE_INDEX");
      if (!matches.length) return new WaterCatalog(this.insert(object,`<State index="${stateIndex}"/>`)).field(id,stateIndex,tag,value);
      container = matches[0];
    }
    const children = this.parsed.nodes.filter(n => n.parentId === container.id && n.tag === tag);
    if (children.length > 1 || (container.attrs[tag] !== undefined && children.length)) throw new Error(`AMBIGUOUS_WATER_FIELD: ${tag}`);
    const node = children[0] ?? container;
    const attribute = children.length ? "value" : tag;
    const span = node.attrSpans.find(s => s.name === attribute);
    if (span) return this.source.slice(0,span.valueStart) + escape(value) + this.source.slice(span.valueEnd);
    if (children.length) throw new Error(`WATER_FIELD_VALUE_REQUIRED: ${tag}`);
    return this.insert(container,`<${tag} value="${escape(value)}"/>`);
  }
}
