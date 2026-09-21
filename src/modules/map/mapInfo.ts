import { createHash } from "node:crypto";

export interface MapBounds { left: number; bottom: number; right: number; top: number }
export interface MapInfoPatch { playableBounds?: MapBounds; baseHeightFixed?: number; fogMaskStyle?: string; minimapResolution?: number }
/** v39 sequential core prefix. Everything after game_options_flags stays opaque.
 * Layout source: sc2-arcade-watcher/sc2-file-format-docs/mapinfo.md;
 * hash + offsets independently checked against four supplied native maps.
 */
export class MapInfoDocument {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly integrityHash: bigint;
  readonly localeMode: number;
  readonly mapDescription: string;
  readonly fogMaskStyle: string;
  readonly playableBounds: MapBounds;
  readonly baseHeightFixed: number;
  readonly minimapResolution: number;
  readonly gameOptionsFlags: number;
  readonly opaqueTailOffset: number;
  private readonly fields = new Map<string,{ start: number; end: number }>();
  constructor(readonly bytes: Buffer) {
    if(bytes.length < 28 || bytes.readUInt32LE(0) !== 0x4d617049) throw new Error("INVALID_MAPINFO_MAGIC");
    this.version = bytes.readUInt32LE(4);
    if(this.version !== 39) throw new Error(`UNSUPPORTED_MAPINFO_VERSION: ${this.version}; preserve only`);
    let offset = 8;
    const require = (n: number) => { if(n < 0 || offset + n > bytes.length) throw new Error("TRUNCATED_MAPINFO"); };
    const numeric = (key: string, signed = false) => {
      require(4); const start = offset; offset += 4; this.fields.set(key,{ start,end:offset });
      return signed ? bytes.readInt32LE(start) : bytes.readUInt32LE(start);
    };
    const string = (key: string, lengthPrefixed = false) => {
      const start = offset; let length: number;
      if(lengthPrefixed) { require(2); length = bytes.readUInt16LE(offset); offset += 2; if(length === 65535) throw new Error("MAPINFO_EXTENDED_STRING_PRESERVE_ONLY"); require(length); }
      else { const end = bytes.indexOf(0,offset); if(end < 0 || end - offset > 65535) throw new Error("INVALID_MAPINFO_STRING"); length = end-offset; }
      const value = bytes.subarray(offset,offset+length).toString("utf8");
      if(!Buffer.from(value).equals(bytes.subarray(offset,offset+length))) throw new Error("MAPINFO_NON_UTF8_PRESERVE_ONLY");
      offset += length + (lengthPrefixed ? 0 : 1); this.fields.set(key,{ start,end:offset }); return value;
    };
    require(8); this.integrityHash = bytes.readBigUInt64LE(offset); offset += 8;
    this.width = numeric("width"); this.height = numeric("height");
    if(this.width < 1 || this.width > 256 || this.height < 1 || this.height > 256) throw new Error("INVALID_MAPINFO_DIMENSIONS");
    this.localeMode = numeric("localeMode");
    if(this.localeMode > 2) throw new Error("INVALID_MAPINFO_LOCALE_MODE");
    if(this.localeMode === 2) string("localeText");
    const previewType = numeric("previewType");
    if(previewType > 2) throw new Error("INVALID_MAPINFO_PREVIEW_TYPE");
    if(previewType === 2) string("previewPath");
    string("minimapPath"); string("hoverPath");
    this.minimapResolution = numeric("minimapResolution"); numeric("difficulty");
    this.fogMaskStyle = string("fogMaskStyle"); this.mapDescription = string("description");
    this.playableBounds = { left:numeric("left",true),bottom:numeric("bottom",true),right:numeric("right",true),top:numeric("top",true) };
    this.baseHeightFixed = numeric("baseHeight",true); numeric("loadingScreenType");
    string("loadingImagePath"); string("loadingBar",true);
    for(const key of ["loadingScale","textAnchor","offsetX","offsetY","sizeX","sizeY"]) numeric(key,true);
    string("customLayoutPath"); string("customLayoutLocale",true); string("reserved39",true);
    this.gameOptionsFlags = numeric("gameOptionsFlags"); this.opaqueTailOffset = offset;
    this.assertBounds(this.playableBounds);
    if(this.computeIntegrityHash() !== this.integrityHash) throw new Error("MAPINFO_INTEGRITY_HASH_MISMATCH: writer disabled for this profile");
  }
  private assertBounds(b: MapBounds) {
    if(Object.keys(b).length !== 4 || [b.left,b.bottom,b.right,b.top].some(v => !Number.isInteger(v)) || b.left < 0 || b.bottom < 0 || b.right > this.width || b.top > this.height || b.right <= b.left || b.top <= b.bottom) throw new Error("INVALID_MAPINFO_PLAYABLE_BOUNDS");
  }
  computeIntegrityHash(bounds = this.playableBounds) {
    let flags = this.gameOptionsFlags, count = 0;
    while(flags) { flags = (flags & (flags-1)) >>> 0; count++; }
    const dx = bounds.right-bounds.left, dy = bounds.top-bounds.bottom;
    return BigInt(Buffer.byteLength(this.mapDescription) + 7*this.height + 2*(dx*dx+dy*dy) + 3*this.width-count-17);
  }
  inspect() {
    return { version:this.version, cells:[this.width,this.height],playableBounds:this.playableBounds,
      mapDescription:this.mapDescription,fogMaskStyle:this.fogMaskStyle,baseHeightFixed:this.baseHeightFixed,
      minimapResolution:this.minimapResolution,gameOptionsFlags:this.gameOptionsFlags,
      integrityHash:this.integrityHash.toString(),integrityVerified:true,opaqueTailOffset:this.opaqueTailOffset,
      opaqueTailBytes:this.bytes.length-this.opaqueTailOffset,sha256:createHash("sha256").update(this.bytes).digest("hex"),
      writerScope:["playableBounds","fogMaskStyle","minimapResolution"],
      playerAndVariantEditing:false,fromScratchSerialization:false };
  }
  patch(change: MapInfoPatch): Buffer {
    if(Object.keys(change).some(k => !["playableBounds","baseHeightFixed","fogMaskStyle","minimapResolution"].includes(k))) throw new Error("UNSUPPORTED_MAPINFO_FIELD");
    const edits: Array<{ start:number; end:number; bytes:Buffer }> = [];
    const set = (key: string, bytes: Buffer) => edits.push({ ...this.fields.get(key)!,bytes });
    const integer = (key: string, value: number, signed = false) => {
      if(!Number.isInteger(value) || value < (signed ? -0x80000000 : 0) || value > (signed ? 0x7fffffff : 0xffffffff)) throw new Error("INVALID_MAPINFO_INTEGER");
      const bytes = Buffer.alloc(4); if(signed) bytes.writeInt32LE(value); else bytes.writeUInt32LE(value); set(key,bytes);
    };
    if(change.playableBounds) { this.assertBounds(change.playableBounds); for(const [key,value] of Object.entries(change.playableBounds)) integer(key,value,true); }
    if(change.baseHeightFixed !== undefined && change.baseHeightFixed !== this.baseHeightFixed) throw new Error("MAPINFO_TERRAIN_BASE_HEIGHT_REBUILD_REQUIRED");
    if(change.minimapResolution !== undefined) { if(![1,2,3,4].includes(change.minimapResolution)) throw new Error("INVALID_MINIMAP_RESOLUTION"); integer("minimapResolution",change.minimapResolution); }
    if(change.fogMaskStyle !== undefined) {
      if(!["None","Dark","Black","BlackNoUnhide"].includes(change.fogMaskStyle)) throw new Error("UNSUPPORTED_FOG_MASK_STYLE");
      set("fogMaskStyle",Buffer.from(change.fogMaskStyle+"\0"));
    }
    const parts: Buffer[] = []; let offset = 0;
    for(const e of edits.sort((a,b) => a.start-b.start)) { parts.push(this.bytes.subarray(offset,e.start),e.bytes); offset=e.end; }
    parts.push(this.bytes.subarray(offset)); const result = Buffer.concat(parts);
    result.writeBigUInt64LE(this.computeIntegrityHash(change.playableBounds),8);
    new MapInfoDocument(result); return result;
  }
}
