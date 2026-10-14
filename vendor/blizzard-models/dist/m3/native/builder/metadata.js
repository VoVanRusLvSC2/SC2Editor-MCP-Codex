import { getSectionString } from '../utils/texture.js';
import { m3MatrixToArray } from '../utils/matrix.js';
import { BoneResolver } from '../utils/bone-resolver.js';
import { MATERIAL_LAYER_FIELDS, UI_LAYER_FIELDS } from './material-helpers.js';
export function buildAttachmentPoints(model, sections) {
    const attSection = sections.getSectionByReference(model.attachment_points);
    if (!attSection)
        return [];
    return attSection.content.map((att, i) => ({
        name: getSectionString(sections, att.name) ?? `Attachment_${i}`,
        boneIndex: att.bone ?? -1,
    }));
}
export function getModelTextureFilenames(model, sections) {
    const filenames = new Set();
    const matSection = sections.getSectionByReference(model.materials_standard);
    if (matSection) {
        for (const mat of matSection.content) {
            for (const field of MATERIAL_LAYER_FIELDS) {
                const ref = mat[field];
                if (!ref)
                    continue;
                const layerSec = sections.getSectionByReference(ref);
                const layer = layerSec?.content[0];
                if (!layer || !layer.color_bitmap)
                    continue;
                const m3Path = getSectionString(sections, layer.color_bitmap);
                if (m3Path) {
                    const filename = m3Path.replace(/\\/g, '/').split('/').pop();
                    if (filename)
                        filenames.add(filename);
                }
            }
        }
    }
    return filenames;
}
/** Returns the full relative texture paths as stored in the M3 binary, forward-slash normalised.
 *  E.g. "Assets/Textures/Foo_Diffuse.dds" — join with an sc2mod root for direct file lookup. */
export function getModelTexturePaths(model, sections) {
    const paths = [];
    const seen = new Set();
    const matSection = sections.getSectionByReference(model.materials_standard);
    if (matSection) {
        for (const mat of matSection.content) {
            for (const field of MATERIAL_LAYER_FIELDS) {
                const ref = mat[field];
                if (!ref)
                    continue;
                const layerSec = sections.getSectionByReference(ref);
                const layer = layerSec?.content[0];
                if (!layer || !layer.color_bitmap)
                    continue;
                const m3Path = getSectionString(sections, layer.color_bitmap);
                if (m3Path) {
                    const normalized = m3Path.replace(/\\/g, '/');
                    if (normalized && !seen.has(normalized)) {
                        seen.add(normalized);
                        paths.push(normalized);
                    }
                }
            }
        }
    }
    return paths;
}
export function buildMaterialList(model, sections) {
    const matSection = sections.getSectionByReference(model.materials_standard);
    if (!matSection)
        return [];
    return matSection.content.map((mat, i) => {
        const name = getSectionString(sections, mat.name) || `Material_${i}`;
        const textures = [];
        for (const { key, label } of UI_LAYER_FIELDS) {
            const ref = mat[key];
            if (!ref)
                continue;
            const layerSec = sections.getSectionByReference(ref);
            const layer = layerSec?.content[0];
            if (!layer || !layer.color_bitmap)
                continue;
            const m3Path = getSectionString(sections, layer.color_bitmap);
            if (!m3Path)
                continue;
            const normalized = m3Path.replace(/\\/g, '/');
            textures.push({ label, filename: normalized });
        }
        return { name, textures };
    });
}
export function buildBoneHierarchy(model, sections) {
    const boneSection = sections.getSectionByReference(model.bones);
    if (!boneSection)
        return [];
    return boneSection.content.map((bone, i) => ({
        index: i,
        name: getSectionString(sections, bone.name) || `Bone_${i}`,
        parentIndex: bone.parent != null && bone.parent >= 0 ? bone.parent : -1,
        flags: bone.flags ?? 0,
    }));
}
export function buildHitVolumes(model, sections) {
    function ssgsToObj(s, i) {
        if (!s || s.shape === undefined)
            return null;
        try {
            return {
                index: i,
                shape: s.shape,
                boneIndex: s.bone,
                matrix4: m3MatrixToArray(s.matrix),
                size0: s.size0,
                size1: s.size1,
                size2: s.size2,
            };
        }
        catch {
            return null;
        }
    }
    function atvlToObj(a, i) {
        if (!a)
            return null;
        try {
            return {
                index: i,
                shape: a.shape,
                boneIndex: a.bone0,
                matrix4: m3MatrixToArray(a.matrix),
                size0: a.size0,
                size1: a.size1,
                size2: a.size2,
            };
        }
        catch {
            return null;
        }
    }
    const hitSection = sections.getSectionByReference(model.hittests);
    const hittests = [];
    if (hitSection) {
        const content = hitSection.content;
        for (let i = 0; i < content.length; i++) {
            const v = ssgsToObj(content[i], i);
            if (v)
                hittests.push(v);
        }
    }
    const atvlSection = sections.getSectionByReference(model.attachment_volumes);
    const attachmentVolumes = [];
    if (atvlSection) {
        const content = atvlSection.content;
        for (let i = 0; i < content.length; i++) {
            const v = atvlToObj(content[i], i);
            if (v)
                attachmentVolumes.push(v);
        }
    }
    let tight = null;
    try {
        if (model.hittest_tight) {
            tight = ssgsToObj(model.hittest_tight, -1);
        }
    }
    catch {
        // ignore
    }
    return { tight, hittests, attachmentVolumes };
}
export function buildBounds(model) {
    const b = model.boundings;
    if (!b)
        return null;
    const min = b.min;
    const max = b.max;
    if (!min || !max)
        return null;
    return {
        left: min.x,
        right: max.x,
        back: min.y,
        front: max.y,
        bottom: min.z,
        top: max.z,
        radius: b.radius ?? 0,
    };
}
export function buildLights(model, sections) {
    const lightSection = sections.getSectionByReference(model.lights);
    if (!lightSection || !lightSection.content.length)
        return [];
    const bones = new BoneResolver(sections, model);
    const shapeNames = ['Directional', 'Point', 'Spot'];
    return lightSection.content.map((l, i) => {
        const boneIndex = l.bone ?? -1;
        const type = l.shape ?? 0;
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `Light_${i}`),
            type,
            shape: shapeNames[type] ?? 'Unknown',
            boneIndex,
            flags: l.flags ?? 0,
            color: readAnimVec3(l.color),
            intensity: readAnimFloat(l.intensity, 1),
            specularColor: readAnimVec3(l.spec_color),
            specularIntensity: readAnimFloat(l.spec_intensity, 1),
            decay: readAnimFloat(l.decay, 1),
            attenuationNear: readAnimFloat(l.attenuation_near, 0),
            attenuationFar: l.attenuation_far ?? 0,
            hotspot: readAnimFloat(l.hotspot, 0),
            falloff: readAnimFloat(l.falloff, 0),
        };
    });
}
export function buildTurrets(model, sections) {
    const turretSection = sections.getSectionByReference(model.turrets);
    if (!turretSection || !turretSection.content.length)
        return [];
    const partData = (sections.getSectionByReference(model.turret_parts)
        ?.content ?? []);
    const bones = new BoneResolver(sections, model);
    return turretSection.content.map((t, i) => {
        const name = getSectionString(sections, t.name) || `Turret_${i}`;
        const partIndices = (sections.getSectionByReference(t.parts)
            ?.content ?? []);
        const parts = partIndices
            .map(ii => {
            const p = partData[ii];
            if (!p)
                return null;
            const boneIndex = p.bone ?? -1;
            return { boneIndex, boneName: bones.getNameOrFallback(boneIndex, `Bone_${boneIndex}`) };
        })
            .filter(Boolean);
        return { index: i, name, parts };
    });
}
export function buildCameras(model, sections) {
    const cameraSection = sections.getSectionByReference(model.cameras);
    if (!cameraSection)
        return [];
    const bones = new BoneResolver(sections, model);
    function getAnimFloat(animRef, fallback) {
        if (typeof animRef === 'number')
            return Number.isFinite(animRef) ? animRef : fallback;
        if (!animRef)
            return fallback;
        const defVal = animRef.default ?? animRef.default;
        if (typeof defVal === 'number' && !isNaN(defVal))
            return defVal;
        return fallback;
    }
    return cameraSection.content.map((c, i) => {
        const boneIndex = c.bone ?? -1;
        const shadowClipDistance = getAnimFloat(c.shadow_clip_distance, 10);
        const focusDistance = getAnimFloat(c.focus_distance, 2);
        const farFocusRange = getAnimFloat(c.far_focus_range, 1);
        const nearFocusRange = getAnimFloat(c.near_focus_range, 2);
        return {
            index: i,
            name: getSectionString(sections, c.name) ||
                bones.getNameOrFallback(boneIndex, `Camera_${i}`),
            boneIndex,
            fieldOfView: getAnimFloat(c.field_of_view, 0.5),
            farClip: getAnimFloat((c.far_clip ?? c.far_clip_static), 10000),
            nearClip: getAnimFloat((c.near_clip ?? c.near_clip_static), 0.1),
            shadowClipDistance,
            focusDistance,
            farFocusRange,
            nearFocusRange,
            nearFalloffStart: getAnimFloat(c.near_falloff_start, 0),
            nearFalloffEnd: getAnimFloat(c.near_falloff_end, 0),
            dofType: c.depth_of_field_type ?? 3,
            bokehFStop: getAnimFloat(c.bokeh_f_stop, 0),
            bokehMaxCoCDiameter: getAnimFloat(c.bokeh_max_coc_diameter, 0),
            // Compatibility aliases for the pre-spec-alignment public API.
            clip2: shadowClipDistance,
            focalDepth: focusDistance,
            falloffStart: farFocusRange,
            falloffEnd: nearFocusRange,
            depthOfField: getAnimFloat(c.depth_of_field, 0.5),
            useVerticalFov: Boolean(c.use_vertical_fov ?? 1),
        };
    });
}
// ── Material texture helper ───────────────────────────────────────────────────
function getEffectTextureFilename(model, sections, materialRefIndex) {
    const matRefSection = sections.getSectionByReference(model.material_references);
    if (!matRefSection)
        return null;
    const matRef = matRefSection.content[materialRefIndex];
    if (!matRef || matRef.type !== 1)
        return null;
    const matSection = sections.getSectionByReference(model.materials_standard);
    if (!matSection)
        return null;
    const mat = matSection.content[matRef.material_index ?? 0];
    if (!mat)
        return null;
    for (const key of ['layer_emis1', 'layer_emis2', 'layer_diff']) {
        const ref = mat[key];
        if (!ref)
            continue;
        const layerSec = sections.getSectionByReference(ref);
        const layer = layerSec?.content[0];
        if (!layer?.color_bitmap)
            continue;
        const path = getSectionString(sections, layer.color_bitmap);
        if (path)
            return path;
    }
    return null;
}
// ── Animation reference helpers ───────────────────────────────────────────────
function readAnimFloat(ref, fallback = 0) {
    if (!ref)
        return fallback;
    return ref.default ?? fallback;
}
function readAnimColor(ref) {
    if (!ref)
        return [1, 1, 1, 1];
    const col = ref.default;
    if (!col)
        return [1, 1, 1, 1];
    return [
        (col.r ?? 255) / 255,
        (col.g ?? 255) / 255,
        (col.b ?? 255) / 255,
        (col.a ?? 255) / 255,
    ];
}
function readAnimVec3(ref, fb = [1, 1, 1]) {
    if (!ref)
        return fb;
    const v = ref.default;
    if (!v)
        return fb;
    return [v.x ?? fb[0], v.y ?? fb[1], v.z ?? fb[2]];
}
// ─────────────────────────────────────────────────────────────────────────────
export function buildRibbons(model, sections) {
    const ribbonSection = sections.getSectionByReference(model.ribbons);
    if (!ribbonSection)
        return [];
    const bones = new BoneResolver(sections, model);
    return ribbonSection.content.map((r, i) => {
        const boneIndex = r.bone ?? -1;
        const materialIndex = r.material_reference_index ?? 0;
        const colorBase = readAnimColor(r.color_base);
        const colorMid = readAnimColor(r.color_mid);
        const colorTip = readAnimColor(r.color_tip);
        const sizeCurve = readAnimVec3(r.scale, [0.5, 0.5, 0.5]);
        const sizeBase = [sizeCurve[0], sizeCurve[0], sizeCurve[0]];
        const sizeMid = [sizeCurve[1], sizeCurve[1], sizeCurve[1]];
        const sizeTip = [sizeCurve[2], sizeCurve[2], sizeCurve[2]];
        const lifespan = readAnimFloat(r.lifespan, 1);
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `Ribbon_${i}`),
            boneIndex,
            materialIndex,
            materialName: `Material_${materialIndex}`,
            segments: 32,
            edge: 1,
            color: [colorBase[0], colorBase[1], colorBase[2]],
            alpha: colorBase[3],
            size: sizeCurve,
            duration: lifespan,
            lifespan,
            speed: readAnimFloat(r.speed, 0),
            gravityX: r.gravity_x ?? 0,
            gravityY: r.gravity_y ?? 0,
            gravityZ: r.gravity ?? 0,
            drag: r.drag ?? 0,
            colorBase,
            colorMid,
            colorTip,
            colorAnimMid: r.color_anim_mid ?? 0.5,
            sizeBase,
            sizeMid,
            sizeTip,
            sizeAnimMid: r.scale_anim_mid_time ?? r.scale_anim_mid ?? 0.5,
            ribbonType: r.ribbon_type ?? 0,
            divisions: r.divisions ?? 8,
            sides: r.sides ?? 1,
            starRatio: r.star_ratio ?? 0.5,
            segmentLength: readAnimFloat(r.length, 0.2),
            flags: r.flags ?? 0,
            textureFilename: getEffectTextureFilename(model, sections, materialIndex),
        };
    });
}
export function buildParticles(model, sections) {
    const particleSection = sections.getSectionByReference(model.particle_systems);
    if (!particleSection)
        return [];
    const bones = new BoneResolver(sections, model);
    return particleSection.content.map((p, i) => {
        const boneIndex = p.bone ?? -1;
        const materialIndex = p.material_reference_index ?? 0;
        const flags = p.flags ?? 0;
        const addlFlags = p.additional_flags ?? 0;
        const sizeCurve = readAnimVec3(p.size, [0.1, 0.1, 0.1]);
        const sizeRandomCurve = readAnimVec3(p.size2, sizeCurve);
        const sizeInit = [sizeCurve[0], sizeCurve[0], sizeCurve[0]];
        const sizeMid = [sizeCurve[1], sizeCurve[1], sizeCurve[1]];
        const sizeEnd = [sizeCurve[2], sizeCurve[2], sizeCurve[2]];
        const sizeRandomInit = [
            sizeRandomCurve[0],
            sizeRandomCurve[0],
            sizeRandomCurve[0],
        ];
        const sizeRandomMid = [
            sizeRandomCurve[1],
            sizeRandomCurve[1],
            sizeRandomCurve[1],
        ];
        const sizeRandomEnd = [
            sizeRandomCurve[2],
            sizeRandomCurve[2],
            sizeRandomCurve[2],
        ];
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `Particle_${i}`),
            boneIndex,
            materialIndex,
            materialName: `Material_${materialIndex}`,
            particleType: String(p.particle_type ?? 0),
            emitType: String(p.emit_type ?? 0),
            emitShape: String(p.emit_shape ?? 0),
            emitRate: readAnimFloat(p.emit_rate, 10),
            lifespan: readAnimFloat(p.lifespan, 1),
            maxParticles: p.emit_max ?? 100,
            gravity: p.gravity ?? 0,
            friction: p.friction ?? 0,
            drag: p.drag ?? 0,
            emitSpeed: readAnimFloat(p.emit_speed, 1),
            emitAngleX: readAnimFloat(p.emit_angle_x, 0),
            emitAngleY: readAnimFloat(p.emit_angle_y, 0),
            emitSpreadX: readAnimFloat(p.emit_spread_x, 0.5),
            emitSpreadY: readAnimFloat(p.emit_spread_y, 0.5),
            emitShapeSize: readAnimVec3(p.emit_shape_size, [1, 1, 1]),
            emitShapeRadius: readAnimFloat(p.emit_shape_radius, 1),
            sizeInit,
            sizeMid,
            sizeEnd,
            sizeRandomInit,
            sizeRandomMid,
            sizeRandomEnd,
            sizeRandomize: Number(p.size_randomize ?? 0) !== 0,
            sizeAnimMid: p.size_anim_mid ?? 0.5,
            colorInit: readAnimColor(p.color_init),
            colorMid: readAnimColor(p.color_mid),
            colorEnd: readAnimColor(p.color_end),
            colorAnimMid: p.color_anim_mid ?? 0.5,
            flags,
            localSpace: (addlFlags & 0x8) === 0,
            textureFilename: getEffectTextureFilename(model, sections, materialIndex),
        };
    });
}
export function buildProjections(model, sections) {
    const projSection = sections.getSectionByReference(model.projections);
    if (!projSection)
        return [];
    const bones = new BoneResolver(sections, model);
    return projSection.content.map((p, i) => {
        const boneIndex = p.bone ?? -1;
        const materialIndex = p.material_reference_index ?? 0;
        const projectionType = p.projection_type ?? 0;
        const projectionTypes = ['Orthographic', 'Perspective'];
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `Projection_${i}`),
            projectionType,
            type: projectionTypes[projectionType] ?? `Unknown_${projectionType}`,
            boneIndex,
            materialIndex,
            materialName: `Material_${materialIndex}`,
            offset: readAnimVec3(p.offset, [0, 0, 0]),
            pitch: readAnimFloat(p.pitch, 0),
            yaw: readAnimFloat(p.yaw, 0),
            roll: readAnimFloat(p.roll, 0),
            fieldOfView: readAnimFloat(p.field_of_view, 0),
            aspectRatio: readAnimFloat(p.aspect_ratio, 0),
            near: readAnimFloat(p.near, 0),
            far: readAnimFloat(p.far, 0),
            boxOffsetZBottom: readAnimFloat(p.box_offset_z_bottom, 0),
            boxOffsetZTop: readAnimFloat(p.box_offset_z_top, 0),
            boxOffsetXLeft: readAnimFloat(p.box_offset_x_left, 0),
            boxOffsetXRight: readAnimFloat(p.box_offset_x_right, 0),
            boxOffsetYFront: readAnimFloat(p.box_offset_y_front, 0),
            boxOffsetYBack: readAnimFloat(p.box_offset_y_back, 0),
            falloff: p.falloff ?? 0,
            alphaInit: p.alpha_init ?? 0,
            alphaMid: p.alpha_mid ?? 0,
            alphaEnd: p.alpha_end ?? 0,
            lifetimeAttack: p.lifetime_attack ?? 0,
            lifetimeAttackTo: p.lifetime_attack_to ?? 0,
            lifetimeHold: p.lifetime_hold ?? 0,
            lifetimeHoldTo: p.lifetime_hold_to ?? 0,
            lifetimeDecay: p.lifetime_decay ?? 0,
            lifetimeDecayTo: p.lifetime_decay_to ?? 0,
            attenuationDistance: p.attenuation_distance ?? 0,
            active: readAnimFloat(p.active, 0),
            layer: p.layer ?? 0,
            lodReduce: p.lod_reduce ?? 0,
            lodCut: p.lod_cut ?? 0,
            flags: p.flags ?? 0,
        };
    });
}
export function buildForces(model, sections) {
    const forceSection = sections.getSectionByReference(model.forces);
    if (!forceSection)
        return [];
    const bones = new BoneResolver(sections, model);
    const forceTypes = ['Radial', 'Wind', 'Explosion'];
    const forceShapes = ['Sphere', 'Cylinder', 'Box', 'Hemisphere'];
    return forceSection.content.map((f, i) => {
        const boneIndex = f.bone ?? -1;
        const forceType = f.force_type ?? 0;
        const shape = f.shape ?? 0;
        const flags = f.flags ?? 0;
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `Force_${i}`),
            boneIndex,
            forceType,
            type: forceTypes[forceType] ?? `Unknown_${forceType}`,
            shape,
            shapeName: forceShapes[shape] ?? `Unknown_${shape}`,
            unknownFor0: f.unknown_for0 ?? 0,
            flags,
            channels: f.channels ?? 0,
            falloff: (flags & 0x1) !== 0,
            heightGradient: (flags & 0x2) !== 0,
            unbounded: (flags & 0x4) !== 0,
            strength: readAnimFloat(f.strength, 0),
            width: readAnimFloat(f.width, 0),
            height: readAnimFloat(f.height, 0),
            length: readAnimFloat(f.length, 0),
        };
    });
}
export function buildBillboards(model, sections) {
    const bbSection = sections.getSectionByReference(model.billboards);
    if (!bbSection)
        return [];
    const bones = new BoneResolver(sections, model);
    const names = ['world-x', 'world-y', 'world-z', 'bone-x', 'unused', 'bone-y', 'free'];
    const quaternion = (value) => {
        const q = (value ?? {});
        const component = (key, fallback) => typeof q[key] === 'number' && Number.isFinite(q[key]) ? q[key] : fallback;
        return [component('x', 0), component('y', 0), component('z', 0), component('w', 1)];
    };
    return bbSection.content.map((b, i) => {
        const boneIndex = b.bone ?? -1;
        const billboardType = Number(b.billboard_type ?? 6);
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `Billboard_${i}`),
            boneIndex,
            type: names[billboardType] ?? `type-${billboardType}`,
            billboardType,
            cameraLookAt: Number(b.camera_look_at ?? 1) !== 0,
            up: quaternion(b.up),
            forward: quaternion(b.forward),
        };
    });
}
export function buildWarps(model, sections) {
    const warpSection = sections.getSectionByReference(model.warps);
    if (!warpSection)
        return [];
    const bones = new BoneResolver(sections, model);
    return warpSection.content.map((w, i) => {
        const boneIndex = w.bone ?? -1;
        const warpType = w.unknown861f507b ?? 0;
        const height = readAnimFloat(w.unknown9306aac0, 0);
        const angular = readAnimFloat(w.unknown50c7f2b4, 0);
        const axial = readAnimFloat(w.unknown8d9c977c, 0);
        const radial = readAnimFloat(w.unknownca6025a2, 0);
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `Warp_${i}`),
            boneIndex,
            unknown861f507b: warpType,
            warpType,
            unknowncf03b856: w.unknowncf03b856 ?? 0,
            radius: readAnimFloat(w.radius, 0),
            unknown9306aac0: height,
            height,
            strength: readAnimFloat(w.strength, 0),
            unknown50c7f2b4: angular,
            angular,
            unknown8d9c977c: axial,
            axial,
            unknownca6025a2: radial,
            radial,
        };
    });
}
export function buildShadowboxes(model, sections) {
    const sbSection = sections.getSectionByReference(model.shadowboxes);
    if (!sbSection)
        return [];
    return sbSection.content.map((s, i) => {
        const matrix4 = m3MatrixToArray(s.matrix);
        const halfExtents = [
            Math.hypot(matrix4[0] ?? 0, matrix4[1] ?? 0, matrix4[2] ?? 0),
            Math.hypot(matrix4[4] ?? 0, matrix4[5] ?? 0, matrix4[6] ?? 0),
            Math.hypot(matrix4[8] ?? 0, matrix4[9] ?? 0, matrix4[10] ?? 0),
        ];
        return {
            index: i,
            name: `Shadowbox_${i}`,
            matrix4,
            position: [matrix4[12] ?? 0, matrix4[13] ?? 0, matrix4[14] ?? 0],
            halfExtents,
            size: [halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2],
        };
    });
}
export function buildRigidBodies(model, sections) {
    const rbSection = sections.getSectionByReference(model.physics_rigidbodies);
    if (!rbSection)
        return [];
    const bones = new BoneResolver(sections, model);
    const shapeNames = [
        'Box',
        'Sphere',
        'Capsule',
        'Cylinder',
        'ConvexHull',
        'Mesh',
    ];
    return rbSection.content.map((r, i) => {
        const boneIndex = r.bone ?? -1;
        const shapeSection = sections.getSectionByReference(r.physics_shape);
        const shapes = (shapeSection?.content ?? []).map((shape, shapeIndex) => {
            const shapeCode = finiteNumber(shape.shape, -1);
            return {
                index: shapeIndex,
                shape: shapeNames[shapeCode] ?? 'Unknown',
                shapeCode,
                matrix4: safeMatrix4(shape.matrix),
                size: [
                    finiteNumber(shape.size0, 1),
                    finiteNumber(shape.size1, 1),
                    finiteNumber(shape.size2, 1),
                ],
                vertices: referenceVector3s(sections, shape.vertices),
            };
        });
        const primaryShape = shapes[0];
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `RigidBody_${i}`),
            boneIndex,
            // Preserve the legacy summary fields for existing editor panels.
            shape: primaryShape?.shape ?? 'Unknown',
            size: primaryShape?.size ?? [1, 1, 1],
            mass: finiteNumber(r.mass, 1),
            friction: finiteNumber(r.friction, 0.5),
            restitution: finiteNumber(r.bounce, 0.2),
            simulationType: finiteNumber(r.simulation_type, 1),
            physicalMaterial: finiteNumber(r.physical_material, 0),
            dampingLinear: finiteNumber(r.damping_linear, 0.001),
            dampingAngular: finiteNumber(r.damping_angular, 0.001),
            gravityFactor: finiteNumber(r.gravity_factor, 1),
            flags: finiteNumber(r.flags, 0),
            localForces: finiteNumber(r.local_forces, 0),
            worldForces: finiteNumber(r.world_forces, 0),
            priority: finiteNumber(r.priority, 0),
            shapes,
        };
    });
}
function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function safeMatrix4(value) {
    try {
        return m3MatrixToArray(value);
    }
    catch {
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }
}
function referenceVector3s(sections, value) {
    const section = sections.getSectionByReference(value);
    if (!section)
        return [];
    const vertices = [];
    for (const entry of section.content) {
        if (Array.isArray(entry) || ArrayBuffer.isView(entry)) {
            const values = Array.from(entry);
            vertices.push([
                finiteNumber(values[0], 0),
                finiteNumber(values[1], 0),
                finiteNumber(values[2], 0),
            ]);
            continue;
        }
        const vector = entry;
        vertices.push([
            finiteNumber(vector?.x, 0),
            finiteNumber(vector?.y, 0),
            finiteNumber(vector?.z, 0),
        ]);
    }
    return vertices;
}
export function buildPhysicsConstraints(model, sections) {
    const constraintSection = sections.getSectionByReference(model.physics_constraints);
    if (!constraintSection)
        return [];
    return constraintSection.content.map((constraint, index) => {
        const dependentSection = sections.getSectionByReference(constraint.dependents);
        const dependentIndices = (dependentSection?.content ?? [])
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value >= 0);
        return {
            index,
            dependentIndices,
            rigidBodyIndex0: constraint.rigid_body1 ?? -1,
            rigidBodyIndex1: constraint.rigid_body2 ?? -1,
            flags: constraint.flags ?? 0,
            breakForce: constraint.break_force ?? 0,
        };
    });
}
export function buildPhysicsJoints(model, sections) {
    const jointSection = sections.getSectionByReference(model.physics_joints);
    if (!jointSection)
        return [];
    const bones = new BoneResolver(sections, model);
    return jointSection.content.map((j, i) => {
        const boneIndex0 = j.bone0 ?? -1;
        const boneIndex1 = j.bone1 ?? -1;
        return {
            index: i,
            name: `Joint_${i}`,
            boneIndex0,
            boneIndex1,
            boneName0: bones.getNameOrFallback(boneIndex0, `Bone_${boneIndex0}`),
            boneName1: bones.getNameOrFallback(boneIndex1, `Bone_${boneIndex1}`),
            type: j.type ?? 'Hinge',
            position: [
                j.position_x ?? 0,
                j.position_y ?? 0,
                j.position_z ?? 0,
            ],
            limits: { min: j.limit_min ?? 0, max: j.limit_max ?? 90 },
        };
    });
}
export function buildPhysicsCloths(model, sections) {
    const clothSection = sections.getSectionByReference(model.physics_cloths);
    if (!clothSection)
        return [];
    return clothSection.content.map((c, i) => {
        const bonesVal = c.bones;
        const boneIndices = Array.isArray(bonesVal) ? bonesVal.map(b => Number(b)) : [];
        return {
            index: i,
            name: `Cloth_${i}`,
            boneIndices,
            vertexCount: c.vertex_count ?? 0,
            stiffness: c.stiffness ?? 0.5,
        };
    });
}
export function buildIk(model, sections) {
    const ikSection = sections.getSectionByReference(model.ik);
    if (!ikSection)
        return [];
    const bones = new BoneResolver(sections, model);
    return ikSection.content.map((ik, i) => {
        const boneIndex = ik.bone ?? -1;
        return {
            index: i,
            name: bones.getNameOrFallback(boneIndex, `IK_${i}`),
            boneIndex,
            targetBoneIndex: ik.target_bone ?? -1,
            effectorBoneIndex: ik.effector_bone ?? -1,
            type: ik.type ?? 'LookAt',
            weight: ik.weight ?? 1,
            enabled: ik.enabled ?? true,
        };
    });
}
//# sourceMappingURL=metadata.js.map