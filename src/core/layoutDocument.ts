import { createHash } from "node:crypto";
import { scanXml } from "./xmlScanner.js";
import type {
  AnchorSpec,
  AnimationSpec,
  ClippedImageSpec,
  ElementDetails,
  ElementSpec,
  FrameDetails,
  FrameSummary,
  ParsedXml,
  PropertySelector,
  ScalarValue,
  StateGroupSpec,
  XmlAttrs,
  XmlNode,
} from "./types.js";

const ANCHOR_SIDES = new Set(["Top", "Left", "Right", "Bottom"]);
const STRUCTURAL_CHILDREN = new Set(["Frame", "Anchor", "StateGroup", "Animation"]);

function encodePathSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("'", "&apos;");
}

function scalarText(value: ScalarValue): string {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

function renderAttrs(attrs?: Record<string, ScalarValue>): string {
  return Object.entries(attrs ?? {}).map(([name, value]) => ` ${name}="${xmlEscape(scalarText(value))}"`).join("");
}

export function renderElement(spec: ElementSpec, indent = "", unit = "    ", nl = "\n"): string {
  const attrs = { ...(spec.attrs ?? {}) };
  if (spec.value !== undefined) attrs.val = spec.value;
  if (!spec.children?.length) return `${indent}<${spec.tag}${renderAttrs(attrs)}/>`;
  return [
    `${indent}<${spec.tag}${renderAttrs(attrs)}>`,
    ...spec.children.map((child) => renderElement(child, indent + unit, unit, nl)),
    `${indent}</${spec.tag}>`,
  ].join(nl);
}

function lineStart(source: string, offset: number): number {
  const n = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return n < 0 ? 0 : n + 1;
}

function lineEndIncludingNewline(source: string, offset: number): number {
  const n = source.indexOf("\n", offset);
  return n < 0 ? source.length : n + 1;
}

function indentAt(source: string, offset: number): string {
  const start = lineStart(source, offset);
  const m = source.slice(start, offset).match(/^[\t ]*/);
  return m?.[0] ?? "";
}

function inferIndentUnit(source: string): string {
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(\s+)</);
    if (m && m[1]) return m[1].includes("\t") ? "\t" : " ".repeat(Math.min(m[1].length, 4));
  }
  return "    ";
}

function newlineOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function directChildren(parsed: ParsedXml, node: XmlNode, tag?: string): XmlNode[] {
  return node.childIds
    .map((id) => parsed.nodes[id])
    .filter((child) => (tag ? child.tag === tag : true));
}

function attrsToObject(attrs: XmlAttrs): XmlAttrs {
  return { ...attrs };
}

export class LayoutDocument {
  private parsed: ParsedXml;

  constructor(private sourceText: string) {
    this.parsed = scanXml(sourceText);
  }

  get source(): string {
    return this.sourceText;
  }

  get sha256(): string {
    return hash(this.sourceText);
  }

  get diagnostics() {
    return [...this.parsed.diagnostics];
  }

  clone(): LayoutDocument {
    return new LayoutDocument(this.sourceText);
  }

  nodes(tag?: string): XmlNode[] {
    return this.parsed.nodes
      .filter((node) => !tag || node.tag === tag)
      .map((node) => ({ ...node, attrs: { ...node.attrs }, attrSpans: [...node.attrSpans], childIds: [...node.childIds] }));
  }

  sourceOf(node: XmlNode): string {
    return this.sourceText.slice(node.start, node.end);
  }

  includes(): string[] {
    return this.parsed.nodes
      .filter((node) => node.tag === "Include" && node.attrs.path)
      .map((node) => node.attrs.path);
  }

  addInclude(includePath: string): void {
    const value = includePath.trim().replaceAll("\\", "/");
    if (!value || !/\.(?:SC2Layout|StormLayout)$/i.test(value)) {
      throw new Error("Include path must point to an SC2Layout or StormLayout file");
    }
    const desc = this.descNode();
    const existing = directChildren(this.parsed, desc, "Include")
      .some((node) => node.attrs.path?.replaceAll("\\", "/").toLowerCase() === value.toLowerCase());
    if (existing) return;
    const firstFrame = directChildren(this.parsed, desc).find((node) => node.tag === "Frame");
    this.insertElement(desc, { tag: "Include", attrs: { path: value } }, firstFrame);
  }

  removeInclude(includePath: string): void {
    const value = includePath.replaceAll("\\", "/").toLowerCase();
    const desc = this.descNode();
    const matches = directChildren(this.parsed, desc, "Include")
      .filter((node) => node.attrs.path?.replaceAll("\\", "/").toLowerCase() === value);
    if (matches.length !== 1) throw new Error(`Expected exactly one Include '${includePath}'; found ${matches.length}`);
    this.deleteNode(matches[0]);
  }

  private rebuild(next: string): void {
    this.sourceText = next;
    this.parsed = scanXml(next);
  }

  private descNode(): XmlNode {
    const desc = this.parsed.nodes.find((n) => n.tag === "Desc" && n.parentId === null);
    if (!desc) throw new Error("SC2 layout root <Desc> not found");
    return desc;
  }

  private frameChildren(node: XmlNode): XmlNode[] {
    return directChildren(this.parsed, node, "Frame");
  }

  private topFrames(): XmlNode[] {
    return this.frameChildren(this.descNode());
  }

  private frameName(node: XmlNode): string {
    return node.attrs.name ?? "";
  }

  private elementDetails(node: XmlNode): ElementDetails {
    return {
      tag: node.tag,
      attrs: attrsToObject(node.attrs),
      children: directChildren(this.parsed, node).map((child) => this.elementDetails(child)),
      source: this.sourceText.slice(node.start, node.end),
    };
  }

  private framePathMap(): Map<string, XmlNode> {
    const map = new Map<string, XmlNode>();
    const walk = (node: XmlNode, prefix: string) => {
      const name = this.frameName(node);
      const segment = encodePathSegment(name);
      const path = prefix ? `${prefix}/${segment}` : segment;
      if (name) map.set(path, node);
      for (const child of this.frameChildren(node)) walk(child, path);
    };
    for (const frame of this.topFrames()) walk(frame, "");
    return map;
  }

  private resolveFrame(path: string): XmlNode {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    const map = this.framePathMap();
    const exact = map.get(normalized);
    if (exact) return exact;

    const rawNameMatches = [...map.entries()].filter(([, node]) => node.attrs.name === normalized);
    if (rawNameMatches.length === 1) return rawNameMatches[0][1];
    if (rawNameMatches.length > 1) {
      throw new Error(`Frame name '${normalized}' is ambiguous; use escaped full path. Matches: ${rawNameMatches.map(([p]) => p).join(", ")}`);
    }

    if (!normalized.includes("/")) {
      const matches = [...map.entries()].filter(([p]) => p === normalized || p.endsWith(`/${normalized}`));
      if (matches.length === 1) return matches[0][1];
      if (matches.length > 1) {
        throw new Error(`Frame name '${normalized}' is ambiguous; use full path. Matches: ${matches.map(([p]) => p).join(", ")}`);
      }
    }
    throw new Error(`Frame not found: ${path}`);
  }

  listFrames(): FrameSummary[] {
    const map = this.framePathMap();
    return [...map.entries()].map(([path, node]) => ({
      path,
      name: node.attrs.name ?? "",
      type: node.attrs.type ?? "Frame",
      file: node.attrs.file,
      template: node.attrs.template,
      handle: this.simpleProperty(node, "Handle")?.val,
      children: this.frameChildren(node).length,
    }));
  }

  queryFrames(query: {
    name?: string;
    type?: string;
    template?: string;
    property?: string;
    handle?: string;
    under?: string;
    limit?: number;
  } = {}): FrameSummary[] {
    const contains = (value: string | undefined, wanted: string | undefined) =>
      !wanted || Boolean(value?.toLowerCase().includes(wanted.toLowerCase()));
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
    return this.listFrames().filter((frame) => {
      if (!contains(frame.name, query.name) || !contains(frame.type, query.type) || !contains(frame.template, query.template)) return false;
      if (query.handle && frame.handle !== query.handle) return false;
      if (query.under && frame.path !== query.under && !frame.path.startsWith(`${query.under}/`)) return false;
      if (query.property) {
        const node = this.resolveFrame(frame.path);
        if (!directChildren(this.parsed, node).some((child) => child.tag.toLowerCase() === query.property!.toLowerCase())) return false;
      }
      return true;
    }).slice(0, limit);
  }

  private simpleProperty(node: XmlNode, property: string): XmlAttrs | undefined {
    const matches = directChildren(this.parsed, node, property);
    if (!matches.length) return undefined;
    return attrsToObject(matches[0].attrs);
  }

  getFrame(path: string): FrameDetails {
    const node = this.resolveFrame(path);
    const propertyBag: Record<string, string | XmlAttrs | Array<string | XmlAttrs>> = {};
    const anchors: AnchorSpec[] = [];
    const elements: ElementDetails[] = [];

    for (const child of directChildren(this.parsed, node)) {
      if (child.tag === "Frame") continue;
      elements.push(this.elementDetails(child));
      if (child.tag === "Anchor") {
        if (!child.attrs.side || ANCHOR_SIDES.has(child.attrs.side)) {
          anchors.push({
            side: (child.attrs.side ?? "All") as AnchorSpec["side"],
            relative: child.attrs.relative ?? "$parent",
            pos: child.attrs.pos,
            offset: child.attrs.offset !== undefined ? Number(child.attrs.offset) : undefined,
          });
        }
        continue;
      }
      const value: string | XmlAttrs = Object.keys(child.attrs).length === 1 && "val" in child.attrs
        ? child.attrs.val
        : attrsToObject(child.attrs);
      const existing = propertyBag[child.tag];
      if (existing === undefined) propertyBag[child.tag] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else propertyBag[child.tag] = [existing, value];
    }

    const pathMap = this.framePathMap();
    const nodePath = [...pathMap.entries()].find(([, n]) => n.id === node.id)?.[0] ?? path;
    const childPaths = this.frameChildren(node).map((child) =>
      [...pathMap.entries()].find(([, n]) => n.id === child.id)?.[0] ?? child.attrs.name ?? ""
    );

    return {
      path: nodePath,
      name: node.attrs.name ?? "",
      type: node.attrs.type ?? "Frame",
      file: node.attrs.file,
      template: node.attrs.template,
      handle: this.simpleProperty(node, "Handle")?.val,
      children: childPaths.length,
      childPaths,
      properties: propertyBag,
      elements,
      anchors,
      source: this.sourceText.slice(node.start, node.end),
    };
  }

  private insertionPoint(parent?: XmlNode): { offset: number; indent: string } {
    const host = parent ?? this.descNode();
    if (host.selfClosing || host.endTagStart < 0) throw new Error(`Cannot insert into <${host.tag}>`);
    const offset = lineStart(this.sourceText, host.endTagStart);
    return { offset, indent: indentAt(this.sourceText, host.endTagStart) + inferIndentUnit(this.sourceText) };
  }

  private directFrameByName(parent: XmlNode | undefined, name: string): XmlNode | undefined {
    const frames = parent ? this.frameChildren(parent) : this.topFrames();
    return frames.find((f) => f.attrs.name === name);
  }

  createFrame(args: {
    parentPath?: string;
    type: string;
    name: string;
    template?: string;
    frameFile?: string;
    properties?: ElementSpec[];
    width?: number;
    height?: number;
    text?: string;
    anchors?: AnchorSpec[];
  }): void {
    if (!/^[A-Za-z_][\w.-]*$/.test(args.type)) throw new Error("Invalid frame type");
    if (!/^[A-Za-z_][\w./-]*$/.test(args.name)) throw new Error("Invalid frame name");
    if (args.name.includes("/") && !args.frameFile) throw new Error("Frame names containing '/' require frameFile (SC2 cross-file descriptor override)");
    const parent = args.parentPath ? this.resolveFrame(args.parentPath) : undefined;
    if (this.directFrameByName(parent, args.name)) throw new Error(`Sibling frame '${args.name}' already exists`);

    const { offset, indent } = this.insertionPoint(parent);
    const unit = inferIndentUnit(this.sourceText);
    const nl = newlineOf(this.sourceText);
    const attrs = [`type="${xmlEscape(args.type)}"`, `name="${xmlEscape(args.name)}"`];
    if (args.template) attrs.push(`template="${xmlEscape(args.template)}"`);
    if (args.frameFile) attrs.push(`file="${xmlEscape(args.frameFile)}"`);
    const lines = [`${indent}<Frame ${attrs.join(" ")}>`];
    for (const property of args.properties ?? []) {
      lines.push(renderElement(property, indent + unit, unit, nl));
    }
    if (args.width !== undefined) lines.push(`${indent}${unit}<Width val="${args.width}"/>`);
    if (args.height !== undefined) lines.push(`${indent}${unit}<Height val="${args.height}"/>`);
    if (args.text !== undefined) lines.push(`${indent}${unit}<Text val="${xmlEscape(args.text)}"/>`);
    for (const a of args.anchors ?? []) {
      if (!ANCHOR_SIDES.has(a.side)) throw new Error(`Invalid anchor side: ${a.side}`);
      const aa = [`side="${a.side}"`, `relative="${xmlEscape(a.relative)}"`];
      if (a.pos !== undefined) aa.push(`pos="${xmlEscape(String(a.pos))}"`);
      if (a.offset !== undefined) aa.push(`offset="${a.offset}"`);
      lines.push(`${indent}${unit}<Anchor ${aa.join(" ")}/>`);
    }
    lines.push(`${indent}</Frame>`);
    const insertion = lines.join(nl) + nl;
    this.rebuild(this.sourceText.slice(0, offset) + insertion + this.sourceText.slice(offset));
  }

  createButton(args: {
    parentPath?: string;
    name: string;
    text: string;
    width?: number;
    height?: number;
    template?: string;
    anchors?: AnchorSpec[];
  }): void {
    this.createFrame({ ...args, type: "Button" });
  }

  createClippedImage(args: ClippedImageSpec): void {
    const imageName = args.imageName ?? "Image";
    this.createFrame({
      parentPath: args.parentPath,
      type: "Frame",
      name: args.name,
      width: args.viewportWidth,
      height: args.viewportHeight,
    });
    const parent = args.parentPath ? `${args.parentPath}/${encodePathSegment(args.name)}` : encodePathSegment(args.name);
    const layer = args.layer ?? args.textureCoords?.layer ?? 0;
    const properties: ElementSpec[] = [
      { tag: "Unclipped", value: false },
      { tag: "Texture", attrs: { val: args.texture, layer } },
    ];
    if (args.textureType) properties.push({ tag: "TextureType", attrs: { val: args.textureType, layer } });
    if (args.textureCoords) {
      properties.push({
        tag: "TextureCoords",
        attrs: {
          top: args.textureCoords.top,
          left: args.textureCoords.left,
          bottom: args.textureCoords.bottom,
          right: args.textureCoords.right,
          layer: args.textureCoords.layer ?? layer,
        },
      });
    }
    this.createFrame({
      parentPath: parent,
      type: "Image",
      name: imageName,
      width: args.imageWidth,
      height: args.imageHeight,
      anchors: [
        { side: "Top", relative: "$parent", pos: "Min", offset: args.offsetY ?? 0 },
        { side: "Left", relative: "$parent", pos: "Min", offset: args.offsetX ?? 0 },
      ],
      properties,
    });
  }

  private selectChildren(node: XmlNode, tag: string, selector: PropertySelector = {}): XmlNode[] {
    const wanted: Record<string, ScalarValue> = { ...(selector.attrs ?? {}) };
    if (selector.index !== undefined) wanted.index = selector.index;
    if (selector.layer !== undefined) wanted.layer = selector.layer;
    let matches = directChildren(this.parsed, node)
      .filter((child) => child.tag.toLowerCase() === tag.toLowerCase())
      .filter((child) => Object.entries(wanted).every(([name, value]) => child.attrs[name] === scalarText(value)));
    if (selector.occurrence !== undefined) matches = matches.slice(selector.occurrence, selector.occurrence + 1);
    return matches;
  }

  private patchAttributes(node: XmlNode, attrs: Record<string, ScalarValue>): void {
    const patches: Array<{ start: number; end: number; text: string }> = [];
    const additions: Array<[string, ScalarValue]> = [];
    for (const [name, value] of Object.entries(attrs)) {
      const span = node.attrSpans.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      if (span) patches.push({ start: span.valueStart, end: span.valueEnd, text: xmlEscape(scalarText(value)) });
      else additions.push([name, value]);
    }
    if (additions.length) {
      const raw = this.sourceText.slice(node.start, node.startTagEnd);
      const local = raw.lastIndexOf("/>") >= 0 ? raw.lastIndexOf("/>") : raw.lastIndexOf(">");
      const offset = node.start + local;
      patches.push({
        start: offset,
        end: offset,
        text: additions.map(([name, value]) => ` ${name}="${xmlEscape(scalarText(value))}"`).join(""),
      });
    }
    let next = this.sourceText;
    for (const patch of patches.sort((a, b) => b.start - a.start)) {
      next = next.slice(0, patch.start) + patch.text + next.slice(patch.end);
    }
    this.rebuild(next);
  }

  private insertElement(node: XmlNode, spec: ElementSpec, before?: XmlNode): void {
    if (node.selfClosing || node.endTagStart < 0) throw new Error(`Cannot insert into <${node.tag}>`);
    const nl = newlineOf(this.sourceText);
    const unit = inferIndentUnit(this.sourceText);
    const offset = before ? lineStart(this.sourceText, before.start) : lineStart(this.sourceText, node.endTagStart);
    const indent = before
      ? indentAt(this.sourceText, before.start)
      : indentAt(this.sourceText, node.start) + unit;
    const insertion = renderElement(spec, indent, unit, nl) + nl;
    this.rebuild(this.sourceText.slice(0, offset) + insertion + this.sourceText.slice(offset));
  }

  private replaceNode(node: XmlNode, spec: ElementSpec): void {
    const nl = newlineOf(this.sourceText);
    const unit = inferIndentUnit(this.sourceText);
    const start = lineStart(this.sourceText, node.start);
    const end = lineEndIncludingNewline(this.sourceText, node.end);
    const prefix = this.sourceText.slice(start, node.start);
    const suffix = this.sourceText.slice(node.end, end).replace(/\r?\n$/, "");
    if (/^[\t ]*$/.test(prefix) && /^[\t ]*$/.test(suffix)) {
      const replacement = renderElement(spec, prefix, unit, nl) + (end > node.end ? nl : "");
      this.rebuild(this.sourceText.slice(0, start) + replacement + this.sourceText.slice(end));
    } else {
      this.rebuild(this.sourceText.slice(0, node.start) + renderElement(spec, "", unit, nl) + this.sourceText.slice(node.end));
    }
  }

  private deleteNode(node: XmlNode): void {
    const startLineOffset = lineStart(this.sourceText, node.start);
    const endLineOffset = lineEndIncludingNewline(this.sourceText, node.end);
    const prefix = this.sourceText.slice(startLineOffset, node.start);
    const suffix = this.sourceText.slice(node.end, endLineOffset).replace(/\r?\n$/, "");
    const wholeLine = /^[\t ]*$/.test(prefix) && /^[\t ]*$/.test(suffix);
    const start = wholeLine ? startLineOffset : node.start;
    const end = wholeLine ? endLineOffset : node.end;
    this.rebuild(this.sourceText.slice(0, start) + this.sourceText.slice(end));
  }

  setSimpleProperty(path: string, property: string, value: string | number | boolean): void {
    this.setProperty(path, property, { value });
  }

  getProperty(path: string, property: string, selector: PropertySelector = {}): ElementDetails[] {
    return this.selectChildren(this.resolveFrame(path), property, selector)
      .map((node) => this.elementDetails(node));
  }

  setProperty(path: string, property: string, args: {
    value?: ScalarValue;
    attrs?: Record<string, ScalarValue>;
    selector?: PropertySelector;
    children?: ElementSpec[];
    replace?: boolean;
  }): void {
    if (!/^[A-Za-z_][\w.-]*$/.test(property)) throw new Error("Invalid property name");
    if (STRUCTURAL_CHILDREN.has(property)) throw new Error(`Use the dedicated operation for ${property}`);
    const frame = this.resolveFrame(path);
    const selector = args.selector ?? {};
    const matches = this.selectChildren(frame, property, selector);
    if (matches.length > 1) {
      throw new Error(`Property '${property}' is ambiguous; select index/layer/attrs/occurrence`);
    }
    const attrs: Record<string, ScalarValue> = { ...(args.attrs ?? {}) };
    if (args.value !== undefined) attrs.val = args.value;
    if (selector.index !== undefined && attrs.index === undefined) attrs.index = selector.index;
    if (selector.layer !== undefined && attrs.layer === undefined) attrs.layer = selector.layer;
    for (const [name, value] of Object.entries(selector.attrs ?? {})) {
      if (attrs[name] === undefined) attrs[name] = value;
    }
    if (matches.length) {
      if (args.replace || args.children) {
        this.replaceNode(matches[0], {
          tag: matches[0].tag,
          attrs: { ...matches[0].attrs, ...attrs },
          children: args.children,
        });
      } else {
        this.patchAttributes(matches[0], attrs);
      }
      return;
    }
    const before = directChildren(this.parsed, frame).find((child) => STRUCTURAL_CHILDREN.has(child.tag));
    this.insertElement(frame, { tag: property, attrs, children: args.children }, before);
  }

  removeProperty(path: string, property: string, selector: PropertySelector = {}): void {
    const matches = this.selectChildren(this.resolveFrame(path), property, selector);
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one '${property}' occurrence; found ${matches.length}`);
    }
    this.deleteNode(matches[0]);
  }

  setAnchor(path: string, anchor: AnchorSpec): void {
    if (anchor.side !== "All" && !ANCHOR_SIDES.has(anchor.side)) throw new Error(`Invalid anchor side: ${anchor.side}`);
    const node = this.resolveFrame(path);
    const anchors = directChildren(this.parsed, node, "Anchor");
    const existing = anchors.find((item) => anchor.side === "All" ? !item.attrs.side : item.attrs.side === anchor.side);
    const attrs: Record<string, ScalarValue> = { relative: anchor.relative };
    if (anchor.side !== "All") attrs.side = anchor.side;
    if (anchor.pos !== undefined) attrs.pos = anchor.pos;
    if (anchor.offset !== undefined) attrs.offset = anchor.offset;
    if (existing) {
      this.patchAttributes(existing, attrs);
      return;
    }
    this.insertElement(node, { tag: "Anchor", attrs }, this.frameChildren(node)[0]);
  }

  cloneFrame(sourcePath: string, args: { parentPath?: string; name: string }): void {
    if (!/^[A-Za-z_][\w.-]*$/.test(args.name)) throw new Error("Invalid frame name");
    const sourceNode = this.resolveFrame(sourcePath);
    const sourceParent = sourceNode.parentId === null ? this.descNode() : this.parsed.nodes[sourceNode.parentId];
    const host = args.parentPath ? this.resolveFrame(args.parentPath) : sourceParent;
    const siblingParent = host.tag === "Frame" ? host : undefined;
    if (this.directFrameByName(siblingParent, args.name)) throw new Error(`Sibling frame '${args.name}' already exists`);
    const nameSpan = sourceNode.attrSpans.find((span) => span.name === "name");
    if (!nameSpan) throw new Error("Source frame has no name attribute");
    let fragment = this.sourceText.slice(sourceNode.start, sourceNode.end);
    const localStart = nameSpan.valueStart - sourceNode.start;
    const localEnd = nameSpan.valueEnd - sourceNode.start;
    fragment = fragment.slice(0, localStart) + xmlEscape(args.name) + fragment.slice(localEnd);
    const point = this.insertionPoint(host);
    const sourceIndent = indentAt(this.sourceText, sourceNode.start);
    const nl = newlineOf(this.sourceText);
    const lines = fragment.split(/\r?\n/).map((line, index) => {
      const relative = index > 0 && line.startsWith(sourceIndent) ? line.slice(sourceIndent.length) : line;
      return point.indent + relative;
    });
    const insertion = lines.join(nl) + nl;
    this.rebuild(this.sourceText.slice(0, point.offset) + insertion + this.sourceText.slice(point.offset));
  }

  applyTemplate(path: string, template: string): void {
    if (!template.trim()) throw new Error("Template reference cannot be empty");
    this.patchAttributes(this.resolveFrame(path), { template });
  }

  private namedDescriptor(framePath: string, tag: "StateGroup" | "Animation", name: string): XmlNode | undefined {
    const frame = this.resolveFrame(framePath);
    return directChildren(this.parsed, frame, tag).find((node) => node.attrs.name === name);
  }

  getStateGroup(framePath: string, name: string): ElementDetails | undefined {
    const node = this.namedDescriptor(framePath, "StateGroup", name);
    return node ? this.elementDetails(node) : undefined;
  }

  upsertStateGroup(framePath: string, spec: StateGroupSpec): void {
    if (!spec.name.trim()) throw new Error("StateGroup name is required");
    const groupChildren: ElementSpec[] = [];
    if (spec.defaultState !== undefined) {
      groupChildren.push({ tag: "DefaultState", value: spec.defaultState });
    }
    for (const state of spec.states ?? []) {
      const stateChildren: ElementSpec[] = [];
      for (const when of state.when ?? []) {
        stateChildren.push({
          tag: "When",
          attrs: {
            type: when.type,
            ...(when.frame ? { frame: when.frame } : {}),
            ...(when.operator ? { operator: when.operator } : {}),
            ...(when.attrs ?? {}),
          },
        });
      }
      for (const action of state.actions ?? []) {
        stateChildren.push({
          tag: "Action",
          attrs: {
            type: action.type,
            ...(action.frame ? { frame: action.frame } : {}),
            ...(action.on ? { on: action.on } : {}),
            ...(action.undo !== undefined ? { undo: action.undo } : {}),
            ...(action.attrs ?? {}),
          },
        });
      }
      groupChildren.push({ tag: "State", attrs: { name: state.name }, children: stateChildren });
    }
    const stateGroup: ElementSpec = {
      tag: "StateGroup",
      attrs: {
        name: spec.name,
        ...(spec.template ? { template: spec.template } : {}),
        ...(spec.file ? { file: spec.file } : {}),
        ...(spec.log !== undefined ? { log: spec.log } : {}),
      },
      children: groupChildren,
    };
    const existing = this.namedDescriptor(framePath, "StateGroup", spec.name);
    if (existing) {
      this.replaceNode(existing, stateGroup);
      return;
    }
    const frame = this.resolveFrame(framePath);
    this.insertElement(frame, stateGroup, this.frameChildren(frame)[0]);
  }

  getAnimation(framePath: string, name: string): ElementDetails | undefined {
    const node = this.namedDescriptor(framePath, "Animation", name);
    return node ? this.elementDetails(node) : undefined;
  }

  upsertAnimation(framePath: string, spec: AnimationSpec): void {
    if (!spec.name.trim()) throw new Error("Animation name is required");
    const animationChildren: ElementSpec[] = [];
    for (const event of spec.events ?? []) {
      animationChildren.push({
        tag: "Event",
        attrs: {
          event: event.event,
          ...(event.action ? { action: event.action } : {}),
          ...(event.frame ? { frame: event.frame } : {}),
        },
      });
    }
    for (const driver of spec.drivers ?? []) {
      animationChildren.push({
        tag: "Driver",
        attrs: { type: driver.type, ...(driver.attrs ?? {}) },
      });
    }
    for (const controller of spec.controllers ?? []) {
      const keys: ElementSpec[] = (controller.keys ?? []).map((key) => ({
        tag: "Key",
        attrs: {
          type: key.type,
          ...(key.time !== undefined ? { time: key.time } : {}),
          ...(key.attrs ?? {}),
        },
      }));
      animationChildren.push({
        tag: "Controller",
        attrs: {
          type: controller.type,
          ...(controller.name ? { name: controller.name } : {}),
          ...(controller.frame ? { frame: controller.frame } : {}),
          ...(controller.end ? { end: controller.end } : {}),
          ...(controller.attrs ?? {}),
        },
        children: keys,
      });
    }
    const animation: ElementSpec = {
      tag: "Animation",
      attrs: {
        name: spec.name,
        ...(spec.template ? { template: spec.template } : {}),
        ...(spec.file ? { file: spec.file } : {}),
        ...(spec.speed !== undefined ? { speed: spec.speed } : {}),
        ...(spec.flags ? { flags: spec.flags } : {}),
      },
      children: animationChildren,
    };
    const existing = this.namedDescriptor(framePath, "Animation", spec.name);
    if (existing) {
      this.replaceNode(existing, animation);
      return;
    }
    const frame = this.resolveFrame(framePath);
    this.insertElement(frame, animation, this.frameChildren(frame)[0]);
  }

  deleteFrame(path: string): void {
    this.deleteNode(this.resolveFrame(path));
  }

  validateBasic(): { errors: string[]; warnings: string[] } {
    const errors = this.parsed.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.offset}: ${d.message}`);
    const warnings = this.parsed.diagnostics.filter((d) => d.severity === "warning").map((d) => `${d.offset}: ${d.message}`);

    try {
      this.descNode();
    } catch (e) {
      errors.push((e as Error).message);
    }

    const siblingCheck = (frames: XmlNode[], parentPath: string) => {
      const seen = new Set<string>();
      for (const f of frames) {
        const name = f.attrs.name;
        const type = f.attrs.type;
        if (!name) errors.push(`Frame under '${parentPath || "<Desc>"}' is missing name`);
        if (!type) warnings.push(`Frame '${name || "<unnamed>"}' is missing type; engine/default behavior may apply`);
        if (name && seen.has(name)) warnings.push(`Duplicate sibling frame name '${name}' under '${parentPath || "<Desc>"}'`);
        if (name) seen.add(name);
        const childPath = parentPath ? `${parentPath}/${name ?? "<unnamed>"}` : name ?? "<unnamed>";
        siblingCheck(this.frameChildren(f), childPath);
      }
    };
    siblingCheck(this.topFrames(), "");

    return { errors, warnings };
  }
}
