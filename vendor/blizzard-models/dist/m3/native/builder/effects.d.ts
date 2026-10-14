import { type RenderMesh, type RenderModelEffects, type SequenceIndexedAnimationTrack } from '@modkit/codec-kit/legacy/models';
import type { ForceInfo, M3StructureData, ParticleSystemInfo, ProjectionInfo, RibbonInfo, SectionResolver, WarpInfo } from '../types.js';
/**
 * M3 stores ribbon lifetime/length/tessellation but no portable spawn cadence.
 * Use the 20 Hz cadence observed in Visecraft as a bounded live-preview default.
 */
export declare const M3_RIBBON_PREVIEW_EMISSION_RATE = 20;
type EffectKind = 'particle' | 'ribbon';
export interface M3EffectConversionDiagnostic {
    code: string;
    severity: 'warning' | 'info';
    emitterKind: EffectKind;
    /** `-1` denotes model-level data such as the PARC array. */
    emitterIndex: number;
    fields: string[];
    message: string;
}
export interface M3EffectParameterAnimation {
    sourceField: string;
    renderFields: string[];
    animId: number;
    interpolationType: number;
    animFlags: number;
    initValue: readonly number[];
    sequenceTracks: SequenceIndexedAnimationTrack[];
}
export interface M3EffectEmitterAnimationMetadata {
    emitterIndex: number;
    parameters: M3EffectParameterAnimation[];
}
export interface M3EffectAnimationMetadata {
    /** Effect animation remains sequence-indexed until RenderModel supports it directly. */
    mode: 'm3-sequence-indexed';
    particles: M3EffectEmitterAnimationMetadata[];
    ribbons: M3EffectEmitterAnimationMetadata[];
}
export interface M3RenderEffectsConversion {
    effects: RenderModelEffects;
    diagnostics: M3EffectConversionDiagnostic[];
    animationMetadata: M3EffectAnimationMetadata | null;
}
/**
 * Convert M3 PAR_/PARC/RIB_ records without pretending the generic effect
 * contract covers spline emitters, collision graphs, or ribbon cross-sections.
 */
export declare function buildM3RenderEffects(model: M3StructureData, sections: SectionResolver, particles: readonly ParticleSystemInfo[], ribbons: readonly RibbonInfo[], forces?: readonly ForceInfo[], warps?: readonly WarpInfo[], projectors?: readonly ProjectionInfo[], renderMeshes?: readonly RenderMesh[]): M3RenderEffectsConversion;
export {};
