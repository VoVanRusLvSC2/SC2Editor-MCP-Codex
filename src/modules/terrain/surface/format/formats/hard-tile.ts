/** HRDT v102. Default stops at the first unresolved variable string boundary.
 * Original fixed-12-byte name and 3x3 rotation interpretation were not proven.
 * Raw 58-byte entries are exposed without pretending unknown lanes are a mesh.
 */
import { Cursor } from '../binary.js'
import { countBytes, integer, MAX_RECORDS } from '../guards.js'
import { protectReadOnly, preservedReadOnlyBytes } from '../readonly.js'
export interface HardTileSubBlock {
  byteOffset: number; raw: Uint8Array; words: number[]
  int32View: number[]; float32View: number[]; flags: [number, number]
}
export interface HardTileBlock {
  byteOffset: number; subs: HardTileSubBlock[]; flags: number[]
  name?: string; nameBytes?: Uint8Array; modelIndex?: number
}
export interface HardTileResult {
  version: number; unk: number[]; blockCount: number; blocks: HardTileBlock[]
  status: 'empty' | 'partial-unresolved-string' | 'experimental-layout'
  stringEncoding: 'unresolved' | 'nul' | 'u32le-length'
  parsedEnd: number; rawRemainder: Uint8Array; raw: Uint8Array
}
export interface HardTileOptions { stringEncoding?: HardTileResult['stringEncoding'] }
export function readHardTile(bytes: Uint8Array, options: HardTileOptions = {}): HardTileResult {
  const c = new Cursor(bytes)
  if (c.ascii(4) !== 'HRDT') throw new Error('Invalid HRDT magic')
  const version = c.u32(); if (version !== 102) throw new Error(`Unsupported HRDT ${version}`)
  const unk = [c.u32(), c.u32(), c.u32(), c.u32()], blockCount = c.u32()
  integer(blockCount, 0, MAX_RECORDS, 'HRDT blocks')
  const stringEncoding = options.stringEncoding ?? 'unresolved'
  const result: HardTileResult = { version, unk, blockCount, blocks: [],
    status: blockCount ? 'partial-unresolved-string' : 'empty', stringEncoding,
    parsedEnd: c.offset, rawRemainder: new Uint8Array(), raw: new Uint8Array(bytes) }
  for (let i = 0; i < blockCount; i++) {
    const byteOffset = c.offset, count = c.u32()
    countBytes(count, 58, c.remaining, 'HRDT tiles', MAX_RECORDS)
    const subs: HardTileSubBlock[] = []
    for (let j = 0; j < count; j++) {
      const off = c.offset, raw = c.bytesOf(58), v = new DataView(raw.buffer, raw.byteOffset, 58)
      subs.push({ byteOffset: off, raw,
        words: Array.from({ length: 14 }, (_, k) => v.getUint32(k * 4, true)),
        int32View: Array.from({ length: 14 }, (_, k) => v.getInt32(k * 4, true)),
        float32View: Array.from({ length: 14 }, (_, k) => v.getFloat32(k * 4, true)),
        flags: [raw[56]!, raw[57]!] })
    }
    const flags = [c.u8(), c.u8(), c.u8()], block: HardTileBlock = { byteOffset, subs, flags }
    result.blocks.push(block)
    if (stringEncoding === 'unresolved') break
    let nameBytes: Uint8Array
    if (stringEncoding === 'u32le-length') {
      const n = c.u32(); integer(n, 0, 4096, 'HRDT string length'); nameBytes = c.bytesOf(n)
    } else {
      const start = c.offset; let n = 0
      while (c.u8() !== 0) { if (++n > 4096) throw new Error('HRDT string budget exceeded') }
      nameBytes = new Uint8Array(bytes.subarray(start, c.offset - 1))
    }
    block.nameBytes = nameBytes; block.name = new TextDecoder().decode(nameBytes); block.modelIndex = c.i32()
    result.status = 'experimental-layout'
  }
  result.parsedEnd = c.offset; result.rawRemainder = c.rest()
  return protectReadOnly(result)
}
export function writeHardTile(data: HardTileResult): Uint8Array { return preservedReadOnlyBytes(data) }
