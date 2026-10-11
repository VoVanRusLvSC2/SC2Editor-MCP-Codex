/** RTXT v100/v101. Names retain all eight slots per set, including empty names.
 * v101: set-count word + 8-byte cells; v100: implicit one set + 4-byte cells.
 * NUL string profile is corroborated by the target MCP source, not by a native run here.
 */
import { Cursor, Writer } from '../binary.js'
import { gridCount, integer, countBytes } from '../guards.js'
export const SYNC_TEXTURE_INFO_MAGIC = 'RTXT'
export interface SyncTextureInfoResult {
  version: number; sizeX: number; sizeY: number; setCount: number
  textureNames: string[]; cells: Uint32Array; secondary?: Uint32Array
  dataOffset: number
  _raw: { names: Uint8Array; originalNames: string[]; trailing: Uint8Array }
}
export function readSyncTextureInfo(buf: Uint8Array): SyncTextureInfoResult {
  const c = new Cursor(buf)
  if (c.ascii(4) !== SYNC_TEXTURE_INFO_MAGIC) throw new Error('Invalid RTXT magic')
  const version = c.u32(); if (version !== 100 && version !== 101) throw new Error(`Unsupported RTXT ${version}`)
  const sizeX = c.u32(), sizeY = c.u32(), n = gridCount(sizeX, sizeY)
  const setCount = version === 101 ? c.u32() : 1
  integer(setCount, 1, 8, 'RTXT sets')
  const start = c.offset, textureNames: string[] = [], decoder = new TextDecoder('utf-8')
  for (let i = 0; i < setCount * 8; i++) {
    const off = c.offset; let len = 0
    while (c.u8() !== 0) { if (++len > 4096) throw new Error('RTXT name length limit') }
    textureNames.push(decoder.decode(buf.subarray(off, c.offset - 1)))
  }
  const dataOffset = c.offset, names = new Uint8Array(buf.subarray(start, dataOffset))
  countBytes(n, version === 101 ? 8 : 4, c.remaining, 'RTXT cells')
  const cells = new Uint32Array(n), secondary = version === 101 ? new Uint32Array(n) : undefined
  for (let i = 0; i < n; i++) { cells[i] = c.u32(); if (secondary) secondary[i] = c.u32() }
  return { version, sizeX, sizeY, setCount, textureNames, cells, secondary, dataOffset,
    _raw: { names, originalNames: [...textureNames], trailing: c.rest() } }
}
export function writeSyncTextureInfo(map: SyncTextureInfoResult): Uint8Array {
  if (map.version !== 100 && map.version !== 101) throw new Error('Unsupported RTXT version')
  const n = gridCount(map.sizeX, map.sizeY); integer(map.setCount, 1, 8, 'RTXT sets')
  if (map.version === 100 && map.setCount !== 1) throw new Error('RTXT v100 has one set')
  if (map.textureNames.length !== map.setCount * 8 || map.cells.length !== n ||
      (map.version === 101 && map.secondary?.length !== n) || (map.version === 100 && map.secondary)) throw new Error('RTXT shape mismatch')
  const w = new Writer(); w.ascii(SYNC_TEXTURE_INFO_MAGIC).u32(map.version).u32(map.sizeX).u32(map.sizeY)
  if (map.version === 101) w.u32(map.setCount)
  if (map.textureNames.length === map._raw.originalNames.length && map.textureNames.every((s, i) => s === map._raw.originalNames[i])) w.raw(map._raw.names)
  else {
    for (const s of map.textureNames) {
      const bytes = new TextEncoder().encode(s)
      if (s.includes('\0') || bytes.length > 4096 || new TextDecoder().decode(bytes) !== s) throw new Error('Invalid RTXT name')
      w.raw(bytes).u8(0)
    }
  }
  for (let i = 0; i < n; i++) { w.u32(map.cells[i]!); if (map.secondary) w.u32(map.secondary[i]!) }
  return w.raw(map._raw.trailing).done()
}
/** Change only the low 8 bits; keep flags in the high 24 bits and the second word. */
export function setSyncTextureSlot(map: SyncTextureInfoResult, cell: number, slot: number): void {
  integer(cell, 0, map.cells.length - 1, 'RTXT cell'); integer(slot, 0, map.textureNames.length - 1, 'RTXT slot')
  map.cells[cell] = ((map.cells[cell]! & 0xffffff00) | slot) >>> 0
}
