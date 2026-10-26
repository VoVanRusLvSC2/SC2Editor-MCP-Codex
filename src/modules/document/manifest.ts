import { buildTuple, contentIdentity, documentHeader, documentInfo, versionMarker, type DocumentBuild, type HeaderString } from "./codecs/metadata.js";
import { createMapInfo } from "./codecs/mapInfoFactory.js";
import { createFlatTerrain, type TerrainSet } from "./codecs/flatTerrainFactory.js";
import type { DocumentRequest } from "./schemas.js";
import { minimapTga } from '../map/minimap.js';
export interface FoundationManifest {
    kind: 'map' | 'mod';
    modType?: 'dependent' | 'extension';
    terrain: boolean;
    mapType?: 'arcade';
    title: string;
    profile: string;
    build: DocumentBuild;
    timestamp: number;
    identity: number;
    dependencies: string[];
    locales: string[];
    width?: number;
    height?: number;
    tileSet?: string;
    initialTexture?: string;
    baseHeight?: number;
    files: Array<{
        file: string;
        size: number;
        sha256: string;
    }>;
    contentSha256: string;
}
export function generateFoundation(request: DocumentRequest, version: string, timestamp: number, identitySeed: string, set?: TerrainSet) {
    const build = buildTuple(version), files = new Map<string, Buffer>(), map = request.kind === 'map', hasTerrain = map && request.terrain.enabled;
    const title = request.name ?? request.destination.replaceAll('\\', '/').split('/').at(-1)!.replace(/\.sc2(?:map|mod)$/i, '');
    const entries = request.dependencies.mode === 'custom' ? request.dependencies.entries : [];
    const specs = entries.map(e => (e.bnet ? 'bnet:' + e.bnet + ',' : '') + 'file:' + e.file);
    files.set('DocumentInfo', documentInfo(specs, request.kind === 'mod' && request.modType === 'extension'));
    const strings: HeaderString[] = [];
    for (const locale of request.locales) {
        const values: Record<string, string> = { 'DocInfo/Name': title, 'DocInfo/DescShort': '', 'DocInfo/DescLong': '' };
        if (map)
            Object.assign(values, { 'MapInfo/Player00/Name': 'Neutral', 'MapInfo/Player01/Name': 'Player 1', 'MapInfo/Player15/Name': 'Hostile' });
        files.set(`${locale}.SC2Data/LocalizedData/GameStrings.txt`, Buffer.from(Object.entries(values).map(([k, v]) => k + '=' + v + '\r\n').join('')));
        for (const [key, value] of Object.entries(values))
            strings.push({ key, locale, value });
    }
    files.set('DocumentHeader', documentHeader(specs, strings, build, request.kind, contentIdentity(identitySeed), map ? 1 : 0));
    files.set('Base.SC2Data/GameData.xml', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<Includes/>\r\n'));
    files.set('Triggers', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<TriggerData><Root/></TriggerData>\r\n'));
    files.set('Preload.xml', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<Preload/>\r\n'));
    files.set('PreloadAssetDB.txt', Buffer.alloc(0));
    const components: Array<{
        type: string;
        root: string;
        locale?: string;
        count: number;
    }> = [{ type: 'gada', root: 'GameData', count: 0 }, ...request.locales.map(locale => ({ type: 'text', root: 'GameText', locale, count: map ? 6 : 3 })), { type: 'info', root: 'DocumentInfo', count: 1 }, { type: 'trig', root: 'Triggers', count: 0 }];
    if (map) {
        const baseHeight = request.terrain.enabled ? request.terrain.baseHeight : 8;
        files.set('MapInfo', createMapInfo(request.map.width, request.map.height, hasTerrain ? request.terrain.enabled ? request.terrain.tileSet : 'Aiur' : 'Aiur', baseHeight, timestamp, hasTerrain));
        components.push({ type: 'mapi', root: 'MapInfo', count: 1 });
        // Engine entry point only. There are no authored functions, actions or gameplay initialization.
        files.set('MapScript.galaxy', Buffer.from('// Empty document bootstrap; gameplay is authored separately.\r\nvoid InitMap () { }\r\n'));
        files.set('Attributes', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<Attributes><DefaultVariants Value="0"/></Attributes>\r\n'));
        components.push({ type: 'attr', root: 'Attributes', count: 0 });
        if (request.terrain.enabled) {
            if (!set || set.id !== request.terrain.tileSet)
                throw new Error('DOCUMENT_TERRAIN_SET_NOT_RESOLVED');
            const texture = request.terrain.initialTexture ?? set.textures[0];
            for (const [file, bytes] of createFlatTerrain(request.map.width, request.map.height, set, texture, baseHeight))
                files.set(file, bytes);
            components.push({ type: 'terr', root: 't3Terrain.xml', count: 1 });
            // A foundation has no authored landscape yet. Keep its neutral preview,
            // but use the same complete TGA envelope as a rebuilt map minimap.
            files.set('Minimap.tga', minimapTga(Buffer.alloc(64 * 64 * 3, 128), 64, 64));
        }
    }
    files.set('ComponentList.SC2Components', Buffer.from('<?xml version="1.0" encoding="utf-8"?>\r\n<Components>\r\n' + components.map(c => `    <DataComponent Type="${c.type}"${c.locale ? ' Locale="' + c.locale + '"' : ''}>${c.root}</DataComponent>\r\n`).join('') + '</Components>\r\n'));
    for (const c of components) {
        const file = c.type === 'terr' ? 't3Terrain' : c.root;
        const key = file + '.version';
        if (!files.has(key))
            files.set(key, versionMarker(c.type, build, timestamp, c.count));
    }
    return { files, title, build, identity: contentIdentity(identitySeed), baseHeight: map && request.terrain.enabled ? request.terrain.baseHeight : undefined, initialTexture: map && request.terrain.enabled ? (request.terrain.initialTexture ?? set!.textures[0]) : undefined, dependencies: specs, profile: 'native-empty-v39-v115-local-3' };
}
