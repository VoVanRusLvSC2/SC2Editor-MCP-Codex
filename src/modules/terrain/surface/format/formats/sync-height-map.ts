/** SMAP decoding is layout-explicit. The supplied interleaved interpretation conflicts with
 * external native-reader notes (two planes for v102+). Never infer a world Z from this payload. */
import { Cursor, Writer } from '../binary.js'
import { gridCount, bytesLength, integer } from '../guards.js'
export const SYNC_HEIGHT_MAGIC='SMAP'
export type SyncHeightLayout='legacy-u16'|'planar-u16-i16'|'archive-interleaved-i16-u16'
export interface SyncHeightCell {height:number;mask:number;secondary?:number}
export interface SyncHeightResult {
  sizeX:number;sizeY:number;version:number;cells:SyncHeightCell[];layout:SyncHeightLayout
  dimensionSource:'header-hint'|'provided';layoutEvidence:string
  _raw:{headerExtra:Uint8Array;trailing:Uint8Array;headerPrefix?:Uint8Array;originalShape?:[number,number,number];originalLayout?:SyncHeightLayout}
}
export interface SyncHeightOptions {sizeX?:number;sizeY?:number;layout?:SyncHeightLayout}
export function readSyncHeightMap(bytes:Uint8Array,options:SyncHeightOptions={}):SyncHeightResult {
  const c=new Cursor(bytes)
  if(c.ascii(4)!==SYNC_HEIGHT_MAGIC)throw new Error('SMAP_BAD_MAGIC')
  const version=c.u32(),headerX=c.u32(),headerY=c.u32(),headerExtra=c.bytesOf(48)
  integer(version,100,102,'SMAP version')
  if(version===102 && !options.layout)throw new Error('SMAP_LAYOUT_PROFILE_REQUIRED: external planar and supplied interleaved interpretations conflict')
  if((options.sizeX===undefined)!==(options.sizeY===undefined))throw new Error('SMAP_BOTH_DIMENSIONS_REQUIRED')
  const sizeX=options.sizeX??headerX,sizeY=options.sizeY??headerY
  const layout=options.layout??(version<=101?'legacy-u16':'planar-u16-i16')
  if(layout==='legacy-u16'&&version>101 || layout==='planar-u16-i16'&&version<102)throw new Error('SMAP_LAYOUT_VERSION_MISMATCH')
  const count=gridCount(sizeX,sizeY,layout==='legacy-u16'?2:4,c.remaining,'SMAP')
  const cells:SyncHeightCell[]=new Array(count)
  if(layout==='archive-interleaved-i16-u16')for(let i=0;i<count;i++)cells[i]={height:c.i16(),mask:c.u16()}
  else {
    for(let i=0;i<count;i++)cells[i]={height:c.u16(),mask:0}
    if(layout==='planar-u16-i16')for(let i=0;i<count;i++){const secondary=c.i16();cells[i]!.secondary=secondary;cells[i]!.mask=secondary&65535}
  }
  return {sizeX,sizeY,version,cells,layout,dimensionSource:options.sizeX===undefined?'header-hint':'provided',
    layoutEvidence:layout==='archive-interleaved-i16-u16'?'supplied-archive-conflicts-with-external-reader':'external-reader-not-independently-native-verified',
    _raw:{headerExtra,trailing:c.rest(),headerPrefix:new Uint8Array(bytes.subarray(0,16)),originalShape:[sizeX,sizeY,version],originalLayout:layout}}
}
export function writeSyncHeightMap(m:SyncHeightResult):Uint8Array {
  integer(m.version,100,102,'SMAP version')
  if(m._raw.originalShape && [m.sizeX,m.sizeY,m.version].some((v,i)=>v!==m._raw.originalShape![i]))throw new Error('SMAP_STRUCTURAL_RESIZE_UNSUPPORTED')
  if(m._raw.originalLayout && m.layout!==m._raw.originalLayout)throw new Error('SMAP_LAYOUT_CONVERSION_UNSUPPORTED')
  bytesLength(m._raw.headerExtra,48,'SMAP extra header')
  const count=gridCount(m.sizeX,m.sizeY,4,undefined,'SMAP')
  if(m.cells.length!==count)throw new Error('SMAP_CELL_COUNT')
  if(m.layout==='legacy-u16'&&m.version>101 || m.layout==='planar-u16-i16'&&m.version<102)throw new Error('SMAP_LAYOUT_VERSION_MISMATCH')
  const w=new Writer(64+count*4+m._raw.trailing.length)
  if(m._raw.headerPrefix){bytesLength(m._raw.headerPrefix,16,'SMAP prefix');const p=new Cursor(m._raw.headerPrefix);if(p.ascii(4)!==SYNC_HEIGHT_MAGIC||p.u32()!==m.version)throw new Error('SMAP_PREFIX_MISMATCH');w.raw(m._raw.headerPrefix)}
  else w.ascii(SYNC_HEIGHT_MAGIC).u32(m.version).u32(m.sizeX).u32(m.sizeY)
  w.raw(m._raw.headerExtra)
  if(m.layout==='archive-interleaved-i16-u16')for(const v of m.cells)w.i16(v.height).u16(v.mask)
  else {
    for(const v of m.cells){if(m.layout==='legacy-u16'&&(v.mask!==0||v.secondary!==undefined))throw new Error('SMAP_LEGACY_HAS_NO_SECONDARY');w.u16(v.height)}
    if(m.layout==='planar-u16-i16')for(const v of m.cells){const s=integer(v.secondary??0,-32768,32767,'SMAP secondary');if(v.mask!==(s&65535))throw new Error('SMAP_SECONDARY_ALIAS_MISMATCH');w.i16(s)}
  }
  return w.raw(m._raw.trailing).done()
}
