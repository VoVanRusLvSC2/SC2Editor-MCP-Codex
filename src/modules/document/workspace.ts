import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Workspace } from "../../core/workspace.js";
import { bytesHash } from "../../core/binaryTransactions.js";
import { directoryManifest, packArchive } from "../../archive/archiveAdapter.js";
import type { CascWorkspace } from "../casc/workspace.js";
import { DocumentDependencies, type DependencyResolution } from "./dependencies.js";
import { documentPlanSchema, type DocumentRequest, type DependencyRequest } from "./schemas.js";
import { generateFoundation, type FoundationManifest } from "./manifest.js";
import { validateFoundation } from "./validation.js";
interface StoredPlan {
    id: string;
    request: DocumentRequest;
    resolution: DependencyResolution;
    files: Map<string, Buffer>;
    manifest: FoundationManifest;
    componentDestination: string;
    archiveDestination: string;
}
const recordFile = '.sc2mcp-document.json';
export class DocumentWorkspace {
    private readonly plans = new Map<string, StoredPlan>();
    readonly dependencies: DocumentDependencies;
    constructor(readonly workspace: Workspace, readonly casc: CascWorkspace) { this.dependencies = new DocumentDependencies(workspace, casc); }
    capabilities() { return { module: 'document', creationFromScratch: true, templatesRequired: false, kinds: ['dependent-mod', 'extension-mod', 'empty-arcade-map'], mapInfoVersion: 39, terrainVersion: 115, dimensions: { minimum: 32, maximum: 256, step: 8, rectangles: true }, initialTerrain: 'flat height and one texture; no authored cliffs/ramps/objects', outputs: ['components', 'packed'], editorValidation: 'NOT_EXECUTED', runtimeValidation: 'NOT_EXECUTED', nativeExactDefaults: 'PARTIAL', headerProfile: 'H2CS v8 native local unpublished document; fresh content stamp', gaps: ['Melee/Training gameplay profiles are not enabled', 'Header identity semantics and complete Editor default fidelity remain uncertified', 'No nav/collision, cliff/ramp/border rebuild or authored gameplay scripts', 'Only bounded CTerrain inheritance/array/token rules; ambiguous required data is rejected', 'Custom local dependencies require component directories; remote-only references and downloads are not supported'] }; }
    types() { return { supported: [{ kind: 'mod', modType: 'dependent', parameters: ['dependencies', 'destination', 'name', 'locales'] }, { kind: 'mod', modType: 'extension', parameters: ['dependencies', 'destination', 'name', 'locales'], flag: 'DocumentInfo/Flags/ExtensionMod' }, { kind: 'map', mapType: 'arcade', parameters: ['dependencies', 'destination', 'name', 'locales', 'map.width', 'map.height', 'terrain.enabled', 'terrain.tileSet', 'terrain.initialTexture', 'terrain.baseHeight'] }], unsupported: ['melee', 'training'], initialization: 'empty' }; }
    private destinations(request: DocumentRequest) {
        const ext = request.kind === 'map' ? '.SC2Map' : '.SC2Mod', raw = this.workspace.binary.key(request.destination);
        if (!raw || raw === '.' || raw.split('/').some(p => p.startsWith('.sc2mcp-') && p !== '.sc2mcp-output') || /\.sc2(?:map|mod)$/i.test(raw) && !raw.toLowerCase().endsWith(ext.toLowerCase()))
            throw new Error('DOCUMENT_DESTINATION_INVALID');
        const componentDestination = /\.sc2(?:map|mod)$/i.test(raw) ? raw + '.components' : raw, archiveDestination = raw.toLowerCase().endsWith(ext.toLowerCase()) ? raw : raw + ext;
        for (const target of [componentDestination, archiveDestination]) {
            const absolute = this.workspace.resolveUserPath(target), rel = path.relative(this.casc.install, absolute);
            if (!rel || !rel.startsWith('..') && !path.isAbsolute(rel))
                throw new Error('DOCUMENT_OUTPUT_INSIDE_GAME_INSTALL');
            if (absolute === this.workspace.root)
                throw new Error('DOCUMENT_DESTINATION_IS_ROOT');
        }
        return { componentDestination, archiveDestination };
    }
    private async missing(relative: string) { const file = this.workspace.resolveUserPath(relative); try {
        await fs.lstat(file);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return;
        throw e;
    } throw new Error('DOCUMENT_DESTINATION_EXISTS: ' + relative); }
    private draftGuard(source: DependencyResolution['source']) { for (const tree of source.localTrees)
        for (const file of [...this.workspace.draftFiles(), ...this.workspace.binary.draftFiles()]) {
            const rel = path.relative(tree.root, this.workspace.resolveUserPath(file));
            if (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))
                throw new Error('DOCUMENT_DEPENDENCY_DRAFT_PENDING: ' + file);
        } }
    async dependencyInfo(request: DependencyRequest) { const r = await this.dependencies.resolve(request); return { direct: r.direct, ordered: r.ordered, build: r.source.build, availability: 'Named builtin packages plus strict local component snapshots; entire game installation is not certified' }; }
    async terrainSets(request: DependencyRequest, offset = 0, limit = 30) { const r = await this.dependencies.resolve(request, true); return { build: r.source.build, total: r.terrainSets.length, items: r.terrainSets.slice(offset, offset + limit), nextOffset: offset + limit < r.terrainSets.length ? offset + limit : null }; }
    async terrainSet(request: DependencyRequest, id: string) { const r = await this.dependencies.resolve(request, true), set = r.terrainSets.find(t => t.id === id); if (!set)
        throw new Error('DOCUMENT_TERRAIN_SET_NOT_FOUND'); return { build: r.source.build, ...set }; }
    async plan(input: unknown) {
        const request = documentPlanSchema.parse(input), destinations = this.destinations(request);
        await this.missing(destinations.componentDestination);
        await this.missing(destinations.archiveDestination);
        const resolution = await this.dependencies.resolve(request.dependencies, request.kind === 'map' && request.terrain.enabled);
        this.draftGuard(resolution.source);
        for (const tree of resolution.source.localTrees)
            for (const target of Object.values(destinations)) {
                const rel = path.relative(tree.root, this.workspace.resolveUserPath(target));
                if (!rel || !rel.startsWith('..') && !path.isAbsolute(rel))
                    throw new Error('DOCUMENT_OUTPUT_INSIDE_DEPENDENCY');
            }
        const selectedSet = request.kind === 'map' && request.terrain.enabled ? request.terrain.tileSet : undefined;
        const set = selectedSet ? resolution.terrainSets.find(t => t.id === selectedSet) : undefined;
        if (request.kind === 'map' && request.terrain.enabled) {
            if (!set || set.generic || set.unsupported?.length || !set.textures.length || set.textures.length > 8 || set.textures.some(t => !t || t.includes('##')) || set.cliffs.some(t => t.includes('##')))
                throw new Error('DOCUMENT_TERRAIN_SET_UNSUPPORTED: ' + JSON.stringify(set?.unsupported ?? []));
        }
        const resolvedRequest = { ...request, dependencies: { mode: 'custom' as const, entries: resolution.direct.map(d => { const m = d.specification.match(/^bnet:([^,]+),/); return { file: d.file, bnet: m?.[1] }; }) } };
        const timestamp = Math.floor(Date.now() / 1000), seed = randomUUID(), generated = generateFoundation(resolvedRequest as DocumentRequest, resolution.source.build.version, timestamp, seed, set);
        const rows = [...generated.files].sort(([a], [b]) => a.localeCompare(b)).map(([file, b]) => ({ file, size: b.length, sha256: bytesHash(b) }));
        const contentSha256 = bytesHash(Buffer.from(JSON.stringify(rows)));
        const manifest: FoundationManifest = { kind: request.kind, modType: request.kind === 'mod' ? request.modType : undefined, mapType: request.kind === 'map' ? request.mapType : undefined, terrain: request.kind === 'map' && request.terrain.enabled, title: generated.title, profile: generated.profile, build: generated.build, timestamp, identity: generated.identity, dependencies: generated.dependencies, locales: request.locales, width: request.kind === 'map' ? request.map.width : undefined, height: request.kind === 'map' ? request.map.height : undefined, tileSet: set?.id, initialTexture: generated.initialTexture, baseHeight: generated.baseHeight, files: rows, contentSha256 };
        const validation = validateFoundation(generated.files, manifest);
        if (!validation.valid)
            throw new Error('DOCUMENT_FOUNDATION_INVALID: ' + JSON.stringify(validation.errors));
        await this.dependencies.verify(resolution.source);
        this.draftGuard(resolution.source);
        const id = 'document_' + createHash('sha256').update(JSON.stringify({ manifest, build: resolution.source.build, destinations })).digest('hex').slice(0, 24);
        this.plans.set(id, { id, request, resolution, files: generated.files, manifest, ...destinations });
        while (this.plans.size > 4)
            this.plans.delete(this.plans.keys().next().value!);
        return { id, valid: true, ...destinations, foundation: { ...manifest, files: rows.map(row => ({ file: row.file, size: row.size, sha256: row.sha256 })) }, resolvedDependencies: { direct: resolution.direct, ordered: resolution.ordered }, validation, authoredObjects: 0, authoredGameplayFunctions: 0, authoredTriggers: 0, scriptBootstrap: request.kind === 'map' ? 'Empty InitMap entry point only' : 'none', sourceBuild: resolution.source.build };
    }
    private get(id: string) { const plan = this.plans.get(id); if (!plan)
        throw new Error('DOCUMENT_PLAN_NOT_FOUND'); return plan; }
    private async verify(plan: StoredPlan) { this.draftGuard(plan.resolution.source); await this.dependencies.verify(plan.resolution.source); await this.missing(plan.componentDestination); await this.missing(plan.archiveDestination); return validateFoundation(plan.files, plan.manifest); }
    async validatePlan(id: string) { const plan = this.get(id); return { planId: id, ...await this.verify(plan), sourceGuard: 'CURRENT', contentSha256: plan.manifest.contentSha256 }; }
    async create(id: string, dryRun = true, output: 'components' | 'packed' = 'components') {
        const plan = this.get(id);
        return this.workspace.transactions.run(async () => {
            const validation = await this.verify(plan);
            if (!validation.valid)
                throw new Error('DOCUMENT_FOUNDATION_INVALID');
            const stagingParent = this.workspace.resolveUserPath('.sc2mcp-document-staging');
            await fs.mkdir(stagingParent, { recursive: true });
            const temporary = await fs.mkdtemp(path.join(stagingParent, 'new-'));
            const resolved = path.resolve(temporary), relative = path.relative(stagingParent, resolved);
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('DOCUMENT_STAGING_SCOPE');
            const componentRoot = path.join(temporary, 'components');
            let published = false;
            try {
                await fs.mkdir(componentRoot);
                for (const [file, b] of plan.files) {
                    const target = path.join(componentRoot, file);
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await fs.writeFile(target, b, { flag: 'wx' });
                }
                const actual = await directoryManifest(componentRoot);
                if (JSON.stringify(actual) !== JSON.stringify(plan.manifest.files))
                    throw new Error('DOCUMENT_MATERIALIZATION_MISMATCH');
                const readBack = new Map(await Promise.all(actual.map(async (row) => [row.file, await fs.readFile(path.join(componentRoot, row.file))] as const)));
                if (!validateFoundation(readBack, plan.manifest).valid)
                    throw new Error('DOCUMENT_REOPEN_VALIDATION_FAILED');
                const destination = output === 'packed' ? plan.archiveDestination : plan.componentDestination;
                let archiveVerification: unknown;
                const packed = path.join(temporary, 'result' + (plan.request.kind === 'map' ? '.SC2Map' : '.SC2Mod'));
                if (output === 'packed')
                    archiveVerification = (await packArchive(componentRoot, packed, { backup: false })).verification;
                await this.verify(plan);
                if (!dryRun) {
                    const target = this.workspace.resolveUserPath(destination);
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await this.missing(destination);
                    if (output === 'components')
                        await fs.writeFile(path.join(componentRoot, recordFile), JSON.stringify({ format: 'sc2-mcp-document-v1', manifest: plan.manifest }, null, 2) + '\n', { flag: 'wx' });
                    // A single new destination is published. No existing file or user map is replaced.
                    if (output === 'packed')
                        await fs.link(packed, target);
                    else
                        await fs.rename(componentRoot, target);
                    published = true;
                }
                return { created: !dryRun, dryRun, output, destination, contentSha256: plan.manifest.contentSha256, kind: plan.request.kind, modType: plan.manifest.modType, dimensions: plan.manifest.width ? [plan.manifest.width, plan.manifest.height] : undefined, tileSet: plan.manifest.tileSet, files: actual.length, validation, archiveVerification, editorValidation: 'NOT_EXECUTED', runtimeValidation: 'NOT_EXECUTED', nativeExactDefaults: 'PARTIAL', publication: published ? 'NEW_DESTINATION_PUBLISHED' : 'PRIVATE_MATERIALIZATION_ONLY' };
            }
            finally {
                await fs.rm(resolved, { recursive: true, force: true });
            }
        });
    }
    async inspect(directory = '') {
        const root = this.workspace.resolveUserPath(directory);
        const raw = await fs.readFile(this.workspace.resolveUserPath(path.join(directory, recordFile)));
        if (raw.length > 128 * 1024)
            throw new Error('DOCUMENT_RECORD_SIZE');
        const record = JSON.parse(raw.toString()) as {
            format: string;
            manifest: FoundationManifest;
        };
        if (record.format !== 'sc2-mcp-document-v1' || !Array.isArray(record.manifest.files) || record.manifest.files.length > 64)
            throw new Error('DOCUMENT_RECORD_INVALID');
        const rows = await directoryManifest(root), files = new Map(await Promise.all(rows.map(async (row) => [row.file, await fs.readFile(path.join(root, row.file))] as const)));
        return { directory, ...validateFoundation(files, record.manifest), foundation: record.manifest, notice: 'Strict foundation validation. Once gameplay content is authored, use the relevant Map/Terrain/Script/Settings validators.' };
    }
}
