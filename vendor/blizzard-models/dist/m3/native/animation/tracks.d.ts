import type { RenderSequence, SequenceIndexedAnimationTrack } from '@modkit/codec-kit/legacy/models';
import type { M3StructureData, SectionResolver } from '../types.js';
export interface M3SequenceExtraction {
    sequences: RenderSequence[];
    /** Per-bone IREF inverse bind matrices (column-major 16 floats). */
    inverseBindMatrices: (Float32Array | undefined)[];
}
export interface M3AnimationReferenceTrackOptions {
    /** Convert every extracted key vector (for example, normalize COL_ bytes). */
    transformVector?: (vector: readonly number[]) => readonly number[];
}
/**
 * Reusable sparse AnimationReference extractor for non-bone properties.
 *
 * Unlike bone extraction, it emits entries only for sequences whose STG/STC/STS
 * chain resolves the reference's animId. Other sequences retain the property's
 * static init value without a duplicated constant track.
 */
export declare class M3AnimationReferenceTrackExtractor {
    private readonly sections;
    private readonly evaluator;
    private readonly sequences;
    constructor(model: M3StructureData, sections: SectionResolver);
    extract(ref: M3StructureData | null | undefined, options?: M3AnimationReferenceTrackOptions): SequenceIndexedAnimationTrack[];
}
export declare function buildRenderSequences(model: M3StructureData, sections: SectionResolver): M3SequenceExtraction;
