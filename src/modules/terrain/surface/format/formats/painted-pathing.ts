/** Physical storage, NOT resolved navigation. Both pathing and creep paint use this shape.
 * Map/world-to-buffer origin/wrapping and the native lookup tables remain unverified.
 */
import { Cursor, Writer } from '../binary.js'
import { cellIndex, bytesLength, inputSize } from '../guards.js'
export const PAINTED_GRID_SIZE = 512
const CELL_BYTES = 512 * 512 * 2
export const PAINTED_LAYER_BYTE_LENGTH = 16 + CELL_BYTES
export interface PaintedPathingResult {
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  paint?: Uint8Array; raw: Uint8Array; trailing?: Uint8Array
  status: 'physical-grid' | 'opaque-short'
}
export function paintedValueAt(result: PaintedPathingResult, x: number, y: number, secondary = false): number {
  if (!result.paint) throw new Error('PAINTED_LAYER_NOT_DECODED')
  return result.paint[2 * cellIndex(x, y, 512, 512) + (secondary ? 1 : 0)]!
}
export function readPaintedPathing(bytes: Uint8Array): PaintedPathingResult {
  inputSize(bytes)
  if (bytes.length < PAINTED_LAYER_BYTE_LENGTH) return { raw: new Uint8Array(bytes), status: 'opaque-short' }
  const c = new Cursor(bytes), bounds = { minX: c.i32(), minY: c.i32(), maxX: c.i32(), maxY: c.i32() }
  return { bounds, paint: c.bytesOf(CELL_BYTES), raw: new Uint8Array(bytes), trailing: c.rest(), status: 'physical-grid' }
}
export function writePaintedPathing(data: PaintedPathingResult): Uint8Array {
  if (!data.paint || !data.bounds) {
    if (data.paint || data.bounds || data.status !== 'opaque-short') throw new Error('Incomplete painted-layer model')
    return data.raw.slice()
  }
  bytesLength(data.paint, CELL_BYTES, 'painted grid')
  const { minX, minY, maxX, maxY } = data.bounds
  return new Writer().i32(minX).i32(minY).i32(maxX).i32(maxY).raw(data.paint).raw(data.trailing ?? new Uint8Array()).done()
}
