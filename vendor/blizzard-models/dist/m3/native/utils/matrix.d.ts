import type { M3StructureData } from '../types.js';
interface M3Matrix4 {
    x: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
    y: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
    z: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
    w: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}
/** Convert a parsed M3 Matrix44 to a flat 16-element column-major number array. */
export declare function m3MatrixToArray(m: M3StructureData | M3Matrix4): number[];
/** Invert a column-major affine transform. Returns null for invalid/singular matrices. */
export declare function invertAffineMatrix4(matrix: ArrayLike<number>): Float32Array | null;
export {};
