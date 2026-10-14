import type { M3Section as IM3Section, M3StructureData, M3Reference } from '../types.js';
import { M3StructureDescription, M3StructureHistory } from './structures.js';
export declare class M3Section implements IM3Section {
    desc: M3StructureDescription;
    indexEntry: M3StructureData;
    references: M3Section[];
    content: (M3StructureData | number | bigint | string)[];
    rawBytes: ArrayBuffer | null;
    model: M3StructureData | null;
    [index: number]: M3Section;
    constructor(desc: M3StructureDescription, indexEntry: M3StructureData, references: M3Section[], content: (M3StructureData | number | bigint | string)[], rawBytes?: ArrayBuffer | null);
    getSectionByReference(reference: import('../types.js').M3Reference | null | undefined): M3Section | null;
}
export declare class M3SectionList extends Array<M3Section> {
    fileBuffer: ArrayBuffer | null;
    /** Exact schema text used for this parse, retained for deterministic snapshots. */
    structuresXmlSource: string | null;
    /** Parse-local schema registry; do not consult the mutable compatibility registry. */
    structureHistories: Record<string, M3StructureHistory>;
    mdVersion: number;
    model: import('../types.js').M3StructureData | null;
    constructor();
    static load(arrayBuffer: ArrayBuffer, xmlPathOrText?: string): Promise<M3SectionList>;
    getSectionByReference(reference: M3Reference | null | undefined): M3Section | null;
    getSectionsByTag(tag: string): M3Section[];
}
