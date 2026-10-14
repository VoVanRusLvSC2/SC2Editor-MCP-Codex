import type { M3Model } from './model.js';
import type { M3SectionList } from './binary/sections.js';
export interface M3SectionInventoryEntry {
    index: number;
    tag: string;
    version: number;
    repetitions: number;
    offset: number;
    byteLength: number;
}
export interface M3MetadataOracle {
    mdVersion?: number;
    sectionCount?: number;
    meshCount?: number;
    materialCount?: number;
    boneCount?: number;
    animationCount?: number;
}
export interface M3OracleMismatch {
    field: keyof M3MetadataOracle;
    expected: number;
    actual: number;
}
export declare function serializeM3SectionList(sections: M3SectionList): Uint8Array;
export declare function serializeM3Model(model: M3Model): Uint8Array;
export declare function getM3SectionInventory(sections: M3SectionList): M3SectionInventoryEntry[];
export declare function m3MetadataOracle(model: M3Model): Required<M3MetadataOracle>;
export declare function compareM3MetadataOracle(model: M3Model, oracle: M3MetadataOracle): M3OracleMismatch[];
