import { M3AnimationReferenceTrackExtractor } from '../animation/tracks.js';
import { getSectionString } from '../utils/texture.js';
import { MATM_TYPE_BUFFER, MATM_TYPE_COMPOSITE, MATM_TYPE_CREEP, MATM_TYPE_DISPLACEMENT, MATM_TYPE_HAIR, MATM_TYPE_LENS_FLARE, MATM_TYPE_REFLECTION, MATM_TYPE_SPLAT_TERRAIN_BAKE, MATM_TYPE_STANDARD, MATM_TYPE_TERRAIN, MATM_TYPE_VOLUME, MATM_TYPE_VOLUME_NOISE, } from './material-helpers.js';
/**
 * M3 → RenderModel material conversion (OPUS_TASK_P4_M3_MATERIALS.md S3).
 * MATM routing: type 1 → StandardMaterialModel from MAT_, type 3 →
 * CompositeMaterialModel from CMP_/CMS_ passes, everything else → metadata +
 * `material-type-unsupported` diagnostic (renderers draw the fallback).
 */
/** MAT_ layer reference field → shader slot (P4 table 1.1). */
const LAYER_FIELD_TO_SLOT = [
    ['layer_diff', 'diffuse'],
    ['layer_decal', 'decal'],
    ['layer_spec', 'specular'],
    ['layer_gloss', 'gloss'],
    ['layer_emis1', 'emissive1'],
    ['layer_emis2', 'emissive2'],
    ['layer_envi', 'envi'],
    ['layer_envi_mask', 'enviMask'],
    ['layer_alpha1', 'alpha1'],
    ['layer_alpha2', 'alpha2'],
    ['layer_norm', 'normal'],
    ['layer_norm_blend1_mask', 'normalBlend1Mask'],
    ['layer_norm_blend2_mask', 'normalBlend2Mask'],
    ['layer_norm_blend1', 'normalBlend1'],
    ['layer_norm_blend2', 'normalBlend2'],
    ['layer_height', 'height'],
    ['layer_light', 'lightMap'],
    ['layer_ao', 'ao'],
];
// LAYR flag bits (structures.xml LAYR).
const LAYR_UV_WRAP_X = 0x4;
const LAYR_UV_WRAP_Y = 0x8;
const LAYR_COLOR_INVERT = 0x10;
const LAYR_COLOR_CLAMP = 0x20;
const LAYR_COLOR_ADD = 0x40;
const LAYR_COLOR_MULT = 0x80;
const LAYR_COLOR = 0x400;
const LAYR_FRESNEL_TRANSFORM = 0x4000;
const LAYR_FRESNEL_NORMALIZE = 0x8000;
const LAYR_FRESNEL_LOCAL_TRANSFORM = 0x10000;
const LAYR_FRESNEL_DO_NOT_MIRROR = 0x20000;
// MAT_ flag bits consumed in P4 (others ride metadata untouched).
const MAT_VERTEX_COLOR = 0x1;
const MAT_VERTEX_ALPHA = 0x2;
const MAT_TWO_SIDED = 0x8;
const MAT_UNSHADED = 0x10;
const MAT_DEPTH_PREPASS = 0x100;
const MAT_DOUBLE_LAMBERT = 0x80000;
/** MAT_ simulate_roughness enables specular energy correction and environment blur together. */
const MAT_SIMULATE_ROUGHNESS = 0x800;
const MAT_CLAMP_OUTPUT = 0x40000000;
const SPECIALIZED_MATERIAL_TAGS = {
    [MATM_TYPE_DISPLACEMENT]: 'DIS_',
    [MATM_TYPE_TERRAIN]: 'TER_',
    [MATM_TYPE_VOLUME]: 'VOL_',
    [MATM_TYPE_VOLUME_NOISE]: 'VON_',
    [MATM_TYPE_CREEP]: 'CREP',
    [MATM_TYPE_HAIR]: 'HAI_',
    [MATM_TYPE_SPLAT_TERRAIN_BAKE]: 'STBM',
    [MATM_TYPE_REFLECTION]: 'REF_',
    [MATM_TYPE_LENS_FLARE]: 'LFLR',
    [MATM_TYPE_BUFFER]: 'MADD',
};
/**
 * Families with no color of their own: DIS_ refracts the frame behind it, TER_ shows the terrain
 * under the model. They publish a render presentation instead of a surface approximation.
 */
const COLORLESS_PRESENTATIONS = {
    [MATM_TYPE_DISPLACEMENT]: 'screen-distortion',
    [MATM_TYPE_TERRAIN]: 'terrain-projection',
};
function animFloat(ref, fallback, animationTracks) {
    const value = typeof ref?.default === 'number' ? ref.default : fallback;
    const sequenceTracks = animationTracks?.extract(ref) ?? [];
    return { value, ...(sequenceTracks.length > 0 ? { sequenceTracks } : {}) };
}
function animVec2(ref, fallback, animationTracks) {
    const v = ref?.default;
    const sequenceTracks = animationTracks?.extract(ref) ?? [];
    if (v && typeof v.x === 'number' && typeof v.y === 'number') {
        return {
            value: [v.x, v.y],
            ...(sequenceTracks.length > 0 ? { sequenceTracks } : {}),
        };
    }
    return { value: fallback, ...(sequenceTracks.length > 0 ? { sequenceTracks } : {}) };
}
function animVec3(ref, fallback, animationTracks) {
    const v = ref?.default;
    const sequenceTracks = animationTracks?.extract(ref) ?? [];
    if (v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') {
        return {
            value: [v.x, v.y, v.z],
            ...(sequenceTracks.length > 0 ? { sequenceTracks } : {}),
        };
    }
    return { value: fallback, ...(sequenceTracks.length > 0 ? { sequenceTracks } : {}) };
}
function normalizedColorVector(vector) {
    const component = (index, fallback) => Math.min(Math.max((vector[index] ?? fallback) / 255, 0), 1);
    return [component(0, 255), component(1, 255), component(2, 255), component(3, 255)];
}
function animColor(ref, animationTracks) {
    const c = ref?.default;
    const sequenceTracks = animationTracks?.extract(ref, { transformVector: normalizedColorVector }) ?? [];
    if (c && typeof c.r === 'number') {
        return {
            value: normalizedColorVector([
                c.r,
                c.g ?? 255,
                c.b ?? 255,
                c.a ?? 255,
            ]),
            ...(sequenceTracks.length > 0 ? { sequenceTracks } : {}),
        };
    }
    return {
        value: [1, 1, 1, 1],
        ...(sequenceTracks.length > 0 ? { sequenceTracks } : {}),
    };
}
function hasSequenceTracks(value) {
    return (value.sequenceTracks?.length ?? 0) > 0;
}
function finiteMaterialNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function materialVec3(value, fallback) {
    const vector = value;
    return [
        finiteMaterialNumber(vector?.x, fallback[0]),
        finiteMaterialNumber(vector?.y, fallback[1]),
        finiteMaterialNumber(vector?.z, fallback[2]),
    ];
}
function referenceNormalBlendFactors(sections, ref, animationTracks) {
    const section = sections.getSectionByReference(ref);
    const entries = (section?.content ?? []);
    const factor = (index, fallback) => animFloat(entries[index]?.value, fallback, animationTracks);
    return [
        factor(0, 1),
        factor(1, 0),
        factor(2, 0),
        factor(3, 0),
        factor(4, 1),
        factor(5, 0),
        factor(6, 0),
        factor(7, 0),
    ];
}
function resolveLayer(sections, ref) {
    const section = sections.getSectionByReference(ref);
    return section?.content?.[0] ?? null;
}
function convertLayer(sections, layer, slot, op, animationTracks) {
    const flags = layer.flags ?? 0;
    const bitmapPath = getSectionString(sections, layer.color_bitmap);
    const usesConstantColor = (flags & LAYR_COLOR) !== 0;
    if (!bitmapPath && !usesConstantColor)
        return null; // disabled layer
    const channelsRaw = layer.color_channels ?? 0;
    const converted = {
        slot,
        // LAYR.color is a source selector: Blender M3 Studio imports COLOR when
        // this bit is set even if the stale bitmap reference is still populated.
        // Keeping that bitmap active would hide animated color_value in shaders.
        texturePath: usesConstantColor ? null : bitmapPath || null,
        uvSource: layer.uv_source ?? 0,
        channels: Math.min(Math.max(channelsRaw, 0), 5),
        op,
        // The diffuse alpha is the team mask only when the layer selects more than RGB — the game's
        // layer shader gates TEAMCOLOR_DIFFUSE on `ChannelSelect != RGB` (psmateriallayer.fx, as
        // WhiteoutFlakes reads it). An RGB diffuse keeps its texel colour whatever its alpha holds.
        // Emissive team colour arrives via ops 4/5 instead.
        teamColorMode: slot === 'diffuse' && channelsRaw !== 0 ? 1 : 0,
        invert: (flags & LAYR_COLOR_INVERT) !== 0,
        clampResult: (flags & LAYR_COLOR_CLAMP) !== 0,
        wrapX: (flags & LAYR_UV_WRAP_X) !== 0,
        wrapY: (flags & LAYR_UV_WRAP_Y) !== 0,
        // Native UV allocation provenance; preserve related-layer redirects.
        ...{sourceFlags: flags >>> 0,
            ...(typeof layer.uv_source_related === 'number' ? {sourceUvRelated: layer.uv_source_related} : {})},
    };
    if (usesConstantColor) {
        converted.constantColor = animColor(layer.color_value, animationTracks);
    }
    if (flags & LAYR_COLOR_MULT) {
        converted.colorMultiply = animFloat(layer.color_multiply, 1, animationTracks);
    }
    if (flags & LAYR_COLOR_ADD) {
        converted.colorAdd = animFloat(layer.color_add, 0, animationTracks);
    }
    const alphaFactor = animFloat(layer.color_brightness, 1, animationTracks);
    if (alphaFactor.value !== 1 || hasSequenceTracks(alphaFactor)) {
        converted.alphaFactor = alphaFactor;
    }
    const fresnelModeRaw = finiteMaterialNumber(layer.fresnel_type, 0);
    if (fresnelModeRaw === 1 || fresnelModeRaw === 2) {
        converted.fresnel = {
            mode: fresnelModeRaw,
            exponent: Math.max(0, finiteMaterialNumber(layer.fresnel_exponent, 4)),
            min: finiteMaterialNumber(layer.fresnel_min, 0),
            maxOffset: finiteMaterialNumber(layer.fresnel_max_offset, 1),
            transformMode: (flags & LAYR_FRESNEL_TRANSFORM) === 0 ? 0 : (flags & LAYR_FRESNEL_NORMALIZE) !== 0 ? 2 : 1,
            localTransform: (flags & LAYR_FRESNEL_LOCAL_TRANSFORM) !== 0,
            doNotMirror: (flags & LAYR_FRESNEL_DO_NOT_MIRROR) !== 0,
            translation: materialVec3(layer.fresnel_translation, [0, 0, 0]),
            invertMask: materialVec3(layer.fresnel_invert_mask, [0, 0, 0]),
            rotation: [
                finiteMaterialNumber(layer.fresnel_yaw, 0),
                finiteMaterialNumber(layer.fresnel_pitch, 0),
            ],
        };
    }
    const uvOffset = animVec2(layer.uv_offset, [0, 0], animationTracks);
    if (uvOffset.value[0] !== 0 || uvOffset.value[1] !== 0 || hasSequenceTracks(uvOffset)) {
        converted.uvOffset = uvOffset;
    }
    // structures.xml and Blender M3 Studio both model uv_angle as an animated
    // Vector3 Euler value (radians). Each component rotates its corresponding
    // triplanar projection; ordinary UVs use the authored Z component.
    const uvAngle = animVec3(layer.uv_angle, [0, 0, 0], animationTracks);
    if (uvAngle.value[0] !== 0 ||
        uvAngle.value[1] !== 0 ||
        uvAngle.value[2] !== 0 ||
        hasSequenceTracks(uvAngle)) {
        converted.uvAngle = uvAngle;
    }
    const uvTiling = animVec2(layer.uv_tiling, [1, 1], animationTracks);
    if (uvTiling.value[0] !== 1 || uvTiling.value[1] !== 1 || hasSequenceTracks(uvTiling)) {
        converted.uvTiling = uvTiling;
    }
    const uvTriplanarOffset = animVec3(layer.uv_triplanar_offset, [0, 0, 0], animationTracks);
    if (uvTriplanarOffset.value[0] !== 0 ||
        uvTriplanarOffset.value[1] !== 0 ||
        uvTriplanarOffset.value[2] !== 0 ||
        hasSequenceTracks(uvTriplanarOffset)) {
        converted.uvTriplanarOffset = uvTriplanarOffset;
    }
    const uvTriplanarScale = animVec3(layer.uv_triplanar_scale, [1, 1, 1], animationTracks);
    if (uvTriplanarScale.value[0] !== 1 ||
        uvTriplanarScale.value[1] !== 1 ||
        uvTriplanarScale.value[2] !== 1 ||
        hasSequenceTracks(uvTriplanarScale)) {
        converted.uvTriplanarScale = uvTriplanarScale;
    }
    const rows = layer.uv_flipbook_rows ?? 0;
    const cols = layer.uv_flipbook_cols ?? 0;
    if (rows > 0 && cols > 0 && rows * cols > 1) {
        converted.flipbook = {
            rows,
            cols,
            frame: animFloat(layer.uv_flipbook_frame, 0, animationTracks),
        };
    }
    return converted;
}
export function convertStandardMaterial(sections, mat, animationTracks) {
    const flags = mat.flags ?? 0;
    const additionalFlags = mat.additional_flags ?? 0;
    const validLayerOp = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
        ? value
        : 2;
    const layerOp = validLayerOp(mat.blend_mode_layer);
    const emis1Op = validLayerOp(mat.blend_mode_emis1);
    const emis2Op = validLayerOp(mat.blend_mode_emis2);
    const layers = {};
    for (const [field, slot] of LAYER_FIELD_TO_SLOT) {
        const layerStruct = resolveLayer(sections, mat[field]);
        if (!layerStruct)
            continue;
        // MAT_ supplies the shared surface op plus two independent emissive ops.
        const op = slot === 'emissive1' ? emis1Op : slot === 'emissive2' ? emis2Op : layerOp;
        const converted = convertLayer(sections, layerStruct, slot, op, animationTracks);
        if (converted)
            layers[slot] = converted;
    }
    const parallaxHeight = animFloat(mat.parallax_height, 0, animationTracks);
    const hasNormalBlendLayers = layers.normalBlend1 !== undefined ||
        layers.normalBlend2 !== undefined ||
        layers.normalBlend1Mask !== undefined ||
        layers.normalBlend2Mask !== undefined;
    const normalBlendFactors = referenceNormalBlendFactors(sections, mat.normal_blend_mask_factor, animationTracks);
    return {
        layers,
        sourceFlags: flags >>> 0,
        sourceAdditionalFlags: additionalFlags >>> 0,
        materialClass: mat.material_class ?? 0,
        blendMode: mat.blend_mode ?? 0,
        priority: mat.priority ?? 0,
        specularity: mat.specularity ?? 0,
        specMult: mat.hdr_spec ?? 1,
        emisMult: mat.hdr_emis ?? 1,
        environmentMultipliers: [
            finiteMaterialNumber(mat.hdr_envi_const, 1),
            finiteMaterialNumber(mat.hdr_envi_diff, 0),
            finiteMaterialNumber(mat.hdr_envi_spec, 0),
        ],
        ...(parallaxHeight.value !== 0 || hasSequenceTracks(parallaxHeight) ? { parallaxHeight } : {}),
        ...(hasNormalBlendLayers ? { normalBlendFactors } : {}),
        specMode: (mat.spec_mode ?? 0) === 1 ? 1 : 0,
        alphaTestThreshold: Math.min(Math.max((mat.alpha_test_threshold ?? 0) / 255, 0), 1),
        twoSided: (flags & MAT_TWO_SIDED) !== 0,
        unshaded: (flags & MAT_UNSHADED) !== 0,
        depthPrepass: (flags & MAT_DEPTH_PREPASS) !== 0,
        doubleLambert: (flags & MAT_DOUBLE_LAMBERT) !== 0,
        clampOutput: (flags & MAT_CLAMP_OUTPUT) !== 0,
        usesVertexColor: (flags & MAT_VERTEX_COLOR) !== 0 || (additionalFlags & 0x4) !== 0,
        usesVertexAlpha: (flags & MAT_VERTEX_ALPHA) !== 0 || (additionalFlags & 0x8) !== 0,
        ...specularEnergy(flags),
    };
}
/**
 * Base98310 141f75cf5: FakeEnergyConservingSpec receives (flags >> 11) & 1.
 * The sibling BlurEnvironmentMap setter uses the same bit; neither value is inverted.
 * A separate object: the vendored codec-kit type predates the field until the next hop.
 */
function specularEnergy(flags) {
    return { specularEnergyConservation: (flags & MAT_SIMULATE_ROUGHNESS) !== 0 };
}
function surfaceMaterial(layers, overrides = {}) {
    return {
        layers,
        blendMode: 0,
        priority: 0,
        specularity: 0,
        specMult: 1,
        emisMult: 1,
        specMode: 0,
        alphaTestThreshold: 0,
        twoSided: false,
        unshaded: false,
        doubleLambert: false,
        clampOutput: false,
        usesVertexColor: false,
        usesVertexAlpha: false,
        ...overrides,
    };
}
function convertedLayers(sections, mat, mappings, animationTracks) {
    const layers = {};
    for (const [field, slot, op = 2] of mappings) {
        const source = resolveLayer(sections, mat[field]);
        if (!source)
            continue;
        const layer = convertLayer(sections, source, slot, op, animationTracks);
        if (layer)
            layers[slot] = layer;
    }
    return layers;
}
function textureLayer(path, slot) {
    return {
        slot,
        texturePath: path,
        uvSource: 0,
        channels: 1,
        op: 2,
        teamColorMode: 0,
        invert: false,
        clampResult: false,
        wrapX: false,
        wrapY: false,
    };
}
function bufferTexturePaths(sections, mat) {
    const pathSection = sections.getSectionByReference(mat.value_data);
    const paths = [];
    for (const entry of (pathSection?.content ?? [])) {
        const path = getSectionString(sections, entry.path);
        if (path)
            paths.push(path);
    }
    return paths;
}
function convertSpecializedMaterial(type, mat, sections, animationTracks) {
    if (type === MATM_TYPE_DISPLACEMENT) {
        const strength = animFloat(mat.strength_factor, 0, animationTracks);
        return {
            standard: surfaceMaterial(convertedLayers(sections, mat, [
                ['layer_norm', 'normal'],
                ['layer_strength', 'height'],
            ], animationTracks), { priority: mat.priority ?? 0, parallaxHeight: strength }),
            metadata: { strength, flags: mat.flags ?? 0 },
        };
    }
    if (type === MATM_TYPE_TERRAIN) {
        return {
            standard: surfaceMaterial(convertedLayers(sections, mat, [['layer_terrain', 'diffuse']], animationTracks)),
            metadata: {},
        };
    }
    if (type === MATM_TYPE_VOLUME || type === MATM_TYPE_VOLUME_NOISE) {
        const density = animFloat(mat.density, 1, animationTracks);
        const alphaThreshold = Math.min(Math.max((mat.alpha_threshold ?? 0) / 255, 0), 1);
        const layers = convertedLayers(sections, mat, [
            ['layer_color', 'diffuse'],
            ['layer_noise1', 'alpha1'],
            ['layer_noise2', 'alpha2'],
        ], animationTracks);
        const metadata = {
            density,
            falloffType: mat.falloff_type ?? 0,
            flags: mat.flags ?? 0,
        };
        if (type === MATM_TYPE_VOLUME_NOISE) {
            metadata.cameraPositionMode = mat.camera_position_mode ?? 0;
            metadata.nearPlane = animFloat(mat.near_plane, 0, animationTracks);
            metadata.falloff = animFloat(mat.falloff, 0, animationTracks);
            metadata.scrollRate = animVec3(mat.scroll_rate, [0, 0, 0], animationTracks);
            metadata.translation = animVec3(mat.translation, [0, 0, 0], animationTracks);
            metadata.scale = animVec3(mat.scale, [1, 1, 1], animationTracks);
            metadata.rotation = animVec3(mat.rotation, [0, 0, 0], animationTracks);
        }
        else {
            metadata.blendMode = mat.blend_mode ?? 0;
        }
        return {
            standard: surfaceMaterial(layers, {
                blendMode: type === MATM_TYPE_VOLUME ? (mat.blend_mode ?? 1) : 1,
                alphaTestThreshold: alphaThreshold,
                twoSided: true,
                unshaded: true,
            }),
            metadata,
        };
    }
    if (type === MATM_TYPE_CREEP) {
        return {
            standard: surfaceMaterial(convertedLayers(sections, mat, [['layer_mask', 'diffuse']], animationTracks), { unshaded: true }),
            metadata: { creepLow: mat.creep_low ?? 0 },
        };
    }
    if (type === MATM_TYPE_HAIR) {
        const diffuseColor = animColor(mat.color_diffuse, animationTracks);
        const specularColor = animColor(mat.color_spec, animationTracks);
        return {
            standard: surfaceMaterial(convertedLayers(sections, mat, [
                ['layer_base', 'diffuse'],
                ['layer_spec_shift', 'specular'],
                ['layer_spec_noise', 'gloss'],
                ['layer_ao', 'ao'],
            ], animationTracks), {
                specularity: Math.max(0, finiteMaterialNumber(mat.spec_exponent0, 0)),
                twoSided: true,
            }),
            metadata: {
                shiftPrimary: finiteMaterialNumber(mat.shift_primary, 0),
                shiftSecondary: finiteMaterialNumber(mat.shift_secondary, 0),
                diffuseColor,
                specularColor,
                specExponent0: finiteMaterialNumber(mat.spec_exponent0, 0),
                specExponent1: finiteMaterialNumber(mat.spec_exponent1, 0),
            },
        };
    }
    if (type === MATM_TYPE_SPLAT_TERRAIN_BAKE) {
        return {
            standard: surfaceMaterial(convertedLayers(sections, mat, [
                ['layer_diff', 'diffuse'],
                ['layer_norm', 'normal'],
                ['layer_spec', 'specular'],
            ], animationTracks)),
            metadata: {},
        };
    }
    if (type === MATM_TYPE_REFLECTION) {
        const displacementStrength = animFloat(mat.displacement_strength, 0, animationTracks);
        const flags = mat.flags ?? 0;
        return {
            standard: surfaceMaterial(convertedLayers(sections, mat, [
                ['layer_reflection', 'envi'],
                ['layer_displacement', 'height'],
                ['layer_blur', 'decal'],
            ], animationTracks), {
                blendMode: (flags & 0x4) !== 0 ? 1 : 0,
                parallaxHeight: displacementStrength,
                twoSided: true,
            }),
            metadata: {
                reflectionStrength: animFloat(mat.reflection_strength, 1, animationTracks),
                displacementStrength,
                reflectionOffset: animFloat(mat.reflection_offset, 0, animationTracks),
                blurAngle: animFloat(mat.blur_angle, 0, animationTracks),
                blurDistance: animFloat(mat.blur_distance, 0, animationTracks),
                flags,
            },
        };
    }
    if (type === MATM_TYPE_LENS_FLARE) {
        const layers = convertedLayers(sections, mat, [
            ['layer_color', 'emissive1', 2],
            ['layer_unknown', 'alpha1', 2],
        ], animationTracks);
        const columns = mat.columns ?? 0;
        const rows = mat.rows ?? 0;
        if (layers.emissive1 && columns > 0 && rows > 0 && columns * rows > 1) {
            layers.emissive1.flipbook = { cols: columns, rows, frame: { value: 0 } };
        }
        const intensity = animFloat(mat.intensity, 1, animationTracks);
        const hdr = animFloat(mat.hdr, 1, animationTracks);
        return {
            standard: surfaceMaterial(layers, {
                blendMode: 2,
                emisMult: Math.max(0, intensity.value * hdr.value),
                twoSided: true,
                unshaded: true,
            }),
            metadata: {
                columns,
                rows,
                distanceFade: mat.distance_fade ?? 0,
                intensity,
                color: animColor(mat.color, animationTracks),
                hdr,
                size: animFloat(mat.size, 1, animationTracks),
            },
        };
    }
    if (type === MATM_TYPE_BUFFER) {
        const texturePaths = bufferTexturePaths(sections, mat);
        const layers = {};
        if (texturePaths[0])
            layers.diffuse = textureLayer(texturePaths[0], 'diffuse');
        return {
            standard: surfaceMaterial(layers),
            metadata: { texturePaths },
        };
    }
    return null;
}
export function buildRenderMaterials(model, sections) {
    const diagnostics = [];
    const animationTracks = new M3AnimationReferenceTrackExtractor(model, sections);
    const matmSection = sections.getSectionByReference(model.material_references);
    const matms = (matmSection?.content ?? []);
    const standardSection = sections.getSectionByReference(model.materials_standard);
    const standards = (standardSection?.content ?? []);
    const compositeSection = sections.getSectionByReference(model.materials_composite);
    const composites = (compositeSection?.content ?? []);
    const materialEntries = (field) => {
        const section = sections.getSectionByReference(model[field]);
        return (section?.content ?? []);
    };
    const specializedSources = new Map([
        [MATM_TYPE_DISPLACEMENT, materialEntries('materials_displacement')],
        [MATM_TYPE_TERRAIN, materialEntries('materials_terrain')],
        [MATM_TYPE_VOLUME, materialEntries('materials_volume')],
        [MATM_TYPE_VOLUME_NOISE, materialEntries('materials_volumenoise')],
        [MATM_TYPE_CREEP, materialEntries('materials_creep')],
        [MATM_TYPE_HAIR, materialEntries('materials_hair')],
        [MATM_TYPE_SPLAT_TERRAIN_BAKE, materialEntries('materials_splatterrainbake')],
        [MATM_TYPE_REFLECTION, materialEntries('materials_reflection')],
        [MATM_TYPE_LENS_FLARE, materialEntries('materials_lensflare')],
        [MATM_TYPE_BUFFER, materialEntries('materials_buffer')],
    ]);
    const materialName = (mat, fallback) => (mat ? getSectionString(sections, mat.name) : null) || fallback;
    const legacyLayers = (standard) => Object.values(standard.layers)
        .filter((layer) => !!layer?.texturePath)
        .map(layer => ({
        label: layer.slot,
        path: layer.texturePath,
        metadata: {
            wrapS: layer.wrapX ? 'repeat' : 'clamp',
            wrapT: layer.wrapY ? 'repeat' : 'clamp',
        },
    }));
    const approximated = new Set();
    const convertSurfaceMatm = (matmIndex) => {
        const matm = matms[matmIndex];
        const type = matm?.type ?? -1;
        const materialIndex = matm?.material_index ?? -1;
        if (type === MATM_TYPE_STANDARD) {
            const source = standards[materialIndex];
            return source
                ? {
                    source,
                    standard: convertStandardMaterial(sections, source, animationTracks),
                    metadata: {},
                }
                : null;
        }
        const source = specializedSources.get(type)?.[materialIndex];
        if (!source)
            return null;
        const converted = convertSpecializedMaterial(type, source, sections, animationTracks);
        return converted ? { source, ...converted } : null;
    };
    const recordApproximation = (matmIndex, type) => {
        if (approximated.has(matmIndex))
            return;
        approximated.add(matmIndex);
        diagnostics.push({
            code: 'material-family-approximated',
            message: `MATM ${matmIndex} ${SPECIALIZED_MATERIAL_TAGS[type]} uses the shared surface shader approximation`,
        });
    };
    const materials = matms.map((matm, matmIndex) => {
        const type = matm.type ?? -1;
        const materialIndex = matm.material_index ?? -1;
        if (type === MATM_TYPE_COMPOSITE) {
            const cmp = composites[materialIndex];
            if (cmp) {
                const sectionsRef = sections.getSectionByReference(cmp.sections);
                const passes = [];
                for (const cms of (sectionsRef?.content ?? [])) {
                    const passMatmIndex = cms.material_reference_index ?? -1;
                    const passMatm = matms[passMatmIndex];
                    const passType = passMatm?.type ?? -1;
                    const presentation = COLORLESS_PRESENTATIONS[passType];
                    if (presentation !== undefined) {
                        diagnostics.push({
                            code: 'composite-pass-presentation-unrendered',
                            message: `composite material ${matmIndex} pass references ${SPECIALIZED_MATERIAL_TAGS[passType]} presentation ${presentation}; it is preserved by the native source but omitted from color passes`,
                        });
                        continue;
                    }
                    const pass = convertSurfaceMatm(passMatmIndex);
                    if (!pass) {
                        diagnostics.push({
                            code: 'composite-pass-unsupported',
                            message: `composite material ${matmIndex} pass references MATM ${passMatmIndex} (type ${passType}) which has no surface representation`,
                        });
                        continue;
                    }
                    if (passType !== MATM_TYPE_STANDARD)
                        recordApproximation(passMatmIndex, passType);
                    passes.push({
                        material: pass.standard,
                        alphaFactor: animFloat(cms.alpha_factor, 1, animationTracks),
                    });
                }
                const composite = {
                    passes,
                    priority: cmp.priority ?? 0,
                };
                return {
                    name: materialName(cmp, `Composite_${matmIndex}`),
                    layers: passes.flatMap(pass => legacyLayers(pass.material)),
                    composite,
                    metadata: { matmType: type, materialIndex, sourceMaterialTag: 'CMP_' },
                };
            }
        }
        else {
            const converted = convertSurfaceMatm(matmIndex);
            if (converted) {
                const presentation = COLORLESS_PRESENTATIONS[type];
                if (type !== MATM_TYPE_STANDARD && presentation === undefined)
                    recordApproximation(matmIndex, type);
                const sourceMaterialTag = type === MATM_TYPE_STANDARD ? 'MAT_' : SPECIALIZED_MATERIAL_TAGS[type];
                return {
                    name: materialName(converted.source, `${sourceMaterialTag}_${matmIndex}`),
                    layers: legacyLayers(converted.standard),
                    standard: converted.standard,
                    metadata: {
                        matmType: type,
                        materialIndex,
                        sourceMaterialTag,
                        ...(presentation === undefined ? {} : { presentation }),
                        renderSupport: type === MATM_TYPE_STANDARD
                            ? 'native'
                            : presentation === undefined
                                ? 'surface-approximation'
                                : 'presentation',
                        ...converted.metadata,
                    },
                };
            }
        }
        const knownTag = type === MATM_TYPE_COMPOSITE ? 'CMP_' : SPECIALIZED_MATERIAL_TAGS[type];
        diagnostics.push({
            code: knownTag ? 'material-reference-invalid' : 'material-type-unsupported',
            message: knownTag
                ? `MATM ${matmIndex} references missing ${knownTag} material ${materialIndex}`
                : `MATM ${matmIndex} has unsupported material type ${type}`,
        });
        return {
            name: `Material_${matmIndex}`,
            layers: [],
            metadata: { matmType: type, materialIndex },
        };
    });
    return { materials, diagnostics };
}
//# sourceMappingURL=standard-material.js.map
