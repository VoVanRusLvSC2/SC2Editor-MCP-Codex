import { MapInfoDocument } from "../map/mapInfo.js";
import type { SettingsOperation } from "./schemas.js";
const controls = ["None", "User", "Computer", "Neutral", "Hostile"] as const;
const flags = { disableReplay: 1, waitForKey: 2, disableTriggerPreload: 4, horizontalFov: 16, hideErrorsTest: 32, disableObservers: 64, staggerEvents: 512, showErrorsOnline: 4096, showCountdown: 8192, allUnitsUseBaseHeight: 16384, disableViewEveryone: 32768, disableTakeCommand: 65536, disableRecoverGame: 131072 };
interface Span {
    start: number;
    end: number;
}
export interface PlayerRecord {
    id: number;
    control: typeof controls[number];
    team: number;
    aiName: string;
    color: number;
    startLocation: number;
    resourceFlags: number;
    decal: string;
}
/** Only the v39 stream profile. In-memory struct padding is never serialized. */
export class PlayersDocument {
    readonly core: MapInfoDocument;
    readonly players: PlayerRecord[] = [];
    readonly startLocationIds: number[] = [];
    readonly tableEnd: number;
    readonly defaultObservedPlayer: number;
    private readonly fields = new Map<number, Record<string, Span>>();
    constructor(readonly bytes: Buffer) {
        this.core = new MapInfoDocument(bytes);
        let o = this.core.opaqueTailOffset;
        const take = (n: number) => { if (n < 0 || o + n > bytes.length)
            throw new Error("TRUNCATED_PLAYER_MAPINFO"); const start = o; o += n; return start; };
        const u32 = () => bytes.readUInt32LE(take(4));
        const cstr = () => { const start = o, end = bytes.indexOf(0, o); if (end < 0 || end - o > 4096)
            throw new Error("INVALID_PLAYER_STRING"); take(end - o + 1); const value = bytes.subarray(start, end).toString("utf8"); if (!Buffer.from(value).equals(bytes.subarray(start, end)))
            throw new Error("NON_UTF8_PLAYER_STRING"); return value; };
        const speed = bytes.readInt32LE(take(4)), publish = u32();
        if (speed < -1 || speed > 1 || publish > 2)
            throw new Error("UNSUPPORTED_PLAYER_CORE_PROFILE");
        take(12);
        this.defaultObservedPlayer = bytes[take(1)];
        const authors = u32();
        if (authors > 999)
            throw new Error("INVALID_AUTHOR_COUNT");
        for (let i = 0; i < authors; i++) {
            cstr();
            take(12);
        }
        const musicLength = bytes.readUInt16LE(take(2));
        if (musicLength === 65535)
            throw new Error("EXTENDED_MUSIC_STRING_UNSUPPORTED");
        take(musicLength);
        const count = u32();
        if (count > 16)
            throw new Error("INVALID_PLAYER_COUNT");
        for (let i = 0; i < count; i++) {
            const id = bytes[take(1)];
            if (id > 16 || this.fields.has(id))
                throw new Error("INVALID_PLAYER_SLOT");
            const spans: Record<string, Span> = {};
            const number = (name: string, signed = false) => { const start = o; const v = signed ? bytes.readInt32LE(take(4)) : u32(); spans[name] = { start, end: o }; return v; };
            const string = (name: string) => { const start = o, v = cstr(); spans[name] = { start, end: o }; return v; };
            const control = number("control");
            if (control > 4)
                throw new Error("INVALID_PLAYER_CONTROL");
            const team = number("team", true), aiName = string("aiName"), color = number("color"), startLocation = number("startLocation"), resourceFlags = number("resourceFlags"), decal = string("decal");
            this.players.push({ id, control: controls[control], team, aiName, color, startLocation, resourceFlags, decal });
            this.fields.set(id, spans);
        }
        this.tableEnd = o;
        const locations = u32();
        if (locations > 256)
            throw new Error("INVALID_START_LOCATION_COUNT");
        for (let i = 0; i < locations; i++)
            this.startLocationIds.push(u32());
        if (new Set(this.startLocationIds).size !== locations)
            throw new Error("DUPLICATE_START_LOCATION_ID");
        // The remaining alliance/team/lighting structures are preserved byte-for-byte.
    }
    inspect() { return { version: 39, players: this.players, startLocationIds: this.startLocationIds, defaultObservedPlayer: this.defaultObservedPlayer, options: Object.fromEntries(Object.entries(flags).map(([name, mask]) => [name, !!(this.core.gameOptionsFlags & mask)])), playerTableEnd: this.tableEnd, preservedTailBytes: this.bytes.length - this.tableEnd, teamAndAllianceWriting: false }; }
    patch(operation: Extract<SettingsOperation, {
        op: "player.set" | "options.set";
    }>): Buffer {
        const edits: Array<Span & {
            bytes: Buffer;
        }> = [];
        if (operation.op === "player.set") {
            const spans = this.fields.get(operation.playerId);
            if (!spans)
                throw new Error("PLAYER_NOT_FOUND");
            for (const [key, value] of Object.entries(operation.patch)) {
                if (key === "startLocation" && value !== 0 && value !== this.players.find(p => p.id === operation.playerId)!.startLocation && !this.startLocationIds.includes(value as number))
                    throw new Error("START_LOCATION_NOT_REGISTERED");
                let b: Buffer;
                if (typeof value === "string" && key !== "control") {
                    if (Buffer.from(value).toString("utf8") !== value || value.includes("\0"))
                        throw new Error("INVALID_PLAYER_STRING");
                    b = Buffer.from(value + "\0");
                    if (b.length - 1 > (key === "decal" ? 40 : 256))
                        throw new Error("PLAYER_STRING_BYTE_LIMIT");
                }
                else {
                    b = Buffer.alloc(4);
                    b.writeUInt32LE(key === "control" ? controls.indexOf(value as typeof controls[number]) : value as number);
                }
                edits.push({ ...spans[key], bytes: b });
            }
        }
        else {
            let bits = this.core.gameOptionsFlags;
            for (const [key, value] of Object.entries(operation.patch)) {
                const mask = flags[key as keyof typeof flags];
                bits = value ? bits | mask : bits & ~mask;
            }
            const b = Buffer.alloc(4);
            b.writeUInt32LE(bits >>> 0);
            edits.push({ start: this.core.opaqueTailOffset - 4, end: this.core.opaqueTailOffset, bytes: b });
        }
        const parts: Buffer[] = [];
        let cursor = 0;
        for (const e of edits.sort((a, b) => a.start - b.start)) {
            parts.push(this.bytes.subarray(cursor, e.start), e.bytes);
            cursor = e.end;
        }
        parts.push(this.bytes.subarray(cursor));
        const next = Buffer.concat(parts);
        if (operation.op === "options.set") {
            let old = this.core.gameOptionsFlags, now = next.readUInt32LE(this.core.opaqueTailOffset - 4), oldCount = 0, newCount = 0;
            while (old) {
                old = (old & (old - 1)) >>> 0;
                oldCount++;
            }
            while (now) {
                now = (now & (now - 1)) >>> 0;
                newCount++;
            }
            next.writeBigUInt64LE(this.core.integrityHash + BigInt(oldCount - newCount), 8);
        }
        new PlayersDocument(next);
        return next;
    }
}
