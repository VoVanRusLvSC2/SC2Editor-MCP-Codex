import type { M3StructureData, SectionResolver } from '../types.js';
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
export declare const SD_FIELDS: readonly ["sdev", "sd2v", "sd3v", "sd4q", "sdcc", "sdr3", "sdu8", "sds6", "sdu6", "sds3", "sdu3", "sdfg", "sdmb"];
export type SdFieldName = (typeof SD_FIELDS)[number];
export interface ParsedAnimationReference {
    /** 0 = step/constant, 1 = linear (quats slerp). */
    interpolationType: number;
    /** Undocumented; stored for diagnostics, never branched on. */
    animFlags: number;
    animId: number;
    /** Bind-pose value components (see valueToComponents). */
    initValue: number[];
}
/** Flatten a parsed key/init value into numeric components. */
export declare function valueToComponents(value: unknown): number[];
/**
 * First-class view of an AnimationReference struct
 * ({ header: { interpolation, flags, id }, default, null }) — P5 S1.
 */
export declare function parseAnimationReference(ref: M3StructureData | null | undefined): ParsedAnimationReference | null;
export interface ResolvedAnimRef {
    stcIndex: number;
    sdField: SdFieldName;
    sdIndex: number;
    sd: M3StructureData;
    /** STC concurrent flag: sampling wraps by the SD block's own fend. */
    concurrent: boolean;
    priority: number;
}
export declare class M3AnimationEvaluator {
    private readonly model;
    private readonly sections;
    private readonly sequenceStcs;
    constructor(model: M3StructureData, sections: SectionResolver);
    get sequenceCount(): number;
    /**
     * The 1.2 chain: walk the sequence's STCs in stored order; STS membership
     * validates; first hit wins; null → caller falls back to initValue.
     */
    resolveAnimRef(sequenceIndex: number, animId: number): ResolvedAnimRef | null;
    /**
     * SD sampling per 1.4: clamp before the first key, hold after the last,
     * step or lerp/slerp between; concurrent STCs wrap by the SD's own fend.
     * Writes into `out` and returns it (allocation-free steady state).
     */
    sampleSd(resolved: ResolvedAnimRef, interpolationType: number, frameMs: number, out: number[]): number[] | null;
    /**
     * Resolve + sample an AnimationReference for a sequence at a frame time;
     * falls back to the reference's initValue — the bind pose — when the
     * sequence does not drive it (the headline P5 fix).
     */
    sampleAnimRef(sequenceIndex: number, animRef: M3StructureData | null | undefined, frameMs: number, out?: number[]): number[];
}
