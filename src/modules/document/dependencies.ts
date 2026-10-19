import { promises as fs } from "node:fs";
import path from "node:path";
import type { Workspace } from "../../core/workspace.js";
import type { CascWorkspace, CascBuild } from "../casc/workspace.js";
import { safeArchivePath, directoryManifest, type DirectoryEntry } from "../../archive/archiveAdapter.js";
import { bytesHash } from "../../core/binaryTransactions.js";
import { scanXml } from "../../core/xmlScanner.js";
import { readDocumentInfo } from "./codecs/metadata.js";
import type { DependencyRequest, DependencyEntry } from "./schemas.js";
import type { TerrainSet } from "./codecs/flatTerrainFactory.js";
import {sc2BuiltinDependencies as builtinParents} from '../../core/sc2BuiltinDependencies.js';
export interface DocumentSource {
    build: CascBuild;
    buildInfoFile: string;
    files: Array<{
        path: string;
        sha256: string;
        bytes: Buffer;
    }>;
    localTrees: Array<{
        root: string;
        manifest: DirectoryEntry[];
    }>;
}
export interface ResolvedDependency {
    file: string;
    specification: string;
    source: 'builtin' | 'local';
    implicit: boolean;
    root?: string;
}
export interface DependencyResolution {
    direct: ResolvedDependency[];
    ordered: ResolvedDependency[];
    source: DocumentSource;
    terrainSets: TerrainSet[];
}
const builtinNames: Record<string, string> = { 'liberty': 'Liberty', 'swarm': 'Swarm', 'void': 'Void' };
const spec = (entry: DependencyEntry) => (entry.bnet ? 'bnet:' + entry.bnet + ',' : '') + 'file:' + entry.file;
export class DocumentDependencies {
    constructor(readonly workspace: Workspace, readonly casc: CascWorkspace) { }
    presets() { return Object.entries(builtinNames).map(([id, name]) => ({ id, name, mod: { file: `Mods/${name}.SC2Mod`, bnet: `${name} (Mod)/0.0/999` }, campaign: { file: `Campaigns/${name}.SC2Campaign`, bnet: `${name} (Campaign)/0.0/999` } })); }
    async resolve(request: DependencyRequest, withTerrain = false): Promise<DependencyResolution> {
        const { build } = await this.casc.refreshBuild(), source: DocumentSource = { build, buildInfoFile: path.join(this.casc.install, '.build.info'), files: [], localTrees: [] };
        const entries = request.mode === 'custom' ? request.entries : [{ file: `Mods/${builtinNames[request.expansion]}.SC2Mod`, bnet: `${builtinNames[request.expansion]} (Mod)/0.0/999` }, ...(request.campaign ? [{ file: `Campaigns/${builtinNames[request.expansion]}.SC2Campaign`, bnet: `${builtinNames[request.expansion]} (Campaign)/0.0/999` }] : [])];
        const direct: ResolvedDependency[] = [], ordered: ResolvedDependency[] = [], active = new Set<string>(), seen = new Set<string>(), names = new Set<string>();
        const readGame = async (file: string) => { const r = await this.casc.read(file); if (r.metadata.buildKey !== build.buildKey)
            throw new Error('DOCUMENT_SOURCE_BUILD_CHANGED'); source.files.push({ path: file, sha256: r.metadata.sha256, bytes: r.bytes }); return r.bytes; };
        const visit = async (entry: DependencyEntry, implicit: boolean) => {
            const file = safeArchivePath(entry.file), key = file.toLowerCase();
            if (!/\.sc2(?:mod|campaign)$/i.test(file))
                throw new Error('DOCUMENT_DEPENDENCY_EXTENSION');
            if (entry.bnet && (/[\r\n\0,]/.test(entry.bnet) || !/^.+\/\d+\.\d+\/\d+$/.test(entry.bnet)))
                throw new Error('DOCUMENT_BNET_REFERENCE_INVALID');
            if (active.has(key))
                throw new Error('DOCUMENT_DEPENDENCY_CYCLE: ' + file);
            if (seen.has(key))
                return ordered.find(d => d.file.toLowerCase() === key)!;
            active.add(key);
            let node: ResolvedDependency;
            if (Object.hasOwn(builtinParents, key)) {
                // Availability is established by a real named package payload, never by an invented folder.
                const found = await this.casc.search(key, '', 0, 1);
                if (!found.total)
                    throw new Error('DOCUMENT_DEPENDENCY_UNAVAILABLE: ' + file);
                for (const parent of builtinParents[key])
                    await visit({ file: parent }, true);
                node = { file, specification: spec({ ...entry, file }), source: 'builtin', implicit };
            }
            else {
                const root = this.workspace.resolveUserPath(file), manifest = await directoryManifest(root);
                source.localTrees.push({ root, manifest });
                const info = await fs.readFile(path.join(root, 'DocumentInfo'));
                source.files.push({ path: path.join(root, 'DocumentInfo'), sha256: bytesHash(info), bytes: info });
                for (const value of readDocumentInfo(info).dependencies) {
                    const match = value.match(/(?:^|,)file:([^,]+)$/);
                    if (!match)
                        throw new Error('DOCUMENT_REMOTE_DEPENDENCY_NOT_LOCAL: ' + value);
                    const bn = value.match(/^bnet:([^,]+),/);
                    await visit({ file: match[1], bnet: bn?.[1] }, true);
                }
                node = { file, specification: spec({ ...entry, file }), source: 'local', implicit, root };
            }
            active.delete(key);
            seen.add(key);
            ordered.push(node);
            return node;
        };
        // The engine Core layer is implicit even for a mod with an empty explicit list.
        await visit({ file: 'Mods/Core.SC2Mod' }, true);
        for (const entry of entries) {
            const key = entry.file.replaceAll('\\', '/').toLowerCase();
            if (names.has(key))
                throw new Error('DOCUMENT_DEPENDENCY_DUPLICATE');
            names.add(key);
            const node = await visit(entry, false);
            direct.push({ ...node, implicit: false, specification: spec({ ...entry, file: node.file }) });
        }
        if (entries.filter(e => /multi\.sc2mod$/i.test(e.file)).length > 1)
            throw new Error('DOCUMENT_MULTIPLE_MULTIPLAYER_DEPENDENCIES');
        const catalogs: Array<{
            path: string;
            bytes: Buffer;
        }> = [];
        if (withTerrain)
            for (const node of ordered) {
                if (node.source === 'builtin') {
                    const file = node.file.toLowerCase() + '/base.sc2data/gamedata/terraindata.xml';
                    const page = await this.casc.search(node.file, 'terraindata.xml', 0, 10);
                    if (page.total === 0)
                        continue;
                    if (!page.items.some(p => p.path === file))
                        throw new Error('DOCUMENT_TERRAIN_CATALOG_PATH_AMBIGUOUS');
                    catalogs.push({ path: file, bytes: await readGame(file) });
                }
                else {
                    const file = path.join(node.root!, 'Base.SC2Data/GameData/TerrainData.xml');
                    try {
                        const bytes = await fs.readFile(file);
                        source.files.push({ path: file, sha256: bytesHash(bytes), bytes });
                        catalogs.push({ path: file, bytes });
                    }
                    catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                            throw e;
                    }
                }
            }
        if ((await this.casc.refreshBuild()).build.buildInfoSha256 !== build.buildInfoSha256)
            throw new Error('DOCUMENT_SOURCE_BUILD_CHANGED');
        return { direct, ordered, source, terrainSets: withTerrain ? resolveTerrainCatalogs(catalogs) : [] };
    }
    async verify(source: DocumentSource) { const current = await this.casc.refreshBuild(); if (current.build.buildInfoSha256 !== source.build.buildInfoSha256)
        throw new Error('STALE_DOCUMENT_BUILD'); for (const tree of source.localTrees)
        if (JSON.stringify(await directoryManifest(tree.root)) !== JSON.stringify(tree.manifest))
            throw new Error('STALE_DOCUMENT_DEPENDENCY'); for (const file of source.files) {
        const bytes = path.isAbsolute(file.path) ? await fs.readFile(file.path) : (await this.casc.read(file.path)).bytes;
        if (bytesHash(bytes) !== file.sha256)
            throw new Error('STALE_DOCUMENT_SOURCE: ' + file.path);
    } }
}
interface CatalogRecord {
    id: string;
    parent?: string;
    generic: boolean;
    textures?: string[];
    cliffs?: string[];
    paths: string[];
    unsupported: string[];
}
/** Bounded CTerrain rules needed by the allocator: ordered overrides, direct arrays and ##id## parent tokens. */
export function resolveTerrainCatalogs(catalogs: Array<{
    path: string;
    bytes: Buffer;
}>): TerrainSet[] {
    const records = new Map<string, CatalogRecord>();
    for (const catalog of catalogs) {
        const text = catalog.bytes.toString('utf8'), xml = scanXml(text);
        if (!Buffer.from(text).equals(catalog.bytes) || xml.diagnostics.some(d => d.severity === 'error') || xml.rootIds.length !== 1 || xml.nodes[xml.rootIds[0]].tag !== 'Catalog')
            throw new Error('DOCUMENT_TERRAIN_CATALOG_INVALID');
        for (const node of xml.nodes.filter(n => n.parentId === xml.rootIds[0] && n.tag === 'CTerrain' && n.attrs.id)) {
            const prior = records.get(node.attrs.id), r: CatalogRecord = { id: node.attrs.id, parent: node.attrs.parent ?? prior?.parent, generic: node.attrs.default === undefined ? (prior?.generic ?? false) : node.attrs.default === '1', textures: prior?.textures, cliffs: prior?.cliffs, paths: [...(prior?.paths ?? []), catalog.path], unsupported: [...(prior?.unsupported ?? [])] };
            for (const field of ['BlendTextures', 'CliffSets'] as const) {
                const nodes = node.childIds.map(i => xml.nodes[i]).filter(n => n.tag === field);
                if (!nodes.length)
                    continue;
                if (nodes.some(n => Object.keys(n.attrs).some(a => a !== 'value') || n.childIds.length || n.attrs.value === undefined)) {
                    r.unsupported.push(field + ' uses unsupported array semantics');
                    continue;
                }
                const value = nodes.map(n => n.attrs.value);
                if (field === 'BlendTextures')
                    r.textures = value;
                else
                    r.cliffs = value;
            }
            records.set(r.id, r);
        }
    }
    const resolve = (id: string, stack = new Set<string>(), tokenId = id): TerrainSet => { const r = records.get(id); if (!r)
        throw new Error('DOCUMENT_TERRAIN_PARENT_MISSING: ' + id); if (stack.has(id))
        throw new Error('DOCUMENT_TERRAIN_PARENT_CYCLE'); const next = new Set([...stack, id]), p = r.parent ? resolve(r.parent, next, tokenId) : undefined; const substitute = (v: string) => v.replaceAll('##id##', tokenId); return { id, textures: (r.textures ?? p?.textures ?? []).map(substitute), cliffs: (r.cliffs ?? p?.cliffs ?? []).map(substitute), sourcePaths: [...new Set([...(p?.sourcePaths ?? []), ...r.paths])], generic: r.generic, unsupported: [...r.unsupported, ...(p?.unsupported ?? [])] }; };
    return [...records.values()].filter(r => !r.generic).map(r => { try {
        return resolve(r.id);
    }
    catch (e) {
        return { id: r.id, textures: [], cliffs: [], sourcePaths: r.paths, unsupported: [String(e)] };
    } }).filter(r => r.textures.length > 0 || r.unsupported?.length).sort((a, b) => a.id.localeCompare(b.id));
}
