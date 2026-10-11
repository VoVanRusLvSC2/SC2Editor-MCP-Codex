/** MASK v102: 8 layers of 64x64 high-even nibbles. Older pixel layout is explicit.
 * Layout evidence: supplied format.zip and external reader notes; engine acceptance unexecuted. */
import { Cursor, Writer } from '../binary.js'
import { gridCount, integer, bytesLength, cellIndex } from '../guards.js'
export const TEXTURE_MASKS_MAGIC = 'MASK'
export const TEXTURE_BLOCK_SIZE = 2048
export interface TextureMasksResult {
  sizeX: number; sizeY: number; version: number; unk: number
  tilesX: number; tilesY: number; blocksPerLayer: number; layers: number
  encoding: 'tiled-nibbles' | 'legacy-u16-pixels'
  body: Uint8Array
  _raw: {zero: Uint8Array; trailing: Uint8Array}
}
function shape(width: number, height: number, version: number, reserved: number): number {
  integer(version,0,102,'MASK version'); integer(reserved,0,0,'MASK reserved')
  integer(width,64,2048,'MASK width'); integer(height,64,2048,'MASK height')
  if (width%64 || height%64) throw new Error('MASK_DIMENSIONS_MUST_BE_MULTIPLES_OF_64')
  return gridCount(width,height,4,undefined,'MASK') * 4
}
export function readTextureMasks(bytes: Uint8Array): TextureMasksResult {
  const c = new Cursor(bytes)
  if (c.ascii(4)!==TEXTURE_MASKS_MAGIC) throw new Error('MASK_BAD_MAGIC')
  const version=c.u32(), unk=c.u32(), sizeX=c.u32(), sizeY=c.u32(), zero=c.bytesOf(44)
  const bodySize=shape(sizeX,sizeY,version,unk)
  c.require(bodySize,'MASK exactly eight layers')
  return {sizeX,sizeY,version,unk,tilesX:sizeX/64,tilesY:sizeY/64,blocksPerLayer:sizeX*sizeY/4096,layers:8,
    encoding:version===102?'tiled-nibbles':'legacy-u16-pixels',body:c.bytesOf(bodySize),_raw:{zero,trailing:c.rest()}}
}
export function writeTextureMasks(m: TextureMasksResult): Uint8Array {
  const expected=shape(m.sizeX,m.sizeY,m.version,m.unk)
  bytesLength(m.body,expected,'MASK body');bytesLength(m._raw.zero,44,'MASK padding')
  if (m.layers!==8 || m.tilesX!==m.sizeX/64 || m.tilesY!==m.sizeY/64 || m.blocksPerLayer!==m.sizeX*m.sizeY/4096) throw new Error('MASK_DERIVED_LAYOUT_MISMATCH')
  if (m.encoding!==(m.version===102?'tiled-nibbles':'legacy-u16-pixels')) throw new Error('MASK_ENCODING_VERSION_MISMATCH')
  return new Writer(64+expected+m._raw.trailing.length).ascii(TEXTURE_MASKS_MAGIC).u32(m.version).u32(m.unk).u32(m.sizeX).u32(m.sizeY).raw(m._raw.zero).raw(m.body).raw(m._raw.trailing).done()
}
export function textureMaskAddress(m: TextureMasksResult, layer: number, x: number, y: number): {offset:number;shift:number;bytes:number} {
  integer(layer,0,7,'MASK layer');cellIndex(x,y,m.sizeX,m.sizeY)
  if (m.encoding==='legacy-u16-pixels') return {offset:2*(Math.floor(layer/4)*m.sizeX*m.sizeY+y*m.sizeX+x),shift:4*(3-layer%4),bytes:2}
  const block=layer*m.blocksPerLayer+Math.floor(y/64)*m.tilesX+Math.floor(x/64)
  return {offset:block*TEXTURE_BLOCK_SIZE+(y%64)*32+Math.floor((x%64)/2),shift:x%2===0?4:0,bytes:1}
}
export function textureMaskWeight(m: TextureMasksResult, layer: number, x: number, y: number): number {
  const a=textureMaskAddress(m,layer,x,y)
  const word=a.bytes===1?m.body[a.offset]!:new DataView(m.body.buffer,m.body.byteOffset,m.body.length).getUint16(a.offset,true)
  return (word>>>a.shift)&15
}
/** Changes only the addressed nibble. Does not normalize other layers or rebuild RTXT. */
export function setTextureMaskWeight(m: TextureMasksResult, layer: number, x: number, y: number, weight: number): void {
  integer(weight,0,15,'MASK weight')
  const a=textureMaskAddress(m,layer,x,y),view=new DataView(m.body.buffer,m.body.byteOffset,m.body.length)
  if (a.bytes===1) m.body[a.offset]=(m.body[a.offset]! & ~(15<<a.shift)) | (weight<<a.shift)
  else view.setUint16(a.offset,(view.getUint16(a.offset,true)&~(15<<a.shift))|(weight<<a.shift),true)
}
export function extractLayerWeights(m: TextureMasksResult, layer: number): Uint8Array {
  integer(layer,0,7,'MASK layer')
  const out=new Uint8Array(m.sizeX*m.sizeY)
  for(let y=0;y<m.sizeY;y++) for(let x=0;x<m.sizeX;x++) out[y*m.sizeX+x]=textureMaskWeight(m,layer,x,y)
  return out
}
export const expandedTextureWeight=(weight:number):number=>integer(weight,0,15,'MASK weight')*17
