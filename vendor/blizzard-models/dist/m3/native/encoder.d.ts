export function encodeM3RenderModel(model: any, options?: {}, parserOptions?: {}): Promise<{
    issues: any;
    files?: {
        path: any;
        bytes: any;
        role: string;
    }[] | undefined;
    bytes: any;
}>;
export function rememberM3SourceBytes(model: any, bytes: any): void;
