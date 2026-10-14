import type { M3StructureData, SectionResolver } from '../types.js';
/**
 * Shared bone name resolver for all metadata builders.
 *
 * M3 metadata builders (lights, turrets, cameras, ribbons, particles, etc.)
 * all need to resolve a bone index to its human-readable name.  This class
 * centralises that lookup so the logic is not copy-pasted 15+ times across
 * builder/metadata.ts.
 */
export declare class BoneResolver {
    private readonly _boneData;
    private readonly _sections;
    constructor(sections: SectionResolver, model: M3StructureData);
    /** Return the bone name for the given index, or a fallback like "Bone_5". */
    getName(index: number): string;
    /** Return bone name, or a custom fallback if the index is out of range. */
    getNameOrFallback(index: number, fallback: string): string;
    /** Convenience: resolve bone index from a raw M3 structure field. */
    resolve(boneField: unknown): string;
}
