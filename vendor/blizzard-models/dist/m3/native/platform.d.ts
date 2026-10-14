export interface M3FileSystem {
    existsSync(path: string): boolean;
    readFileSync(path: string): Uint8Array;
    readFileSync(path: string, encoding: 'utf8'): string;
}
export interface M3Path {
    dirname(path: string): string;
    join(...paths: string[]): string;
}
export interface M3PlatformAdapters {
    readonly fs?: M3FileSystem;
    readonly path?: M3Path;
    readonly dirname?: string;
    readonly DOMParser?: typeof globalThis.DOMParser;
}
/** Install host adapters without importing Node modules into the portable M3 graph. */
export declare function installM3PlatformAdapters(next: M3PlatformAdapters): void;
/** Install a lazy host initializer. The Node-only leaf uses this compatibility seam. */
export declare function installM3PlatformInitializer(next: () => Promise<void>): void;
/** Initialize the active host. Browser-main uses its native DOMParser. */
export declare function initPlatform(): Promise<void>;
export declare function getFs(): M3FileSystem;
export declare function getPath(): M3Path;
export declare function getDirname(): string;
export declare function getDOMParser(): typeof globalThis.DOMParser;
