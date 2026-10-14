import type { M3Section, M3StructureData, M3Reference } from '../types.js';
/**
 * The real MAT_ layer reference fields (structures.xml MAT_ v15+, lines ~1180–1197).
 * Order matches the shader slot table in OPUS_TASK_P4_M3_MATERIALS.md §1.1.
 * The previous list contained mostly nonexistent names (layer_emi, layer_glow, …),
 * which is why most texture paths were never requested.
 */
export declare const MATERIAL_LAYER_FIELDS: string[];
export declare const UI_LAYER_FIELDS: {
    key: string;
    label: string;
}[];
type SectionResolver = {
    getSectionByReference(ref: M3Reference | null | undefined): M3Section | null;
};
/** MATM material-reference types (structures.xml MATM). */
export declare const MATM_TYPE_STANDARD = 1;
export declare const MATM_TYPE_DISPLACEMENT = 2;
export declare const MATM_TYPE_COMPOSITE = 3;
export declare const MATM_TYPE_TERRAIN = 4;
export declare const MATM_TYPE_VOLUME = 5;
export declare const MATM_TYPE_VOLUME_NOISE = 6;
export declare const MATM_TYPE_CREEP = 7;
/** Defunct in current SC2 assets but part of the documented MATM/HAI_ contract. */
export declare const MATM_TYPE_HAIR = 8;
export declare const MATM_TYPE_SPLAT_TERRAIN_BAKE = 9;
export declare const MATM_TYPE_REFLECTION = 10;
export declare const MATM_TYPE_LENS_FLARE = 11;
export declare const MATM_TYPE_BUFFER = 12;
export interface RegionBatch {
    batchIndex: number;
    /** Index into the MATM material_references list. */
    materialReferenceIndex: number;
    /** MATM type: 1 = standard (MAT_), 3 = composite (CMP_), others unsupported. */
    matmType: number;
    /** Index into the type-specific material list (materials_standard for type 1). */
    materialIndex: number;
    /** Resolved MAT_ entry when matmType is standard, else null. */
    material: M3StructureData | null;
    /**
     * Whether the game draws the batch's geometry. From MAT_ version 17 a standard material states it
     * (flag 0x80000000, geometry_visible); a mesh without it is there for hit tests, pathing or the
     * editor (InvisibleWalkablePlatform's slab), and the game never shows it. Earlier versions and
     * other material types always draw.
     */
    geometryVisible: boolean;
}
/**
 * All batches referencing a region, in stored batch order — a region can carry
 * several material batches (P3: the old single-`find` lookup dropped everything
 * after the first one).
 */
export declare function getAllRegionBatches(model: M3StructureData, sections: SectionResolver, division: M3StructureData, regionIndex: number): RegionBatch[];
/**
 * First standard material of a region — legacy single-material lookup kept for
 * existing consumers; new code should iterate getAllRegionBatches.
 */
export declare function getRegionMaterial(model: M3StructureData, sections: SectionResolver, division: M3StructureData, regionIndex: number): M3StructureData | null;
export {};
