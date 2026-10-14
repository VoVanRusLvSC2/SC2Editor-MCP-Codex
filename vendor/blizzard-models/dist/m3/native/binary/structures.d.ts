import type { FieldRecord, M3StructureData as IM3StructureData, M3Reference } from '../types.js';
export declare class M3StructureHistory {
    name: string;
    primitive: boolean;
    versionToSize: Map<number, number>;
    fieldRecords: FieldRecord[];
    versionToDescription: Map<string, M3StructureDescription>;
    constructor(name: string, versionToSize: Map<number, number>, fieldRecords: FieldRecord[]);
    getVersion(version: number, mdVersion?: number, structureHistories?: Record<string, M3StructureHistory>): M3StructureDescription;
}
export declare class M3StructureDescription {
    history: M3StructureHistory;
    version: number;
    fields: Record<string, import('../types.js').M3Field>;
    size: number;
    constructor(history: M3StructureHistory, version: number, fields: Record<string, import('../types.js').M3Field>, size: number);
    instance(buffer?: ArrayBuffer, offset?: number): M3StructureData;
    instances(buffer: ArrayBuffer, count: number): (M3StructureData | number | string)[];
    static getVertexDescription(vertexFlags: number, structureHistories?: Record<string, M3StructureHistory>): M3StructureDescription;
}
export declare class M3StructureData implements IM3StructureData {
    desc: M3StructureDescription;
    [key: string]: number | string | boolean | bigint | M3Reference | M3StructureData | Uint8Array | undefined | M3StructureDescription | ((buffer: ArrayBuffer, offset?: number) => void) | ((fieldName: string, bitName: string) => boolean);
    constructor(desc: M3StructureDescription, buffer?: ArrayBuffer, offset?: number);
    fromBuffer(buffer: ArrayBuffer, offset?: number): void;
    toBuffer(buffer: ArrayBuffer, offset?: number): void;
    bitGet(fieldName: string, bitName: string): boolean;
}
