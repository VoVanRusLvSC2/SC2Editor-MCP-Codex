/** DLFT: preserve undecoded bit patterns; typed position semantics conflict between sources.
 * v101 is opaque. v102 has two 32-bit lanes, v103 adds a byte. All writes are no-op.
 */
import { Cursor } from '../binary.js'
import { countBytes, integer, MAX_RECORDS } from '../guards.js'
import { protectReadOnly, preservedReadOnlyBytes } from '../readonly.js'
export const FLUFF_DOODAD_MAGIC = 'DLFT'
export interface FluffDoodad { x: number; y: number; type: number; rawWords: [number, number]; int32View: [number, number]; byteOffset: number }
export interface FluffDoodadResult {
  version: number; doodads: FluffDoodad[]; declaredCount: number
  status: 'opaque-v101' | 'raw-records'; positionSemantics: 'unresolved-float-vs-int'
  _raw: { zero: Uint8Array; trailing: Uint8Array }; raw: Uint8Array
}
export function readFluffDoodad(data: Uint8Array): FluffDoodadResult {
  const c = new Cursor(data)
  if (c.ascii(4) !== FLUFF_DOODAD_MAGIC) throw new Error('Invalid DLFT magic')
  const version = c.u32(); integer(version, 101, 103, 'DLFT version')
  const zero = c.bytesOf(16), declaredCount = c.u32(); integer(declaredCount, 0, MAX_RECORDS, 'DLFT count')
  const doodads: FluffDoodad[] = []
  if (version !== 101) {
    countBytes(declaredCount, version === 103 ? 9 : 8, c.remaining, 'DLFT records', MAX_RECORDS)
    for (let i = 0; i < declaredCount; i++) {
      const byteOffset = c.offset, raw = c.bytesOf(8), v = new DataView(raw.buffer, raw.byteOffset, 8)
      doodads.push({ byteOffset, x: v.getFloat32(0, true), y: v.getFloat32(4, true),
        rawWords: [v.getUint32(0, true), v.getUint32(4, true)], int32View: [v.getInt32(0, true), v.getInt32(4, true)], type: version === 103 ? c.u8() : 0 })
    }
  }
  return protectReadOnly({ version, doodads, declaredCount, status: version === 101 ? 'opaque-v101' : 'raw-records',
    positionSemantics: 'unresolved-float-vs-int', _raw: { zero, trailing: c.rest() }, raw: new Uint8Array(data) })
}
export function writeFluffDoodad(map: FluffDoodadResult): Uint8Array { return preservedReadOnlyBytes(map) }
