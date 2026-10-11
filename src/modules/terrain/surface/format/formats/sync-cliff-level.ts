import { gridCount, bytesLength, integer } from '../guards.js'
/**
 * t3SyncCliffLevel — `mapSyncCliffLevel`, magic `CLIF`.
 *
 * ```c
 * struct Header { char magic[4]; uint32 version; uint32 sizeX; uint32 sizeY; uint32 zero[4]; };
 * uint16 height[sizeX * sizeY];   // unsigned, row-major
 * ```
 *
 * Simplified cliff-level integer map (companion to the height maps).
 * Byte-exact round-trip: `version`, the 16-byte zero region (`_raw.padding`)
 * and any trailing bytes are preserved verbatim.
 */

import { Cursor, Writer } from '../binary.js'

export const SYNC_CLIFF_MAGIC = 'CLIF'
const HEADER_PADDING = 16 // zero[4]

export interface CliffLevelResult {
  sizeX: number
  sizeY: number
  version: number
  /** uint16, row-major (`y * sizeX + x`). */
  heights: number[]
  dimensionSource?: 'header-hint' | 'provided'
  _raw: { padding: Uint8Array; trailing: Uint8Array; header?: Uint8Array; originalShape?: [number, number, number] }
}

export function readSyncCliffLevel(data: Uint8Array, dimensions?: { sizeX: number; sizeY: number }): CliffLevelResult {
  const c = new Cursor(data)
  const magic = c.ascii(4)
  if (magic !== SYNC_CLIFF_MAGIC) {
    throw new Error(`Invalid CLIF: bad magic "${magic}" (expected "${SYNC_CLIFF_MAGIC}")`)
  }
  const version = c.u32()
  if (version !== 100) throw new Error('CLIF_UNSUPPORTED_VERSION: only archive v100 profile enabled')
  const headerX = c.u32()
  const headerY = c.u32()
  const sizeX = dimensions?.sizeX ?? headerX
  const sizeY = dimensions?.sizeY ?? headerY
  const padding = c.bytesOf(HEADER_PADDING)

  const count = gridCount(sizeX, sizeY, 2, c.remaining, 'CLIF')
  const heights: number[] = new Array(count)
  for (let i = 0; i < count; i++) heights[i] = c.u16()

  return { sizeX, sizeY, version, heights, dimensionSource: dimensions ? 'provided' : 'header-hint', _raw: { padding, trailing: c.rest(), header: new Uint8Array(data.subarray(0,32)), originalShape: [sizeX, sizeY, version] } }
}

/**
 * Engine dequantization (`t3SyncCliffLevel__Read`): the raw uint16 is clamped
 * up to the map's base cliff level (`base << 6`), then shifted by four bits (NOT proof of a four-bit range): `(clamped + 8) >> 4`.
 */
export function dequantizeCliffLevel(raw: number, baseCliffLevel = 0): number {
  integer(raw, 0, 65535, 'CLIF raw'); integer(baseCliffLevel, 0, 255, 'baseCliffLevel')
  const floor = baseCliffLevel * 64
  const clamped = Math.max(raw, floor)
  return ((clamped + 8) >> 4) & 0xffff
}

export function writeSyncCliffLevel(map: CliffLevelResult): Uint8Array {
  if (map.version !== 100) throw new Error('CLIF_UNSUPPORTED_VERSION')
  if (map._raw.originalShape && [map.sizeX,map.sizeY,map.version].some((v,i)=>v!==map._raw.originalShape![i])) throw new Error('CLIF_STRUCTURAL_RESIZE_UNSUPPORTED')
  bytesLength(map._raw.padding, 16, 'CLIF padding')
  const expected = gridCount(map.sizeX, map.sizeY, 2, undefined, 'CLIF')
  if (map.heights.length !== expected) {
    throw new Error(`CLIF height count ${map.heights.length} ≠ sizeX*sizeY (${expected})`)
  }
  const w = new Writer(32 + expected * 2 + map._raw.trailing.length)
  if (map._raw.header) { bytesLength(map._raw.header, 32, 'CLIF header'); const c=new Cursor(map._raw.header);if(c.ascii(4)!==SYNC_CLIFF_MAGIC||c.u32()!==map.version)throw new Error('CLIF_HEADER_MISMATCH');w.raw(map._raw.header.subarray(0,16)).raw(map._raw.padding) }
  else w.ascii(SYNC_CLIFF_MAGIC).u32(map.version).u32(map.sizeX).u32(map.sizeY).raw(map._raw.padding)
  for (const h of map.heights) w.u16(h)
  return w.raw(map._raw.trailing).done()
}

/** Explicit casts from the external native pseudocode. Kept separate from the wide helper. */
export function decodeRuntimeCliffByte(raw: number, baseCliffLevel = 0): number {
  integer(raw, 0, 65535, 'CLIF raw'); integer(baseCliffLevel, 0, 255, 'baseCliffLevel')
  return (((Math.max(raw, baseCliffLevel * 64) + 8) & 65535) >>> 4) & 255
}
