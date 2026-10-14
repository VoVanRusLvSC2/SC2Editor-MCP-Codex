import type { BuiltVertex } from '../types.js';
import type { M3StructureData } from '../binary/structures.js';
/** Convert a parsed M3 vertex into a plain object ready for Three.js geometry construction. */
export declare function buildVertexObject(vertex: M3StructureData, uvMultiply: number, uvOffset: number): BuiltVertex;
