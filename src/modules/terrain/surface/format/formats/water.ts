/** WATR: conservative default reader + explicit experimental body-layout profile.
 * No body/shore/level authoring. Details and conflicting evidence: docs/FORMATS_RU.md.
 * The original rectangle-only decoder is valid only for a subset, not every WATR.
 */
import { Cursor } from '../binary.js'
import { integer, countBytes, MAX_RECORDS } from '../guards.js'
import { protectReadOnly, preservedReadOnlyBytes } from '../readonly.js'
export const WATER_MAGIC = 'WATR'
export interface WaterZone {
  templateId: string; templateIdBytes: Uint8Array
  /** Candidate interpretations of four raw words, NOT a proven universal rectangle. */
  startX: number; startY: number; endX: number; endY: number
  words: number[]; byteOffset: number; finiteRectangleCandidate: boolean
}
export interface WaterWaveRecord { byteOffset: number; byteLength: number; words: number[]; raw: Uint8Array; fields: Array<{name:string;memoryOffset:number;fileOffset:number|null;words:number[];floatView:number[];defaulted?:boolean}> }
export interface WaterBody {
  byteOffset: number; byteLength: number; names: string[]; rawNames: Uint8Array[]
  flagA: number; flagB?: number; extraNames: string[]
  waves: WaterWaveRecord[]; parameters: WaterWaveRecord; footer: number[]
}
export interface WaterResult {
  version: number; bodyCount: number; entryCount: number
  zones: WaterZone[]; bodies: WaterBody[]
  status: 'flat-table' | 'opaque-bodies' | 'experimental-bodies'
  evidence: string; parsedEnd: number
  _raw: { zero: Uint8Array; trailing: Uint8Array }
  raw: Uint8Array
}
export interface WaterReadOptions { bodyLayout?: 'opaque' | 'external-sequential' }
const utf8 = new TextDecoder('utf-8')
function name(bytes: Uint8Array): string {
  const n = bytes.indexOf(0); return utf8.decode(bytes.subarray(0, n < 0 ? bytes.length : n))
}
/** Computed sum of sequential fields, not an in-memory C++ sizeof. Experimental. */
export function waterWaveByteLength(version: number): number {
  integer(version, 104, 110, 'WATR version')
  return 104 + (version >= 106 ? 4 : 0) + (version >= 108 ? 4 : 0) + (version >= 110 ? 4 : 0)
}
function wave(c: Cursor, version: number): WaterWaveRecord {
  const byteOffset = c.offset, byteLength = waterWaveByteLength(version), raw = c.bytesOf(byteLength)
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const fields:WaterWaveRecord['fields']=[];let offset=0
  const add=(name:string,memoryOffset:number,count:number)=>{const start=offset;offset+=count*4;fields.push({name,memoryOffset,fileOffset:byteOffset+start,words:Array.from({length:count},(_,i)=>view.getUint32(start+i*4,true)),floatView:Array.from({length:count},(_,i)=>view.getFloat32(start+i*4,true))})}
  add('base_data',0,8);add('field_20',0x20,1);add('field_24',0x24,4);add('field_34',0x34,1)
  if(version>=108)add('field_38',0x38,1);else fields.push({name:'field_38',memoryOffset:0x38,fileOffset:null,words:[0],floatView:[0],defaulted:true})
  add('field_3c',0x3c,1);add('field_40',0x40,1);add('field_44',0x44,4);add('field_54',0x54,1)
  if(version>=110){add('uv_u',0x58,1);add('uv_v',0x5c,1)}else if(version>=106)add('uv_shared',0x58,1)
  else fields.push({name:'uv_u_and_v',memoryOffset:0x58,fileOffset:null,words:[0x3f800000,0x3f800000],floatView:[1,1],defaulted:true})
  for(const memoryOffset of[0x60,0x64,0x68,0x6c,0x70])add('field_'+memoryOffset.toString(16),memoryOffset,1)
  if(offset!==byteLength)throw new Error('INTERNAL_WAVE_LAYOUT_SIZE')
  return { byteOffset, byteLength, raw, fields, words: Array.from({ length: byteLength / 4 }, (_, i) => view.getUint32(i * 4, true)) }
}
export function readWater(data: Uint8Array, options: WaterReadOptions = {}): WaterResult {
  const c = new Cursor(data)
  if (c.ascii(4) !== WATER_MAGIC) throw new Error('Invalid WATR magic')
  const version = c.u32(); integer(version, 104, 110, 'WATR version')
  const entryCount = c.u32(), bodyCount = c.u32()
  integer(entryCount, 0, MAX_RECORDS, 'WATR entries'); integer(bodyCount, 0, 10_000, 'WATR bodies')
  c.bytesOf(16)
  const result: WaterResult = {
    version, bodyCount, entryCount, zones: [], bodies: [], status: bodyCount ? 'opaque-bodies' : 'flat-table',
    evidence: bodyCount ? 'body boundaries unresolved by default; full raw retained' : 'archive + external header/table agreement; float meaning not engine-certified',
    parsedEnd: 32, _raw: { zero: new Uint8Array(data.subarray(12, 32)), trailing: new Uint8Array() }, raw: new Uint8Array(data),
  }
  if (bodyCount && options.bodyLayout !== 'external-sequential') {
    // Cannot safely locate global entries after unknown variable-size bodies.
    // Header-only mode deliberately does not certify that the body payload is valid.
    result._raw.trailing = c.rest(); return protectReadOnly(result)
  }
  if (bodyCount) {
    result.status = 'experimental-bodies'
    result.evidence = 'opt-in external-sequential hypothesis; no real-map/native validation; inline record-size ambiguity remains'
    for (let i = 0; i < bodyCount; i++) {
      const byteOffset = c.offset
      const rawNames = [c.bytesOf(40), c.bytesOf(40)]
      if (version >= 107 && version <= 109) rawNames.push(c.bytesOf(40), c.bytesOf(40))
      const flagA = c.u8(), flagB = version >= 105 ? c.u8() : undefined, extraNames: string[] = []
      if (version === 109) {
        const n = c.u32(); countBytes(n, 40, c.remaining, 'WATR extra strings', MAX_RECORDS)
        for (let j = 0; j < n; j++) { const b = c.bytesOf(40); rawNames.push(b); extraNames.push(name(b)) }
      }
      const n = c.u32(); countBytes(n, waterWaveByteLength(version), c.remaining, 'WATR waves', 1000)
      const waves = Array.from({ length: n }, () => wave(c, version))
      const parameters = wave(c, version), footer = [c.i32(), c.i32(), c.i32()]
      result.bodies.push({ byteOffset, byteLength: c.offset - byteOffset, names: rawNames.map(name), rawNames, flagA, flagB, extraNames, waves, parameters, footer })
    }
  }
  countBytes(entryCount, 56, c.remaining, 'WATR global entries', MAX_RECORDS)
  for (let i = 0; i < entryCount; i++) {
    const byteOffset = c.offset, templateIdBytes = c.bytesOf(40), rawWords = c.bytesOf(16)
    const v = new DataView(rawWords.buffer, rawWords.byteOffset, 16)
    const floats = [0, 4, 8, 12].map(o => v.getFloat32(o, true))
    const words = [0, 4, 8, 12].map(o => v.getUint32(o, true))
    const [startX, startY, endX, endY] = floats as [number, number, number, number]
    result.zones.push({ byteOffset, templateId: name(templateIdBytes), templateIdBytes, words,
      startX, startY, endX, endY,
      finiteRectangleCandidate: floats.every(Number.isFinite) && endX > startX && endY > startY })
  }
  result.parsedEnd = c.offset; result._raw.trailing = c.rest()
  return protectReadOnly(result)
}
/** Deliberately no-op only. Any changed parsed field or raw byte is rejected. */
export function writeWater(map: WaterResult): Uint8Array { return preservedReadOnlyBytes(map) }
/** Fixed name encoder: explicit rejection replaces silent truncation and high-bit masking. */
export function encodeWaterTemplateId(id: string): Uint8Array {
  if (!/^[\x20-\x7e]{1,39}$/.test(id)) throw new Error('WATER_ID_REQUIRES_1_TO_39_PRINTABLE_ASCII_BYTES')
  const out = new Uint8Array(40); out.set(new TextEncoder().encode(id)); return out
}
