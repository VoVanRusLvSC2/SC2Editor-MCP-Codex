import type { RenderMaterial, StandardMaterialModel } from '@modkit/codec-kit/legacy/models';
import type { M3StructureData, SectionResolver } from '../types.js';
import { M3AnimationReferenceTrackExtractor } from '../animation/tracks.js';
export interface MaterialConversionDiagnostic {
    code: string;
    message: string;
}
export interface M3RenderMaterials {
    /** One entry per MATM material reference; mesh.materialIndex indexes this list. */
    materials: RenderMaterial[];
    diagnostics: MaterialConversionDiagnostic[];
}
export declare function convertStandardMaterial(sections: SectionResolver, mat: M3StructureData, animationTracks?: M3AnimationReferenceTrackExtractor): StandardMaterialModel;
export declare function buildRenderMaterials(model: M3StructureData, sections: SectionResolver): M3RenderMaterials;
