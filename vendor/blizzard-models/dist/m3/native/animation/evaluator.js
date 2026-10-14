/**
 * M3 animation evaluator (OPUS_TASK_P5_M3_ANIMATION.md, D1).
 *
 * Ports the verified mdx-m3-viewer resolution chain:
 *   sequence i ↔ STG_ i → stc_indices (stored order) → STC → STS membership
 *   → first hit wins → SD sampling; no hit → the reference's initValue
 *   (the bind-pose fallback).
 *
 * Validity is decided purely by STS membership — never by
 * `AnimationReferenceHeader.flags` (the old gate skipped valid tracks and
 * applied stale ones).
 */
/** STC SD reference fields in packed anim_refs order (high u16 selects one). */
export const SD_FIELDS = [
    'sdev',
    'sd2v',
    'sd3v',
    'sd4q',
    'sdcc',
    'sdr3',
    'sdu8',
    'sds6',
    'sdu6',
    'sds3',
    'sdu3',
    'sdfg',
    'sdmb',
];
/** Flatten a parsed key/init value into numeric components. */
export function valueToComponents(value) {
    if (typeof value === 'number')
        return [value];
    if (value && typeof value === 'object') {
        const v = value;
        if (typeof v.x === 'number') {
            return typeof v.w === 'number'
                ? [v.x, v.y, v.z, v.w]
                : typeof v.z === 'number'
                    ? [v.x, v.y, v.z]
                    : [v.x, v.y];
        }
        if (typeof v.r === 'number') {
            return [v.r, v.g ?? 0, v.b ?? 0, v.a ?? 255];
        }
    }
    return [0];
}
/**
 * First-class view of an AnimationReference struct
 * ({ header: { interpolation, flags, id }, default, null }) — P5 S1.
 */
export function parseAnimationReference(ref) {
    if (!ref)
        return null;
    const header = ref.header;
    if (!header || typeof header.id !== 'number')
        return null;
    return {
        interpolationType: header.interpolation ?? 0,
        animFlags: header.flags ?? 0,
        animId: header.id,
        initValue: valueToComponents(ref.default),
    };
}
function numberContent(sections, ref) {
    const section = sections.getSectionByReference(ref);
    return (section?.content ?? []).filter((value) => typeof value === 'number');
}
export class M3AnimationEvaluator {
    model;
    sections;
    sequenceStcs = [];
    constructor(model, sections) {
        this.model = model;
        this.sections = sections;
        const stgSection = sections.getSectionByReference(model.sequence_transformation_groups);
        const stcSection = sections.getSectionByReference(model.sequence_transformation_collections);
        const stsSection = sections.getSectionByReference(model.sts);
        const stgs = (stgSection?.content ?? []);
        const stcs = (stcSection?.content ?? []);
        const stss = (stsSection?.content ?? []);
        const stcLookups = new Map();
        const buildStcLookup = (stcIndex) => {
            const cached = stcLookups.get(stcIndex);
            if (cached)
                return cached;
            const stc = stcs[stcIndex];
            if (!stc)
                return null;
            // STS membership is per-STC (sts_index), never cached at STG level (gotcha #1).
            const sts = stss[stc.sts_index ?? -1];
            const stsAnimIds = new Set(numberContent(sections, sts?.anim_ids));
            const refs = new Map();
            const animIds = numberContent(sections, stc.anim_ids);
            const animRefs = numberContent(sections, stc.anim_refs);
            for (let i = 0; i < animIds.length; i += 1) {
                const packed = animRefs[i];
                if (packed === undefined)
                    continue;
                const sdIndex = packed & 0xffff;
                const sdField = SD_FIELDS[(packed >>> 16) & 0xffff];
                if (!sdField)
                    continue;
                const sdSection = sections.getSectionByReference(stc[sdField]);
                const sd = sdSection?.content?.[sdIndex];
                if (!sd)
                    continue;
                refs.set(animIds[i], { sdField, sdIndex, sd });
            }
            const lookup = {
                stcIndex,
                concurrent: !!(stc.concurrent ?? 0),
                priority: stc.priority ?? 0,
                stsAnimIds,
                refs,
            };
            stcLookups.set(stcIndex, lookup);
            return lookup;
        };
        for (const stg of stgs) {
            const stcIndices = numberContent(sections, stg.stc_indices);
            const lookups = [];
            for (const stcIndex of stcIndices) {
                const lookup = buildStcLookup(stcIndex);
                if (lookup)
                    lookups.push(lookup);
            }
            this.sequenceStcs.push(lookups);
        }
    }
    get sequenceCount() {
        return this.sequenceStcs.length;
    }
    /**
     * The 1.2 chain: walk the sequence's STCs in stored order; STS membership
     * validates; first hit wins; null → caller falls back to initValue.
     */
    resolveAnimRef(sequenceIndex, animId) {
        const lookups = this.sequenceStcs[sequenceIndex];
        if (!lookups)
            return null;
        for (const lookup of lookups) {
            if (!lookup.stsAnimIds.has(animId))
                continue;
            const entry = lookup.refs.get(animId);
            if (!entry)
                continue; // defensive: STS claims the id but the STC lacks data
            return {
                stcIndex: lookup.stcIndex,
                sdField: entry.sdField,
                sdIndex: entry.sdIndex,
                sd: entry.sd,
                concurrent: lookup.concurrent,
                priority: lookup.priority,
            };
        }
        return null;
    }
    /**
     * SD sampling per 1.4: clamp before the first key, hold after the last,
     * step or lerp/slerp between; concurrent STCs wrap by the SD's own fend.
     * Writes into `out` and returns it (allocation-free steady state).
     */
    sampleSd(resolved, interpolationType, frameMs, out) {
        const sd = resolved.sd;
        const frames = numberContent(this.sections, sd.frames);
        const keysSection = this.sections.getSectionByReference(sd.keys);
        const keys = (keysSection?.content ?? []);
        if (frames.length === 0 || keys.length === 0)
            return null;
        let frame = frameMs;
        if (resolved.concurrent) {
            const fend = sd.fend ?? 0;
            if (fend > 0)
                frame = frameMs % fend; // wrap by the SD block's fend, not sequence length
        }
        const count = Math.min(frames.length, keys.length);
        const firstFrame = frames[0];
        if (frame <= firstFrame)
            return writeComponents(keys[0], out);
        const lastFrame = frames[count - 1];
        if (frame >= lastFrame)
            return writeComponents(keys[count - 1], out);
        let b = 1;
        while (b < count - 1 && frame > frames[b])
            b += 1;
        const a = b - 1;
        if (interpolationType === 0)
            return writeComponents(keys[a], out);
        const span = frames[b] - frames[a];
        const t = span > 0 ? Math.min(Math.max((frame - frames[a]) / span, 0), 1) : 0;
        const va = valueToComponents(keys[a]);
        const vb = valueToComponents(keys[b]);
        if (resolved.sdField === 'sd4q' && va.length === 4 && vb.length === 4) {
            return slerpInto(va, vb, t, out);
        }
        out.length = va.length;
        for (let i = 0; i < va.length; i += 1)
            out[i] = va[i] + ((vb[i] ?? va[i]) - va[i]) * t;
        return out;
    }
    /**
     * Resolve + sample an AnimationReference for a sequence at a frame time;
     * falls back to the reference's initValue — the bind pose — when the
     * sequence does not drive it (the headline P5 fix).
     */
    sampleAnimRef(sequenceIndex, animRef, frameMs, out = []) {
        const parsed = parseAnimationReference(animRef);
        if (!parsed) {
            out.length = 0;
            return out;
        }
        const resolved = this.resolveAnimRef(sequenceIndex, parsed.animId);
        if (resolved) {
            const sampled = this.sampleSd(resolved, parsed.interpolationType, frameMs, out);
            if (sampled)
                return sampled;
        }
        out.length = parsed.initValue.length;
        for (let i = 0; i < parsed.initValue.length; i += 1)
            out[i] = parsed.initValue[i];
        return out;
    }
}
function writeComponents(value, out) {
    const components = valueToComponents(value);
    out.length = components.length;
    for (let i = 0; i < components.length; i += 1)
        out[i] = components[i];
    return out;
}
/** Shortest-path slerp with the standard nlerp fallback for near-parallel quats. */
function slerpInto(a, b, t, out) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let sign = 1;
    if (dot < 0) {
        dot = -dot;
        sign = -1;
    }
    out.length = 4;
    if (dot > 0.9995) {
        for (let i = 0; i < 4; i += 1)
            out[i] = a[i] + (sign * b[i] - a[i]) * t;
    }
    else {
        const theta = Math.acos(Math.min(1, dot));
        const sinTheta = Math.sin(theta);
        const wa = Math.sin((1 - t) * theta) / sinTheta;
        const wb = (Math.sin(t * theta) / sinTheta) * sign;
        for (let i = 0; i < 4; i += 1)
            out[i] = wa * a[i] + wb * b[i];
    }
    const len = Math.hypot(out[0], out[1], out[2], out[3]);
    if (len > 0) {
        for (let i = 0; i < 4; i += 1)
            out[i] /= len;
    }
    return out;
}
//# sourceMappingURL=evaluator.js.map