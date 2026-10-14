/**
 * The real MAT_ layer reference fields (structures.xml MAT_ v15+, lines ~1180–1197).
 * Order matches the shader slot table in OPUS_TASK_P4_M3_MATERIALS.md §1.1.
 * The previous list contained mostly nonexistent names (layer_emi, layer_glow, …),
 * which is why most texture paths were never requested.
 */
export const MATERIAL_LAYER_FIELDS = [
    'layer_diff',
    'layer_decal',
    'layer_spec',
    'layer_gloss',
    'layer_emis1',
    'layer_emis2',
    'layer_envi',
    'layer_envi_mask',
    'layer_alpha1',
    'layer_alpha2',
    'layer_norm',
    'layer_height',
    'layer_light',
    'layer_ao',
    'layer_norm_blend1_mask',
    'layer_norm_blend2_mask',
    'layer_norm_blend1',
    'layer_norm_blend2',
];
export const UI_LAYER_FIELDS = [
    { key: 'layer_diff', label: 'Diffuse' },
    { key: 'layer_decal', label: 'Decal' },
    { key: 'layer_spec', label: 'Specular' },
    { key: 'layer_gloss', label: 'Gloss' },
    { key: 'layer_emis1', label: 'Emissive 1' },
    { key: 'layer_emis2', label: 'Emissive 2' },
    { key: 'layer_envi', label: 'Environment' },
    { key: 'layer_envi_mask', label: 'Environment Mask' },
    { key: 'layer_alpha1', label: 'Alpha Mask 1' },
    { key: 'layer_alpha2', label: 'Alpha Mask 2' },
    { key: 'layer_norm', label: 'Normal' },
    { key: 'layer_height', label: 'Height' },
    { key: 'layer_light', label: 'Light Map' },
    { key: 'layer_ao', label: 'Ambient Occlusion' },
];
/** MATM material-reference types (structures.xml MATM). */
export const MATM_TYPE_STANDARD = 1;
export const MATM_TYPE_DISPLACEMENT = 2;
export const MATM_TYPE_COMPOSITE = 3;
export const MATM_TYPE_TERRAIN = 4;
export const MATM_TYPE_VOLUME = 5;
export const MATM_TYPE_VOLUME_NOISE = 6;
export const MATM_TYPE_CREEP = 7;
/** Defunct in current SC2 assets but part of the documented MATM/HAI_ contract. */
export const MATM_TYPE_HAIR = 8;
export const MATM_TYPE_SPLAT_TERRAIN_BAKE = 9;
export const MATM_TYPE_REFLECTION = 10;
export const MATM_TYPE_LENS_FLARE = 11;
export const MATM_TYPE_BUFFER = 12;
/** MAT_ flag 0x80000000, stated from version 17 (structures.xml). */
const MAT_GEOMETRY_VISIBLE = 0x8000_0000;
const MAT_GEOMETRY_VISIBLE_SINCE = 17;
/**
 * All batches referencing a region, in stored batch order — a region can carry
 * several material batches (P3: the old single-`find` lookup dropped everything
 * after the first one).
 */
export function getAllRegionBatches(model, sections, division, regionIndex) {
    const batchSection = sections.getSectionByReference(division.batches);
    if (!batchSection)
        return [];
    const matRefSection = sections.getSectionByReference(model.material_references);
    const matRefs = (matRefSection?.content ?? []);
    const matSection = sections.getSectionByReference(model.materials_standard);
    const standardMaterials = (matSection?.content ?? []);
    const result = [];
    const batches = batchSection.content;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        if (!batch || batch.region_index !== regionIndex)
            continue;
        const materialReferenceIndex = batch.material_reference_index ?? 0;
        const matRef = matRefs[materialReferenceIndex];
        const matmType = matRef?.type ?? -1;
        const materialIndex = matRef?.material_index ?? -1;
        const material = matmType === MATM_TYPE_STANDARD ? (standardMaterials[materialIndex] ?? null) : null;
        const flags = Number(material?.flags ?? 0) >>> 0;
        result.push({
            batchIndex,
            materialReferenceIndex,
            matmType,
            materialIndex,
            material,
            geometryVisible: material === null ||
                (matSection?.desc.version ?? 0) < MAT_GEOMETRY_VISIBLE_SINCE ||
                (flags & MAT_GEOMETRY_VISIBLE) !== 0,
        });
    }
    return result;
}
/**
 * First standard material of a region — legacy single-material lookup kept for
 * existing consumers; new code should iterate getAllRegionBatches.
 */
export function getRegionMaterial(model, sections, division, regionIndex) {
    for (const batch of getAllRegionBatches(model, sections, division, regionIndex)) {
        if (batch.material)
            return batch.material;
    }
    return null;
}
//# sourceMappingURL=material-helpers.js.map