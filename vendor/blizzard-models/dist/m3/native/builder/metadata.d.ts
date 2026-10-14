import type { M3StructureData, AttachmentPoint, MaterialInfo, BoneInfo, HitVolume, BoundsInfo, LightInfo, TurretInfo, SectionResolver, CameraInfo, RibbonInfo, ParticleSystemInfo, ProjectionInfo, ForceInfo, BillboardInfo, WarpInfo, ShadowboxInfo, RigidBodyInfo, PhysicsConstraintInfo, PhysicsJointInfo, PhysicsClothInfo, IkInfo } from '../types.js';
export declare function buildAttachmentPoints(model: M3StructureData, sections: SectionResolver): AttachmentPoint[];
export declare function getModelTextureFilenames(model: M3StructureData, sections: SectionResolver): Set<string>;
/** Returns the full relative texture paths as stored in the M3 binary, forward-slash normalised.
 *  E.g. "Assets/Textures/Foo_Diffuse.dds" — join with an sc2mod root for direct file lookup. */
export declare function getModelTexturePaths(model: M3StructureData, sections: SectionResolver): string[];
export declare function buildMaterialList(model: M3StructureData, sections: SectionResolver): MaterialInfo[];
export declare function buildBoneHierarchy(model: M3StructureData, sections: SectionResolver): BoneInfo[];
export declare function buildHitVolumes(model: M3StructureData, sections: SectionResolver): {
    tight: HitVolume | null;
    hittests: HitVolume[];
    attachmentVolumes: HitVolume[];
};
export declare function buildBounds(model: M3StructureData): BoundsInfo | null;
export declare function buildLights(model: M3StructureData, sections: SectionResolver): LightInfo[];
export declare function buildTurrets(model: M3StructureData, sections: SectionResolver): TurretInfo[];
export declare function buildCameras(model: M3StructureData, sections: SectionResolver): CameraInfo[];
export declare function buildRibbons(model: M3StructureData, sections: SectionResolver): RibbonInfo[];
export declare function buildParticles(model: M3StructureData, sections: SectionResolver): ParticleSystemInfo[];
export declare function buildProjections(model: M3StructureData, sections: SectionResolver): ProjectionInfo[];
export declare function buildForces(model: M3StructureData, sections: SectionResolver): ForceInfo[];
export declare function buildBillboards(model: M3StructureData, sections: SectionResolver): BillboardInfo[];
export declare function buildWarps(model: M3StructureData, sections: SectionResolver): WarpInfo[];
export declare function buildShadowboxes(model: M3StructureData, sections: SectionResolver): ShadowboxInfo[];
export declare function buildRigidBodies(model: M3StructureData, sections: SectionResolver): RigidBodyInfo[];
export declare function buildPhysicsConstraints(model: M3StructureData, sections: SectionResolver): PhysicsConstraintInfo[];
export declare function buildPhysicsJoints(model: M3StructureData, sections: SectionResolver): PhysicsJointInfo[];
export declare function buildPhysicsCloths(model: M3StructureData, sections: SectionResolver): PhysicsClothInfo[];
export declare function buildIk(model: M3StructureData, sections: SectionResolver): IkInfo[];
