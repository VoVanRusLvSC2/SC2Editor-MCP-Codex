import type { Point2 } from "./types.js";

/** Editor 5.0.17.98310 user fixture p.SC2Map: visible ground 0x02, hidden ground 0x06.
 * Bit 0x04 controls authored ground hiding. It is distinct from cliff holes (0x01).
 * Preserve all other bits. This is a visual surface flag, not a pathability certificate.
 */
export const TERRAIN_HIDDEN_BIT = 0x04;
export class TerrainVisibility {
  readonly width: number;
  readonly height: number;
  readonly version: number;
  constructor(readonly bytes: Buffer, width: number, height: number) {
    if (bytes.length < 32 || bytes.toString("ascii", 0, 4) !== "LFCT") throw new Error("VISIBILITY_LFCT_HEADER_INVALID");
    this.version = bytes.readUInt32LE(4);
    if (this.version !== 102) throw new Error("VISIBILITY_LFCT_VERSION_UNSUPPORTED");
    this.width = bytes.readUInt32LE(24); this.height = bytes.readUInt32LE(28);
    if (this.width !== width || this.height !== height || bytes.length !== 32 + width * height)
      throw new Error("VISIBILITY_CELL_GRID_MISMATCH");
  }
  private index(x: number, y: number) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height)
      throw new Error("VISIBILITY_CELL_OUT_OF_BOUNDS");
    return 32 + y * this.width + x;
  }
  raw(x: number, y: number) { return this.bytes[this.index(x, y)]; }
  hidden(x: number, y: number) { return (this.raw(x, y) & TERRAIN_HIDDEN_BIT) !== 0; }
  setHidden(x: number, y: number, hidden: boolean) {
    const index = this.index(x, y), before = this.bytes[index];
    this.bytes[index] = hidden ? before | TERRAIN_HIDDEN_BIT : before & ~TERRAIN_HIDDEN_BIT;
    return before !== this.bytes[index];
  }
  atGrid(x: number, y: number) {
    return this.hidden(Math.max(0, Math.min(this.width - 1, Math.floor(x))), Math.max(0, Math.min(this.height - 1, Math.floor(y))));
  }
  touchesHiddenVertex(x: number, y: number) {
    for (const cy of [y - 1, y]) for (const cx of [x - 1, x])
      if (cx >= 0 && cy >= 0 && cx < this.width && cy < this.height && this.hidden(cx, cy)) return true;
    return false;
  }
  inspect(cells: Point2[] = []) {
    let hiddenCells = 0;
    for (let i = 32; i < this.bytes.length; i++) if (this.bytes[i] & TERRAIN_HIDDEN_BIT) hiddenCells++;
    return { component: "t3CellFlags", version: this.version, cells: [this.width, this.height],
      coordinateDomain: "integer cell indices; y increases north", hiddenBit: TERRAIN_HIDDEN_BIT,
      totalCells: this.width * this.height, hiddenCells, visibleCells: this.width * this.height - hiddenCells,
      samples: cells.map(({ x, y }) => ({ x, y, rawFlags: this.raw(x, y), hidden: this.hidden(x, y) })),
      pathingValidated: false, editorProfile: "user-authored p.SC2Map, Editor 5.0.17.98310" };
  }
}
