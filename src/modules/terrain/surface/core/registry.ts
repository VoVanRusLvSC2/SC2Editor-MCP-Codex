import * as f from '../format/index.js';
import { readCellAttribute } from '../format/formats/cell-attribute.js';
import { readSyncHeightMap, type SyncHeightLayout } from '../format/formats/sync-height-map.js';
import { readWater } from '../format/formats/water.js';
import { readHardTile } from '../format/formats/hard-tile.js';
import { inspectSurfaceCatalog, inspectDds } from './catalog.js';
export interface DecodeOptions {
    syncHeightLayout?: SyncHeightLayout;
    experimentalWaterBodies?: boolean;
    hardTileStringEncoding?: 'nul' | 'u32le-length';
}
export type DecodeStatus = 'parsed' | 'partial' | 'opaque' | 'ambiguous' | 'invalid';
export interface ComponentDecode {
    kind: string;
    status: DecodeStatus;
    model?: unknown;
    diagnostics: string[];
    evidence: string;
}
const utf8 = new TextDecoder('utf-8', { fatal: true });
const aliases: Record<string, string> = { mapheightmap: 't3heightmap', mapsyncheightmap: 't3syncheightmap', mapsyncclifflevel: 't3syncclifflevel', mappathinginfo: 't3syncpathinginfo', mapcellflags: 't3cellflags', maptexturemasks: 't3texturemasks', mapfluffdoodad: 't3fluffdoodad', mapwater: 't3water', maphardtile: 't3hardtile', mapsynctextureinfo: 't3synctextureinfo' };
export function componentKind(name: string): string {
    const base = name.replaceAll('\\', '/').split('/').at(-1)!.toLowerCase();
    if (base.startsWith('cellattribute_'))
        return 'cell-attribute:' + base;
    if (/^(water|terrain|terraintex|terrainobject|cliff|cliffmesh|light|actor|effect)data\.xml$/.test(base))
        return 'catalog:' + base;
    if (base.endsWith('.dds'))
        return 'dds';
    if (base === 'hardtile.bin' || /\.(m3|m3a|hardtile\.bin)$/.test(base))
        return 'asset-opaque';
    return aliases[base] ?? base;
}
export const surfaceKinds = new Set(['t3terrain.xml', 't3heightmap', 't3syncheightmap', 't3syncclifflevel', 't3syncpathinginfo', 't3cellflags', 't3texturemasks', 't3synctextureinfo', 't3vertcol', 't3fluffdoodad', 't3hardtile', 't3water', 'paintedpathinglayer', 'paintedcreeplayer', 'terrain', 'mapinfo', 'objects', 'regions']);
export function decodeComponent(name: string, bytes: Uint8Array, options: DecodeOptions = {}): ComponentDecode {
    const kind = componentKind(name), base: ComponentDecode = { kind, status: 'parsed', diagnostics: [], evidence: 'source-code profile; synthetic-tested, not engine-certified' };
    try {
        switch (kind) {
            case 't3terrain.xml':
                base.model = f.parseTerrainXml(utf8.decode(bytes));
                break;
            case 't3heightmap':
                base.model = f.readHeightMap(bytes);
                break;
            case 't3syncheightmap':
                try {
                    base.model = readSyncHeightMap(bytes, { layout: options.syncHeightLayout });
                    base.status = 'partial';
                }
                catch (error) {
                    if (error instanceof Error && error.message.includes('SMAP_LAYOUT_PROFILE_REQUIRED')) {
                        base.status = 'ambiguous';
                        base.diagnostics.push(error.message);
                        return base;
                    }
                    throw error;
                }
                break;
            case 't3syncclifflevel':
                base.model = f.readSyncCliffLevel(bytes);
                base.status = 'partial';
                base.diagnostics.push('header dimensions are hints; runtime dimensions come from map context');
                break;
            case 't3syncpathinginfo':
                base.model = f.readPathingInfo(bytes);
                base.status = 'partial';
                base.diagnostics.push('archive raw-u16 profile; runtime navigation and version gates unknown');
                break;
            case 't3cellflags':
                base.model = bytes.length >= 8 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) <= 100 ? f.readLegacyCellFlags(bytes) : f.readCellFlags(bytes);
                base.status = 'partial';
                break;
            case 't3texturemasks':
                base.model = f.readTextureMasks(bytes);
                break;
            case 't3synctextureinfo':
                base.model = f.readSyncTextureInfo(bytes);
                base.status = 'partial';
                break;
            case 't3vertcol':
                base.model = f.readVertexColor(bytes);
                base.status = 'partial';
                break;
            case 't3fluffdoodad': {
                const v = f.readFluffDoodad(bytes);
                base.model = v;
                base.status = v.status === 'opaque-v101' ? 'opaque' : 'partial';
                break;
            }
            case 't3hardtile': {
                const v = readHardTile(bytes, { stringEncoding: options.hardTileStringEncoding });
                base.model = v;
                base.status = v.status === 'empty' ? 'parsed' : 'partial';
                break;
            }
            case 't3water': {
                const v = readWater(bytes, { bodyLayout: options.experimentalWaterBodies ? 'external-sequential' : 'opaque' });
                base.model = v;
                base.status = v.status === 'opaque-bodies' ? 'opaque' : 'partial';
                break;
            }
            case 'paintedpathinglayer':
            case 'paintedcreeplayer': {
                const v = f.readPaintedPathing(bytes);
                base.model = v;
                base.status = v.status === 'opaque-short' ? 'opaque' : 'partial';
                break;
            }
            case 'terrain':
                base.model = f.readTerrainBinary(bytes);
                base.status = 'opaque';
                break;
            case 'attributes':
                base.model = f.readAttributes(utf8.decode(bytes));
                base.status = 'partial';
                break;
            case 'aidata.xml':
            case 'aidata':
                base.model = f.readAIData(utf8.decode(bytes));
                base.status = 'partial';
                break;
            case 'preload':
                base.model = f.readPreload(utf8.decode(bytes));
                base.status = 'partial';
                break;
            case 'preloadassetdb.txt':
                base.model = f.readPreloadAssetDb(utf8.decode(bytes));
                base.status = 'partial';
                break;
            case 'objects':
                base.model = f.readObjects(utf8.decode(bytes));
                base.status = 'partial';
                base.diagnostics.push('inherited auxiliary parser; not a surface collision/footprint resolver');
                break;
            case 'regions':
                base.model = f.readRegions(utf8.decode(bytes));
                base.status = 'partial';
                break;
            case 'mapinfo':
                base.model = f.readMapInfo(bytes);
                base.status = 'partial';
                break;
            default:
                if (kind.startsWith('cell-attribute:')) {
                    base.model = readCellAttribute(bytes);
                    base.status = 'partial';
                    base.diagnostics.push('dimensions inferred only for square payload; attribute semantics unresolved');
                }
                else if (kind.startsWith('catalog:')) {
                    base.model = inspectSurfaceCatalog(utf8.decode(bytes));
                    base.status = 'partial';
                }
                else if (kind === 'dds') {
                    base.model = inspectDds(bytes);
                    base.status = 'partial';
                }
                else {
                    base.status = 'opaque';
                    base.diagnostics.push('no schema in this toolkit; original bytes retained');
                }
        }
    }
    catch (error) {
        base.status = 'invalid';
        base.diagnostics.push(error instanceof Error ? error.message : String(error));
    }
    return base;
}
