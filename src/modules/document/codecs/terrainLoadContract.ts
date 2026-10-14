import { scanXml } from "../../../core/xmlScanner.js";

/** Checks editor-load prerequisites absent from the generic Terrain readers.
 * Allocation tags are executed by the native XML reader, not inferred from HMAP.
 * This is structural validation; it does not replace an Editor open test.
 */
export function validateTerrainLoadContract(files: ReadonlyMap<string, Buffer>, width: number, height: number) {
    const xml = files.get('t3Terrain.xml')?.toString('utf8');
    if (!xml) throw new Error('DOCUMENT_TERRAIN_XML_MISSING');
    const parsed = scanXml(xml);
    const heightMap = parsed.nodes.find(n => n.tag === 'heightMap');
    if (!heightMap || heightMap.attrs.dim !== `${width + 1} ${height + 1}`)
        throw new Error('DOCUMENT_TERRAIN_LOAD_DIMENSIONS');
    for (const [tag, count] of [['cliffCellList', width * height / 4], ['blockTextureSetList', width * height / 64]] as const) {
        const nodes = parsed.nodes.filter(n => n.tag === tag && n.parentId === heightMap.id);
        if (nodes.length !== 1 || Number(nodes[0].attrs.num) !== count)
            throw new Error('DOCUMENT_TERRAIN_ALLOCATION_REQUIRED: ' + tag);
    }
    const sync = files.get('t3SyncHeightMap');
    if (!sync || sync.length !== 64 + (width + 1) * (height + 1) * 4 || sync.toString('ascii', 0, 4) !== 'SMAP' || sync.readUInt32LE(4) !== 102 || sync.readUInt32LE(8) !== width + 1 || sync.readUInt32LE(12) !== height + 1)
        throw new Error('DOCUMENT_SYNC_HEIGHT_GRID_INVALID');
    // Newly created documents use identity geometry in Q12. Existing map
    // transforms remain the responsibility of their preserving Terrain codec.
    if ([16, 20, 24].some(o => sync.readInt32LE(o) !== 0) || [28, 32, 36].some(o => sync.readInt32LE(o) !== 4096))
        throw new Error('DOCUMENT_SYNC_HEIGHT_TRANSFORM_INVALID');
    return { cliffCells: width * height / 4, textureBlocks: width * height / 64, syncScaleQ12: [4096, 4096, 4096] };
}
