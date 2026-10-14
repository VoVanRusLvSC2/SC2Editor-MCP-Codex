import type { M3SectionList } from './binary/sections.js';
import type { AttachmentPoint, BoneInfo, BoundsInfo, HitVolume, LightInfo, MaterialInfo, M3StructureData, TurretInfo, CameraInfo, RibbonInfo, ParticleSystemInfo, ProjectionInfo, ForceInfo, BillboardInfo, WarpInfo, ShadowboxInfo, RigidBodyInfo, PhysicsConstraintInfo, PhysicsJointInfo, PhysicsClothInfo, IkInfo } from './types.js';
import type { RenderModel } from '@modkit/codec-kit/legacy/models';
import { type M3RenderModelOptions } from './render-model.js';
/** Thin OOP facade over M3 binary data. Pure data accessors, no Three.js. */
export declare class M3Model {
    #private;
    readonly sections: M3SectionList;
    readonly model: M3StructureData;
    constructor(sections: M3SectionList);
    get bounds(): BoundsInfo | null;
    get attachmentPoints(): AttachmentPoint[];
    get materials(): MaterialInfo[];
    get bones(): BoneInfo[];
    get hitVolumes(): {
        tight: HitVolume | null;
        hittests: HitVolume[];
        attachmentVolumes: HitVolume[];
    };
    get lights(): LightInfo[];
    get turrets(): TurretInfo[];
    get textureFilenames(): Set<string>;
    get cameras(): CameraInfo[];
    get ribbons(): RibbonInfo[];
    get particles(): ParticleSystemInfo[];
    get projections(): ProjectionInfo[];
    get forces(): ForceInfo[];
    get billboards(): BillboardInfo[];
    get warps(): WarpInfo[];
    get shadowboxes(): ShadowboxInfo[];
    get rigidBodies(): RigidBodyInfo[];
    get physicsConstraints(): PhysicsConstraintInfo[];
    get physicsJoints(): PhysicsJointInfo[];
    get physicsCloths(): PhysicsClothInfo[];
    get ik(): IkInfo[];
    toRenderModel(options?: M3RenderModelOptions): RenderModel;
}
