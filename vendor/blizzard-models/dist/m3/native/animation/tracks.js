import { getSectionString } from '../utils/texture.js';
import { m3MatrixToArray } from '../utils/matrix.js';
import { getAllRegionBatches } from '../builder/material-helpers.js';
import { M3AnimationEvaluator, parseAnimationReference, valueToComponents, } from './evaluator.js';
/**
 * P5-S4 — per-sequence track extraction (OPUS_TASK_P5_M3_ANIMATION.md D2–D4, D7).
 *
 * Every bone of every sequence gets a track set; bones the sequence does not
 * drive get a constant single-key track at the reference's initValue, which
 * makes the bind-pose reset structural — backends never keep stale transforms.
 * Key times are sequence-local seconds (`RenderScalarAnimationKey.frame`).
 */
const BONE_BATCH1 = 0x4000;
const BONE_BATCH2 = 0x8000;
const SEQ_NOT_LOOPING = 0x1;
function resolveSource(evaluator, seqIndex, ref) {
    const parsed = parseAnimationReference(ref);
    if (!parsed)
        return null;
    return { parsed, resolved: evaluator.resolveAnimRef(seqIndex, parsed.animId) };
}
function constantTrack(parsed) {
    return {
        lineType: 0,
        globalSeqId: null,
        keys: [{ frame: 0, vector: parsed.initValue }],
    };
}
function sdArrays(sections, sd) {
    const framesSection = sections.getSectionByReference(sd.frames);
    const keysSection = sections.getSectionByReference(sd.keys);
    return {
        frames: (framesSection?.content ?? []).filter((v) => typeof v === 'number'),
        keys: (keysSection?.content ?? []),
    };
}
/** Sample the SD at an absolute frame with the 1.4 clamp/hold rules (for D3 boundary keys). */
function sampleAt(evaluator, source, frameMs) {
    if (!source.resolved)
        return null;
    return evaluator.sampleSd(source.resolved, source.parsed.interpolationType, frameMs, []);
}
function extractTrack(evaluator, sections, source, msStart, msEnd, isQuat) {
    const { parsed, resolved } = source;
    if (!resolved) {
        return { track: constantTrack(parsed), concurrent: false };
    }
    const { frames, keys } = sdArrays(sections, resolved.sd);
    const count = Math.min(frames.length, keys.length);
    if (count === 0) {
        return { track: constantTrack(parsed), concurrent: false };
    }
    const outKeys = [];
    if (resolved.concurrent) {
        // D4: concurrent overlays keep their own 0..fend timeline; backends wrap.
        for (let i = 0; i < count; i += 1) {
            outKeys.push({ frame: frames[i] / 1000, vector: valueToComponents(keys[i]) });
        }
    }
    else {
        // D3: window filter with boundary sampling — SD frames may start before
        // anim_ms_start (leading clamp key); never silently drop the edges.
        let firstIncluded = Number.POSITIVE_INFINITY;
        let lastIncluded = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < count; i += 1) {
            const frame = frames[i];
            if (frame < msStart || frame > msEnd)
                continue;
            firstIncluded = Math.min(firstIncluded, frame);
            lastIncluded = Math.max(lastIncluded, frame);
            outKeys.push({ frame: (frame - msStart) / 1000, vector: valueToComponents(keys[i]) });
        }
        if (firstIncluded > msStart) {
            const boundary = sampleAt(evaluator, source, msStart);
            if (boundary)
                outKeys.unshift({ frame: 0, vector: boundary });
        }
        if (lastIncluded < msEnd) {
            const boundary = sampleAt(evaluator, source, msEnd);
            if (boundary)
                outKeys.push({ frame: (msEnd - msStart) / 1000, vector: boundary });
        }
    }
    if (outKeys.length === 0) {
        return { track: constantTrack(parsed), concurrent: false };
    }
    // D7: quaternion neighborhood correction once at extraction — backends
    // receive sign-consistent tracks and can lerp/slerp naively.
    if (isQuat) {
        for (let i = 1; i < outKeys.length; i += 1) {
            const prev = outKeys[i - 1].vector;
            const next = outKeys[i].vector;
            let dot = 0;
            for (let c = 0; c < 4; c += 1)
                dot += (prev[c] ?? 0) * (next[c] ?? 0);
            if (dot < 0) {
                outKeys[i] = { frame: outKeys[i].frame, vector: next.map(v => -v) };
            }
        }
    }
    const track = {
        lineType: parsed.interpolationType === 0 ? 0 : 1,
        globalSeqId: null,
        keys: outKeys,
    };
    const fend = resolved.sd.fend ?? 0;
    return resolved.concurrent
        ? { track, concurrent: true, wrapSeconds: fend > 0 ? fend / 1000 : undefined }
        : { track, concurrent: false };
}
/**
 * Reusable sparse AnimationReference extractor for non-bone properties.
 *
 * Unlike bone extraction, it emits entries only for sequences whose STG/STC/STS
 * chain resolves the reference's animId. Other sequences retain the property's
 * static init value without a duplicated constant track.
 */
export class M3AnimationReferenceTrackExtractor {
    sections;
    evaluator;
    sequences;
    constructor(model, sections) {
        this.sections = sections;
        this.evaluator = new M3AnimationEvaluator(model, sections);
        const sequenceSection = sections.getSectionByReference(model.sequences);
        this.sequences = (sequenceSection?.content ?? []);
    }
    extract(ref, options = {}) {
        const parsed = parseAnimationReference(ref);
        if (!parsed)
            return [];
        const result = [];
        for (let sequenceIndex = 0; sequenceIndex < this.sequences.length; sequenceIndex += 1) {
            const resolved = this.evaluator.resolveAnimRef(sequenceIndex, parsed.animId);
            if (!resolved)
                continue;
            const sequence = this.sequences[sequenceIndex];
            const extracted = extractTrack(this.evaluator, this.sections, { parsed, resolved }, sequence.anim_ms_start ?? 0, sequence.anim_ms_end ?? 0, false);
            const track = options.transformVector
                ? transformTrackVectors(extracted.track, options.transformVector)
                : extracted.track;
            result.push({
                sequenceIndex,
                track,
                ...(extracted.concurrent ? { concurrent: true } : {}),
                ...(extracted.wrapSeconds !== undefined ? { wrapSeconds: extracted.wrapSeconds } : {}),
            });
        }
        return result;
    }
}
function transformTrackVectors(track, transform) {
    return {
        ...track,
        keys: track.keys.map(key => ({
            ...key,
            vector: transform(key.vector),
            ...(key.inTan ? { inTan: transform(key.inTan) } : {}),
            ...(key.outTan ? { outTan: transform(key.outTan) } : {}),
        })),
    };
}
/** batchIndex → RenderModel mesh index, replicating buildRenderMeshes emission order. */
function buildBatchToMeshIndex(model, sections) {
    const divisionSection = sections.getSectionByReference(model.divisions);
    const result = [];
    let meshIndex = 0;
    for (const division of (divisionSection?.content ?? [])) {
        const map = new Map();
        const regionSection = sections.getSectionByReference(division.regions);
        const regionCount = regionSection?.content.length ?? 0;
        for (let regionIndex = 0; regionIndex < regionCount; regionIndex += 1) {
            const batches = getAllRegionBatches(model, sections, division, regionIndex);
            if (batches.length === 0) {
                meshIndex += 1; // batch-less region still emits one mesh
                continue;
            }
            for (const batch of batches) {
                // A hidden batch (geometry_visible off) is no mesh: its visibility drives nothing.
                if (!batch.geometryVisible)
                    continue;
                map.set(batch.batchIndex, meshIndex);
                meshIndex += 1;
            }
        }
        result.push(map);
    }
    return result;
}
export function buildRenderSequences(model, sections) {
    const seqSection = sections.getSectionByReference(model.sequences);
    const boneSection = sections.getSectionByReference(model.bones);
    const seqs = (seqSection?.content ?? []);
    const bones = (boneSection?.content ?? []);
    // IREF inverse bind matrices (skinning = world × IREF, D8).
    const irefSection = sections.getSectionByReference(model.bone_rests);
    const inverseBindMatrices = (irefSection?.content ?? []).map(iref => {
        const matrix = iref.matrix;
        return matrix ? Float32Array.from(m3MatrixToArray(matrix)) : undefined;
    });
    if (seqs.length === 0) {
        return { sequences: [], inverseBindMatrices };
    }
    const evaluator = new M3AnimationEvaluator(model, sections);
    // Batching visibility: BAT_.bone points at the toggle bone (batch1/batch2).
    const boneToBatchMeshes = new Map();
    const divisionSection = sections.getSectionByReference(model.divisions);
    const divisions = (divisionSection?.content ?? []);
    const batchMaps = buildBatchToMeshIndex(model, sections);
    divisions.forEach((division, divisionIndex) => {
        const batchSection = sections.getSectionByReference(division.batches);
        const batches = (batchSection?.content ?? []);
        const map = batchMaps[divisionIndex];
        batches.forEach((batch, batchIndex) => {
            const bone = batch.bone ?? -1;
            if (bone < 0)
                return;
            const meshIndex = map?.get(batchIndex);
            if (meshIndex === undefined)
                return;
            let list = boneToBatchMeshes.get(bone);
            if (!list) {
                list = [];
                boneToBatchMeshes.set(bone, list);
            }
            list.push(meshIndex);
        });
    });
    const sequences = seqs.map((seq, seqIndex) => {
        const msStart = seq.anim_ms_start ?? 0;
        const msEnd = seq.anim_ms_end ?? msStart;
        const flags = seq.flags ?? 0;
        const nodeTracks = bones.map((bone, boneIndex) => {
            const trackSet = { boneIndex };
            let concurrent = false;
            let wrapSeconds;
            const assign = (key, ref, isQuat) => {
                const source = resolveSource(evaluator, seqIndex, ref);
                if (!source)
                    return;
                const extracted = extractTrack(evaluator, sections, source, msStart, msEnd, isQuat);
                trackSet[key] = extracted.track;
                if (extracted.concurrent) {
                    concurrent = true;
                    wrapSeconds = wrapSeconds ?? extracted.wrapSeconds;
                }
            };
            assign('translation', bone.location, false);
            assign('rotation', bone.rotation, true);
            assign('scale', bone.scale, false);
            if (concurrent) {
                trackSet.concurrent = true;
                if (wrapSeconds !== undefined)
                    trackSet.wrapSeconds = wrapSeconds;
            }
            return trackSet;
        });
        // Mesh visibility from `batching` flag animation on batch1/batch2 bones (1.6).
        const meshVisibility = [];
        bones.forEach((bone, boneIndex) => {
            const boneFlags = bone.flags ?? 0;
            if (!(boneFlags & (BONE_BATCH1 | BONE_BATCH2)))
                return;
            const meshIndices = boneToBatchMeshes.get(boneIndex);
            if (!meshIndices?.length)
                return;
            const source = resolveSource(evaluator, seqIndex, bone.batching);
            if (!source)
                return;
            const extracted = extractTrack(evaluator, sections, source, msStart, msEnd, false);
            for (const meshIndex of meshIndices) {
                meshVisibility.push({ meshIndex, track: extracted.track });
            }
        });
        const boundsSphere = readBoundsSphere(seq.bounding_sphere);
        return {
            name: getSectionString(sections, seq.name) ?? `Seq_${seqIndex}`,
            durationSeconds: Math.max(0, msEnd - msStart) / 1000,
            looping: (flags & SEQ_NOT_LOOPING) === 0,
            ...(typeof seq.movement_speed === 'number' && seq.movement_speed !== 0
                ? { movementSpeed: seq.movement_speed }
                : {}),
            ...(boundsSphere ? { boundsSphere } : {}),
            nodeTracks,
            ...(meshVisibility.length > 0 ? { meshVisibility } : {}),
        };
    });
    return { sequences, inverseBindMatrices };
}
function readBoundsSphere(bounds) {
    const min = bounds?.min;
    const max = bounds?.max;
    if (!min || !max || typeof min.x !== 'number' || typeof max.x !== 'number')
        return null;
    return {
        center: [
            (min.x + max.x) / 2,
            (min.y + max.y) / 2,
            (min.z + max.z) / 2,
        ],
        radius: bounds.radius ?? 0,
    };
}
//# sourceMappingURL=tracks.js.map