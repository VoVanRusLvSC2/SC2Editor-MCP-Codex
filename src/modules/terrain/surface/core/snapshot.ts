import { componentKind, decodeComponent, type ComponentDecode, type DecodeOptions } from './registry.js';
import { integer, inputSize, cellIndex, equalBytes } from '../format/guards.js';
import type { TerrainInfo } from '../format/terrain-params.js';
import { levelFromCell, type HeightMapResult } from '../format/formats/height-map.js';
import { textureMaskWeight, type TextureMasksResult } from '../format/formats/texture-masks.js';
import { type VertexColorResult } from '../format/formats/vertex-color.js';
import { paintedValueAt, type PaintedPathingResult } from '../format/formats/painted-pathing.js';
export function safeComponentPath(path: string): string {
    if (!path || path.length > 1024 || [...path].some(char => char.charCodeAt(0) < 32) || /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path))
        throw new Error('UNSAFE_COMPONENT_PATH');
    const normalized = path.replaceAll('\\', '/');
    if (normalized.split('/').some(p => !p || p === '..' || p === '.' || p.includes(':')))
        throw new Error('UNSAFE_COMPONENT_PATH');
    return normalized;
}
function summarizeModel(decoded: ComponentDecode): Record<string, unknown> {
    const m = decoded.model as Record<string, unknown> | undefined;
    if (!m)
        return {};
    const out: Record<string, unknown> = {};
    for (const k of ['version', 'sizeX', 'sizeY', 'dimX', 'dimY', 'setCount', 'layout', 'dimensionSource', 'dataOffset', 'parsedEnd', 'blockCount', 'bodyCount', 'entryCount', 'status', 'positionSemantics', 'quantizeScale', 'quantizeBias', 'standardHeight', 'offsetX', 'offsetY', 'offsetZ', 'scaleX', 'scaleY', 'scaleZ'])
        if (m[k] !== undefined)
            out[k] = m[k];
    for (const k of ['cells', 'heights', 'blocks', 'textures', 'textureSets', 'blockTextureSets', 'cliffCells', 'cliffSets', 'cliffDoodads', 'ramps', 'zones', 'bodies', 'entries', 'doodads', 'textureNames', 'indices']) {
        const a = m[k];
        if (Array.isArray(a) || ArrayBuffer.isView(a))
            out[k + 'Count'] = (a as {
                length: number;
            }).length;
    }
    for (const k of ['diagnostics', 'defaultedParameters', 'uninterpretedElements'])
        if (m[k])
            out[k] = m[k];
    return out;
}
export interface ComponentSummary {
    name: string;
    kind: string;
    bytes: number;
    status: ComponentDecode['status'];
    summary: Record<string, unknown>;
    diagnostics: string[];
    evidence: string;
}
export interface ConsistencyResult {
    engineValidated: false;
    structuralErrors: string[];
    warnings: string[];
    missing: string[];
}
export class SurfaceSnapshot {
    readonly #files = new Map<string, Uint8Array>();
    readonly #decoded = new Map<string, ComponentDecode>();
    readonly #kinds = new Map<string, string[]>();
    readonly options: Readonly<DecodeOptions>;
    constructor(files: ReadonlyMap<string, Uint8Array>, options: DecodeOptions = {}) {
        this.options = Object.freeze({ ...options });
        if (files.size > 2048)
            throw new Error('FILE_COUNT_BUDGET');
        let total = 0;
        const names = new Set<string>();
        for (const [raw, b] of files) {
            const name = safeComponentPath(raw), folded = name.toLowerCase();
            if (names.has(folded))
                throw new Error('DUPLICATE_CASE_INSENSITIVE_COMPONENT');
            names.add(folded);
            inputSize(b);
            total += b.length;
            if (total > 256 * 1024 * 1024)
                throw new Error('SNAPSHOT_BYTE_BUDGET');
            this.#files.set(name, new Uint8Array(b));
            const k = componentKind(name), n = this.#kinds.get(k) ?? [];
            n.push(name);
            this.#kinds.set(k, n);
        }
    }
    names(): string[] { return [...this.#files.keys()].sort(); }
    bytes(name: string): Uint8Array { const b = this.#files.get(safeComponentPath(name)); if (!b)
        throw new Error('COMPONENT_NOT_FOUND'); return b.slice(); }
    uniqueName(kind: string): string | undefined { const names = this.#kinds.get(kind) ?? []; if (names.length > 1)
        throw new Error(`AMBIGUOUS_MAP_COMPONENT: ${kind}`); return names[0]; }
    #decode(name: string): ComponentDecode {
        name = safeComponentPath(name);
        let d = this.#decoded.get(name);
        if (!d) {
            d = decodeComponent(name, this.bytes(name), this.options);
            this.#decoded.set(name, d);
        }
        return d;
    }
    inspect(name: string): ComponentSummary { name = safeComponentPath(name); const d = this.#decode(name); return { name, kind: d.kind, bytes: this.#files.get(name)!.length, status: d.status, summary: summarizeModel(d), diagnostics: [...d.diagnostics], evidence: d.evidence }; }
    inventory(): ComponentSummary[] { return this.names().map(n => this.inspect(n)); }
    /** Return a detached typed model to code clients; never automatically put it into LLM context. */
    model(name: string): unknown { return structuredClone(this.#decode(name).model); }
    modelFor<T>(kind: string): T | undefined { const n = this.uniqueName(kind); return n ? this.model(n) as T | undefined : undefined; }
    rawRange(name: string, offset: number, length: number): {
        offset: number;
        length: number;
        hex: string;
    } { const b = this.bytes(name); integer(offset, 0, b.length, 'offset'); integer(length, 0, 4096, 'length'); if (offset + length > b.length)
        throw new Error('RAW_RANGE_OUT_OF_BOUNDS'); return { offset, length, hex: [...b.subarray(offset, offset + length)].map(n => n.toString(16).padStart(2, '0')).join('') }; }
    consistency(): ConsistencyResult {
        const out: ConsistencyResult = { engineValidated: false, structuralErrors: [], warnings: [], missing: [] };
        for (const [kind, names] of this.#kinds)
            if (names.length > 1 && !kind.startsWith('catalog:') && kind !== 'dds' && kind !== 'asset-opaque')
                out.structuralErrors.push(`duplicate semantic kind: ${kind}`);
        for (const c of this.inventory()) {
            if (c.status === 'invalid')
                out.structuralErrors.push(c.name + ': ' + c.diagnostics.join('; '));
            if (c.status === 'ambiguous' || c.status === 'opaque')
                out.warnings.push(c.name + ': ' + c.status);
        }
        for (const k of ['t3terrain.xml', 't3heightmap'])
            if (!this.#kinds.has(k))
                out.missing.push(k);
        if (out.structuralErrors.some(x => x.startsWith('duplicate semantic kind')))
            return out;
        const h = this.modelFor<HeightMapResult>('t3heightmap'), t = this.modelFor<TerrainInfo>('t3terrain.xml');
        if (h && t) {
            if (t.dimX !== h.sizeX || t.dimY !== h.sizeY)
                out.structuralErrors.push('HMAP/XML dimensions disagree');
            if (t.defaultedParameters?.length)
                out.warnings.push('terrain parameters defaulted: ' + t.defaultedParameters.join(','));
            for (const diagnostic of t.diagnostics ?? [])
                out.warnings.push('terrain XML: ' + diagnostic);
            if (t.vertDataName && t.vertDataName.toLowerCase() !== 't3heightmap')
                out.warnings.push('nondefault vertData.name is retained, not automatically bound: ' + t.vertDataName);
            if (t.masksName && t.masksName.toLowerCase() !== 't3texturemasks')
                out.warnings.push('nondefault masks.name is retained, not automatically bound: ' + t.masksName);
            if (t.scaleZ !== undefined && t.scaleZ !== 1)
                out.warnings.push('non-unit scaleZ: reference formula conflicts with target MCP formula');
        }
        const lf = this.modelFor<{
            sizeX: number;
            sizeY: number;
        }>('t3cellflags');
        if (h && lf && lf.sizeX !== undefined && (lf.sizeX !== h.sizeX - 1 || lf.sizeY !== h.sizeY - 1))
            out.structuralErrors.push('LFCT/HMAP grid relation differs from enabled profile');
        out.warnings.push('No proof of final passability, footprints, cliff mesh generation, shoreline generation or engine rebuild');
        return out;
    }
    context(maxChars = 6000): string {
        integer(maxChars, 128, 32000, 'context character budget');
        const records = this.inventory();
        const lines = ['SC2 SURFACE | offline component snapshot | ENGINE VALIDATION: NOT RUN', ...records.map(c => `${c.name} | ${c.kind} | ${c.status} | ${JSON.stringify(c.summary)}`)];
        const full = lines.join('\n');
        if (full.length <= maxChars)
            return full;
        const suffix = '\n[TRUNCATED: inspect individual components; budget is characters, not model tokens]';
        return full.slice(0, maxChars - suffix.length) + suffix;
    }
    sampleHeight(x: number, y: number) {
        const h = this.modelFor<HeightMapResult>('t3heightmap');
        if (!h)
            throw new Error('HMAP_NOT_DECODED');
        const cell = h.cells[cellIndex(x, y, h.sizeX, h.sizeY)]!, t = this.modelFor<TerrainInfo>('t3terrain.xml');
        if (!t)
            return { grid: [x, y], raw: cell, worldZ: null, evidence: 'missing t3Terrain.xml' };
        const reference = levelFromCell(cell, t, t), repository = ((cell.heightBase + cell.heightAdjustments) * t.quantizeScale - 2 * t.quantizeBias) * (t.scaleZ ?? 1) + (t.offsetZ ?? 0);
        return { grid: [x, y], raw: cell, worldXY: [x * (t.scaleX ?? 1) + (t.offsetX ?? 0), y * (t.scaleY ?? 1) + (t.offsetY ?? 0)],
            worldZ: reference === repository ? reference : null, candidates: { reference, repository }, evidence: reference === repository ? 'two reviewed formulas agree; not engine-certified' : 'FORMULA_CONFLICT', engineValidated: false };
    }
    sampleMask(x: number, y: number) { const m = this.modelFor<TextureMasksResult>('t3texturemasks'); if (!m)
        throw new Error('MASK_NOT_DECODED'); return { grid: [x, y], weights: Array.from({ length: 8 }, (_, l) => textureMaskWeight(m, l, x, y)), domain: 'MASK pixels; not world coordinates', range: [0, 15], sumConstraint: 'not imposed' }; }
    samplePaint(kind: 'paintedpathinglayer' | 'paintedcreeplayer', x: number, y: number) { const m = this.modelFor<PaintedPathingResult>(kind); if (!m)
        throw new Error('PAINT_NOT_FOUND'); return { physicalGrid: [x, y], primary: paintedValueAt(m, x, y), secondary: paintedValueAt(m, x, y, true), passable: null, lookupTable: 'not available', bounds: m.bounds }; }
    /** Stable revision check uses the whole original file, not just the edited byte. */
    isCurrent(name: string, expected: Uint8Array): boolean { return equalBytes(this.bytes(name), expected); }
    vertexEntryInfo(entry: number) { const m = this.modelFor<VertexColorResult>('t3vertcol'); if (!m)
        throw new Error('VTCL_NOT_DECODED'); integer(entry, 0, m.entries.length - 1, 'entry'); return m.entries[entry]!; }
}
