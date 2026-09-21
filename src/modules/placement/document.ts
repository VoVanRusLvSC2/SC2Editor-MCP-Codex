import { createHash } from "node:crypto";
import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import type {
  PlacementMutation,
  PlacementObject,
  PlacementValidationIssue,
} from "./types.js";

const MAX_ID = 2_147_483_647;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("'", "&apos;");
}
function numberText(value: number): string {
  if (!Number.isFinite(value))
    throw new Error(`Placement number must be finite; got ${value}`);
  const normalized = Object.is(value, -0) ? 0 : value;
  return Number.isInteger(normalized)
    ? String(normalized)
    : String(Number(normalized.toFixed(6)));
}
function positionText(position: PlacementObject["position"]): string {
  return `${numberText(position.x)},${numberText(position.y)},${numberText(position.z)}`;
}
function scaleText(scale: NonNullable<PlacementObject["scale"]>): string {
  return `${numberText(scale.x)},${numberText(scale.y)},${numberText(scale.z)}`;
}
function newlineOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}
function indentAt(source: string, offset: number): string {
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return source.slice(start, offset).match(/^\s*/)?.[0] ?? "";
}

export interface PlacedObjectRecord {
  nodeId: number;
  kind: string;
  id?: number;
  catalogId?: string;
  position?: string;
  rotation?: string;
  scale?: string;
  variation?: string;
  attributes: Record<string, string>;
  flags: Record<string, string>;
}

export class PlacementDocument {
  private parsed = scanXml("");
  constructor(
    public source: string,
    readonly sourceFile = "Objects",
  ) {
    this.reparse();
  }

  static create(sourceFile = "Objects"): PlacementDocument {
    return new PlacementDocument(
      `<?xml version="1.0" encoding="utf-8"?>\r\n<PlacedObjects Version="27">\r\n</PlacedObjects>`,
      sourceFile,
    );
  }

  get sha256(): string {
    return createHash("sha256").update(this.source, "utf8").digest("hex");
  }
  get diagnostics() {
    return this.parsed.diagnostics;
  }
  private reparse(): void {
    this.parsed = scanXml(this.source);
  }
  private replace(start: number, end: number, text: string): void {
    this.source = this.source.slice(0, start) + text + this.source.slice(end);
    this.reparse();
  }
  private root(): XmlNode {
    const root = this.parsed.rootIds
      .map((id) => this.parsed.nodes[id])
      .find((node) => node.tag === "PlacedObjects");
    if (!root)
      throw new Error(`${this.sourceFile} must have a <PlacedObjects> root`);
    if (this.parsed.diagnostics.some((entry) => entry.severity === "error"))
      throw new Error(`${this.sourceFile} contains malformed XML`);
    return root;
  }
  private children(node: XmlNode): XmlNode[] {
    return node.childIds.map((id) => this.parsed.nodes[id]);
  }

  list(): PlacedObjectRecord[] {
    const root = this.root();
    return this.children(root).map((node) => {
      const id = /^\d+$/.test(node.attrs.Id ?? "")
        ? Number(node.attrs.Id)
        : NaN;
      const flags: Record<string, string> = {};
      for (const child of this.children(node).filter(
        (entry) => entry.tag === "Flag",
      ))
        if (child.attrs.Index)
          flags[child.attrs.Index] = child.attrs.Value ?? "";
      return {
        nodeId: node.id,
        kind: node.tag,
        ...(Number.isSafeInteger(id) ? { id } : {}),
        ...((node.attrs.UnitType ?? node.attrs.Type)
          ? { catalogId: node.attrs.UnitType ?? node.attrs.Type }
          : {}),
        ...(node.attrs.Position ? { position: node.attrs.Position } : {}),
        ...(node.attrs.Rotation ? { rotation: node.attrs.Rotation } : {}),
        ...(node.attrs.Scale ? { scale: node.attrs.Scale } : {}),
        ...(node.attrs.Variation ? { variation: node.attrs.Variation } : {}),
        attributes: { ...node.attrs },
        flags,
      };
    });
  }

  private append(rendered: string): void {
    const root = this.root();
    const newline = newlineOf(this.source);
    const rootIndent = indentAt(this.source, root.start);
    const childIndent = `${rootIndent}    `;
    const indented = rendered
      .split(/\r?\n/)
      .map((line) => `${childIndent}${line}`)
      .join(newline);
    if (root.selfClosing) {
      const opening = this.source
        .slice(root.start, root.startTagEnd)
        .replace(/\/\s*>$/, ">");
      this.replace(
        root.start,
        root.end,
        `${opening}${newline}${indented}${newline}${rootIndent}</PlacedObjects>`,
      );
      return;
    }
    const closingLineStart =
      this.source.lastIndexOf("\n", Math.max(0, root.endTagStart - 1)) + 1;
    if (/^[ \t]*$/.test(this.source.slice(closingLineStart, root.endTagStart)))
      this.replace(
        closingLineStart,
        root.endTagStart,
        `${indented}${newline}${rootIndent}`,
      );
    else
      this.replace(
        root.endTagStart,
        root.endTagStart,
        `${newline}${indented}${newline}${rootIndent}`,
      );
  }

  private renderObject(object: PlacementObject, id: number): string {
    if (!object.catalogId)
      throw new Error("A Unit or Doodad catalog id is required");
    if (
      object.owner !== undefined &&
      (!Number.isInteger(object.owner) || object.owner < 0 || object.owner > 15)
    )
      throw new Error("Player must be an integer in 0..15");
    if (
      object.variation !== undefined &&
      (!Number.isInteger(object.variation) || object.variation < 0)
    )
      throw new Error("Variation must be a nonnegative integer");
    if (
      object.scale &&
      Object.values(object.scale).some(
        (value) => !Number.isFinite(value) || value <= 0,
      )
    )
      throw new Error("Scale components must be finite and positive");
    if (object.customAttributes && Object.keys(object.customAttributes).length)
      throw new Error(
        "Creating unproven custom attributes is disabled; existing attributes are preserved",
      );
    for (const [flag, value] of Object.entries(object.flags ?? {}))
      if (flag !== "HeightAbsolute" || !["0", "1"].includes(value))
        throw new Error(
          `Unproven placement flag ${flag}=${value}; only observed HeightAbsolute 0/1 is writable`,
        );

    const kind = object.kind === "Unit" ? "ObjectUnit" : "ObjectDoodad";
    const attrs = [
      `Id="${id}"`,
      `Position="${escapeXml(positionText(object.position))}"`,
    ];
    if (object.rotation !== undefined)
      attrs.push(`Rotation="${escapeXml(numberText(object.rotation))}"`);
    if (object.scale)
      attrs.push(`Scale="${escapeXml(scaleText(object.scale))}"`);
    if (object.variation !== undefined)
      attrs.push(`Variation="${escapeXml(numberText(object.variation))}"`);
    attrs.push(
      `${object.kind === "Unit" ? "UnitType" : "Type"}="${escapeXml(object.catalogId)}"`,
    );
    if (object.kind === "Unit" && object.owner !== undefined)
      attrs.push(`Player="${escapeXml(numberText(object.owner))}"`);
    for (const [name, value] of Object.entries(object.customAttributes ?? {})) {
      if (
        !/^[A-Za-z_][\w:.-]*$/.test(name) ||
        [
          "Id",
          "Position",
          "Rotation",
          "Scale",
          "Variation",
          "UnitType",
          "Type",
          "Player",
        ].includes(name)
      )
        throw new Error(
          `Unsupported or reserved placement attribute '${name}'`,
        );
      attrs.push(`${name}="${escapeXml(value)}"`);
    }
    const flags = Object.entries(object.flags ?? {});
    const newline = newlineOf(this.source);
    const rendered = flags.length
      ? [
          `<${kind} ${attrs.join(" ")}>`,
          ...flags.map(
            ([index, value]) =>
              `    <Flag Index="${escapeXml(index)}" Value="${escapeXml(value)}"/>`,
          ),
          `</${kind}>`,
        ].join(newline)
      : `<${kind} ${attrs.join(" ")}/>`;
    return rendered;
  }

  add(object: PlacementObject): number {
    return this.addMany([object])[0]!;
  }

  /** Allocate IDs once and append a consecutive add run with one XML reparse. */
  addMany(objects: PlacementObject[]): number[] {
    if (!objects.length) return [];
    const used = new Set(
      this.list().flatMap((entry) =>
        entry.id === undefined ? [] : [entry.id],
      ),
    );
    let next = 1;
    for (const id of used) next = Math.max(next, id + 1);
    let free = 1;
    const ids: number[] = [];
    const fragments: string[] = [];
    for (const object of objects) {
      if (next > MAX_ID) while (used.has(free) && free <= MAX_ID) free++;
      const id = object.objectId ?? (next <= MAX_ID ? next : free);
      if (!Number.isInteger(id) || id < 1 || id > MAX_ID)
        throw new Error(`Invalid placement object ID ${id}`);
      if (used.has(id)) throw new Error(`Duplicate placement object ID ${id}`);
      fragments.push(this.renderObject(object, id));
      used.add(id);
      next = Math.max(next, id + 1);
      ids.push(id);
    }
    this.append(fragments.join(newlineOf(this.source)));
    return ids;
  }

  private objectNode(id: number): XmlNode {
    const root = this.root();
    const node = this.children(root).find(
      (entry) =>
        /^\d+$/.test(entry.attrs.Id ?? "") && Number(entry.attrs.Id) === id,
    );
    if (!node) throw new Error(`Placement object ${id} not found`);
    return node;
  }

  private setAttribute(id: number, name: string, value: string): void {
    const node = this.objectNode(id);
    const span = node.attrSpans.find((entry) => entry.name === name);
    const encoded = escapeXml(value);
    if (span) {
      if (this.source.slice(span.valueStart, span.valueEnd) !== encoded)
        this.replace(span.valueStart, span.valueEnd, encoded);
      return;
    }
    const offset = node.startTagEnd - (node.selfClosing ? 2 : 1);
    this.replace(offset, offset, ` ${name}="${encoded}"`);
  }

  addPoint(spec:{name:string;position:PlacementObject["position"];type?:"Normal"|"StartLoc";objectId?:number}):number {
    if(this.root().attrs.Version!=="27")throw new Error("POINT_WRITER_VERSION_UNSUPPORTED");
    if(!spec.name || [...spec.name].some(c=>c.charCodeAt(0)<32))throw new Error("INVALID_POINT_NAME");
    const used=new Set(this.list().flatMap(p=>p.id===undefined?[]:[p.id]));
    let next=1;for(const usedId of used)next=Math.max(next,usedId+1);
    const id=spec.objectId ?? next;
    if(!Number.isInteger(id)||id<1||id>MAX_ID||used.has(id))throw new Error("INVALID_OR_DUPLICATE_POINT_ID");
    this.append(`<ObjectPoint Id="${id}" Position="${positionText(spec.position)}" Scale="1,1,1" Type="${spec.type??"Normal"}" Name="${escapeXml(spec.name)}" Color="0,0,0,0"/>`);
    return id;
  }
  updatePoint(id:number,spec:{name?:string;position?:PlacementObject["position"];type?:"Normal"|"StartLoc"}):void {
    if(this.root().attrs.Version!=="27")throw new Error("POINT_WRITER_VERSION_UNSUPPORTED");
    if(this.objectNode(id).tag!=="ObjectPoint")throw new Error("POINT_OBJECT_REQUIRED");
    if(spec.name!==undefined){if(!spec.name || [...spec.name].some(c=>c.charCodeAt(0)<32))throw new Error("INVALID_POINT_NAME");this.setAttribute(id,"Name",spec.name);}
    if(spec.position)this.move(id,spec.position);
    if(spec.type)this.setAttribute(id,"Type",spec.type);
  }
  removePoint(id:number):void {if(this.root().attrs.Version!=="27")throw new Error("POINT_WRITER_VERSION_UNSUPPORTED");if(this.objectNode(id).tag!=="ObjectPoint")throw new Error("POINT_OBJECT_REQUIRED");this.remove(id);}

  move(id: number, position: PlacementObject["position"]): void {
    this.setAttribute(id, "Position", positionText(position));
  }
  setHeightAbsolute(id: number, value: boolean): void {
    const node = this.objectNode(id);
    if (node.tag !== "ObjectDoodad")
      throw new Error("HeightAbsolute flag is supported only for Doodads");
    const flags = this.children(node).filter(
      (n) => n.tag === "Flag" && n.attrs.Index === "HeightAbsolute",
    );
    if (flags.length > 1) throw new Error("Duplicate HeightAbsolute flags");
    const encoded = value ? "1" : "0";
    if (flags.length) {
      const flag = flags[0],
        span = flag.attrSpans.find((a) => a.name === "Value");
      if (!span) throw new Error("HeightAbsolute flag has no Value");
      this.replace(span.valueStart, span.valueEnd, encoded);
      return;
    }
    const newline = newlineOf(this.source),
      indent = indentAt(this.source, node.start);
    const rendered = `${indent}    <Flag Index="HeightAbsolute" Value="${encoded}"/>`;
    if (node.selfClosing) {
      const opening = this.source
        .slice(node.start, node.startTagEnd)
        .replace(/\/\s*>$/, ">");
      this.replace(
        node.start,
        node.end,
        `${opening}${newline}${rendered}${newline}${indent}</ObjectDoodad>`,
      );
    } else
      this.replace(
        node.endTagStart,
        node.endTagStart,
        `${newline}${rendered}${newline}${indent}`,
      );
  }
  rotate(id: number, rotation: number): void {
    this.setAttribute(id, "Rotation", numberText(rotation));
  }
  scale(id: number, scale: NonNullable<PlacementObject["scale"]>): void {
    if (Object.values(scale).some((value) => value <= 0))
      throw new Error("Scale must be positive");
    this.setAttribute(id, "Scale", scaleText(scale));
  }

  remove(id: number): void {
    const node = this.objectNode(id);
    const newline = newlineOf(this.source);
    let start = node.start;
    let end = node.end;
    if (this.source.slice(end, end + newline.length) === newline)
      end += newline.length;
    else {
      const lineStart =
        this.source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      if (/^\s*$/.test(this.source.slice(lineStart, start))) start = lineStart;
    }
    this.replace(start, end, "");
  }

  apply(
    operations: PlacementMutation[],
  ): Array<{ index: number; op: string; objectId: number }> {
    const result: Array<{ index: number; op: string; objectId: number }> = [];
    for (let index = 0; index < operations.length; ) {
      const operation = operations[index]!;
      if (operation.op === "add") {
        const objects: PlacementObject[] = [];
        const start = index;
        while (index < operations.length && operations[index]!.op === "add") {
          objects.push(
            (operations[index]! as Extract<PlacementMutation, { op: "add" }>)
              .object,
          );
          index++;
        }
        for (const [offset, objectId] of this.addMany(objects).entries())
          result.push({ index: start + offset, op: "add", objectId });
        continue;
      }
      switch (operation.op) {
        case "move":
          this.move(operation.objectId, operation.position);
          break;
        case "rotate":
          this.rotate(operation.objectId, operation.rotation);
          break;
        case "scale":
          this.scale(operation.objectId, operation.scale);
          break;
        case "setHeightAbsolute":
          this.setHeightAbsolute(operation.objectId, operation.value);
          break;
        case "remove":
          this.remove(operation.objectId);
          break;
      }
      result.push({ index, op: operation.op, objectId: operation.objectId });
      index++;
    }
    return result;
  }

  validate(): PlacementValidationIssue[] {
    const issues: PlacementValidationIssue[] = this.diagnostics
      .filter((entry) => entry.severity === "error")
      .map((entry) => ({
        severity: "error",
        code: "MALFORMED_XML",
        message: entry.message,
      }));
    if (issues.length) return issues;
    if (
      !this.parsed.rootIds.some(
        (id) => this.parsed.nodes[id]!.tag === "PlacedObjects",
      )
    )
      return [
        {
          severity: "error",
          code: "MALFORMED_XML",
          message: "Expected PlacedObjects root",
        },
      ];
    const ids = new Map<number, number>();
    for (const object of this.list()) {
      if (!object.kind.startsWith("Object")) continue;
      if (object.id === undefined)
        issues.push({
          severity: "error",
          code: "MISSING_OBJECT_ID",
          message: `${object.kind} has no numeric Id`,
        });
      else {
        ids.set(object.id, (ids.get(object.id) ?? 0) + 1);
        if (object.id < 1 || object.id > MAX_ID)
          issues.push({
            severity: "error",
            code: "INVALID_OBJECT_ID",
            message: `Id ${object.id} outside positive signed32 range`,
          });
      }
      const placeable = ["ObjectUnit", "ObjectDoodad"].includes(object.kind);
      if (placeable && !object.position)
        issues.push({
          severity: "error",
          code: "INVALID_POSITION",
          message: `${object.kind} ${object.id} has no Position`,
        });
      if (
        object.rotation !== undefined &&
        (object.rotation.trim() === "" ||
          !Number.isFinite(Number(object.rotation)))
      )
        issues.push({
          severity: "error",
          code: "INVALID_ROTATION",
          message: `Invalid Rotation '${object.rotation}'`,
        });
      if (
        ["ObjectUnit", "ObjectDoodad"].includes(object.kind) &&
        !object.catalogId
      )
        issues.push({
          severity: "error",
          code: "MISSING_CATALOG_ID",
          message: `${object.kind} ${object.id ?? "?"} has no ${object.kind === "ObjectUnit" ? "UnitType" : "Type"}`,
          ...(object.id !== undefined ? { objectId: object.id } : {}),
        });
      if (
        object.position &&
        (!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(
          object.position,
        ) ||
          object.position
            .split(",")
            .some((value) => !Number.isFinite(Number(value))))
      )
        issues.push({
          severity: "error",
          code: "INVALID_POSITION",
          message: `Invalid Position '${object.position}'`,
          ...(object.id !== undefined ? { objectId: object.id } : {}),
        });
      if (
        object.scale &&
        (object.scale.split(",").length !== 3 ||
          object.scale
            .split(",")
            .some(
              (value) => !Number.isFinite(Number(value)) || Number(value) <= 0,
            ))
      )
        issues.push({
          severity: "error",
          code: "INVALID_SCALE",
          message: `Invalid Scale '${object.scale}'`,
          ...(object.id !== undefined ? { objectId: object.id } : {}),
        });
    }
    for (const [id, count] of ids)
      if (count > 1)
        issues.push({
          severity: "error",
          code: "DUPLICATE_OBJECT_ID",
          message: `Object Id ${id} occurs ${count} times`,
          objectId: id,
        });
    return issues;
  }
}

export function componentListWithObjects(source: string): string {
  const initial =
    source ||
    `<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n</Components>`;
  const parsed = scanXml(initial);
  const root = parsed.rootIds
    .map((id) => parsed.nodes[id])
    .find((node) => node.tag === "Components");
  if (parsed.diagnostics.some((issue) => issue.severity === "error"))
    throw new Error("Malformed ComponentList.SC2Components");
  if (!root)
    throw new Error(
      "ComponentList.SC2Components must have a <Components> root",
    );
  if (
    root.childIds
      .map((id) => parsed.nodes[id])
      .some(
        (node) =>
          node.tag === "DataComponent" &&
          node.attrs.Type?.toLowerCase() === "plob",
      )
  )
    return initial;
  const newline = newlineOf(initial);
  const rendered = `    <DataComponent Type="plob">Objects</DataComponent>`;
  if (root.selfClosing)
    return (
      initial.slice(0, root.start) +
      initial
        .slice(root.start, root.startTagEnd)
        .replace(/\/\s*>$/, `>${newline}${rendered}${newline}</Components>`) +
      initial.slice(root.end)
    );
  return (
    initial.slice(0, root.endTagStart) +
    `${newline}${rendered}${newline}` +
    initial.slice(root.endTagStart)
  );
}
