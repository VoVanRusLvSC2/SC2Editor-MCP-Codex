import { SurfaceSnapshot } from './snapshot.js';
import { readHeightMap } from '../format/formats/height-map.js';
import { readTextureMasks, textureMaskAddress, setTextureMaskWeight, writeTextureMasks } from '../format/formats/texture-masks.js';
import { readPaintedPathing } from '../format/formats/painted-pathing.js';
import { readVertexColor } from '../format/formats/vertex-color.js';
import { integer, cellIndex, equalBytes } from '../format/guards.js';
import { patchTerrainNumericAttribute } from './xml-patch.js';
export type CellEdit = {
    kind: 'height-raw';
    x: number;
    y: number;
    channel: 'heightBase' | 'heightAdjustments';
    value: number;
} | {
    kind: 'texture-weight';
    x: number;
    y: number;
    layer: number;
    value: number;
} | {
    kind: 'painted-raw';
    layer: 'pathing' | 'creep';
    x: number;
    y: number;
    secondary: boolean;
    value: number;
} | {
    kind: 'vertex-byte';
    entry: number;
    byte: number;
    value: number;
} | {
    kind: 'terrain-parameter';
    attribute: 'quantizeScale' | 'quantizeBias' | 'standardHeight';
    value: number;
};
export interface PatchPlan {
    component: string;
    request: CellEdit;
    before: Uint8Array;
    after: Uint8Array;
    ranges: Array<{
        offset: number;
        before: number[];
        after: number[];
    }>;
    dirtyDependencies: string[];
    engineValidated: false;
    requiresEditorRoundTrip: true;
}
export function planCellEdit(s: SurfaceSnapshot, request: CellEdit): PatchPlan {
    const kind = request.kind === 'height-raw' ? 't3heightmap' : request.kind === 'texture-weight' ? 't3texturemasks' : request.kind === 'painted-raw' ? (request.layer === 'pathing' ? 'paintedpathinglayer' : 'paintedcreeplayer') : request.kind === 'terrain-parameter' ? 't3terrain.xml' : 't3vertcol';
    const component = s.uniqueName(kind);
    if (!component)
        throw new Error('EDIT_COMPONENT_MISSING');
    const before = s.bytes(component);
    let after: Uint8Array = before.slice();
    let dirtyDependencies: string[] = [];
    switch (request.kind) {
        case 'height-raw': {
            const m = readHeightMap(before);
            integer(request.value, 0, 65535, 'height value');
            if (request.channel !== 'heightBase' && request.channel !== 'heightAdjustments')
                throw new Error('INVALID_HEIGHT_CHANNEL');
            const offset = 32 + cellIndex(request.x, request.y, m.sizeX, m.sizeY) * 6 + (request.channel === 'heightBase' ? 0 : 2);
            new DataView(after.buffer).setUint16(offset, request.value, true);
            readHeightMap(after);
            dirtyDependencies = ['t3SyncHeightMap', 't3SyncCliffLevel', 't3HardTile', 't3Water', 'derived-pathing', 'collision-and-footprints'];
            break;
        }
        case 'texture-weight': {
            const m = readTextureMasks(before);
            textureMaskAddress(m, request.layer, request.x, request.y);
            setTextureMaskWeight(m, request.layer, request.x, request.y, request.value);
            after = writeTextureMasks(m);
            dirtyDependencies = ['t3SyncTextureInfo', 'catalog-dependent-material-effects'];
            break;
        }
        case 'painted-raw': {
            const m = readPaintedPathing(before);
            if (!m.paint)
                throw new Error('PAINTED_LAYER_NOT_DECODED');
            integer(request.value, 0, 255, 'paint byte');
            const i = 16 + cellIndex(request.x, request.y, 512, 512) * 2 + (request.secondary ? 1 : 0);
            after[i] = request.value;
            dirtyDependencies = ['native-paint-lookup', 'derived-pathing-or-creep'];
            break;
        }
        case 'vertex-byte': {
            const m = readVertexColor(before);
            integer(request.entry, 0, m.entries.length - 1, 'VTCL entry');
            const e = m.entries[request.entry]!;
            integer(request.byte, 0, e.data.length - 1, 'VTCL payload byte');
            integer(request.value, 0, 255, 'VTCL value');
            let off = 32;
            const stride = m.version === 103 ? 28 : 36;
            for (let i = 0; i < request.entry; i++)
                off += stride + m.entries[i]!.data.length;
            after[off + stride + request.byte] = request.value;
            readVertexColor(after);
            dirtyDependencies = ['vertex-color-derived-render-state'];
            break;
        }
        case 'terrain-parameter': {
            const xml = new TextDecoder('utf-8', { fatal: true }).decode(before), next = patchTerrainNumericAttribute(xml, request.attribute, request.value);
            after = new TextEncoder().encode(next);
            dirtyDependencies = ['t3HeightMap', 't3SyncHeightMap', 't3SyncCliffLevel', 't3HardTile', 't3Water', 'derived-pathing'];
            break;
        }
    }
    const ranges: PatchPlan['ranges'] = [];
    // Equal-size binary edits are localized; changed-size XML has one replacement span with common prefix/suffix removed.
    if (before.length === after.length) {
        for (let i = 0; i < before.length;) {
            if (before[i] === after[i]) {
                i++;
                continue;
            }
            const start = i++;
            while (i < before.length && before[i] !== after[i])
                i++;
            ranges.push({ offset: start, before: [...before.subarray(start, i)], after: [...after.subarray(start, i)] });
        }
    }
    else {
        let start = 0, endBefore = before.length, endAfter = after.length;
        while (start < Math.min(endBefore, endAfter) && before[start] === after[start])
            start++;
        while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
            endBefore--;
            endAfter--;
        }
        ranges.push({ offset: start, before: [...before.subarray(start, endBefore)], after: [...after.subarray(start, endAfter)] });
    }
    return { component, request: structuredClone(request), before, after, ranges, dirtyDependencies: ranges.length ? dirtyDependencies : [], engineValidated: false, requiresEditorRoundTrip: true };
}
/** Pure in-memory operation. It is NOT an Editor-valid cross-layer commit. */
export function materializePlan(plan: PatchPlan, current: Uint8Array): Uint8Array {
    if (!equalBytes(plan.before, current))
        throw new Error('STALE_PLAN: original bytes changed');
    return plan.after.slice();
}
export function planSummary(p: PatchPlan) { return { component: p.component, request: p.request, beforeBytes: p.before.length, afterBytes: p.after.length, changedRanges: p.ranges, dirtyDependencies: p.dirtyDependencies, engineValidated: p.engineValidated, requiresEditorRoundTrip: p.requiresEditorRoundTrip }; }
