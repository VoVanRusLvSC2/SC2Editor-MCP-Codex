import { gridCount, versionIs, bytesLength, finite, integer } from '../guards.js'
/**
 * t3HeightMap — `mapHeightMap`, magic `HMAP`.
 *
 * ```c
 * struct Header { char magic[4]; uint32 version; uint32 sizeX; uint32 sizeY; uint8 padding[16]; };
 * struct Cell   { uint16 heightBase; uint16 heightAdjustments; uint16 mask; };  // row-major
 * ```
 *
 * Field order claimed in supplied/external reader documentation (`t3HeightMap__Read` writes
 * `heightBase` from the FIRST uint16) — the community docs list the two fields
 * reversed. `version` must be exactly 101; cells default to
 * `{ heightBase: 0, heightAdjustments: 0, mask: 1 }` in the engine.
 *
 * Byte-exact round-trip: `version`, the 16-byte header padding (`_raw.padding`)
 * and any bytes after the cell array (`_raw.trailing`) are preserved verbatim.
 */

import { Cursor, Writer } from '../binary.js'

export const HEIGHT_MAP_MAGIC = 'HMAP'
const HEADER_PADDING = 16

export interface HeightCell {
  heightBase: number // uint16 — plateau/base elevation (first field on disk)
  heightAdjustments: number // uint16 — fine height offset (dents/jitter)
  /** uint16 terrain layer mask; engine default 1, the 0x9000 interpretation in the supplied archive is NOT independently verified. */
  mask: number
}

export interface HeightMapResult {
  sizeX: number
  sizeY: number
  version: number
  /** Row-major (`y * sizeX + x`) per-cell height chunks. */
  cells: HeightCell[]
  _raw: { padding: Uint8Array; trailing: Uint8Array }
}

export interface TerrainParams {
  quantizeScale: number
  quantizeBias: number
  standardHeight: number
}

export function readHeightMap(data: Uint8Array): HeightMapResult {
  const c = new Cursor(data)
  const magic = c.ascii(4)
  if (magic !== HEIGHT_MAP_MAGIC) {
    throw new Error(`Invalid HMAP: bad magic "${magic}" (expected "${HEIGHT_MAP_MAGIC}")`)
  }
  const version = c.u32()
  versionIs(version, [101], 'HMAP')
  const sizeX = c.u32()
  const sizeY = c.u32()
  const padding = c.bytesOf(HEADER_PADDING)

  const count = gridCount(sizeX, sizeY, 6, c.remaining, 'HMAP')
  const cells: HeightCell[] = new Array(count)
  for (let i = 0; i < count; i++) {
    cells[i] = { heightBase: c.u16(), heightAdjustments: c.u16(), mask: c.u16() }
  }
  return { sizeX, sizeY, version, cells, _raw: { padding, trailing: c.rest() } }
}

export function writeHeightMap(map: HeightMapResult): Uint8Array {
  versionIs(map.version, [101], 'HMAP')
  bytesLength(map._raw.padding, 16, 'HMAP padding')
  const expected = gridCount(map.sizeX, map.sizeY, 6, undefined, 'HMAP')
  if (map.cells.length !== expected) {
    throw new Error(`HMAP cell count ${map.cells.length} ≠ sizeX*sizeY (${expected})`)
  }
  const w = new Writer(32 + expected * 6 + map._raw.trailing.length)
  w.ascii(HEIGHT_MAP_MAGIC).u32(map.version).u32(map.sizeX).u32(map.sizeY).raw(map._raw.padding)
  for (const cell of map.cells) {
    w.u16(cell.heightBase).u16(cell.heightAdjustments).u16(cell.mask)
  }
  return w.raw(map._raw.trailing).done()
}

/** World-space grid geometry from `<heightMap offset=".."> / <heightMap scale="..">` (defaults 0 / 1). */
export interface TerrainGeometry {
  offsetZ?: number
  scaleZ?: number
}

/**
 * Convert a HeightCell to a world-space level, per the engine's
 * `CTerrain3HeightMap__InitVertexGrid`: each field dequantizes SEPARATELY
 * (`value * quantizeScale - quantizeBias`), then
 * `world_z = base_z * scale_z + offset_z + adj`. `standardHeight` is NOT part
 * of this reference formula. Native arithmetic and non-unit scaleZ behavior
 * were NOT independently executed in this audit; target MCP uses another formula.
 */
export function levelFromCell(cell: HeightCell, params: TerrainParams, geometry: TerrainGeometry = {}): number {
  integer(cell.heightBase, 0, 65535, 'heightBase'); integer(cell.heightAdjustments, 0, 65535, 'heightAdjustments')
  finite(params.quantizeScale, 'quantizeScale'); finite(params.quantizeBias, 'quantizeBias')
  finite(geometry.scaleZ ?? 1, 'scaleZ'); finite(geometry.offsetZ ?? 0, 'offsetZ')
  if (params.quantizeScale <= 0) throw new RangeError('quantizeScale must be positive')
  const baseZ = cell.heightBase * params.quantizeScale - params.quantizeBias
  const adj = cell.heightAdjustments * params.quantizeScale - params.quantizeBias
  return baseZ * (geometry.scaleZ ?? 1) + (geometry.offsetZ ?? 0) + adj
}

/** Invert worldZ by changing only the base channel; report the actually representable height.
 * Does not rebuild sync heights, hard geometry or pathing. No clamping on overflow. */
export function quantizeWorldHeight(worldZ: number, cell: HeightCell, params: TerrainParams, geometry: TerrainGeometry = {}): { cell: HeightCell; actualWorldZ: number; error: number } {
  finite(worldZ, 'worldZ')
  levelFromCell(cell, params, geometry)
  const zscale = geometry.scaleZ ?? 1
  if (zscale === 0) throw new RangeError('scaleZ is zero: inverse is undefined')
  const adj = cell.heightAdjustments * params.quantizeScale - params.quantizeBias
  const q = Math.round(((worldZ - (geometry.offsetZ ?? 0) - adj) / zscale + params.quantizeBias) / params.quantizeScale)
  integer(q, 0, 65535, 'quantized heightBase')
  const next = { ...cell, heightBase: q }
  const actualWorldZ = levelFromCell(next, params, geometry)
  return { cell: next, actualWorldZ, error: actualWorldZ - worldZ }
}
