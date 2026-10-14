import { M3Section, M3SectionList } from './binary/sections.js';
import type { M3StructureData } from './binary/structures.js';
import type { M3Reference } from './types.js';
export type M3SectionValue = M3StructureData | number | bigint | string;
export interface M3SectionGraphWriteOptions {
    /** M3 sections and the index table are conventionally 16-byte aligned. */
    alignment?: number;
    /** Byte used in alignment gaps. Blizzard-authored M3 containers use 0xaa. */
    paddingByte?: number;
}
/**
 * Relocating typed writer for an existing M3/M3A section graph.
 *
 * Unlike the lossless serializer, this rebuilds every known section, updates
 * section offsets/repetition counts, and emits a new index table. Unknown
 * sections remain byte-preserved through their synthetic raw-byte structure.
 */
export declare function serializeM3SectionGraph(sections: M3SectionList, options?: M3SectionGraphWriteOptions): Uint8Array;
export declare function serializeM3SectionContent(section: M3Section): Uint8Array;
/** Append a schema-backed section without renumbering any existing reference. */
export declare function appendM3Section(sections: M3SectionList, tag: string, version: number, content?: readonly M3SectionValue[]): M3Section;
/** Replace all records owned by a reference and keep its entry count coherent. */
export declare function replaceM3ReferencedRecords(sections: M3SectionList, reference: M3Reference, records: readonly M3SectionValue[]): void;
export declare function appendM3ReferencedRecord(sections: M3SectionList, reference: M3Reference, record: M3SectionValue): number;
export declare function removeM3ReferencedRecord(sections: M3SectionList, reference: M3Reference, recordIndex: number): M3SectionValue;
export declare function pointM3ReferenceAtSection(sections: M3SectionList, reference: M3Reference, section: M3Section): void;
