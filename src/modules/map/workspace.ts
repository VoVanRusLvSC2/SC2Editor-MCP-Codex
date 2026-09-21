import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { Workspace } from "../../core/workspace.js";
import { decodeUtf8, readSnapshot, assertSnapshots } from "../../core/fileTransactions.js";
import { bytesHash, type ByteOptions } from "../../core/binaryTransactions.js";
import { scanXml } from "../../core/xmlScanner.js";
import { archiveBackendAvailable, archiveMetadataFile, directoryManifest, extractArchive, inspectArchive, packArchive, safeArchivePath, type DirectoryEntry } from "../../archive/archiveAdapter.js";
import { TerrainWorkspace } from "../terrain/workspace.js";
import { MapInfoDocument, type MapInfoPatch } from "./mapInfo.js";
import { PlacementDocument } from "../placement/document.js";
import { terrainPlanSchema } from "../terrain/schemas.js";
import type { TerrainOperation } from "../terrain/types.js";
import type { GenerateArgs } from "../terrain/recipes.js";
import { commitFiles } from "../../core/fileTransactions.js";

const blueprintRegistry = ".sc2mcp-blueprints.json";
const blueprintTerrainFiles = ["t3Terrain.xml", "t3HeightMap", "t3TextureMasks", "t3SyncHeightMap", "t3SyncCliffLevel", "t3SyncTextureInfo", "t3CellFlags", "t3HardTile", "t3FluffDoodad", "t3VertCol", "t3Water"];
interface BlueprintRecord {
  id: string; directory: string; sha256: string; cells: number[]; tileSet?: string;
  objectCount: number; scriptFiles: string[]; registeredAt: string;
}
interface CreateMapRequest {
  blueprintId: string; destinationDirectory: string; dryRun?: boolean;
  expectedBlueprintSha256?: string; metadataPatch?: MapInfoPatch;
  landscape?: Omit<GenerateArgs, "directory" | "area"> & { area?: GenerateArgs["area"] };
  terrainOperations?: TerrainOperation[];
}

interface MapMetadataPlan { id:string; directory:string; file:string; snapshot:DirectoryEntry[]; sourceSha256:string; afterSha256:string; patch:MapInfoPatch; next:Buffer }
export class MapWorkspace {
  private readonly plans = new Map<string,MapMetadataPlan>();
  constructor(readonly workspace: Workspace, readonly terrain = new TerrainWorkspace(workspace)) {}
  capabilities() {
    return { module:"map",archiveBackendAvailable:archiveBackendAvailable(),
      import:true,export:true,fullNativeClone:true,metadataVersion:39,
      metadataEditing:["playableBounds","fogMaskStyle","minimapResolution"],
      arbitraryResize:false,cleanMapCreation:false,blueprints:[],
      creationFromRegisteredNativeTemplate:true,blueprintContentGuards:true,
      createWithLandscape:true,creationPublication:"New component directory published only after offline validation; existing destinations rejected",
      cleanMapCreationReason:"No verified clean native blueprint or complete native defaults in the provided corpus",
      scriptPreservation:true,triggerEditing:false,editorValidation:"NOT_EXECUTED",runtimeValidation:"NOT_EXECUTED" };
  }
  private root(directory: string) { return this.workspace.resolveUserPath(directory); }
  private assertNoDrafts(directory: string, except: string[] = []) {
    const root = this.root(directory), ignored = new Set(except);
    for(const file of [...this.workspace.draftFiles(),...this.workspace.binary.draftFiles()]) {
      const relative = path.relative(root,this.workspace.resolveUserPath(file));
      if(!ignored.has(file) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error(`MAP_DRAFTS_PENDING: ${file}; save/discard the complete transaction before map operations`);
    }
  }
  async inspect(directory = "") {
    const root = this.root(directory), files = await directoryManifest(root), filenames = new Set(files.map(f => f.file));
    const issues: Array<{ severity:"error"|"warning";code:string;message:string }> = [];
    const read = async (name: string) => (await this.workspace.binary.read(path.join(directory,name))).bytes;
    let mapInfo: ReturnType<MapInfoDocument["inspect"]> | undefined;
    try { mapInfo = new MapInfoDocument(await read("MapInfo")).inspect(); }
    catch(e) { issues.push({ severity:"error",code:"MAPINFO_INVALID",message:String(e) }); }
    const components: Array<{ type:string;root:string;locale?:string }> = [];
    for(const name of ["ComponentList.SC2Components","DocumentInfo","DocumentHeader"]) {
      const bytes = await read(name);
      if(!bytes.length) { issues.push({ severity:"error",code:"MAP_DOCUMENT_COMPONENT_MISSING",message:name }); continue; }
      if(name === "DocumentHeader") continue; // Binary payload is preserved, not falsely XML-parsed.
      try {
        const text = decodeUtf8(bytes,name), parsed = scanXml(text);
        if(parsed.diagnostics.some(d => d.severity === "error") || parsed.rootIds.length !== 1) throw new Error("Invalid document XML");
        if(name === "ComponentList.SC2Components") {
          for(const node of parsed.nodes.filter(n => n.tag === "DataComponent" || n.tag === "Component")) {
            const value = text.slice(node.startTagEnd,node.endTagStart).trim().replaceAll("&amp;","&").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&quot;",'"').replaceAll("&apos;","'");
            components.push({ type:node.attrs.Type,root:safeArchivePath(value),locale:node.attrs.Locale });
          }
          for(const type of ["info","mapi","terr"]) if(!components.some(c => c.type === type)) issues.push({ severity:"error",code:"COMPONENT_ROOT_MISSING",message:type });
          for(const c of components.filter(c => ["info","mapi","terr"].includes(c.type))) {
            if(!filenames.has(c.root)) issues.push({ severity:"error",code:"DECLARED_COMPONENT_MISSING",message:`${c.type}: ${c.root}` });
          }
          for(const c of components.filter(c => !["info","mapi","terr"].includes(c.type))) {
            if(!filenames.has(c.root)) issues.push({ severity:"warning",code:"LOGICAL_COMPONENT_ROOT_UNRESOLVED",message:`${c.type}: ${c.root}; logical/optimized roots are preserved without guessing a direct file binding` });
          }
        }
      } catch(e) { issues.push({ severity:"error",code:"MAP_DOCUMENT_XML_INVALID",message:`${name}: ${String(e)}` }); }
    }
    const terrain = await this.terrain.inspect(directory);
    if("error" in terrain && terrain.error) issues.push({ severity:"error",code:"TERRAIN_INVALID",message:terrain.error });
    if("nativeIntegrity" in terrain && terrain.nativeIntegrity) issues.push(...terrain.nativeIntegrity.issues);
    if(mapInfo && terrain.dimensions?.vertices) {
      if(terrain.dimensions.vertices[0] !== mapInfo.cells[0]+1 || terrain.dimensions.vertices[1] !== mapInfo.cells[1]+1) issues.push({ severity:"error",code:"MAP_TERRAIN_DIMENSION_MISMATCH",message:"MapInfo cells and height-map vertices disagree" });
    }
    issues.push({ severity:"warning",code:"OFFLINE_VALIDATION_ONLY",message:"DocumentHeader payload, player/variant semantics and engine acceptance remain unverified" });
    return { directory,files,mapInfo,components,terrain,issues,
      valid:!issues.some(i => i.severity === "error"),stagedFiles:[...this.workspace.draftFiles(),...this.workspace.binary.draftFiles()],
      validationScope:"Known MapInfo core prefix, required document roots, terrain parsers and file manifest; not complete engine semantics",
      editorValidation:"NOT_EXECUTED",runtimeValidation:"NOT_EXECUTED" };
  }
  async validate(directory = "") { return this.inspect(directory); }
  /** Content-addressed reference to an existing native template; no guessed defaults. */
  async inspectBlueprint(directory: string) {
    this.assertNoDrafts(directory);
    const inspected = await this.inspect(directory);
    const metadata = await readSnapshot(this.root(path.join(directory, archiveMetadataFile)));
    const sha256 = bytesHash(Buffer.from(JSON.stringify({ files: inspected.files, archiveMetadata: metadata.exists ? bytesHash(metadata.bytes) : null })));
    const raw = await this.workspace.binary.read(path.join(directory, "Objects"), false);
    let objectCount = 0;
    if (raw.exists) objectCount = new PlacementDocument(decodeUtf8(raw.bytes, "Objects")).list().length;
    const scriptFiles = inspected.files.filter(f => /\.galaxy$/i.test(f.file)).map(f => f.file);
    const filenames = new Set(inspected.files.map(f => f.file));
    const issues = [...inspected.issues, ...blueprintTerrainFiles.filter(name => !filenames.has(name)).map(name => ({ severity: "error" as const, code: "BLUEPRINT_TERRAIN_COMPONENT_MISSING", message: name }))];
    return { directory, sha256, valid: !issues.some(i => i.severity === "error"), cells: inspected.mapInfo?.cells ?? [], tileSet: inspected.terrain.tileSet,
      objectCount, scriptFiles, entryCount: inspected.files.length, issues,
      terrainProfile: "Conventional complete native terrain bundle; optimized/custom-name/missing-component profiles are not certified as creation templates",
      cleanTemplateVerified: false, inheritedContent: "All objects, scripts, data, dependencies and opaque components are preserved",
      editorValidation: "NOT_EXECUTED", runtimeValidation: "NOT_EXECUTED" };
  }
  private async readBlueprintRegistry() {
    if (this.workspace.draftFiles().includes(blueprintRegistry) || this.workspace.binary.hasDraft(blueprintRegistry)) throw new Error("BLUEPRINT_REGISTRY_DRAFTS_PENDING");
    const file = this.root(blueprintRegistry), snapshot = await readSnapshot(file);
    if (!snapshot.exists) return { file, snapshot, records: [] as BlueprintRecord[] };
    if (snapshot.bytes.length > 256 * 1024) throw new Error("BLUEPRINT_REGISTRY_SIZE_LIMIT");
    const value = JSON.parse(decodeUtf8(snapshot.bytes, blueprintRegistry));
    if (value.format !== "sc2-mcp-blueprints-v1" || !Array.isArray(value.records) || value.records.length > 64) throw new Error("INVALID_BLUEPRINT_REGISTRY");
    const ids = new Set<string>();
    for (const r of value.records) {
      if (!r || typeof r.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id) || ids.has(r.id) || typeof r.directory !== "string" || typeof r.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(r.sha256)
        || !Array.isArray(r.cells) || r.cells.length !== 2 || r.cells.some((v: unknown) => typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 256)
        || !Number.isSafeInteger(r.objectCount) || r.objectCount < 0 || !Array.isArray(r.scriptFiles) || r.scriptFiles.length > 4096 || r.scriptFiles.some((v: unknown) => typeof v !== "string" || !/\.galaxy$/i.test(v))
        || typeof r.registeredAt !== "string" || !Number.isFinite(Date.parse(r.registeredAt)) || (r.tileSet !== undefined && typeof r.tileSet !== "string")) throw new Error("INVALID_BLUEPRINT_RECORD");
      ids.add(r.id); this.root(r.directory);
    }
    return { file, snapshot, records: value.records as BlueprintRecord[] };
  }
  async listBlueprints() {
    const registry = await this.readBlueprintRegistry();
    return { blueprints: registry.records, snapshotVerified: false, notice: "Registry summaries; source contents are rechecked on create. Templates are supplied locally, not bundled." };
  }
  async registerBlueprint(id: string, directory: string, dryRun = true) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("INVALID_BLUEPRINT_ID");
    return this.workspace.transactions.run(async () => {
      const registry = await this.readBlueprintRegistry();
      if (registry.records.some(r => r.id === id)) throw new Error("BLUEPRINT_ID_EXISTS");
      if (registry.records.length >= 64) throw new Error("BLUEPRINT_REGISTRY_LIMIT");
      const inspected = await this.inspectBlueprint(directory);
      if (!inspected.valid) throw new Error("INVALID_BLUEPRINT_FOUNDATION: " + JSON.stringify(inspected.issues));
      const record: BlueprintRecord = { id, directory: path.relative(this.workspace.root, this.root(directory)).replaceAll("\\", "/"), sha256: inspected.sha256,
        cells: inspected.cells, tileSet: inspected.tileSet, objectCount: inspected.objectCount, scriptFiles: inspected.scriptFiles, registeredAt: new Date().toISOString() };
      if (!dryRun) {
        if ((await this.inspectBlueprint(directory)).sha256 !== record.sha256) throw new Error("STALE_BLUEPRINT_SOURCE");
        await assertSnapshots(file => file, new Map([[registry.file, registry.snapshot]]));
        await commitFiles(file => this.root(file), new Map([[blueprintRegistry, registry.snapshot]]),
          new Map([[blueprintRegistry, Buffer.from(JSON.stringify({ format: "sc2-mcp-blueprints-v1", records: [...registry.records, record] }, null, 2) + "\n")]]),
          // Internal registry is excluded from the document recovery journal.
          // A single atomic file replacement under the shared lock is sufficient.
          { backup: false, verify: async () => {
            if ((await this.inspectBlueprint(directory)).sha256 !== record.sha256) throw new Error("STALE_BLUEPRINT_SOURCE");
          } });
      }
      return { dryRun, blueprint: record, cleanTemplateVerified: false, inheritedContent: inspected.inheritedContent };
    });
  }
  async create(request: CreateMapRequest) {
    const { destinationDirectory, blueprintId } = request, dryRun = request.dryRun ?? true;
    const target = this.root(destinationDirectory);
    if (!destinationDirectory || target === this.workspace.root) throw new Error("INVALID_MAP_DESTINATION");
    const operations = request.terrainOperations ? terrainPlanSchema.parse({ operations: request.terrainOperations }).operations as TerrainOperation[] : [];
    if (operations.some(op => op.op === "stamp.apply")) throw new Error("CREATE_STAMP_UNSUPPORTED: choose the desired native terrain as the blueprint");
    return this.workspace.transactions.run(async () => {
      const registry = await this.readBlueprintRegistry(), record = registry.records.find(r => r.id === blueprintId);
      if (!record) throw new Error("BLUEPRINT_NOT_FOUND");
      if (request.expectedBlueprintSha256 && request.expectedBlueprintSha256 !== record.sha256) throw new Error("BLUEPRINT_HASH_MISMATCH");
      const source = this.root(record.directory), relative = path.relative(source, target);
      const withinSource = relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      if (!relative || (withinSource && !relative.replaceAll("\\", "/").startsWith(".sc2mcp-output/"))) throw new Error("MAP_CREATE_INSIDE_BLUEPRINT: root templates may create only under .sc2mcp-output/");
      const assertMissing = async () => { try { await fs.lstat(target); throw new Error("MAP_DESTINATION_EXISTS"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };
      await assertMissing();
      const verify = async () => {
        this.assertNoDrafts(record.directory);
        const current = await this.inspectBlueprint(record.directory);
        if (!current.valid || current.sha256 !== record.sha256) throw new Error("STALE_BLUEPRINT_SOURCE");
        await assertSnapshots(file => file, new Map([[registry.file, registry.snapshot]]));
        return current;
      };
      const verifiedBlueprint = await verify();
      const inspection = await this.inspect(record.directory);
      // Dry-run performs the actual transformations in a disposable private directory.
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "sc2mcp-map-create-"));
      let publication: string | undefined;
      try {
        await this.snapshotCopy(record.directory, temporary, inspection.files);
        const localWorkspace = new Workspace(temporary), terrain = new TerrainWorkspace(localWorkspace), map = new MapWorkspace(localWorkspace, terrain);
        const changed = new Set<string>();
        const apply = async (plan: Awaited<ReturnType<TerrainWorkspace["plan"]>>) => {
          if (!plan.valid) throw new Error("INVALID_CREATE_TERRAIN_PLAN: " + JSON.stringify(plan.issues));
          const result = await terrain.apply(plan.id, { dryRun: false, stage: false, backup: false });
          if (!result.accepted) throw new Error("CREATE_TERRAIN_APPLY_REJECTED");
          plan.files.filter(f => f.changedBytes > 0 || f.beforeBytes !== f.afterBytes).forEach(f => changed.add(f.file));
        };
        if (request.landscape) await apply(await terrain.landscape(request.landscape));
        if (operations.length) await apply(await terrain.plan({ operations }));
        if (request.metadataPatch) {
          const plan = await map.planMetadata("", request.metadataPatch);
          await map.applyMetadata(plan.id, { dryRun: false, stage: false, backup: false });
          if (plan.sourceSha256 !== plan.afterSha256) changed.add("MapInfo");
        }
        const after = await map.inspect();
        if (!after.valid) throw new Error("INVALID_CREATED_MAP: " + JSON.stringify(after.issues));
        await verify(); await assertMissing();
        if (!dryRun) {
          await fs.mkdir(path.dirname(target), { recursive: true });
          publication = await fs.mkdtemp(path.join(path.dirname(target), ".sc2mcp-create-"));
          await map.snapshotCopy("", publication, after.files);
          await verify(); await assertMissing();
          await fs.rename(publication, target);
        }
        return { dryRun, blueprintId, blueprintSha256: record.sha256, destinationDirectory, cells: after.mapInfo?.cells,
          entryCount: after.files.length, changedFiles: [...changed].sort(),
          contentSha256: bytesHash(Buffer.from(JSON.stringify(after.files))), cleanMap: false,
          inheritedObjects: verifiedBlueprint.objectCount, inheritedScripts: verifiedBlueprint.scriptFiles,
          validationScope: after.validationScope, issues: after.issues,
          editorValidation: "NOT_EXECUTED", runtimeValidation: "NOT_EXECUTED",
          nextStep: "Open the created directory as a project, author objects/data/scripts with the existing modules, save all drafts and map.export" };
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
        if (publication) await fs.rm(publication, { recursive: true, force: true });
      }
    });
  }
  async planMetadata(directory: string, patch: MapInfoPatch) {
    this.assertNoDrafts(directory);
    const inspected = await this.inspect(directory);
    if(!inspected.valid) throw new Error("INVALID_MAP_FOUNDATION: " + JSON.stringify(inspected.issues));
    const file = this.workspace.binary.key(path.join(directory,"MapInfo"));
    const source = (await this.workspace.binary.read(file,false)).bytes, next = new MapInfoDocument(source).patch(patch);
    const payload = JSON.stringify({ directory,patch,snapshot:inspected.files,source:bytesHash(source),next:bytesHash(next) });
    const id = "map_"+createHash("sha256").update(payload).digest("hex").slice(0,24);
    this.plans.set(id,{ id,directory,file,snapshot:inspected.files,sourceSha256:bytesHash(source),afterSha256:bytesHash(next),patch:structuredClone(patch),next });
    while(this.plans.size > 16) this.plans.delete(this.plans.keys().next().value!);
    return { id,directory,file,patch,sourceSha256:bytesHash(source),afterSha256:bytesHash(next),after:new MapInfoDocument(next).inspect(),valid:true,editorValidation:"NOT_EXECUTED" };
  }
  async applyMetadata(planId: string, options: ByteOptions = {}) {
    const plan = this.plans.get(planId); if(!plan) throw new Error("MAP_PLAN_NOT_FOUND");
    const verify = async () => {
      this.assertNoDrafts(plan.directory,[plan.file]);
      if(JSON.stringify(await directoryManifest(this.root(plan.directory))) !== JSON.stringify(plan.snapshot)) throw new Error("STALE_MAP_PLAN: file content or entry list changed");
    };
    return this.workspace.binary.apply([plan.file],() => new Map([[plan.file,plan.next]]),{
      ...options,expectedSha256:{ ...options.expectedSha256,[plan.file]:plan.sourceSha256 },
      verify:async () => { await verify(); await options.verify?.(); },
    });
  }
  save(transactionId: string, options: Omit<ByteOptions,"stage"> = {}) { return this.workspace.binary.save(transactionId,options); }
  discard(transactionId: string, dryRun = true) { return this.workspace.binary.discard(transactionId,dryRun); }
  async inspectPacked(archive: string) { return inspectArchive(this.root(archive)); }
  async import(archive: string, directory: string, dryRun = true) {
    const source = this.root(archive), destination = this.root(directory);
    const manifest = await inspectArchive(source);
    try { await fs.lstat(destination); throw new Error("MAP_DESTINATION_EXISTS"); } catch(e) { if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if(dryRun) return { dryRun:true,archive,directory,manifest };
    return this.workspace.transactions.run(async () => extractArchive(source,destination));
  }
  private async snapshotCopy(directory: string, destination: string, files: DirectoryEntry[]) {
    const source = this.root(directory);
    await fs.mkdir(destination,{ recursive:true });
    for(const file of files) { await fs.mkdir(path.dirname(path.join(destination,file.file)),{ recursive:true }); await fs.copyFile(path.join(source,file.file),path.join(destination,file.file)); }
    const metadata = await readSnapshot(this.root(path.join(directory,archiveMetadataFile)));
    if(metadata.exists) await fs.writeFile(path.join(destination,archiveMetadataFile),metadata.bytes);
    if(JSON.stringify(await directoryManifest(destination)) !== JSON.stringify(files)) throw new Error("STALE_MAP_SNAPSHOT");
    return metadata;
  }
  async export(directory: string, archive: string, dryRun = true, backup = true) {
    const source = this.root(directory), target = this.root(archive);
    if(!/\.(SC2Map|SC2Mod)$/i.test(target)) throw new Error("INVALID_MAP_ARCHIVE_EXTENSION");
    // Root workspaces export into a reserved output tree excluded from components.
    const relative = path.relative(source,target).replaceAll("\\","/");
    if(relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative) && !relative.startsWith(".sc2mcp-output/")) throw new Error("MAP_EXPORT_INSIDE_COMPONENTS: use .sc2mcp-output/result.SC2Map or an output outside the map directory");
    this.assertNoDrafts(directory);
    const inspection = await this.inspect(directory);
    if(!inspection.valid) throw new Error("INVALID_MAP_FOUNDATION: " + JSON.stringify(inspection.issues));
    if(dryRun) return { dryRun:true,directory,archive,entryCount:inspection.files.length,validation:inspection.validationScope };
    return this.workspace.transactions.run(async () => {
      this.assertNoDrafts(directory);
      const staging = await fs.mkdtemp(path.join(os.tmpdir(),"sc2mcp-map-export-"));
      try {
        const meta = await this.snapshotCopy(directory,staging,inspection.files);
        const result = await packArchive(staging,target,{ backup,beforePublish:async () => {
          this.assertNoDrafts(directory);
          if(JSON.stringify(await directoryManifest(source)) !== JSON.stringify(inspection.files)) throw new Error("STALE_MAP_EXPORT");
          await assertSnapshots(file => file,new Map([[path.join(source,archiveMetadataFile),meta]]));
        } });
        return { ...result,componentDirectory:source,dryRun:false,validation:inspection.validationScope,editorValidation:"NOT_EXECUTED",runtimeValidation:"NOT_EXECUTED" };
      } finally { await fs.rm(staging,{ recursive:true,force:true }); }
    });
  }
  async clone(directory: string, destinationDirectory: string, dryRun = true) {
    const source = this.root(directory), target = this.root(destinationDirectory);
    const relative = path.relative(source,target);
    if(!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("MAP_CLONE_INSIDE_SOURCE");
    this.assertNoDrafts(directory);
    const inspection = await this.inspect(directory);
    if(!inspection.valid) throw new Error("INVALID_MAP_FOUNDATION");
    try { await fs.lstat(target); throw new Error("MAP_DESTINATION_EXISTS"); } catch(e) { if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if(dryRun) return { dryRun:true,directory,destinationDirectory,entryCount:inspection.files.length,cleanMap:false,scripts:"preserved",opaqueComponents:"preserved" };
    return this.workspace.transactions.run(async () => {
      await fs.mkdir(path.dirname(target),{ recursive:true });
      const temporary = await fs.mkdtemp(`${target}.sc2uimcp.`);
      try {
        const meta = await this.snapshotCopy(directory,temporary,inspection.files);
        this.assertNoDrafts(directory);
        if(JSON.stringify(await directoryManifest(source)) !== JSON.stringify(inspection.files)) throw new Error("STALE_MAP_CLONE");
        await assertSnapshots(file => file,new Map([[path.join(source,archiveMetadataFile),meta]]));
        try { await fs.lstat(target); throw new Error("MAP_DESTINATION_EXISTS"); } catch(e) { if((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        await fs.rename(temporary,target);
        return { dryRun:false,directory,destinationDirectory,entryCount:inspection.files.length,cleanMap:false,scripts:"preserved",opaqueComponents:"preserved" };
      } finally { await fs.rm(temporary,{ recursive:true,force:true }); }
    });
  }
}
