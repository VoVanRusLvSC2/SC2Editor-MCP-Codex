import { MapInfoDocument } from "../../map/mapInfo.js";
import { PlayersDocument } from "../../settings/players.js";
import { Reader, Writer } from "./metadata.js";
export function createMapInfo(width: number, height: number, label: string, baseHeight: number, timestamp: number, terrain = true) {
    const bounds = { left: 8, bottom: 8, right: width - 8, top: height - 8 }, flags = 0x4000;
    const dx = bounds.right - bounds.left, dy = bounds.top - bounds.bottom;
    const hash = BigInt(Buffer.byteLength(label) + 7 * height + 2 * (dx * dx + dy * dy) + 3 * width - 1 - 17);
    const w = new Writer().u32(0x4d617049).u32(39).u64(hash).u32(width).u32(height).u32(1).u32(terrain ? 1 : 0).cstr('').cstr('').u32(1).u32(0).cstr('Dark').cstr(label);
    for (const n of [bounds.left, bounds.bottom, bounds.right, bounds.top, Math.round((baseHeight - 0.5) * 4096), 0])
        w.i32(n);
    w.cstr('').text16('').i32(0).i32(0).i32(0).i32(0).i32(800).i32(600).cstr('').text16('').text16('').u32(flags);
    w.i32(1).u32(2).u32(8192).u32(0).u32(timestamp).u8(16).u32(0).text16('').u32(3);
    for (const [id, control, team] of [[0, 3, 0], [1, 1, -1], [15, 4, 0]])
        w.u8(id).u32(control).i32(team).cstr('').u32(0).u32(0).u32(0).cstr('');
    // Empty start locations, alliance bits, team slots, team entries and enemy bits.
    for (let i = 0; i < 7; i++)
        w.u32(0);
    // No lighting override and no camera override.
    for (let i = 0; i < 6; i++)
        w.u32(0);
    const bytes = w.done();
    const core = new MapInfoDocument(bytes), players = new PlayersDocument(bytes);
    if (core.computeIntegrityHash() !== hash || players.players.length !== 3)
        throw new Error('DOCUMENT_MAPINFO_SELF_CHECK');
    validateEmptyMapInfo(bytes);
    return bytes;
}
export function validateEmptyMapInfo(bytes: Buffer) { const players = new PlayersDocument(bytes), r = new Reader(bytes); r.offset = players.tableEnd; for (let i = 0; i < 13; i++)
    if (r.u32() !== 0)
        throw new Error('DOCUMENT_MAPINFO_NONEMPTY_TAIL'); r.end(); return { ...players.inspect(), core: players.core.inspect() }; }
