import { buildAttachmentPoints, buildMaterialList, buildBoneHierarchy, buildHitVolumes, buildBounds, buildLights, buildTurrets, buildCameras, buildRibbons, buildParticles, buildProjections, buildForces, buildBillboards, buildWarps, buildShadowboxes, buildRigidBodies, buildPhysicsConstraints, buildPhysicsJoints, buildPhysicsCloths, buildIk, getModelTextureFilenames, } from './builder/metadata.js';
import { m3ModelToRenderModel } from './render-model.js';
/** Thin OOP facade over M3 binary data. Pure data accessors, no Three.js. */
export class M3Model {
    sections;
    model;
    #resolver;
    #bounds;
    #attachmentPoints;
    #materials;
    #bones;
    #hitVolumes;
    #lights;
    #turrets;
    #cameras;
    #ribbons;
    #particles;
    #projections;
    #forces;
    #billboards;
    #warps;
    #shadowboxes;
    #rigidBodies;
    #physicsConstraints;
    #physicsJoints;
    #physicsCloths;
    #ik;
    #textureFilenames;
    constructor(sections) {
        if (!sections.model) {
            throw new Error('M3SectionList does not contain a model section');
        }
        this.sections = sections;
        this.model = sections.model;
        this.#resolver = sections;
    }
    get bounds() {
        if (this.#bounds === undefined)
            this.#bounds = buildBounds(this.model);
        return this.#bounds;
    }
    get attachmentPoints() {
        if (this.#attachmentPoints === undefined) {
            this.#attachmentPoints = buildAttachmentPoints(this.model, this.#resolver);
        }
        return this.#attachmentPoints;
    }
    get materials() {
        if (this.#materials === undefined) {
            this.#materials = buildMaterialList(this.model, this.#resolver);
        }
        return this.#materials;
    }
    get bones() {
        if (this.#bones === undefined) {
            this.#bones = buildBoneHierarchy(this.model, this.#resolver);
        }
        return this.#bones;
    }
    get hitVolumes() {
        if (this.#hitVolumes === undefined) {
            this.#hitVolumes = buildHitVolumes(this.model, this.#resolver);
        }
        return this.#hitVolumes;
    }
    get lights() {
        if (this.#lights === undefined) {
            this.#lights = buildLights(this.model, this.#resolver);
        }
        return this.#lights;
    }
    get turrets() {
        if (this.#turrets === undefined) {
            this.#turrets = buildTurrets(this.model, this.#resolver);
        }
        return this.#turrets;
    }
    get textureFilenames() {
        if (this.#textureFilenames === undefined) {
            this.#textureFilenames = getModelTextureFilenames(this.model, this.#resolver);
        }
        return this.#textureFilenames;
    }
    get cameras() {
        if (this.#cameras === undefined)
            this.#cameras = buildCameras(this.model, this.#resolver);
        return this.#cameras;
    }
    get ribbons() {
        if (this.#ribbons === undefined)
            this.#ribbons = buildRibbons(this.model, this.#resolver);
        return this.#ribbons;
    }
    get particles() {
        if (this.#particles === undefined)
            this.#particles = buildParticles(this.model, this.#resolver);
        return this.#particles;
    }
    get projections() {
        if (this.#projections === undefined)
            this.#projections = buildProjections(this.model, this.#resolver);
        return this.#projections;
    }
    get forces() {
        if (this.#forces === undefined)
            this.#forces = buildForces(this.model, this.#resolver);
        return this.#forces;
    }
    get billboards() {
        if (this.#billboards === undefined)
            this.#billboards = buildBillboards(this.model, this.#resolver);
        return this.#billboards;
    }
    get warps() {
        if (this.#warps === undefined)
            this.#warps = buildWarps(this.model, this.#resolver);
        return this.#warps;
    }
    get shadowboxes() {
        if (this.#shadowboxes === undefined)
            this.#shadowboxes = buildShadowboxes(this.model, this.#resolver);
        return this.#shadowboxes;
    }
    get rigidBodies() {
        if (this.#rigidBodies === undefined)
            this.#rigidBodies = buildRigidBodies(this.model, this.#resolver);
        return this.#rigidBodies;
    }
    get physicsConstraints() {
        if (this.#physicsConstraints === undefined) {
            this.#physicsConstraints = buildPhysicsConstraints(this.model, this.#resolver);
        }
        return this.#physicsConstraints;
    }
    get physicsJoints() {
        if (this.#physicsJoints === undefined)
            this.#physicsJoints = buildPhysicsJoints(this.model, this.#resolver);
        return this.#physicsJoints;
    }
    get physicsCloths() {
        if (this.#physicsCloths === undefined)
            this.#physicsCloths = buildPhysicsCloths(this.model, this.#resolver);
        return this.#physicsCloths;
    }
    get ik() {
        if (this.#ik === undefined)
            this.#ik = buildIk(this.model, this.#resolver);
        return this.#ik;
    }
    toRenderModel(options) {
        return m3ModelToRenderModel(this, options);
    }
}
//# sourceMappingURL=model.js.map