import { gridCount, bytesLength, versionIs } from '../guards.js'
/**
 * t3CellFlags — `mapCellFlags`, magic `LFCT`.
 *
 * ```c
 * struct Header {
 *   char magic[4]; uint32 version; uint32 zero[4];   // <- 16-byte zero region
 *   uint32 sizeX; uint32 sizeY;                       // dimensions come AFTER the zeros
 * };
 * uint8 types[sizeX * sizeY];   // raw byte flags; visual interpretations are archive claims, not runtime passability
 * ```
 *
 * `0x03` punches holes in terrain for cliff models. Byte-exact round-trip:
 * `version`, the 16-byte zero region and any trailing bytes are preserved.
 */

import { Cursor, Writer } from '../binary.js'

export const CELL_FLAGS_MAGIC = 'LFCT'
const HEADER_ZERO = 16 // zero[4]

export interface CellFlagsResult {
  sizeX: number
  sizeY: number
  version: number
  /** One byte per cell, row-major (`y * sizeX + x`). */
  types: Uint8Array
  _raw: { zero: Uint8Array; trailing: Uint8Array }
}

export function readCellFlags(data: Uint8Array): CellFlagsResult {
  const c = new Cursor(data)
  const magic = c.ascii(4)
  if (magic !== CELL_FLAGS_MAGIC) {
    throw new Error(`Invalid LFCT: bad magic "${magic}" (expected "${CELL_FLAGS_MAGIC}")`)
  }
  const version = c.u32()
  versionIs(version, [101, 102], 'LFCT bulk layout; <=100 sparse is not this reader')
  const zero = c.bytesOf(HEADER_ZERO)
  const sizeX = c.u32()
  const sizeY = c.u32()

  const types = c.bytesOf(gridCount(sizeX,sizeY,1,c.remaining,'LFCT'))
  return { sizeX, sizeY, version, types, _raw: { zero, trailing: c.rest() } }
}

export function writeCellFlags(map: CellFlagsResult): Uint8Array {
  versionIs(map.version, [101, 102], 'LFCT bulk')
  bytesLength(map._raw.zero,16,'LFCT padding')
  const expected = gridCount(map.sizeX,map.sizeY,1,undefined,'LFCT')
  if (map.types.length !== expected) {
    throw new Error(`LFCT type count ${map.types.length} ≠ sizeX*sizeY (${expected})`)
  }
  const w = new Writer(32 + expected + map._raw.trailing.length)
  w.ascii(CELL_FLAGS_MAGIC).u32(map.version).raw(map._raw.zero).u32(map.sizeX).u32(map.sizeY)
  return w.raw(map.types).raw(map._raw.trailing).done()
}

/** Separate external-reference sparse profile; not a bulk LFCT file. */
export interface LegacyCellFlagsResult {version:number;oldWidth:number;indices:number[];_raw:{zero:Uint8Array;trailing:Uint8Array}}
export function readLegacyCellFlags(data:Uint8Array):LegacyCellFlagsResult {
  const c=new Cursor(data);if(c.ascii(4)!==CELL_FLAGS_MAGIC)throw new Error('LFCT_BAD_MAGIC')
  const version=c.u32();if(version>100)throw new Error('LFCT_NOT_LEGACY_SPARSE')
  const zero=c.bytesOf(16),oldWidth=c.i32(),count=c.u32()
  if(!Number.isSafeInteger(oldWidth)||oldWidth<=0)throw new Error('LFCT_SPARSE_OLD_WIDTH')
  if(count>4_194_304)throw new Error('LFCT_SPARSE_COUNT_BUDGET');c.require(count*4,'LFCT sparse indices')
  const indices=Array.from({length:count},()=>c.i32());return{version,oldWidth,indices,_raw:{zero,trailing:c.rest()}}
}
export function writeLegacyCellFlags(m:LegacyCellFlagsResult):Uint8Array {
  if(m.version>100||!Number.isSafeInteger(m.oldWidth)||m.oldWidth<=0||m.indices.length>4_194_304)throw new Error('LFCT_SPARSE_SHAPE')
  bytesLength(m._raw.zero,16,'LFCT sparse padding');const w=new Writer().ascii(CELL_FLAGS_MAGIC).u32(m.version).raw(m._raw.zero).i32(m.oldWidth).u32(m.indices.length)
  for(const i of m.indices)w.i32(i);return w.raw(m._raw.trailing).done()
}
/** Raw bit-1 expansion; NO claim that the resulting bit is final pathability. */
export function expandLegacyCellFlags(m:LegacyCellFlagsResult,newWidth:number,newHeight:number):Uint8Array{
  const result=new Uint8Array(gridCount(newWidth,newHeight))
  for(const i of m.indices){if(i<0)throw new Error('LFCT_NEGATIVE_INDEX');const x=i%m.oldWidth,y=Math.floor(i/m.oldWidth);if(x>=newWidth||y>=newHeight)throw new Error('LFCT_SPARSE_OUT_OF_GRID');result[x+y*newWidth]!|=2}
  return result
}
