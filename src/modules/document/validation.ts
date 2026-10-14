import { bytesHash } from "../../core/binaryTransactions.js";
import { scanXml } from "../../core/xmlScanner.js";
import { parseState } from "../terrain/operations.js";
import { inspectNativeIntegrity } from "../terrain/nativeIntegrity.js";
import { readDocumentHeader, readDocumentInfo, readVersion } from "./codecs/metadata.js";
import { validateTerrainLoadContract } from "./codecs/terrainLoadContract.js";
import { validateEmptyMapInfo } from "./codecs/mapInfoFactory.js";
import type { FoundationManifest } from "./manifest.js";
export function validateFoundation(files: ReadonlyMap<string, Buffer>, manifest: FoundationManifest) {
    const errors: string[] = [];
    const check = (fn: () => void) => { try {
        fn();
    }
    catch (e) {
        errors.push(String(e));
    } };
    check(() => { const expected = new Map(manifest.files.map(f => [f.file, f])); if (files.size !== expected.size)
        throw new Error('DOCUMENT_MANIFEST_FILE_SET'); for (const [file, b] of files) {
        const row = expected.get(file);
        if (!row || row.size !== b.length || row.sha256 !== bytesHash(b))
            throw new Error('DOCUMENT_MANIFEST_CHANGED: ' + file);
    } });
    check(() => { const info = readDocumentInfo(files.get('DocumentInfo')!), header = readDocumentHeader(files.get('DocumentHeader')!); if (JSON.stringify(info.dependencies) !== JSON.stringify(manifest.dependencies) || JSON.stringify(header.dependencies) !== JSON.stringify(manifest.dependencies))
        throw new Error('DOCUMENT_DEPENDENCY_SECTIONS_DISAGREE'); if (info.flags.includes('ExtensionMod') !== (manifest.modType === 'extension'))
        throw new Error('DOCUMENT_EXTENSION_FLAG_MISMATCH'); if (info.flags.some(f => f !== 'ExtensionMod'))
        throw new Error('DOCUMENT_UNEXPECTED_FLAG'); if (header.identity !== manifest.identity || header.identity2 !== manifest.identity || header.build !== manifest.build.build || header.build2 !== header.build || header.kind !== (manifest.kind === 'mod' ? 2 : 0) || header.players !== (manifest.kind === 'map' ? 1 : 0))
        throw new Error('DOCUMENT_HEADER_MODEL_MISMATCH'); for (const s of header.strings) {
        const value = files.get(`${s.locale}.SC2Data/LocalizedData/GameStrings.txt`)?.toString('utf8');
        if (!value?.split(/\r?\n/).includes(s.key + '=' + s.value))
            throw new Error('DOCUMENT_HEADER_LOCALIZATION_MISMATCH');
    } });
    const components = files.get('ComponentList.SC2Components')?.toString('utf8') ?? '', xml = scanXml(components);
    check(() => {
        if (xml.diagnostics.some(d => d.severity === 'error') || xml.rootIds.length !== 1 || xml.nodes[xml.rootIds[0]].tag !== 'Components')
            throw new Error('DOCUMENT_COMPONENT_LIST_INVALID');
        for (const n of xml.nodes.filter(n => n.tag === 'DataComponent')) {
            const root = components.slice(n.startTagEnd, n.endTagStart);
            const marker = files.get((n.attrs.Type === 'terr' ? 't3Terrain' : root) + '.version');
            if (!marker)
                throw new Error('DOCUMENT_VERSION_MISSING');
            const v = readVersion(marker);
            if (v.tag !== n.attrs.Type || v.build !== manifest.build.build || v.build2 !== v.build || v.timestamp !== manifest.timestamp || v.terminal !== 1)
                throw new Error('DOCUMENT_VERSION_MISMATCH');
        }
    });
    check(() => {
        for (const [file, b] of files)
            if (['DocumentInfo', 'ComponentList.SC2Components', 'Triggers', 'Attributes', 'Preload.xml', 'Base.SC2Data/GameData.xml'].includes(file)) {
                const text = b.toString('utf8'), p = scanXml(text);
                if (!Buffer.from(text).equals(b) || p.diagnostics.some(d => d.severity === 'error') || p.rootIds.length !== 1)
                    throw new Error('DOCUMENT_XML_INVALID: ' + file);
                if (file === 'Triggers' && p.nodes.some(n => n.tag === 'Element' || n.tag === 'Item'))
                    throw new Error('DOCUMENT_GAMEPLAY_TRIGGER_PRESENT');
                if (file === 'Attributes' && p.nodes.some(n => n.tag === 'Variant' || n.tag === 'Attribute'))
                    throw new Error('DOCUMENT_LOBBY_CONTENT_PRESENT');
            }
        if (files.has('Objects') || files.has('CustomAI') || files.has('Cutscene') || [...files.keys()].some(f => /\.galaxy$/i.test(f) && f !== 'MapScript.galaxy'))
            throw new Error('DOCUMENT_AUTHOR_CONTENT_PRESENT');
        if (manifest.kind === 'mod' && (files.has('MapInfo') || files.has('MapScript.galaxy') || [...files.keys()].some(f => /^t3/.test(f))))
            throw new Error('DOCUMENT_MOD_MAP_CONTENT_PRESENT');
    });
    if (manifest.kind === 'map')
        check(() => { const m = validateEmptyMapInfo(files.get('MapInfo')!); if (m.core.cells[0] !== manifest.width || m.core.cells[1] !== manifest.height)
            throw new Error('DOCUMENT_MAP_DIMENSIONS'); if (files.get('MapScript.galaxy')?.toString() !== '// Empty document bootstrap; gameplay is authored separately.\r\nvoid InitMap () { }\r\n')
            throw new Error('DOCUMENT_BOOTSTRAP_CHANGED'); });
    if (manifest.terrain)
        check(() => { validateTerrainLoadContract(files, manifest.width!, manifest.height!); const state = parseState(new Map(files)), integrity = inspectNativeIntegrity(files, manifest.width!, manifest.height!); if (!integrity.valid)
            throw new Error('DOCUMENT_TERRAIN_ENVELOPES: ' + JSON.stringify(integrity.issues)); if (state.descriptor.heightMap.attrs.tileSet !== manifest.tileSet || state.descriptor.ramps.length || state.water?.count || state.visibility?.inspect().hiddenCells)
            throw new Error('DOCUMENT_TERRAIN_NONEMPTY'); if (state.heights.width !== manifest.width! + 1 || state.heights.height !== manifest.height! + 1)
            throw new Error('DOCUMENT_TERRAIN_DIMENSIONS'); const layer = state.descriptor.textures.find(t => t.id === manifest.initialTexture)?.slot; if (layer === undefined)
            throw new Error('DOCUMENT_INITIAL_TEXTURE_NOT_BOUND'); for (let y = 0; y < state.heights.height; y++)
            for (let x = 0; x < state.heights.width; x++)
                if (Math.abs(state.heights.z(x, y) - manifest.baseHeight!) > 0.001 || state.heights.mask(x, y) !== 1)
                    throw new Error('DOCUMENT_TERRAIN_NOT_FLAT'); if (!state.masks || !state.syncTextures)
            throw new Error('DOCUMENT_TERRAIN_GRID_MISSING'); for (let l = 0; l < 8; l++) {
            const payload = state.masks.bytes.subarray(64 + l * state.masks.width * state.masks.height / 2, 64 + (l + 1) * state.masks.width * state.masks.height / 2);
            if (payload.some(v => v !== (l === layer ? 255 : 0)))
                throw new Error('DOCUMENT_TEXTURE_MASK_CONTENT');
        } });
    if (!manifest.terrain)
        check(() => { if ([...files.keys()].some(f => /^t3/.test(f)))
            throw new Error('DOCUMENT_UNEXPECTED_TERRAIN'); });
    return { valid: errors.length === 0, errors, profile: manifest.profile, kind: manifest.kind, emptyContent: true, validationScope: 'Strict generated foundation manifest, native codecs, dependency/localization and initial grids; no engine acceptance claim', editorValidation: 'NOT_EXECUTED', runtimeValidation: 'NOT_EXECUTED' };
}
