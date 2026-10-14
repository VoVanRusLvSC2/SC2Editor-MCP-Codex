import type { M3StructureHistory } from './structures.js';
/** Get the current structures registry. */
export declare function getStructures(): Record<string, M3StructureHistory>;
/** Replace the entire structures registry. */
export declare function setStructures(newStructures: Record<string, M3StructureHistory>): void;
