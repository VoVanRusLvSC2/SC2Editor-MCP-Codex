import { createHash } from "node:crypto";
import { scanXml } from "../../../core/xmlScanner.js";
import { escapeXml } from "../schemas.js";
export interface DocumentBuild {
    major: number;
    minor: number;
    patch: number;
    build: number;
}
export function buildTuple(version: string): DocumentBuild { const m = version.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if (!m)
    throw new Error("DOCUMENT_BUILD_VERSION_UNSUPPORTED"); const [major, minor, patch, build] = m.slice(1).map(Number); if ([major, minor, patch].some(v => v > 255) || build > 0xffffffff)
    throw new Error("DOCUMENT_BUILD_RANGE"); return { major, minor, patch, build }; }
export class Writer {
    private parts: Buffer[] = [];
    u8(v: number) { const b = Buffer.alloc(1); b.writeUInt8(v); this.parts.push(b); return this; }
    u32(v: number) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.parts.push(b); return this; }
    i32(v: number) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.parts.push(b); return this; }
    u64(v: bigint) { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); this.parts.push(b); return this; }
    raw(b: Buffer) { this.parts.push(b); return this; }
    cstr(v: string) { if (v.includes('\0') || Buffer.from(v).toString('utf8') !== v || Buffer.byteLength(v) > 65534)
        throw new Error("DOCUMENT_BINARY_STRING_INVALID"); return this.raw(Buffer.from(v + '\0')); }
    text16(v: string) { const b = Buffer.from(v); if (b.length > 65534 || b.toString('utf8') !== v || v.includes('\0'))
        throw new Error("DOCUMENT_BINARY_STRING_INVALID"); const n = Buffer.alloc(2); n.writeUInt16LE(b.length); return this.raw(n).raw(b); }
    done() { return Buffer.concat(this.parts); }
}
export class Reader {
    offset = 0;
    constructor(readonly bytes: Buffer) { }
    take(n: number) { if (n < 0 || this.offset + n > this.bytes.length)
        throw new Error("DOCUMENT_COMPONENT_TRUNCATED"); const b = this.bytes.subarray(this.offset, this.offset + n); this.offset += n; return b; }
    u8() { return this.take(1)[0]; }
    u32() { return this.take(4).readUInt32LE(); }
    cstr() { const end = this.bytes.indexOf(0, this.offset); if (end < this.offset || end - this.offset > 65534)
        throw new Error("DOCUMENT_BINARY_STRING_INVALID"); return this.utf8(this.take(end - this.offset + 1).subarray(0, -1)); }
    text16() { return this.utf8(this.take(this.take(2).readUInt16LE())); }
    utf8(b: Buffer) { const v = b.toString('utf8'); if (!Buffer.from(v).equals(b))
        throw new Error("DOCUMENT_UTF8_INVALID"); return v; }
    end() { if (this.offset !== this.bytes.length)
        throw new Error("DOCUMENT_COMPONENT_TRAILING_BYTES"); }
}
export function versionMarker(tag: string, build: DocumentBuild, timestamp: number, entryCount = 0) { if (!['info','text','gada','attr','aiai','uiui','cuts','font','mapi','terr','plob','regi','trig','cine','stdi'].includes(tag) || !Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff)
    throw new Error("DOCUMENT_VERSION_ARGUMENT"); const w = new Writer().raw(Buffer.from('cdes')).raw(Buffer.from(tag).reverse()).u32(2); for (const n of [build.build, build.major, build.minor, build.patch, build.build, entryCount, timestamp, 1])
    w.u32(n); return w.done(); }
export function readVersion(bytes: Buffer) { if (bytes.length !== 44 || bytes.toString('ascii', 0, 4) !== 'cdes' || bytes.readUInt32LE(8) !== 2)
    throw new Error("DOCUMENT_VERSION_PROFILE"); return { tag: Buffer.from(bytes.subarray(4, 8)).reverse().toString('ascii'), build: bytes.readUInt32LE(12), major: bytes.readUInt32LE(16), minor: bytes.readUInt32LE(20), patch: bytes.readUInt32LE(24), build2: bytes.readUInt32LE(28), entryCount: bytes.readUInt32LE(32), timestamp: bytes.readUInt32LE(36), terminal: bytes.readUInt32LE(40) }; }
export function documentInfo(specs: string[], extension: boolean) { return Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n    <ModType><Value>Interface</Value></ModType>\r\n' + (extension ? '    <Flags><Value>ExtensionMod</Value></Flags>\r\n' : '') + '    <Dependencies>\r\n' + specs.map(s => '        <Value>' + escapeXml(s) + '</Value>\r\n').join('') + '    </Dependencies>\r\n</DocInfo>\r\n'); }
export function readDocumentInfo(bytes: Buffer) { const source = bytes.toString('utf8'); if (!Buffer.from(source).equals(bytes))
    throw new Error('DOCUMENT_UTF8_INVALID'); const xml = scanXml(source); if (xml.diagnostics.some(d => d.severity === 'error') || xml.rootIds.length !== 1 || xml.nodes[xml.rootIds[0]].tag !== 'DocInfo')
    throw new Error('DOCUMENT_INFO_INVALID'); const read = (parent: string) => xml.nodes.filter(n => n.tag === 'Value' && xml.nodes[n.parentId!]?.tag === parent).map(n => source.slice(n.startTagEnd, n.endTagStart).trim().replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')); return { dependencies: read('Dependencies'), flags: read('Flags'), modType: read('ModType') }; }
export interface HeaderString {
    key: string;
    locale: string;
    value: string;
}
/** H2CS v8 native local-document profile. Publication/catalog identities are intentionally unassigned. */
export function documentHeader(specs: string[], strings: HeaderString[], build: DocumentBuild, kind: 'map' | 'mod', identity: number, players = 0) {
    const w = new Writer().raw(Buffer.from('H2CS')).u32(8).u32(0x5332).u8(1).u8(build.major).u8(build.minor).u8(build.patch).u32(build.build).u32(build.build).u32(kind === 'mod' ? 2 : 0).u32(identity).u32(identity).u32(players).u32(0).u32(specs.length);
    for (const s of specs)
        w.cstr(s);
    w.u32(strings.length);
    for (const s of strings) {
        if (!/^[a-z]{2}[A-Z]{2}$/.test(s.locale))
            throw new Error('DOCUMENT_LOCALE_INVALID');
        w.text16(s.key).raw(Buffer.from(s.locale).reverse()).text16(s.value);
    }
    return w.done();
}
export function readDocumentHeader(bytes: Buffer) { const r = new Reader(bytes); if (r.take(4).toString() !== 'H2CS' || r.u32() !== 8 || r.u32() !== 0x5332)
    throw new Error('DOCUMENT_HEADER_PROFILE'); const buildFlag = r.u8(), major = r.u8(), minor = r.u8(), patch = r.u8(), build = r.u32(), build2 = r.u32(), kind = r.u32(), identity = r.u32(), identity2 = r.u32(), players = r.u32(), reserved = r.u32(), count = r.u32(); if (count > 512)
    throw new Error('DOCUMENT_DEPENDENCY_COUNT'); const dependencies = Array.from({ length: count }, () => r.cstr()); const sc = r.u32(); if (sc > 65536)
    throw new Error('DOCUMENT_LOCALIZATION_COUNT'); const strings = Array.from({ length: sc }, () => ({ key: r.text16(), locale: Buffer.from(r.take(4)).reverse().toString('ascii'), value: r.text16() })); r.end(); return { buildFlag, major, minor, patch, build, build2, kind, identity, identity2, players, reserved, dependencies, strings }; }
export const contentIdentity = (seed: string) => createHash('sha256').update(seed).digest().readUInt32LE();
