import type { M3Field, M3StructureData } from '../types.js';
import type { M3StructureDescription } from './structures.js';
import { PRIMITIVE_FIELD_INFO } from './constants.js';
export declare class M3FieldBase implements M3Field {
    name: string;
    size: number;
    constructor(name: string);
    fromBuffer(_data: M3StructureData, _buffer: ArrayBuffer, _offset: number): void;
    toBuffer(_data: M3StructureData, _buffer: ArrayBuffer, _offset: number): void;
}
export declare class M3FieldPrimitive extends M3FieldBase {
    type: string;
    defaultValue: number | bigint;
    expectedValue: number | bigint | null;
    structInfo: (typeof PRIMITIVE_FIELD_INFO)[keyof typeof PRIMITIVE_FIELD_INFO];
    bitMaskMap?: Record<string, number>;
    constructor(name: string, type: keyof typeof PRIMITIVE_FIELD_INFO, defaultValue?: number | bigint, expectedValue?: number | bigint | null);
    fromBuffer(data: M3StructureData, buffer: ArrayBuffer, offset: number): void;
    toBuffer(data: M3StructureData, buffer: ArrayBuffer, offset: number): void;
}
export declare class M3FieldBytes extends M3FieldBase {
    defaultValue: Uint8Array;
    expectedValue: Uint8Array | null;
    constructor(name: string, size: number, defaultValue: Uint8Array, expectedValue?: Uint8Array | null);
    fromBuffer(data: M3StructureData, buffer: ArrayBuffer, offset: number): void;
    toBuffer(data: M3StructureData, buffer: ArrayBuffer, offset: number): void;
}
export declare class M3FieldStructure extends M3FieldBase {
    desc: M3StructureDescription;
    refTo: string;
    constructor(name: string, desc: M3StructureDescription, refTo?: string);
    fromBuffer(data: M3StructureData, buffer: ArrayBuffer, offset: number): void;
    toBuffer(data: M3StructureData, buffer: ArrayBuffer, offset: number): void;
}
