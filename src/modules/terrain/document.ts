import { scanXml } from "../../core/xmlScanner.js";
import type { XmlNode } from "../../core/types.js";
import { waterName } from "./waterCatalog.js";
import type { Point2, TerrainArea } from "./types.js";

function gridSize(w: number, h: number): number {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 2 ||
    h < 2 ||
    w > 2049 ||
    h > 2049
  )
    throw new Error("INVALID_TERRAIN_DIMENSIONS");
  return w * h;
}
function numbers(value: string | undefined, count: number): number[] {
  const n = (value ?? "").trim().split(/\s+/).map(Number);
  if (n.length !== count || n.some((v) => !Number.isFinite(v)))
    throw new Error("INVALID_TERRAIN_XML_VECTOR");
  return n;
}
function header(
  bytes: Buffer,
  magic: string,
  version: number,
  min: number,
): void {
  if (bytes.length < min || bytes.toString("ascii", 0, 4) !== magic)
    throw new Error(`INVALID_${magic}_HEADER`);
  if (bytes.readUInt32LE(4) !== version)
    throw new Error(`UNSUPPORTED_${magic}_VERSION: ${bytes.readUInt32LE(4)}`);
}
export class TerrainDescriptor {
  readonly parsed;
  readonly heightMap: XmlNode;
  readonly vert: XmlNode;
  readonly width: number;
  readonly height: number;
  readonly offset: number[];
  readonly scale: number[];
  readonly quantizeBias: number;
  readonly quantizeScale: number;
  readonly version: number;
  private textureCache?: Array<{ slot: number; id: string }>;
  private rampCache?: Record<string, string>[];
  private blockCache?: Map<number, number>;
  constructor(readonly source: string) {
    this.parsed = scanXml(source);
    if (
      this.parsed.diagnostics.some((d) => d.severity === "error") ||
      this.parsed.rootIds.length !== 1
    )
      throw new Error("MALFORMED_TERRAIN_XML");
    const root = this.parsed.nodes[this.parsed.rootIds[0]];
    if (root.tag !== "terrain") throw new Error("INVALID_TERRAIN_ROOT");
    this.version = Number(root.attrs.version);
    this.heightMap = this.parsed.nodes.find(
      (n) => n.tag === "heightMap" && n.parentId === root.id,
    )!;
    this.vert = this.parsed.nodes.find(
      (n) => n.tag === "vertData" && n.parentId === this.heightMap?.id,
    )!;
    if (!this.heightMap || !this.vert)
      throw new Error("MISSING_TERRAIN_DESCRIPTOR");
    [this.width, this.height] = numbers(this.heightMap.attrs.dim, 2);
    gridSize(this.width, this.height);
    this.offset = numbers(this.heightMap.attrs.offset ?? "0 0 0", 3);
    this.scale = numbers(this.heightMap.attrs.scale ?? "1 1 1", 3);
    if (this.scale.some((v) => v <= 0))
      throw new Error("UNSUPPORTED_TERRAIN_TRANSFORM");
    this.quantizeBias = Number(this.vert.attrs.quantizeBias);
    this.quantizeScale = Number(this.vert.attrs.quantizeScale);
    if (
      !Number.isFinite(this.quantizeBias) ||
      !Number.isFinite(this.quantizeScale) ||
      this.quantizeScale <= 0
    )
      throw new Error("INVALID_TERRAIN_QUANTIZATION");
  }
  get textures(): Array<{ slot: number; id: string }> {
    return (this.textureCache ??= this.parsed.nodes
      .filter(
        (n) =>
          n.tag === "texture" &&
          this.parsed.nodes[n.parentId ?? -1]?.tag === "textureList",
      )
      .map((n) => ({ slot: Number(n.attrs.i), id: n.attrs.name ?? "" })));
  }
  get tileSets() {
    return this.parsed.nodes
      .filter((n) => n.tag === "textureSet")
      .map((n) => ({ slot: Number(n.attrs.i), id: n.attrs.name }));
  }
  get ramps() {
    return (this.rampCache ??= this.parsed.nodes
      .filter((n) => n.tag === "ramp")
      .map((n) => ({ ...n.attrs })));
  }
  get cliffSets() {
    return this.parsed.nodes
      .filter((n) => n.tag === "cliffSet")
      .map((n) => ({ ...n.attrs }));
  }
  blockSet(x: number, y: number): number {
    const i =
      Math.floor(y / 8) * Math.ceil((this.width - 1) / 8) + Math.floor(x / 8);
    this.blockCache ??= new Map(
      this.parsed.nodes
        .filter((n) => n.tag === "blockTextureSet")
        .map((n) => [Number(n.attrs.i), Number(n.attrs.tileSet)]),
    );
    return this.blockCache.get(i) ?? 0;
  }
  replaceTextures(
    replacements: Array<{ slot: number; texture: string }>,
  ): string {
    const spans = replacements.map((r) => {
      const n = this.parsed.nodes.find(
        (n) => n.tag === "texture" && Number(n.attrs.i) === r.slot,
      );
      const span = n?.attrSpans.find((a) => a.name === "name");
      if (!span) throw new Error(`PALETTE_SLOT_MISSING: ${r.slot}`);
      return {
        start: span.valueStart,
        end: span.valueEnd,
        text: r.texture
          .replaceAll("&", "&amp;")
          .replaceAll('"', "&quot;")
          .replaceAll("<", "&lt;"),
      };
    });
    let next = this.source;
    for (const s of spans.sort((a, b) => b.start - a.start))
      next = next.slice(0, s.start) + s.text + next.slice(s.end);
    return next;
  }
  rampProtected(x: number, y: number): boolean {
    for (const ramp of this.ramps)
      for (const name of ["base", "mid"]) {
        const value = ramp[name];
        if (!value) continue;
        const center = value.match(/c=\(\s*([^,]+),\s*([^)]+)\)/);
        const w = value.match(/\bw=([^\s]+)/);
        const h = value.match(/\bh=([^\s]+)/);
        if (!center || !w || !h) return true;
        if (
          Math.hypot(x - Number(center[1]), y - Number(center[2])) <=
          Math.hypot(Number(w[1]), Number(h[1])) + 4
        )
          return true;
      }
    return false;
  }
}
export class HeightMap {
  readonly width: number;
  readonly height: number;
  constructor(
    readonly bytes: Buffer,
    readonly descriptor: TerrainDescriptor,
  ) {
    header(bytes, "HMAP", 101, 32);
    this.width = bytes.readUInt32LE(8);
    this.height = bytes.readUInt32LE(12);
    const n = gridSize(this.width, this.height);
    if (
      this.width !== descriptor.width ||
      this.height !== descriptor.height ||
      bytes.length !== 32 + n * 6
    )
      throw new Error("HEIGHTMAP_SIZE_MISMATCH");
  }
  mask(x: number, y: number): number {
    return this.bytes.readUInt16LE(32 + (y * this.width + x) * 6 + 4);
  }
  z(x: number, y: number): number {
    const i = 32 + (y * this.width + x) * 6;
    const d = this.descriptor;
    return (
      ((this.bytes.readUInt16LE(i) + this.bytes.readUInt16LE(i + 2)) *
        d.quantizeScale -
        2 * d.quantizeBias) *
        d.scale[2] +
      d.offset[2]
    );
  }
  setZ(x: number, y: number, z: number): number {
    const i = 32 + (y * this.width + x) * 6;
    const d = this.descriptor;
    const fine = Math.round(
      ((z - d.offset[2]) / d.scale[2] + 2 * d.quantizeBias) / d.quantizeScale -
        this.bytes.readUInt16LE(i),
    );
    if (fine < 0 || fine > 65535)
      throw new Error(
        `HEIGHT_QUANTIZATION_RANGE: (${x},${y}); choose a smaller height change or an Editor-generated donor stamp`,
      );
    this.bytes.writeUInt16LE(fine, i + 2);
    return this.z(x, y);
  }
  point(x: number, y: number): Point2 {
    return {
      x: x * this.descriptor.scale[0] + this.descriptor.offset[0],
      y: y * this.descriptor.scale[1] + this.descriptor.offset[1],
    };
  }
  sample(p: Point2) {
    const d = this.descriptor;
    const gx = (p.x - d.offset[0]) / d.scale[0],
      gy = (p.y - d.offset[1]) / d.scale[1];
    if (gx < 0 || gy < 0 || gx > this.width - 1 || gy > this.height - 1)
      throw new Error("TERRAIN_SAMPLE_OUT_OF_BOUNDS");
    const x = Math.min(this.width - 2, Math.floor(gx)),
      y = Math.min(this.height - 2, Math.floor(gy));
    const fx = gx - x,
      fy = gy - y;
    return {
      height:
        this.z(x, y) * (1 - fx) * (1 - fy) +
        this.z(x + 1, y) * fx * (1 - fy) +
        this.z(x, y + 1) * (1 - fx) * fy +
        this.z(x + 1, y + 1) * fx * fy,
      mask: this.mask(Math.round(gx), Math.round(gy)),
      slope: Math.hypot(
        (this.z(x + 1, y) - this.z(x, y)) / d.scale[0],
        (this.z(x, y + 1) - this.z(x, y)) / d.scale[1],
      ),
    };
  }
  protected(x: number, y: number): boolean {
    const m = this.mask(x, y);
    if (m === 0 || this.descriptor.rampProtected(x, y)) return true;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (
          nx >= 0 &&
          ny >= 0 &&
          nx < this.width &&
          ny < this.height &&
          this.mask(nx, ny) !== m
        )
          return true;
      }
    return false;
  }
}
export class SyncHeightMap {
  readonly width: number;
  readonly height: number;
  constructor(
    readonly bytes: Buffer,
    hm: HeightMap,
  ) {
    header(bytes, "SMAP", 102, 64);
    this.width = bytes.readUInt32LE(8);
    this.height = bytes.readUInt32LE(12);
    if (
      this.width !== hm.width ||
      this.height !== hm.height ||
      bytes.length !== 64 + this.width * this.height * 4
    )
      throw new Error("SYNC_HEIGHTMAP_SIZE_MISMATCH");
  }
  delta(x: number, y: number, delta: number): void {
    const i = 64 + (y * this.width + x) * 4;
    const value = this.bytes.readInt16LE(i) + Math.round(delta * 256);
    if (value < -32768 || value > 32767)
      throw new Error("SYNC_HEIGHT_OVERFLOW");
    this.bytes.writeInt16LE(value, i);
  }
}
export class TextureMasks {
  readonly width: number;
  readonly height: number;
  constructor(readonly bytes: Buffer) {
    header(bytes, "MASK", 102, 64);
    this.width = bytes.readUInt32LE(12);
    this.height = bytes.readUInt32LE(16);
    if (
      this.width < 64 ||
      this.height < 64 ||
      this.width > 2048 ||
      this.height > 2048 ||
      this.width % 64 ||
      this.height % 64 ||
      bytes.readUInt32LE(8) !== 0 ||
      bytes.length !== 64 + this.width * this.height * 4
    )
      throw new Error("TEXTURE_MASK_SIZE_MISMATCH");
  }
  private index(x: number, y: number, layer: number): number {
    return (
      64 +
      (layer * this.width * this.height) / 2 +
      (Math.floor(y / 64) * (this.width / 64) + Math.floor(x / 64)) * 2048 +
      (y % 64) * 32 +
      Math.floor((x % 64) / 2)
    );
  }
  get(x: number, y: number, layer: number): number {
    const v = this.bytes[this.index(x, y, layer)];
    return x % 2 ? v & 15 : v >>> 4;
  }
  set(x: number, y: number, layer: number, v: number): void {
    const i = this.index(x, y, layer);
    const n = Math.max(0, Math.min(15, Math.round(v)));
    this.bytes[i] =
      x % 2 ? (this.bytes[i] & 240) | n : (this.bytes[i] & 15) | (n << 4);
  }
  weights(x: number, y: number): number[] {
    return Array.from({ length: 8 }, (_, l) => this.get(x, y, l));
  }
  paint(x: number, y: number, layer: number, strength: number): void {
    const old = this.weights(x, y);
    const next = old.map(
      (v, l) => v * (1 - strength) + (l === layer ? 15 * strength : 0),
    );
    this.setWeights(x, y, next);
  }
  replace(
    x: number,
    y: number,
    fromLayer: number,
    toLayer: number,
    strength: number,
  ): void {
    const weights = this.weights(x, y),
      amount = weights[fromLayer] * strength;
    weights[fromLayer] -= amount;
    weights[toLayer] += amount;
    this.setWeights(x, y, weights);
  }
  setWeights(x: number, y: number, next: number[]): void {
    let remainder = 15;

    const total = next.reduce((a, b) => a + b, 0);
    const normalized = next.map((v) => (total ? (v * 15) / total : 0));
    const result = normalized.map((v) => Math.floor(v));
    remainder -= result.reduce((a, b) => a + b, 0);
    for (const l of normalized
      .map((v, l) => ({ l, f: v - result[l] }))
      .sort((a, b) => b.f - a.f || a.l - b.l)
      .slice(0, remainder))
      result[l.l]++;
    for (let l = 0; l < 8; l++) this.set(x, y, l, result[l]);
  }
}
export class SyncTextureInfo {
  readonly width: number;
  readonly height: number;
  readonly setCount: number;
  readonly names: string[] = [];
  readonly dataOffset: number;
  constructor(readonly bytes: Buffer) {
    header(bytes, "RTXT", 101, 20);
    this.width = bytes.readUInt32LE(8);
    this.height = bytes.readUInt32LE(12);
    gridSize(this.width, this.height);
    this.setCount = bytes.readUInt32LE(16);
    if (this.setCount < 1 || this.setCount > 8)
      throw new Error("SYNC_TEXTURE_SET_COUNT");
    let off = 20;
    for (let i = 0; i < this.setCount * 8; i++) {
      const end = bytes.indexOf(0, off);
      if (end < 0 || end - off > 4096) throw new Error("SYNC_TEXTURE_NAME");
      this.names.push(bytes.toString("utf8", off, end));
      off = end + 1;
    }
    this.dataOffset = off;
    if (bytes.length !== off + this.width * this.height * 8)
      throw new Error("SYNC_TEXTURE_SIZE_MISMATCH");
  }
  set(x: number, y: number, index: number) {
    if (index < 0 || index >= this.names.length)
      throw new Error("SYNC_TEXTURE_INDEX");
    const off = this.dataOffset + (y * this.width + x) * 8;
    this.bytes.writeUInt32LE(
      ((this.bytes.readUInt32LE(off) & 0xffffff00) | index) >>> 0,
      off,
    );
  }
  rename(replacements: Array<{ slot: number; texture: string }>): Buffer {
    const names = [...this.names];
    for (const r of replacements) {
      if (r.slot >= names.length) throw new Error("SYNC_TEXTURE_SLOT_MISSING");
      names[r.slot] = r.texture;
    }
    return Buffer.concat([
      this.bytes.subarray(0, 20),
      ...names.map((n) => Buffer.from(n + "\0")),
      this.bytes.subarray(this.dataOffset),
    ]);
  }
}
export class WaterEntries {
  readonly version: number;
  readonly count: number;
  readonly bodyCount: number;
  readonly simple: boolean;
  readonly coverageKnown: boolean;
  constructor(readonly bytes: Buffer) {
    if (bytes.length < 32 || bytes.toString("ascii", 0, 4) !== "WATR")
      throw new Error("INVALID_WATER_HEADER");
    this.version = bytes.readUInt32LE(4);
    this.count = bytes.readUInt32LE(8);
    this.bodyCount = bytes.readUInt32LE(12);
    if (
      this.version < 104 ||
      this.version > 110 ||
      this.count > 100000 ||
      this.bodyCount > 10000
    )
      throw new Error("INVALID_WATER_FORMAT");
    this.simple =
      this.version === 110 &&
      this.bodyCount === 0 &&
      bytes.length === 32 + this.count * 56;
    // Only the flat v110 table profile is editable; nonzero native body sections stay opaque.
    this.coverageKnown = this.simple && this.records().every(r =>
      r.rawFloats.every(Number.isFinite) && r.rawFloats[2] > r.rawFloats[0] && r.rawFloats[3] > r.rawFloats[1] &&
      r.rawFloats.every(v => Number.isInteger(v / 8)));
  }
  private records() {
    return Array.from({ length: this.simple ? this.count : 0 }, (_, index) => {
      const off = 32 + index * 56;
      const name = this.bytes.subarray(off, off + 40), end = name.indexOf(0);
      if (end < 0) throw new Error("UNTERMINATED_WATER_TEMPLATE_NAME");
      const template = new TextDecoder("utf-8", { fatal:true }).decode(name.subarray(0,end));
      waterName(template);
      return { index, template, rawFloats:[40,44,48,52].map(offset => this.bytes.readFloatLE(off + offset)) };
    });
  }
  list() {
    if (!this.simple)
      return {
        entries: [],
        opaque: true,
        coverageKnown: this.coverageKnown,
        semantics: "unverified" as const,
        bodyCount: this.bodyCount,
        count: this.count,
        version: this.version,
      };
    return {
      entries: this.records().map(r => ({ ...r, semantics:this.coverageKnown ? "flat-v110-rectangle-reference" as const : "unverified" as const,
        area:this.coverageKnown ? { type:"rectangle" as const,minX:r.rawFloats[0],minY:r.rawFloats[1],maxX:r.rawFloats[2],maxY:r.rawFloats[3] } : undefined })),
      opaque: false,
      coverageKnown: this.coverageKnown,
      semantics: "unverified" as const,
      bodyCount: 0,
      count: this.count,
      version: this.version,
    };
  }
  edit(kind: "create" | "update" | "remove", index: number, area?: Extract<TerrainArea, { type: "rectangle" }>, template?: string): Buffer {
    if (!this.coverageKnown) throw new Error("WATER_BODY_WRITER_UNAVAILABLE: unsupported native body or flat table profile");
    if (!Number.isInteger(index) || index < 0 || (kind !== "create" || !template) && index >= this.count)
      throw new Error("WATER_INDEX_OUT_OF_RANGE");
    if (area && (![area.minX,area.minY,area.maxX,area.maxY].every(v => Number.isFinite(v) && Number.isInteger(v/8)) || area.maxX <= area.minX || area.maxY <= area.minY))
      throw new Error("WATER_RECTANGLE_REQUIRES_8_CELL_GRID");
    if (kind !== "remove" && !area) throw new Error("WATER_RECTANGLE_REQUIRED");
    if(kind !== "remove" && area && this.records().some(r => (kind === "create" || r.index !== index) &&
      area.minX < r.rawFloats[2] && area.maxX > r.rawFloats[0] && area.minY < r.rawFloats[3] && area.maxY > r.rawFloats[1]))
      throw new Error("WATER_RECTANGLE_OVERLAP: ambiguous overlapping liquid assignments");
    const rows = Array.from({length:this.count},(_,i) => Buffer.from(this.bytes.subarray(32+i*56,88+i*56)));
    if (kind === "remove") rows.splice(index,1);
    else {
      const row = kind === "create" && template ? Buffer.alloc(56) : Buffer.from(rows[index]);
      if (template) { row.fill(0,0,40); row.write(waterName(template),0,"utf8"); }
      [area!.minX,area!.minY,area!.maxX,area!.maxY].forEach((v,i) => row.writeFloatLE(v,40+i*4));
      if (kind === "create") { if(rows.length >= 100000) throw new Error("WATER_ENTRY_LIMIT"); rows.push(row); } else rows[index] = row;
    }
    const head = Buffer.from(this.bytes.subarray(0,32)); head.writeUInt32LE(rows.length,8);
    const result = Buffer.concat([head,...rows]); new WaterEntries(result); return result;
  }
  at(p: Point2): Array<{ index: number; template: string; level: string }> {
    if (!this.coverageKnown) return [];
    return this.records().filter(r => p.x >= r.rawFloats[0] && p.y >= r.rawFloats[1] && p.x < r.rawFloats[2] && p.y < r.rawFloats[3])
      .map(r => ({index:r.index,template:r.template,level:"catalog-defined",evidence:"flat-v110-rectangle-reference"}));
  }
}
