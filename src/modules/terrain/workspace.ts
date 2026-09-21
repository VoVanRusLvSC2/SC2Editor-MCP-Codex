import { LightingCatalog } from "./lighting.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { bytesHash, type ByteOptions } from "../../core/binaryTransactions.js";
import type { BrowseWorkspace } from "../browse/workspace.js";
import type { PlacementWorkspace } from "../placement/workspace.js";
import {
  PlacementDocument,
  componentListWithObjects,
} from "../placement/document.js";
import type {
  Point2,
  TerrainArea,
  TerrainIssue,
  TerrainPlanRequest,
  TerrainPlanSummary,
} from "./types.js";
import {
  applyOperations,
  parseState,
  TERRAIN_COMPONENTS,
  type TerrainState,
} from "./operations.js";
import {
  featureRecipe,
  generateRecipe,
  TERRAIN_STYLES,
  type FeatureArgs,
  type GenerateArgs,
} from "./recipes.js";
import { renderTerrainPng, type PreviewMode } from "./preview.js";
import {
  terrainPlanSchema,
  terrainGenerateSchema, terrainLandscapeSchema,
  terrainFeatureSchema,
} from "./schemas.js";
import { areaWeight } from "./geometry.js";
import { inspectNativeIntegrity } from "./nativeIntegrity.js";
interface StoredPlan {
  summary: TerrainPlanSummary;
  before: Map<string, Buffer>;
  next: Map<string, Buffer>;
  dependencyHashes: Record<string, string>;
  browseFingerprint?: string;
  waterDependencySnapshot?: string;
  applied?: boolean;
  transactionId?: string;
}
export class TerrainWorkspace {
  private plans = new Map<string, StoredPlan>();
  constructor(
    readonly workspace: Workspace,
    readonly browse?: BrowseWorkspace,
    readonly placement?: PlacementWorkspace,
  ) {}
  private file(directory: string, name: string): string {
    return this.workspace.binary.key(path.join(directory, name));
  }
  private async load(directory = "") {
    const sources = new Map<string, Buffer>();
    const sourceSha256: Record<string, string> = {},
      diskSha256: Record<string, string> = {};
    for (const name of TERRAIN_COMPONENTS) {
      const file = this.file(directory, name),
        raw = await this.workspace.binary.read(file),
        disk = await this.workspace.binary.read(file, false);
      sources.set(name, raw.bytes);
      sourceSha256[file] = bytesHash(raw.bytes);
      diskSha256[file] = bytesHash(disk.bytes);
    }
    return { sources, sourceSha256, diskSha256 };
  }
  async state(directory = "", planId?: string): Promise<TerrainState> {
    if (planId) {
      const plan = await this.checked(planId);
      return parseState(new Map(TERRAIN_COMPONENTS.map(name => [name,Buffer.from(plan.next.get(this.file(plan.summary.directory,name)) ?? Buffer.alloc(0))])));
    }
    return parseState((await this.load(directory)).sources);
  }
  async inspect(directory = "") {
    const data = await this.load(directory);
    const components = [...data.sources].map(([name, bytes]) => ({
      name,
      file: this.file(directory, name),
      exists: bytes.length > 0,
      bytes: bytes.length,
      sha256: bytesHash(bytes),
    }));
    try {
      const state = parseState(data.sources),
        d = state.descriptor;
      return {
        directory,
        components,
        version: d.version,
        dimensions: {
          vertices: [d.width, d.height],
          cells: [d.width - 1, d.height - 1],
        },
        bounds: {
          minX: d.offset[0],
          minY: d.offset[1],
          maxX: d.offset[0] + (d.width - 1) * d.scale[0],
          maxY: d.offset[1] + (d.height - 1) * d.scale[1],
        },
        tileSet: d.heightMap.attrs.tileSet,
        transform: { offset: d.offset, scale: d.scale },
        quantization: { bias: d.quantizeBias, scale: d.quantizeScale },
        textures: d.textures,
        tileSets: d.tileSets,
        cliffSets: d.cliffSets,
        ramps: d.ramps.length,
        water: state.water?.list(),
        waterMaterials: state.waterCatalog?.list(),
        nativeIntegrity: inspectNativeIntegrity(data.sources, d.width - 1, d.height - 1),
        capabilities: this.support(state),
        nativeEditorVerified: false,
      };
    } catch (error) {
      return {
        directory,
        components,
        capabilities: { read: false, write: false },
        error: (error as Error).message,
        nativeEditorVerified: false,
      };
    }
  }
  private support(state: TerrainState) {
    return {
      read: true,
      heightBrush:
        !!state.sync &&
        state.descriptor.scale.every((v) => v === 1) &&
        [114, 115].includes(state.descriptor.version),
      textureBrush:
        !!state.masks &&
        !!state.syncTextures &&
        state.descriptor.scale.every((v) => v === 1) &&
        [114, 115].includes(state.descriptor.version),
      paletteUpdate: !!state.syncTextures,
      waterTableRead: state.water?.simple ?? false,
      waterEntries: state.water?.coverageKnown ?? false,
      waterBodyEditing: false,
      flatWaterRectangleEditing: state.water?.coverageKnown ?? false,
      waterMaterialEditing: true,
      lightingPresetAssignment: true,
      lightingAmbientHDRDirectionalEditing: true,
      lightingCycleEditing: true,
      engineLightingPreview: false,
      waterCoverageKnown: state.water?.coverageKnown ?? false,
      proceduralStyles: Object.keys(TERRAIN_STYLES),
      wholeMapStamp: true,
      structuralCliffEditing: false,
      nativeRampEditing: false,
      pathingPainting: false,
      arbitraryWaterLevel: true,
      vertexColorPainting: false,
      syncStrategy:
        "preserve native residuals + quantized delta; dominant texture rule",
      editorOracle: "not run",
      runtimePathingProof: "unavailable",
    };
  }
  async capabilities(directory = "") {
    const inspected = await this.inspect(directory);
    return {
      directory,
      ...inspected.capabilities,
      reason:
        "Structural writers and pathing flag semantics require additional native evidence; no guessed binary records are emitted.",
    };
  }
  async inspectComponents(directory = "") {
    const data = await this.load(directory), state = parseState(data.sources);
    return inspectNativeIntegrity(data.sources, state.descriptor.width - 1, state.descriptor.height - 1);
  }
  /** One immutable operation snapshot; repeated sampling performs no file reads or XML parses. */
  async surface(directory = "", planId?: string) {
    const loaded = planId ? undefined : await this.load(directory);
    const s = loaded
      ? parseState(loaded.sources)
      : await this.state(directory, planId);
    const textureIds = new Map(
      s.descriptor.textures.map((t) => [t.slot, t.id]),
    );
    const protection = new Uint8Array(s.heights.width * s.heights.height);
    const sampleGround = (p: Point2) => {
      const sample = s.heights.sample(p),
        gx = (p.x - s.descriptor.offset[0]) / s.descriptor.scale[0],
        gy = (p.y - s.descriptor.offset[1]) / s.descriptor.scale[1];
      const x = Math.round(gx),
        y = Math.round(gy),
        i = y * s.heights.width + x;
      if (!protection[i]) protection[i] = s.heights.protected(x, y) ? 2 : 1;
      return {
        ...p,
        ...sample,
        protected: protection[i] === 2,
        textures: undefined as
          | Array<{ id: string; weight: number }>
          | undefined,
        water: s.water?.coverageKnown ? s.water.at(p) : undefined,
        heightEvidence:
          "reference-supported dequantization; native geometry sampling unverified",
        pathing: "unknown",
      };
    };
    return {
      sourceSha256: loaded?.sourceSha256,
      diskSha256: loaded?.diskSha256,
      bounds: {
        minX: s.descriptor.offset[0],
        minY: s.descriptor.offset[1],
        maxX:
          s.descriptor.offset[0] +
          (s.heights.width - 1) * s.descriptor.scale[0],
        maxY:
          s.descriptor.offset[1] +
          (s.heights.height - 1) * s.descriptor.scale[1],
      },
      waterCoverageKnown: s.water?.coverageKnown ?? false,
      texturesKnown: !!s.masks,
      sampleGround,
      sample: (p: Point2) => {
        const gx = (p.x - s.descriptor.offset[0]) / s.descriptor.scale[0],
          gy = (p.y - s.descriptor.offset[1]) / s.descriptor.scale[1];
        const point = sampleGround(p),
          px = s.masks ? Math.min(s.masks.width - 1, Math.floor(gx * 8)) : 0,
          py = s.masks ? Math.min(s.masks.height - 1, Math.floor(gy * 8)) : 0,
          set = s.descriptor.blockSet(
            Math.min(s.heights.width - 1 - 1e-9, gx),
            Math.min(s.heights.height - 1 - 1e-9, gy),
          );
        return {
          ...point,
          textures: s.masks
            ?.weights(px, py)
            .map((weight, layer) => ({
              id: textureIds.get(set * 8 + layer) ?? "",
              weight,
            }))
            .filter((t) => t.weight > 0),
        };
      },
    };
  }

  async sample(points: Point2[], directory = "", planId?: string) {
    const surface = await this.surface(directory, planId);
    return {
      sourceSha256: surface.sourceSha256,
      diskSha256: surface.diskSha256,
      samples: points.map(surface.sample),
    };
  }
  async analyze(directory = "", area?: TerrainArea, planId?: string) {
    const s = await this.state(directory, planId);
    let min = Infinity,
      max = -Infinity,
      sum = 0,
      maxSlope = 0,
      count = 0,
      protectedVertices = 0;
    for (let y = 0; y < s.heights.height; y++)
      for (let x = 0; x < s.heights.width; x++) {
        const p = s.heights.point(x, y);
        if (area && areaWeight(area, p) === 0) continue;
        const z = s.heights.z(x, y);
        min = Math.min(min, z);
        max = Math.max(max, z);
        sum += z;
        count++;
        if (s.heights.protected(x, y)) protectedVertices++;
        if (x < s.heights.width - 1 && y < s.heights.height - 1)
          maxSlope = Math.max(maxSlope, s.heights.sample(p).slope);
      }
    return {
      count,
      height: count ? { min, max, mean: sum / count } : null,
      maxSlope,
      protectedVertices,
      pathing: "unavailable",
      water: s.water?.list(),
    };
  }
  async palette(directory = "") {
    const s = await this.state(directory);
    return {
      textures: s.descriptor.textures,
      tileSets: s.descriptor.tileSets,
      cliffSets: s.descriptor.cliffSets,
      blockTextureSets: s.descriptor.parsed.nodes
        .filter((n) => n.tag === "blockTextureSet")
        .map((n) => n.attrs),
    };
  }
  styles() {
    return {
      styles: TERRAIN_STYLES,
      notes: [
        "Style recipes generate relief and use existing active-palette textures; they do not invent assets.",
        "Vegetation/buildings are delegated to placement.createLocation with terrain snapping.",
      ],
    };
  }
  async assets(
    query = "",
    kind: "texture" | "tileset" | "cliff" | "water" | "lighting" = "texture",
  ) {
    if (!this.browse) throw new Error("BROWSE_CONTEXT_UNAVAILABLE");
    const catalogType =
      kind === "texture"
        ? "TerrainTex"
        : kind === "cliff"
          ? "Cliff"
          : kind === "lighting" ? "Light" : kind === "water"
            ? "Water"
            : "Terrain";
    return this.browse.search({ query, catalogType, limit: 50 });
  }
  private async readyTexture(id: string, current: TerrainState) {
    if (current.descriptor.textures.some((t) => t.id === id)) return;
    if (!this.browse) throw new Error(`TEXTURE_NOT_RESOLVED: ${id}`);
    const result = await this.browse
      .resolve({ id, catalogType: "TerrainTex" })
      .catch(() => ({ resolved: false, dependencyReady: false }));
    if (!result.resolved || !result.dependencyReady)
      throw new Error(`TEXTURE_DEPENDENCY_UNAVAILABLE: ${id}`);
  }
  private async waterDependencySnapshot(directory: string) {
    if (!this.browse) return undefined;
    const owned = new Set(TERRAIN_COMPONENTS.map(n => path.resolve(this.workspace.root,this.file(directory,n))));
    const files = (await this.browse.index(true)).files.filter(f => !owned.has(path.resolve(f.path)));
    const records = [];
    for(const file of files) {
      const disk = bytesHash(await fs.readFile(file.path));
      const key = path.relative(this.workspace.root,file.path).split(path.sep).join("/");
      const draft = file.sourceLayer === "workspace" && this.workspace.hasDraft(key) ? (await this.workspace.diff(key)).afterSha256 : undefined;
      records.push({file:file.path,disk,draft});
    }
    return bytesHash(Buffer.from(JSON.stringify(records)));
  }
  private async readyWater(id: string, state: TerrainState, ready: Set<string>, visiting = new Set<string>()) {
    if (ready.has(id)) return;
    if(visiting.has(id)) throw new Error(`WATER_TEMPLATE_PARENT_CYCLE: ${id}`);
    const local = state.waterCatalog?.list().find(w => w.id === id);
    if(local) {
      visiting.add(id);
      if(local.parent) await this.readyWater(local.parent,state,ready,visiting);
      visiting.delete(id); ready.add(id); return;
    }
    if (state.water?.list().entries.some(w => w.template === id)) { ready.add(id); return; }
    const resolved = await this.browse?.resolve({id,catalogType:"Water"}).catch(() => undefined);
    if (!resolved?.resolved || !resolved.dependencyReady) throw new Error(`WATER_DEPENDENCY_UNAVAILABLE: ${id}`);
    ready.add(id);
  }
  async plan(request: TerrainPlanRequest): Promise<TerrainPlanSummary> {
    request = terrainPlanSchema.parse(request) as TerrainPlanRequest;
    if (!request.operations.length || request.operations.length > 100)
      throw new Error("Terrain plan requires 1..100 operations");
    const directory = request.directory ?? "",
      data = await this.load(directory);
    const before = new Map(
      [...data.sources].map(([n, b]) => [
        this.file(directory, n),
        Buffer.from(b),
      ]),
    );
    let sources: Map<string, Buffer> = new Map(
      [...data.sources].map(([n, b]) => [n, Buffer.from(b)]),
    );
    const initial = parseState(sources);
    const integrity = inspectNativeIntegrity(sources, initial.descriptor.width - 1, initial.descriptor.height - 1);
    if (!integrity.valid) throw new Error("INVALID_TERRAIN_NATIVE_COMPONENTS: " + JSON.stringify(integrity.issues));
    if (
      !request.operations.every((op) => op.op === "stamp.apply") &&
      initial.descriptor.scale.some((v) => v !== 1)
    )
      throw new Error("NONUNIT_TERRAIN_WRITE_TRANSFORM_UNVERIFIED");
    if (![114, 115].includes(initial.descriptor.version))
      throw new Error(
        `TERRAIN_XML_WRITER_VERSION_UNSUPPORTED: ${initial.descriptor.version}`,
      );
    const dependencyHashes: Record<string, string> = {};
    let issues: TerrainIssue[] = [];
    let result = { changedVertices: 0, changedTexturePixels: 0 };
    const stamps = request.operations.filter((o) => o.op === "stamp.apply");
    if (stamps.length) {
      if (request.operations.length !== 1)
        throw new Error("WHOLE_MAP_STAMP_MUST_BE_STANDALONE");
      const op = stamps[0] as Extract<
        (typeof request.operations)[number],
        { op: "stamp.apply" }
      >;
      const donor = await this.load(op.donorDirectory);
      const donorState = parseState(donor.sources);
      if (![114, 115].includes(donorState.descriptor.version))
        throw new Error("STAMP_TERRAIN_XML_VERSION_UNSUPPORTED");
      if (
        initial.descriptor.width !== donorState.descriptor.width ||
        initial.descriptor.height !== donorState.descriptor.height ||
        JSON.stringify(initial.descriptor.offset) !==
          JSON.stringify(donorState.descriptor.offset) ||
        JSON.stringify(initial.descriptor.scale) !==
          JSON.stringify(donorState.descriptor.scale)
      )
        throw new Error("STAMP_DIMENSIONS_OR_TRANSFORM_MISMATCH");
      if (
        initial.descriptor.heightMap.attrs.tileSet !==
          donorState.descriptor.heightMap.attrs.tileSet ||
        JSON.stringify(initial.descriptor.tileSets) !==
          JSON.stringify(donorState.descriptor.tileSets) ||
        JSON.stringify(initial.descriptor.cliffSets) !==
          JSON.stringify(donorState.descriptor.cliffSets)
      )
        throw new Error("STAMP_TILESET_OR_CLIFF_DEPENDENCY_UNVERIFIED");
      const authoringFiles = ["Base.SC2Data/GameData/LightData.xml","Base.SC2Data/GameData/TerrainData.xml","Base.SC2Data/GameData/WaterData.xml","Base.SC2Data/GameData.xml","ComponentList.SC2Components"];
      for (const [name, bytes] of donor.sources) {
        if(authoringFiles.includes(name)) continue;
        if (!bytes.length && sources.get(name)?.length)
          throw new Error(`STAMP_COMPONENT_REMOVAL_UNSUPPORTED: ${name}`);
        dependencyHashes[this.file(op.donorDirectory, name)] =
          donor.sourceSha256[this.file(op.donorDirectory, name)];
      }
      for (const t of donorState.descriptor.textures.filter((t) => t.id))
        await this.readyTexture(t.id, initial);
      for (const donorWater of donorState.water?.list().entries ?? [])
        if (
          !initial.water
            ?.list()
            .entries.some((w) => w.template === donorWater.template)
        )
          throw new Error(
            `STAMP_WATER_DEPENDENCY_UNVERIFIED: ${donorWater.template}`,
          );
      sources = new Map([...donor.sources,...authoringFiles.map(name => [name,data.sources.get(name)!] as [string,Buffer])]);
      issues.push({
        severity: "warning",
        code: "WHOLE_MAP_STAMP",
        message:
          "Replaces the entire terrain bundle; existing Objects and triggers are preserved and may require repositioning.",
      });
    } else {
      // Resolve new palette assets before the isolated transformation.
      for (const op of request.operations)
        if (op.op === "palette.update")
          for (const r of op.replacements)
            await this.readyTexture(r.texture, initial);
      const lightReady=new Set<string>();
      const lightSource=initial.sources.get("Base.SC2Data/GameData/LightData.xml");
      const lights=request.operations.some(o=>o.op.startsWith("lighting.")) ? new LightingCatalog(lightSource?.length ? lightSource.toString("utf8") : "<Catalog/>","CLight") : undefined;
      const resolveLight=async (id:string,visiting=new Set<string>()):Promise<void> => {
        if(lightReady.has(id))return;
        if(visiting.has(id))throw new Error(`LIGHTING_PARENT_CYCLE: ${id}`);
        const local=lights?.list().find(l=>l.id===id);
        if(local){visiting.add(id);if(local.parent)await resolveLight(local.parent,visiting);visiting.delete(id);}
        else {const resolved=await this.browse?.resolve({id,catalogType:"Light"}).catch(()=>undefined);if(!resolved?.resolved || !resolved.dependencyReady)throw new Error(`LIGHTING_DEPENDENCY_UNAVAILABLE: ${id}`);}
        lightReady.add(id);
      };
      for(const op of request.operations) {
        if(op.op === "lighting.preset") {await resolveLight(op.parent ?? op.id);lightReady.add(op.id);}
        if(op.op === "lighting.assign") await resolveLight(op.id);
      }
      const ready = new Set<string>();
      for (const op of request.operations) {
        if (op.op === "water.material") {
          if(op.parent) await this.readyWater(op.parent,initial,ready);
          else await this.readyWater(op.id,initial,ready);
          ready.add(op.id);
        } else if((op.op === "water.create" || op.op === "water.update") && op.template) await this.readyWater(op.template,initial,ready);
      }
      const applied = applyOperations(
        parseState(sources),
        request.operations,
        request.maxSlope,
      );
      issues = applied.issues;
      result = applied;
    }
    const waterDependencies = request.operations.some(op => op.op.startsWith("water.") || op.op.startsWith("lighting.")) ? await this.waterDependencySnapshot(directory) : undefined;
    const next = new Map(
      [...sources].map(([n, b]) => [this.file(directory, n), Buffer.from(b)]),
    );
    const summary = this.remember(
      directory,
      request.operations,
      before,
      next,
      data.sourceSha256,
      data.diskSha256,
      dependencyHashes,
      issues,
      result.changedVertices,
      result.changedTexturePixels,
    );
    if (
      this.browse &&
      !request.operations.some(op => op.op === "water.material") && request.operations.some(
        (op) => op.op === "palette.update" || op.op === "stamp.apply",
      )
    )
      this.plans.get(summary.id)!.browseFingerprint = (
        await this.browse.index()
      ).fingerprint;
    this.plans.get(summary.id)!.waterDependencySnapshot = waterDependencies;
    return summary;
  }
  private remember(
    directory: string,
    operations: TerrainPlanSummary["operations"],
    before: Map<string, Buffer>,
    next: Map<string, Buffer>,
    sourceSha256: Record<string, string>,
    diskSha256: Record<string, string>,
    dependencyHashes: Record<string, string>,
    issues: TerrainIssue[],
    changedVertices: number,
    changedTexturePixels: number,
  ): TerrainPlanSummary {
    const files = [...next].map(([file, bytes]) => {
      const old = before.get(file) ?? Buffer.alloc(0);
      let changedBytes = Math.abs(old.length - bytes.length);
      for (let i = 0; i < Math.min(old.length, bytes.length); i++)
        if (old[i] !== bytes[i]) changedBytes++;
      return {
        file,
        beforeSha256: bytesHash(old),
        afterSha256: bytesHash(bytes),
        changedBytes,
        beforeBytes: old.length,
        afterBytes: bytes.length,
      };
    });
    const id = `terrain_${bytesHash(Buffer.from(JSON.stringify({ directory, operations, sourceSha256, after: files.map((f) => f.afterSha256) }))).slice(0, 24)}`;
    const summary: TerrainPlanSummary = {
      id,
      directory,
      operations,
      files,
      issues,
      valid: !issues.some((i) => i.severity === "error"),
      changedVertices,
      changedTexturePixels,
      sourceSha256,
      diskSha256,
      evidence: [
        "OBSERVED_REAL_MAP_COMPONENTS",
        "EXE_STRING_EVIDENCE",
        "REFERENCE_SUPPORTED_WRITERS",
      ],
      nativeEditorVerified: false,
    };
    if (!this.plans.has(id))
      this.plans.set(id, { summary, before, next, dependencyHashes });
    while (this.plans.size > 8)
      this.plans.delete(this.plans.keys().next().value!);
    return this.plans.get(id)!.summary;
  }
  private async checked(id: string) {
    const p = this.plans.get(id);
    if (!p) throw new Error(`TERRAIN_PLAN_NOT_FOUND: ${id}`);
    if (p.applied) return p;
    if(p.waterDependencySnapshot && await this.waterDependencySnapshot(p.summary.directory) !== p.waterDependencySnapshot) throw new Error("STALE_WATER_DEPENDENCIES");
    if (
      p.browseFingerprint &&
      this.browse &&
      (await this.browse.index()).fingerprint !== p.browseFingerprint
    )
      throw new Error("STALE_TERRAIN_ASSET_INDEX");
    for (const [file, expected] of Object.entries(p.summary.sourceSha256))
      if (
        bytesHash((await this.workspace.binary.read(file)).bytes) !== expected
      )
        throw new Error(`STALE_TERRAIN_PLAN: ${file}`);
    for (const [file, expected] of Object.entries(p.summary.diskSha256))
      if (
        bytesHash((await this.workspace.binary.read(file, false)).bytes) !==
        expected
      )
        throw new Error(`STALE_TERRAIN_PLAN: ${file}`);
    for (const [file, expected] of Object.entries(p.dependencyHashes))
      if (
        bytesHash((await this.workspace.binary.read(file)).bytes) !== expected
      )
        throw new Error(`STALE_TERRAIN_DONOR: ${file}`);
    return p;
  }
  async preview(
    id?: string,
    directory = "",
    mode: PreviewMode = "height",
    size = 128,
  ) {
    const p = id ? await this.checked(id) : undefined;
    const s = await this.state(directory, id);
    const image = renderTerrainPng(s, mode, size);
    return {
      plan: p?.summary,
      mode,
      orientation: "north up; positive Y",
      imageMimeType: "image/png",
      imageBase64: image.toString("base64"),
      legend:
        mode === "texture"
          ? s.descriptor.textures.filter((t) => t.id)
          : undefined,
      notice:
        "Diagnostic terrain preview; this does not render SC2 materials or models.",
    };
  }
  async validate(id?: string, directory = "") {
    if (id) {
      const p = await this.checked(id);
      return {
        valid: p.summary.valid,
        issues: p.summary.issues,
        sourceHashes: "pass",
        serialization: "supported formats reparsed",
        editor: "not run",
        runtime: "not run",
      };
    }
    const inspection = await this.inspect(directory);
    return {
      valid: !("error" in inspection) && !!inspection.nativeIntegrity?.valid,
      inspection,
      editor: "not run",
      runtime: "not run",
    };
  }
  async apply(id: string, options: ByteOptions = {}) {
    const p = await this.checked(id);
    if (p.applied)
      return {
        accepted: true,
        alreadyApplied: true,
        planId: id,
        transactionId: p.transactionId,
      };
    if (!p.summary.valid)
      return { accepted: false, planId: id, issues: p.summary.issues };
    const transaction = await this.workspace.binary.apply(
      [...p.next.keys()],
      (sources) => {
        for (const [file, bytes] of sources)
          if (bytesHash(bytes) !== p.summary.sourceSha256[file])
            throw new Error(`STALE_TERRAIN_PLAN: ${file}`);
        return new Map([...p.next].map(([f, b]) => [f, Buffer.from(b)]));
      },
      {
        ...options,
        expectedSha256: { ...options.expectedSha256, ...p.summary.diskSha256 },
        verify: async () => {
          await options.verify?.();
          if(p.waterDependencySnapshot && await this.waterDependencySnapshot(p.summary.directory) !== p.waterDependencySnapshot) throw new Error("STALE_WATER_DEPENDENCIES");
          for(const [file,hash] of Object.entries(p.dependencyHashes))
            if(bytesHash((await this.workspace.binary.read(file)).bytes) !== hash) throw new Error(`STALE_TERRAIN_DONOR: ${file}`);
        },
      },
    );
    if (!(options.dryRun ?? true)) {
      p.applied = true;
      p.transactionId = transaction.transactionId;
    }
    return {
      accepted: true,
      planId: id,
      transaction,
      issues: p.summary.issues,
    };
  }
  async save(transactionId: string, options: Omit<ByteOptions, "stage"> = {}) {
    return this.workspace.binary.save(transactionId, options);
  }
  async rollback(transactionId: string, dryRun = true) {
    const result = await this.workspace.binary.rollback(transactionId, dryRun);
    if ("discarded" in result && result.discarded)
      for (const p of this.plans.values())
        if (p.transactionId === transactionId) {
          p.applied = false;
          p.transactionId = undefined;
        }
    return result;
  }
  async lighting(directory="") {
    const state=await this.state(directory);
    const read=(file:string,tag:"CLight"|"CTerrain")=>new LightingCatalog(state.sources.get(`Base.SC2Data/GameData/${file}`)?.toString("utf8") || "<Catalog/>",tag).list();
    const tileSet=state.descriptor.heightMap.attrs.tileSet;
    return {tileSet,localBinding:read("TerrainData.xml","CTerrain").find(t=>t.id===tileSet),presets:read("LightData.xml","CLight"),dependencyBinding:await this.browse?.resolve({id:tileSet,catalogType:"Terrain"}).catch(()=>undefined),editorVerified:false};
  }
  async landscape(args: Omit<GenerateArgs,"area"> & {area?:GenerateArgs["area"];lighting?:string}) {
    args=terrainLandscapeSchema.parse(args);
    const {lighting,...options}=args;
    const state=await this.state(args.directory);
    const d=state.descriptor;
    const generate={...options,area:options.area ?? {type:"rectangle" as const,minX:d.offset[0],minY:d.offset[1],maxX:d.offset[0]+(d.width-1)*d.scale[0],maxY:d.offset[1]+(d.height-1)*d.scale[1]}};
    return this.plan({directory:generate.directory,operations:[...this.generateOperations(generate,state),...(lighting ? [{op:"lighting.assign" as const,id:lighting}] : [])]});
  }
  async generate(args: GenerateArgs) {
    args = terrainGenerateSchema.parse(args);
    const s = await this.state(args.directory);
    return this.plan({directory:args.directory,operations:this.generateOperations(args,s)});
  }
  private generateOperations(args:GenerateArgs,s:TerrainState) {
    let texture = args.materials?.base;
    const style = TERRAIN_STYLES[args.style];
    if (!texture)
      texture = s.descriptor.textures.find(
        (t) =>
          t.id && style.terms.some((term) => t.id.toLowerCase().includes(term)),
      )?.id;
    if (!texture)
      throw new Error(
        `STYLE_MATERIAL_UNRESOLVED: ${args.style}; use terrain.assets and palette.update, or supply an existing materials.base texture`,
      );
    return generateRecipe(args, texture);
  }
  async feature(name: string, args: FeatureArgs) {
    args = terrainFeatureSchema.parse(args);
    return this.plan({
      directory: args.directory,
      operations: featureRecipe(name, args),
    });
  }
  async createLocation(
    args: Parameters<PlacementWorkspace["createLocation"]>[0] & {
      terrain: Omit<GenerateArgs, "area">;
      maxSlope?: number;
    },
  ) {
    if (!this.placement) throw new Error("PLACEMENT_CONTEXT_UNAVAILABLE");
    const placementArea = args.area;
    const area: TerrainArea =
      placementArea.type === "circle"
        ? {
            type: "circle",
            center: { x: placementArea.center.x, y: placementArea.center.y },
            radius: placementArea.radius,
          }
        : {
            type: "rectangle",
            minX: placementArea.minX,
            minY: placementArea.minY,
            maxX: placementArea.maxX,
            maxY: placementArea.maxY,
          };
    const terrainPlan = await this.generate({
      ...args.terrain,
      area,
      seed: args.seed ?? args.terrain.seed,
    });
    const stored = await this.checked(terrainPlan.id);
    const state = await this.state("", terrainPlan.id);
    const placed = await this.placement.createLocation(args);
    const preview = await this.placement.preview(placed.plan.id);
    if (!preview.validation.valid)
      throw new Error("LOCATION_PLACEMENT_VALIDATION_FAILED");
    const objectFile = placed.plan.objectFile,
      componentFile = placed.plan.componentListFile;
    const raw = await this.workspace.readRaw(objectFile),
      component = await this.workspace.readRaw(componentFile);
    const document = raw.text
      ? new PlacementDocument(raw.text, objectFile)
      : PlacementDocument.create(objectFile);
    const operations = placed.plan.operations.map((op) => {
      if (op.op !== "add") return op;
      const sample = state.heights.sample(op.object.position);
      if (
        sample.mask === 0 ||
        (args.maxSlope !== undefined && sample.slope > args.maxSlope)
      )
        throw new Error(
          "LOCATION_OBJECT_ON_HOLE_OR_EXCESSIVE_SLOPE: adjust exclusions or seed",
        );
      return {
        ...op,
        object: {
          ...op.object,
          position: { ...op.object.position, z: sample.height },
          ...(op.object.kind === "Doodad"
            ? { flags: { ...op.object.flags, HeightAbsolute: "1" } }
            : {}),
        },
      };
    });
    document.apply(operations);
    if (document.validate().some((i) => i.severity === "error"))
      throw new Error("LOCATION_OBJECT_SERIALIZATION_FAILED");
    const before = new Map(stored.before),
      next = new Map(stored.next),
      sourceSha256 = { ...stored.summary.sourceSha256 },
      diskSha256 = { ...stored.summary.diskSha256 };
    for (const [file, bytes] of [
      [objectFile, Buffer.from(raw.text)],
      [componentFile, Buffer.from(component.text)],
    ] as Array<[string, Buffer]>) {
      const key = this.workspace.binary.key(file);
      if (next.has(key) && !next.get(key)!.equals(bytes)) throw new Error("LOCATION_COMPONENT_FILE_CONFLICT");
      before.set(key, bytes);
      sourceSha256[key] = bytesHash(bytes);
      diskSha256[key] = bytesHash(
        (await this.workspace.binary.read(key, false)).bytes,
      );
    }
    next.set(
      this.workspace.binary.key(objectFile),
      Buffer.from(document.source),
    );
    next.set(
      this.workspace.binary.key(componentFile),
      Buffer.from(componentListWithObjects(component.text)),
    );
    const issues = [
      ...stored.summary.issues,
      {
        severity: "warning" as const,
        code: "PLACEMENT_PATHING_UNVERIFIED",
        message:
          "Objects are snapped to sampled ground; model footprints, native pathing and runtime collisions remain unverified.",
      },
    ];
    const summary = this.remember(
      stored.summary.directory,
      stored.summary.operations,
      before,
      next,
      sourceSha256,
      diskSha256,
      stored.dependencyHashes,
      issues,
      stored.summary.changedVertices,
      stored.summary.changedTexturePixels,
    );
    if (this.browse)
      this.plans.get(summary.id)!.browseFingerprint = (
        await this.browse.index()
      ).fingerprint;
    return {
      plan: summary,
      objects: operations.length,
      composition: placed.composition,
      atomicComponents: "terrain + Objects + ComponentList",
      groundSnapping: true,
    };
  }
}
