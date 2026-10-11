/** Catalog inspection only. Does not flatten inheritance, resolve dependency priority, or decode M3. */
import { parseStrictXml, type XmlElementView, type XmlProcessingInstructionView } from '../format/xml.js';
import { Cursor } from '../format/binary.js';
export interface CatalogEntry {
    type: string;
    id: string | null;
    parent: string | null;
    attributes: Record<string, string>;
    fields: XmlElementView[];
    assetReferences: string[];
    processingInstructions?: XmlProcessingInstructionView[];
}
export function inspectSurfaceCatalog(xml: string): {
    entries: CatalogEntry[];
    semantics: string;
} {
    const root = parseStrictXml(xml);
    if (root.name !== 'Catalog')
        throw new Error('CATALOG_ROOT_REQUIRED');
    const entries = root.children.map(e => {
        const assets = new Set<string>();
        const visit = (n: XmlElementView): void => {
            for (const value of Object.values(n.attributes))
                // hardTile.bin is a basename, not an extension: retain both path separators.
                if (/\.(dds|m3|m3a|tga|png|hardtile\.bin)$/i.test(value)
                    || /(?:^|[\\/])hardtile\.bin$/i.test(value))
                    assets.add(value);
            for (const child of n.children)
                visit(child);
        };
        visit(e);
        return { type: e.name, id: e.attributes.id ?? null, parent: e.attributes.parent ?? null,
            attributes: e.attributes, fields: e.children, assetReferences: [...assets],
            ...(e.processingInstructions ? {processingInstructions: e.processingInstructions} : {}) };
    });
    return { entries, semantics: 'raw-catalog-records; inheritance, defaults, dependency priority and assets unresolved' };
}
/** DDS header structural inspector. This does not decompress pixels or create a terrain material. */
export function inspectDds(bytes: Uint8Array) {
    const c = new Cursor(bytes);
    if (c.ascii(4) !== 'DDS ')
        throw new Error('DDS_BAD_MAGIC');
    c.require(124, 'DDS header');
    if (c.u32() !== 124)
        throw new Error('DDS_HEADER_SIZE');
    const flags = c.u32(), height = c.u32(), width = c.u32(), pitchOrLinearSize = c.u32(), depth = c.u32(), mipMapCount = c.u32();
    c.bytesOf(44);
    if (c.u32() !== 32)
        throw new Error('DDS_PIXEL_FORMAT_SIZE');
    const pixelFlags = c.u32(), fourCC = c.ascii(4), rgbBits = c.u32(), masks = [c.u32(), c.u32(), c.u32(), c.u32()];
    const caps = [c.u32(), c.u32(), c.u32(), c.u32()], reserved = c.u32();
    let dx10: undefined | {
        format: number;
        dimension: number;
        misc: number;
        arraySize: number;
        misc2: number;
    };
    if (fourCC === 'DX10')
        dx10 = { format: c.u32(), dimension: c.u32(), misc: c.u32(), arraySize: c.u32(), misc2: c.u32() };
    return { width, height, depth, mipMapCount, flags, pitchOrLinearSize, pixelFlags, fourCC, rgbBits, masks, caps, reserved, dx10,
        dataOffset: c.offset, dataBytes: c.remaining, validation: 'header-only; pixel layout and length not validated' };
}
