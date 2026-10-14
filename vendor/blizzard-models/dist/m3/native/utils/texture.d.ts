import type { M3Reference, SectionResolver } from '../types.js';
/** Resolve an M3 texture path to a local filesystem or URL path. */
export declare function resolveTexturePath(m3Path: string | null, textureBasePath: string | null): string | null;
/** Read a string from a CHAR section referenced by a Reference field. */
export declare function getSectionString(sections: SectionResolver, reference: M3Reference | null): string;
/** Check whether a texture file exists on disk (Node.js only). */
export declare function textureExists(texPath: string): boolean;
