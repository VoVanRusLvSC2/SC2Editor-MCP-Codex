import {landscapeZonePlanSchema,landscapeInspectSchema,editLandscapeZone,inspectLandscapeState} from './landscapeEditing.js';
import type {LightingWorkspace,LightingResolveOptions} from '../lighting/workspace.js';
import {resolveGlobalLighting} from '../lighting/catalog.js';
import { LightingCatalog } from "./lighting.js";

import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { bytesHash, type ByteOptions } from "../../core/binaryTransactions.js";
import type { BrowseWorkspace } from "../browse/workspace.js";
import type { PlacementWorkspace } from "../placement/workspace.js";
import type {LocationRoute} from '../placement/types.js';
import type {PlacementPlan,PlacementMutation,ExclusionZone} from '../placement/types.js';
import {measuredObjects} from '../placement/measuredGroups.js';
import {checkGroupClearance} from '../placement/groupClearance.js';
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
  TerrainVisibilityRequest,
} from "./types.js";
import {
  applyOperations,
  parseState,
  TERRAIN_COMPONENTS,
  type TerrainState,
  type TerrainTouches,
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
  terrainGenerateSchema, terrainLandscapeSchema, terrainVisibilitySchema,terrainLocationSchema,
  terrainFeatureSchema,
} from "./schemas.js";
import { areaWeight,areaDistance,areaBounds,corridorWithinArea } from "./geometry.js";
import { inspectNativeIntegrity } from "./nativeIntegrity.js";
import {inspectTerrainLoadContract} from './loadContract.js';
import {modkitAvailable} from '../../integrations/modkit/runtime.js';
import {landscapeIntentSchema,landscapeStateSchema,landscapeOrder,landscapeClosure,landscapeAncestors,landscapeHash,landscapeContext,objectFingerprints,restoreLandscapePatch,LandscapeTouches,LANDSCAPE_RECIPE_REVISION,type LandscapeState} from './landscapeOwnership.js';
import {prepareNativeGeometryFoundation} from './nativeGeometry.js';
import {restoreTopologyPatch,topologyConflicts} from './nativeTopologyOwnership.js';
import {resolveLandscapeRouteSource,mergeRouteReservations,addedRouteReservations,ownedReservationConflicts} from './landscapeRouteSource.js';
import {resolveLandscapePadSource,padReservationAreas,addedPadReservations} from './landscapePadSource.js';
import type * as z from 'zod/v4';
interface StoredPlan {
  summary: TerrainPlanSummary;
  before: Map<string, Buffer>;
  next: Map<string, Buffer>;
  dependencyHashes: Record<string, string>;
  browseFingerprint?: string;
  waterDependencySnapshot?: string;
  routeSourceSnapshot?: {file:string;sha256:string};
  padSourceSnapshot?: {file:string;sha256:string};
  applied?: boolean;
  transactionId?: string;
}
export class TerrainWorkspace {
  private plans = new Map<string, StoredPlan>();
  constructor(
    readonly workspace: Workspace,
    readonly browse?: BrowseWorkspace,
    readonly placement?: PlacementWorkspace,
    readonly globalLighting?: LightingWorkspace,
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
        {current:raw,disk} = await this.workspace.binary.readPair(file);
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
        surfaceVisibility: state.visibility?.inspect(),
        waterMaterials: state.waterCatalog?.list(),
        nativeIntegrity: inspectNativeIntegrity(data.sources, d.width - 1, d.height - 1),
        nativeLoad: inspectTerrainLoadContract(data.sources),
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
      hideTerrain: !!state.visibility && state.descriptor.scale.every(v => v === 1) && [114, 115].includes(state.descriptor.version),
      showTerrain: !!state.visibility && state.descriptor.scale.every(v => v === 1) && [114, 115].includes(state.descriptor.version),
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
      structuralCliffEditing: state.descriptor.version===115 && !!state.sync && !!state.visibility,
      nativeGeometryProfile: "v115 identity; rectangular two-cell lattice; nonflat cliff joins between adjacent levels 1..3, including measured low-HMAP/high-SMAP saddle centers; multi-level and void joins rejected; cardinal width-4 ramps",
      nativeRampEditing: state.descriptor.version===115 && !!state.sync && !!state.visibility,
      nativeSyncLevelLabels: 'SMAP low-byte levels follow HMAP; saddle height correction is independent; upper SMAP bits are preserved',
      pathingPainting: modkitAvailable()&&!!state.sources.get('CellAttribute_Pnp')?.length,
      modkitTerrainToolsAvailable:modkitAvailable(),
      pathingPaintingTool:'terrain.pathing.paint/fill; native CellAttribute masks; missing headers need an explicit template',
      nativeScalarColorEditingTool:'terrain.modkit.plan vertexColor.set; existing stroke bytes, not arbitrary RGBA',
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
        "Writers are format-specific. ModKit adds native CellAttribute masks, scalar color/fluff/road records and template ramps through terrain.modkit tools. Engine navigation acceptance remains separate.",
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
      if (!protection[i]) protection[i] = (s.heights.protected(x, y) || s.visibility?.touchesHiddenVertex(x, y)) ? 2 : 1;
      return {
        ...p,
        ...sample,
        hidden: s.visibility?.atGrid(gx, gy) ?? false,
        nativeMeshHole: !!((s.visibility?.raw(Math.max(0,Math.min(s.heights.width-2,Math.floor(gx))),Math.max(0,Math.min(s.heights.height-2,Math.floor(gy))))??0) & 1),
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
      protectedVertices = 0,
      editableVertices = 0,
      commonMin = -Infinity,
      commonMax = Infinity;
    for (let y = 0; y < s.heights.height; y++)
      for (let x = 0; x < s.heights.width; x++) {
        const p = s.heights.point(x, y);
        if (area && areaWeight(area, p) === 0) continue;
        const z = s.heights.z(x, y);
        min = Math.min(min, z);
        max = Math.max(max, z);
        sum += z;
        count++;
        if (s.heights.protected(x, y) || s.visibility?.touchesHiddenVertex(x, y)) protectedVertices++;
        else {
          const range = s.heights.editableRange(x, y);
          commonMin = Math.max(commonMin, range.min);
          commonMax = Math.min(commonMax, range.max);
          editableVertices++;
        }
        if (x < s.heights.width - 1 && y < s.heights.height - 1)
          maxSlope = Math.max(maxSlope, s.heights.sample(p).slope);
      }
    return {
      count,
      height: count ? { min, max, mean: sum / count } : null,
      maxSlope,
      protectedVertices,
      heightEditing: {
        editableVertices,
        commonRange: editableVertices && commonMin <= commonMax ? { min: commonMin, max: commonMax } : null,
        scope: "Intersection of fine-height ranges on selected unprotected visible vertices; stored coarse/base channel preserved",
        nativeRequantization: "unsupported",
      },
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
  async visibility(directory = "", cells: Point2[] = [], planId?: string) {
    const state = await this.state(directory, planId);
    if (!state.visibility) throw new Error("VISIBILITY_COMPONENT_UNSUPPORTED: requires LFCT v102");
    return { directory, ...state.visibility.inspect(cells), nativeEditorVerified: false };
  }
  async visibilityPlan(hidden: boolean, request: TerrainVisibilityRequest) {
    const parsed = terrainVisibilitySchema.parse(request);
    return this.plan({ directory: parsed.directory, operations: [{ op: hidden ? "surface.hide" : "surface.show", ...(parsed.area ? { area: parsed.area } : { cells: parsed.cells }) }] });
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
    const catalogs=await this.browse.data.catalog(),records=[];
    for(const catalog of catalogs.filter(c=>!owned.has(path.resolve(c.absolute)))){
      records.push({file:catalog.absolute,source:bytesHash(Buffer.from(catalog.document.source)),layer:catalog.layer,order:catalog.declarationOrder});
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
    const resolved = await this.browse?.data.metadataEntry('Water',id);
    if (!resolved?.available) throw new Error(`WATER_DEPENDENCY_UNAVAILABLE: ${id}`);
    ready.add(id);
  }
  async plan(request: TerrainPlanRequest, foundation?:Map<string,Buffer>,touches?:TerrainTouches): Promise<TerrainPlanSummary> {
    request = terrainPlanSchema.parse(request) as TerrainPlanRequest;
    if (request.operations.length > 100)
      throw new Error("Terrain plan accepts at most 100 operations");
    if(request.operations.some(op=>op.op==='load.repair')&&request.operations.length!==1)throw Error('TERRAIN_LOAD_REPAIR_MUST_BE_STANDALONE');
    const directory = request.directory ?? "",
      data = await this.load(directory);
    const before = new Map(
      [...data.sources].map(([n, b]) => [
        this.file(directory, n),
        Buffer.from(b),
      ]),
    );
    let sources: Map<string, Buffer> = new Map(
      [...(foundation??data.sources)].map(([n, b]) => [n, Buffer.from(b)]),
    );
    const initial = parseState(sources);
    const integrity = inspectNativeIntegrity(sources, initial.descriptor.width - 1, initial.descriptor.height - 1);
    if (!integrity.valid) throw new Error("INVALID_TERRAIN_NATIVE_COMPONENTS: " + JSON.stringify(integrity.issues));
    const load=inspectTerrainLoadContract(sources);
    if(load.issues.some(i=>i.severity==='error')&&!(request.operations.length===1&&['load.repair','stamp.apply'].includes(request.operations[0].op)))throw Error('INVALID_TERRAIN_LOAD_CONTRACT: '+JSON.stringify(load.issues)+'; inspect terrain.load.repair before ordinary terrain edits');
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
        else {const resolved=await this.browse?.data.metadataEntry('Light',id);if(!resolved?.available)throw new Error(`LIGHTING_DEPENDENCY_UNAVAILABLE: ${id}`);}
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
        touches,
      );
      issues = applied.issues;
      result = applied;
    }
    const nextLoad=inspectTerrainLoadContract(sources);
    if(nextLoad.issues.some(i=>i.severity==='error'))throw Error('INVALID_PLANNED_TERRAIN_LOAD_CONTRACT: '+JSON.stringify(nextLoad.issues));
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
      changedVisibilityCells: (() => {
        const file = this.file(directory, "t3CellFlags"), old = before.get(file), current = next.get(file);
        if (!old || !current || old.length !== current.length) return 0;
        let count = 0;
        for (let i = 32; i < current.length; i++) if ((old[i] ^ current[i]) & 4) count++;
        return count;
      })(),
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
  private async assertRouteSource(p:StoredPlan){
    if(p.routeSourceSnapshot&&bytesHash(Buffer.from((await this.workspace.readRaw(p.routeSourceSnapshot.file)).text))!==p.routeSourceSnapshot.sha256)
      throw Error('STALE_LANDSCAPE_ROUTE_SOURCE: '+p.routeSourceSnapshot.file);
    if(p.padSourceSnapshot&&bytesHash(Buffer.from((await this.workspace.readRaw(p.padSourceSnapshot.file)).text))!==p.padSourceSnapshot.sha256)
      throw Error('STALE_LANDSCAPE_PAD_SOURCE: '+p.padSourceSnapshot.file);
  }
  private async checked(id: string) {
    const p = this.plans.get(id);
    if (!p) throw new Error(`TERRAIN_PLAN_NOT_FOUND: ${id}`);
    await this.assertRouteSource(p);
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
    lightOptions:LightingResolveOptions={},
  ) {
    const p = id ? await this.checked(id) : undefined;
    const s = await this.state(directory, id);
    let lighting:Awaited<ReturnType<LightingWorkspace['resolve']>>|undefined;
    if(mode==='lit'){
      const tileSet=s.descriptor.heightMap.attrs.tileSet,localTerrain=new LightingCatalog(s.sources.get('Base.SC2Data/GameData/TerrainData.xml')?.toString('utf8')||'<Catalog/>','CTerrain').list().find(t=>t.id===tileSet);
      const dependency=lightOptions.preset||localTerrain?.lighting?undefined:await this.browse?.resolve({id:tileSet,catalogType:'Terrain'}).catch(()=>undefined);
      const preset=lightOptions.preset??localTerrain?.lighting??dependency?.object?.effective?.fields?.Lighting?.value??'DefaultLight';
      const localTexts=[s.sources.get('Base.SC2Data/GameData/LightData.xml')?.toString('utf8')||'<Catalog/>'];
      lighting=this.globalLighting?await this.globalLighting.resolve({...lightOptions,preset,directory,localTexts}):{lighting:resolveGlobalLighting(localTexts,preset,lightOptions.stateIndex),issues:[{code:'LIGHTING_CASC_UNAVAILABLE',detail:'Only local catalog was resolved'}],references:[],build:undefined,stateIndex:lightOptions.stateIndex??0,engineValidated:false};
    }
    const image = renderTerrainPng(s, mode, size,lighting?.lighting);
    return {
      plan: p?.summary,
      lighting:lighting?{preset:lighting.lighting.preset,found:lighting.lighting.found,stateIndex:lighting.stateIndex,issues:lighting.issues,references:lighting.references,sharedModule:true,engineValidated:false}:undefined,
      mode,
      orientation: "north up; positive Y",
      imageMimeType: "image/png",
      imageBase64: image.toString("base64"),
      legend:
        mode === "texture"
          ? s.descriptor.textures.filter((t) => t.id)
          : undefined,
      notice:
        mode==='lit'?"Shared SC2 global lighting over diagnostic terrain colors/normals; native terrain materials, shadows and regions remain partial.":"Diagnostic terrain preview; this does not render SC2 materials or models.",
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
      visual: "NOT_VERIFIED",
      cliffJunctionClosure: "NOT_VERIFIED",
      cliffJunctionRisk: "Structural terrain validation does not prove that adjoining cliff cells form a closed wall. Concave or acute joins can leave open ground holes; compare an editor-saved before/after sample before treating such joins as repaired.",
      rampVisualRisk: inspection.ramps
        ? "Native ramp components pass structural checks, but cliff side caps and rotated joins are not certified by a game render. Inspect ramps in SC2 before treating the terrain as visually complete."
        : undefined,
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
          await this.assertRouteSource(p);
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
      transactionId: transaction.transactionId,
      transaction,
      issues: p.summary.issues,
    };
  }
  async save(transactionId: string, options: Omit<ByteOptions, "stage"> = {}) {
    return this.workspace.binary.save(transactionId, options);
  }
  async savePlan(planId: string, options: Omit<ByteOptions, "stage"> = {}) {
    const p=await this.checked(planId);
    if(!p.applied)throw Error('TERRAIN_PLAN_NOT_APPLIED: '+planId);
    if(p.transactionId)return this.save(p.transactionId,options);
    // A truly unchanged apply creates no binary group. Recheck every source
    // instead of inventing a transaction or failing a repeatable author command.
    for(const [file,hash]of Object.entries(p.summary.sourceSha256))if(bytesHash((await this.workspace.binary.read(file)).bytes)!==hash)throw Error('STALE_TERRAIN_PLAN: '+file);
    return {saved:false,unchanged:true,planId};
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
  /** Extend the existing location generator with persistent regional ownership. */
  async inspectLandscape(input:z.input<typeof landscapeInspectSchema>={}){
    const args=landscapeInspectSchema.parse(input),raw=await this.workspace.readRaw('.sc2mcp/locations.json');
    if(Buffer.byteLength(raw.text)>64*1024*1024)throw Error('LANDSCAPE_STATE_TOO_LARGE');
    return {...inspectLandscapeState(raw.text?landscapeStateSchema.parse(JSON.parse(raw.text)):undefined,args),staged:raw.staged};
  }
  async landscapeZonePlan(input:z.input<typeof landscapeZonePlanSchema>){
    const edit=landscapeZonePlanSchema.parse(input);
    return this.ownedLandscapePlan(old=>({zones:[editLandscapeZone(old,edit)]}));
  }
  async ownedLandscape(input:z.input<typeof landscapeIntentSchema>){
    const intent=landscapeIntentSchema.parse(input);
    return this.ownedLandscapePlan(()=>intent);
  }
  private async ownedLandscapePlan(selectIntent:(old:LandscapeState)=>z.input<typeof landscapeIntentSchema>){
    if(!this.placement||!this.browse)throw Error('PLACEMENT_CONTEXT_UNAVAILABLE');
    const placement=this.placement,browse=this.browse;
    return this.workspace.withReadSet(()=>browse.withSnapshot(async()=>{
      if(this.workspace.draftFiles().length||this.workspace.binary.draftFiles().length)throw Error('LANDSCAPE_PENDING_DRAFTS: save or discard complete groups first');
      const file='.sc2mcp/locations.json',raw=await this.workspace.readRaw(file);
      if(Buffer.byteLength(raw.text)>64*1024*1024)throw Error('LANDSCAPE_STATE_TOO_LARGE');
      const original=raw.text?JSON.parse(raw.text) as z.input<typeof landscapeStateSchema>:undefined;
      const data=await this.load(),initial=parseState(data.sources),context=landscapeContext(initial),old:LandscapeState=original?landscapeStateSchema.parse(original):{version:1,context,zones:[]},originalRecords=new Map(original?.zones.map(zone=>[zone.id,zone])??[]);
      const intent=landscapeIntentSchema.parse(selectIntent(old));
      if(old.context!==context)throw Error('LANDSCAPE_COMPONENT_LAYOUT_CHANGED: review ownership after changing terrain layout or palette');
      const oldOrder=landscapeOrder(old.zones),requestedOrder=landscapeOrder(intent.zones.map(z=>({...z,dependsOn:z.dependsOn.filter(id=>intent.zones.some(v=>v.id===id))})));
      if(requestedOrder.length!==intent.zones.length)throw Error('LANDSCAPE_DUPLICATE_ZONE');
      const definitions=new Map(old.zones.map(zone=>[zone.id,{id:zone.id,dependsOn:zone.dependsOn,purpose:zone.purpose,condition:zone.condition,config:zone.config}]));
      for(const zone of intent.zones){if(zone.config.objectFile!=='Objects'||zone.config.componentListFile!=='ComponentList.SC2Components'||zone.config.terrain.directory!=='')throw Error('LANDSCAPE_ROOT_COMPONENTS_REQUIRED');definitions.set(zone.id,zone);}
      if(definitions.size>32)throw Error('LANDSCAPE_ZONE_LIMIT');
      const zones=[...definitions.values()],order=landscapeOrder(zones),byOld=new Map(old.zones.map(zone=>[zone.id,zone])),fingerprint=(await browse.index()).fingerprint;
      const requestedRouteSource=intent.routeSource===undefined?old.routeSource:intent.routeSource;
      const resolvedRouteSource=requestedRouteSource?await resolveLandscapeRouteSource(this.workspace,requestedRouteSource):undefined,routeBinding=resolvedRouteSource?.binding;
      const routeBindingChanged=landscapeHash(old.routeSource??null)!==landscapeHash(routeBinding??null),routeGeometryChanged=landscapeHash(old.routeSource?.corridors??[])!==landscapeHash(routeBinding?.corridors??[]);
      const declaredRoutes=zones.flatMap(zone=>zone.config.terrain.routes),allRoutes=routeBinding?mergeRouteReservations([...declaredRoutes,...routeBinding.corridors]):declaredRoutes;
      const newlyReserved=routeGeometryChanged&&routeBinding?addedRouteReservations([...old.zones.flatMap(zone=>zone.config.terrain.routes),...old.routeSource?.corridors??[]],allRoutes):[];
      const requestedPadSource=intent.padSource===undefined?old.padSource:intent.padSource;
      const resolvedPadSource=requestedPadSource?await resolveLandscapePadSource(this.workspace,requestedPadSource):undefined,padBinding=resolvedPadSource?.binding;
      const padAreas=padReservationAreas(padBinding),oldPadAreas=padReservationAreas(old.padSource);
      const padBindingChanged=landscapeHash(old.padSource??null)!==landscapeHash(padBinding??null),padGeometryChanged=landscapeHash(oldPadAreas)!==landscapeHash(padAreas);
      const newlyReservedPads=padGeometryChanged?addedPadReservations(oldPadAreas,padAreas):[];
      const endX=initial.descriptor.offset[0]+(initial.heights.width-1)*initial.descriptor.scale[0],endY=initial.descriptor.offset[1]+(initial.heights.height-1)*initial.descriptor.scale[1];
      const worldArea:TerrainArea={type:'rectangle',minX:Math.min(initial.descriptor.offset[0],endX),minY:Math.min(initial.descriptor.offset[1],endY),maxX:Math.max(initial.descriptor.offset[0],endX),maxY:Math.max(initial.descriptor.offset[1],endY)};
      if(routeBinding?.corridors.some(route=>route.points.some(point=>areaDistance(worldArea,point)<0)))throw Error('LANDSCAPE_ROUTE_SOURCE_OUTSIDE_TERRAIN');
      if(padAreas.some(p=>p.minX<worldArea.minX||p.maxX>worldArea.maxX||p.minY<worldArea.minY||p.maxY>worldArea.maxY))throw Error('LANDSCAPE_PAD_SOURCE_OUTSIDE_TERRAIN');
      if(old.zones.some(zone=>zone.generatorRevision>LANDSCAPE_RECIPE_REVISION))throw Error('LANDSCAPE_NEWER_GENERATOR_STATE');
      const changed=new Set(intent.zones.filter(zone=>{const previous=byOld.get(zone.id);return !previous||previous.generatorRevision!==LANDSCAPE_RECIPE_REVISION||previous.requestHash!==landscapeHash(zone)||previous.browseFingerprint!==fingerprint;}).map(zone=>zone.id));
      let rebuild=landscapeClosure(zones,changed);for(let size=-1;size!==rebuild.size;){size=rebuild.size;rebuild=landscapeClosure(zones,landscapeClosure(old.zones,rebuild));}
      const objectRaw=await this.workspace.readRaw('Objects'),componentRaw=await this.workspace.readRaw('ComponentList.SC2Components');
      const copy=()=>new Map([...data.sources].map(([name,b])=>[name,Buffer.from(b)]));
      const document=()=>objectRaw.text?new PlacementDocument(objectRaw.text):PlacementDocument.create();
      if(newlyReserved.length){
        const conflicts=ownedReservationConflicts(old.zones,document(),newlyReserved,worldArea,rebuild),requestedIds=new Set(intent.zones.map(zone=>zone.id));
        for(const id of conflicts){if(!requestedIds.has(id))throw Error('LANDSCAPE_ROUTE_SOURCE_CONFLICT: include '+id+' in the reviewed request');changed.add(id);}
        rebuild=landscapeClosure(zones,changed);for(let size=-1;size!==rebuild.size;){size=rebuild.size;rebuild=landscapeClosure(zones,landscapeClosure(old.zones,rebuild));}
      }
      if(newlyReservedPads.length){
        const conflicts=ownedReservationConflicts(old.zones,document(),[],worldArea,rebuild,newlyReservedPads),requestedIds=new Set(intent.zones.map(zone=>zone.id));
        for(const id of conflicts){if(!requestedIds.has(id))throw Error('LANDSCAPE_PAD_SOURCE_CONFLICT: include '+id+' in the reviewed request');changed.add(id);}
        rebuild=landscapeClosure(zones,changed);for(let size=-1;size!==rebuild.size;){size=rebuild.size;rebuild=landscapeClosure(zones,landscapeClosure(old.zones,rebuild));}
      }
      const restore=(sources:Map<string,Buffer>,doc:PlacementDocument,ids:Set<string>)=>{
        const fingerprints=objectFingerprints(doc),remove:number[]=[];
        for(const id of [...oldOrder].reverse()){if(!ids.has(id))continue;const zone=byOld.get(id)!;restoreTopologyPatch(sources,zone.topology,id);restoreLandscapePatch(sources,zone.patches,id);for(const object of zone.objects){if(fingerprints.get(object.id)!==object.fingerprint)throw Error('LANDSCAPE_OWNED_OBJECT_CHANGED: '+id+' '+object.id);remove.push(object.id);}}doc.removeMany(remove);
      };
      // Verify requested no-op zones through their overlay dependants as well.
      restore(copy(),document(),landscapeClosure(old.zones,new Set([...intent.zones.map(z=>z.id),...rebuild])));
      const sources=copy(),doc=document();restore(sources,doc,rebuild);
      let outputContext=context,foundationPreparation:{changed:boolean;changedVertices:number;maxWorldDelta:number}|undefined;
      if(rebuild.size&&zones.some(z=>z.config.terrain.topology&&(z.config.terrain.topology.cliffs.length||z.config.terrain.topology.ramps.length))){
        const foundation=parseState(sources),standard=Number(foundation.descriptor.vert.attrs.standardHeight??8);
        const relief=Math.max(0,...zones.map(z=>z.config.terrain.heightMode==='preserve'?0:z.config.terrain.relief??TERRAIN_STYLES[z.config.terrain.style].relief));
        const prepared=prepareNativeGeometryFoundation(foundation,old.zones.length?0:Math.min(128,Math.ceil(Math.abs(standard)+relief+3)));
        if(prepared.changed&&old.zones.length)throw Error('LANDSCAPE_NATIVE_FOUNDATION_MIGRATION_REQUIRED: existing region preimages cannot be silently requantized');
        outputContext=landscapeContext(foundation);
        foundationPreparation={changed:prepared.changed,changedVertices:prepared.vertices.size,maxWorldDelta:prepared.maxWorldDelta};
      }
      const occupied=new Set(doc.list().flatMap(o=>o.id===undefined?[]:[o.id])),reserved=new Set<number>();
      for(const zone of old.zones)for(const object of zone.objects){if(reserved.has(object.id))throw Error('LANDSCAPE_DUPLICATE_OWNERSHIP: '+object.id);reserved.add(object.id);}
      let nextId=1;for(const id of [...occupied,...reserved])nextId=Math.max(nextId,id+1);
      const allocate=()=>{if(nextId>2_147_483_647)nextId=1;while(occupied.has(nextId)||reserved.has(nextId))nextId++;if(nextId>2_147_483_647)throw Error('LANDSCAPE_OBJECT_IDS_EXHAUSTED');const id=nextId++;occupied.add(id);return id;};
      const records=new Map(old.zones.filter(zone=>!rebuild.has(zone.id)).map(zone=>[zone.id,zone]));
      const operations:TerrainPlanRequest['operations']=[],issues:TerrainIssue[]=[],rebuilt:Array<{id:string;objects:number;reusedObjectIds:number}>=[];
      const queue:Array<{id:string;area:TerrainArea}>=[];
      let lastTerrainPlanId:string|undefined;
      let changedVertices=0,changedTexturePixels=0;
      for(const id of order){if(!rebuild.has(id))continue;const zone=definitions.get(id)!,args=zone.config,p= args.area;
        const area:TerrainArea=p.type==='polygon'?{type:'polygon',points:p.points}:p.type==='circle'?{type:'circle',center:{x:p.center.x,y:p.center.y},radius:p.radius}:{type:'rectangle',minX:p.minX,minY:p.minY,maxX:p.maxX,maxY:p.maxY};
        const {routes,topology,...settings}=args.terrain;
        for(const route of routes)if((route.flatten||route.texture)&&!corridorWithinArea(area,route.points,route.width))throw Error('LOCATION_ROUTE_OUTSIDE_AREA: '+id);
        const generation={...settings,area,seed:args.seed??settings.seed},state=parseState(sources),touches=new LandscapeTouches(state);
        const roads=routes.flatMap(route=>(route.flatten?featureRecipe('road',route):route.texture?[{op:'texture.paint' as const,area:{type:'corridor' as const,points:route.points,width:route.width},texture:route.texture,edgeBlend:route.edgeBlend}]:[]).map(op=>({...op,protectedAreas:settings.protectedAreas})));
        const generated=this.generateOperations(generation,state).map(op=>{
          if(!('pattern' in op)||!op.pattern)return op;
          const protectedAreas=[...op.protectedAreas??[],...allRoutes.map(route=>({type:'corridor' as const,points:route.points,width:route.width}))];
          if(protectedAreas.length>50)throw Error('LANDSCAPE_MATERIAL_ROUTE_PROTECTION_LIMIT: at most 50 explicit and reserved material masks');
          return {...op,protectedAreas};
        }),native:TerrainPlanRequest['operations']=[
          ...topology?.cliffs.map(c=>({op:'cliff.paint' as const,area:c.area,parameters:{level:c.level,cliffSet:c.cliffSet,variation:c.variation}}))??[],
          ...topology?.ramps.map(r=>({op:'ramp.create' as const,parameters:{center:r.center,direction:r.direction,lowerLevel:r.lowerLevel,width:r.width,cliffSet:r.cliffSet}}))??[],
        ];
        const zoneOperations=[...generated.filter(op=>op.op.startsWith('height.')),...native,...generated.filter(op=>!op.op.startsWith('height.')),...roads];operations.push(...zoneOperations);if(operations.length>100)throw Error('LANDSCAPE_OPERATION_LIMIT: at most 100 generated operations in one atomic plan');
        const terrainPlan=await this.plan({operations:zoneOperations,maxSlope:args.maxSlope},sources,touches),stored=await this.checked(terrainPlan.id);
        const after=new Map(TERRAIN_COMPONENTS.map(name=>[name,Buffer.from(stored.next.get(name)!)])),patches=touches.patches(sources,after),nativePatch=touches.topology(sources,after),ancestors=landscapeAncestors(zones,id);
        if(nativePatch){
          const width=state.heights.width-1,protectedBoxes=(settings.protectedAreas??[]).map(p=>({type:'rectangle' as const,...areaBounds(p)}));
          for(const cell of touches.nativeCells){const x=cell%(width/2)*2,y=Math.floor(cell/(width/2))*2;
            try{checkGroupClearance({position:{x:x+1,y:y+1},corners:[{x,y},{x:x+2,y},{x,y:y+2},{x:x+2,y:y+2}]},area,[],protectedBoxes);}
            catch(e){throw Error('LANDSCAPE_NATIVE_HALO_OR_PROTECTION_CONFLICT: '+id+' '+cell+' '+String(e),{cause:e});}
          }
        }
        for(const other of records.values())if(!ancestors.has(other.id)&&(touches.conflicts(other.patches)||topologyConflicts(nativePatch,other.topology)))throw Error(`LANDSCAPE_OWNERSHIP_OVERLAP: ${id} touches ${other.id}; declare the actual overlay dependency`);
        records.set(id,{...zone,requestHash:landscapeHash(zone),browseFingerprint:fingerprint,generatorRevision:LANDSCAPE_RECIPE_REVISION,patches,...nativePatch?{topology:nativePatch}:{},objects:[]});
        sources.clear();for(const [name,bytes]of after)sources.set(name,bytes);
        issues.push(...terrainPlan.issues);changedVertices+=terrainPlan.changedVertices;changedTexturePixels+=terrainPlan.changedTexturePixels;
        queue.push({id,area});lastTerrainPlanId=terrainPlan.id;
      }
      // Every placement samples the complete dependency stack, not its parent's
      // intermediate surface before a later clearing/road has been generated.
      const finalState=parseState(sources),surface=lastTerrainPlanId?await this.surface('',lastTerrainPlanId):undefined;
      // Restoration/removal can change the surface even if the new definition
      // emits no height operations. Count the final map delta, not only new writes.
      changedVertices=0;for(let y=0;y<finalState.heights.height;y++)for(let x=0;x<finalState.heights.width;x++)if(Math.abs(finalState.heights.z(x,y)-initial.heights.z(x,y))>1e-12)changedVertices++;
      if(queue.some(({id})=>{const c=definitions.get(id)!.config;return c.objectCount!==0||c.groups.length>0;})&&!surface?.waterCoverageKnown)throw Error('LANDSCAPE_WATER_COVERAGE_UNAVAILABLE');
      const plannedGroups=new Map<string,Array<{plan:PlacementPlan;slots:string[]}>>(),groupExclusions:ExclusionZone[]=[];
      for(const {id,area}of queue){const args=definitions.get(id)!.config;
        if(new Set(args.groups.map(g=>g.id)).size!==args.groups.length)throw Error('LANDSCAPE_DUPLICATE_GROUP: '+id);
        if(args.groups.reduce((n,g)=>n+g.members.length,0)>5000)throw Error('LANDSCAPE_ZONE_OBJECT_LIMIT');
        const groupPlans:Array<{plan:PlacementPlan;slots:string[]}>=[];
        for(const group of args.groups){
          const objects=measuredObjects(group,surface!,(geometry,member)=>{try{groupExclusions.push(checkGroupClearance(geometry,area,allRoutes,[...args.exclusionZones??[],...padAreas]));}catch(e){throw Error(String(e)+' '+id+'/'+group.id+'/'+member.id,{cause:e});}});
          const plan=await placement.addBatch({objects,bounds:args.bounds});groupPlans.push({plan,slots:objects.map((_,i)=>'group:'+group.id+':'+i)});
        }
        plannedGroups.set(id,groupPlans);
      }
      for(const {id}of queue){const args=definitions.get(id)!.config,groupPlans=plannedGroups.get(id)!;
        const batches:Array<{plan:PlacementPlan;slots:string[];grounded:boolean}>=[];
        if(args.objectCount!==0){const placed=await placement.createLocation({...args,reservedCorridors:allRoutes,exclusionZones:[...args.exclusionZones??[],...padAreas,...groupExclusions]},doc);batches.push({plan:placed.plan,slots:placed.plan.operations.map((_,i)=>'scatter:'+i),grounded:false});}
        batches.push(...groupPlans.map(v=>({...v,grounded:true})));
        if(batches.reduce((n,b)=>n+b.slots.length,0)>5000)throw Error('LANDSCAPE_ZONE_OBJECT_LIMIT');
        const prior=byOld.get(id)?.objects??[],bySlot=new Map<string,number>();for(const o of prior)if(o.slot){if(bySlot.has(o.slot))throw Error('LANDSCAPE_DUPLICATE_SLOT: '+id);bySlot.set(o.slot,o.id);}
        const additions:Array<Extract<PlacementMutation,{op:'add'}>>=[],slots:string[]=[];
        let reusedObjectIds=0;
        for(const batch of batches){const start=additions.length;for(const [i,op]of batch.plan.operations.entries()){
          if(op.op!=='add')throw Error('LANDSCAPE_LOCATION_OPERATION_UNSUPPORTED');const sample=finalState.heights.sample(op.object.position),gx=(op.object.position.x-finalState.descriptor.offset[0])/finalState.descriptor.scale[0],gy=(op.object.position.y-finalState.descriptor.offset[1])/finalState.descriptor.scale[1];
          if(sample.mask===0||finalState.visibility?.atGrid(gx,gy)||finalState.water?.at(op.object.position).length||(!batch.grounded&&args.maxSlope!==undefined&&sample.slope>args.maxSlope))throw Error('LANDSCAPE_OBJECT_UNSUITABLE_GROUND: '+id);
          const slot=batch.slots[i],previousId=bySlot.get(slot)??(slot.startsWith('scatter:')&&prior[i]?.slot===undefined?prior[i]?.id:undefined),objectId=previousId&&!occupied.has(previousId)?(occupied.add(previousId),previousId):allocate();
          if(objectId===previousId)reusedObjectIds++;
          additions.push({op:'add',object:{...op.object,objectId,position:{...op.object.position,z:batch.grounded?op.object.position.z:sample.height},flags:{...op.object.flags,HeightAbsolute:'1'}}});slots.push(slot);
        }batch.plan={...batch.plan,operations:additions.slice(start)};}
        const added=doc.apply(additions).map(v=>v.objectId);for(const batch of batches){const validation=await placement.validateDocument(doc,batch.plan);if(!validation.valid)throw Error('LOCATION_PLACEMENT_VALIDATION_FAILED: '+id+' '+JSON.stringify(validation.issues.filter(i=>i.severity==='error')));}
        const fingerprints=objectFingerprints(doc);records.set(id,{...records.get(id)!,objects:added.map((id,i)=>({id,slot:slots[i],fingerprint:fingerprints.get(id)!}))});
        rebuilt.push({id,objects:added.length,reusedObjectIds});
      }
      const resnapped:Array<{id:string;objects:number}>=[],ancestorIds=new Set([...rebuild].flatMap(id=>[...landscapeAncestors(zones,id)]).filter(id=>!rebuild.has(id)));
      const routesChanged=routeGeometryChanged||[...changed].some(id=>landscapeHash(definitions.get(id)?.config.terrain.routes??[])!==landscapeHash(byOld.get(id)?.config.terrain.routes??[]));
      if(ancestorIds.size&&(changedVertices||routesChanged)){
        const current=new Map(doc.list().flatMap(o=>o.id===undefined?[]:[[o.id,o] as const])),fingerprints=objectFingerprints(doc),moves:Array<Extract<PlacementMutation,{op:'move'}>>=[],updates=new Map<string,Set<number>>();
        for(const id of ancestorIds){const record=records.get(id)!,p=record.config.area,area:TerrainArea=p.type==='polygon'?{type:'polygon',points:p.points}:p.type==='circle'?{type:'circle',center:{x:p.center.x,y:p.center.y},radius:p.radius}:{type:'rectangle',minX:p.minX,minY:p.minY,maxX:p.maxX,maxY:p.maxY},groupsToCheck=new Set<string>();
          for(const object of record.objects){const placed=current.get(object.id);if(!placed?.position)continue;const [x,y,z]=placed.position.split(',').map(Number);if(![x,y,z].every(Number.isFinite))throw Error('LANDSCAPE_OWNED_POSITION_INVALID');
            const groupSlot=object.slot?.startsWith('group:')?object.slot.split(':'):undefined,group=groupSlot?record.config.groups.find(g=>g.id===groupSlot[1]):undefined,member=groupSlot?group?.members[Number(groupSlot[2])]:undefined;if(groupSlot&&!member)throw Error('LANDSCAPE_GROUP_SLOT_MISMATCH');
            if(routesChanged){if(group)groupsToCheck.add(group.id);else if(allRoutes.some(route=>areaDistance({type:'corridor',points:route.points,width:route.width},{x,y})>=0))throw Error('LANDSCAPE_ANCESTOR_ROUTE_CONFLICT: include '+id+' in the reviewed request');}
            const sample=surface!.sampleGround({x,y}),desired=sample.height+(member?.heightOffset??0);if(Math.abs(desired-z)<=1e-6)continue;
            if(fingerprints.get(object.id)!==object.fingerprint)throw Error('LANDSCAPE_OWNED_OBJECT_CHANGED: '+id+' '+object.id);
            if(!surface!.waterCoverageKnown)throw Error('LANDSCAPE_WATER_COVERAGE_UNAVAILABLE');
            if(sample.hidden||sample.mask===0||sample.protected||sample.water?.length||sample.slope>(group?.maxSlope??record.config.maxSlope??Infinity))throw Error('LANDSCAPE_ANCESTOR_UNSUITABLE_GROUND: '+id+' '+object.id);
            if(group)groupsToCheck.add(group.id);moves.push({op:'move',objectId:object.id,position:{x,y,z:desired}});const ids=updates.get(id)??new Set<number>();ids.add(object.id);updates.set(id,ids);
          }
          for(const group of record.config.groups.filter(g=>groupsToCheck.has(g.id)))measuredObjects(group,surface!,geometry=>checkGroupClearance(geometry,area,allRoutes,[...record.config.exclusionZones??[],...padAreas]));
        }
        doc.moveMany(moves);const after=objectFingerprints(doc);for(const [id,ids]of updates){const record=records.get(id)!;records.set(id,{...record,objects:record.objects.map(o=>ids.has(o.id)?{...o,fingerprint:after.get(o.id)!}:o)});resnapped.push({id,objects:ids.size});}
      }
      const before=new Map([...data.sources].map(([name,b])=>[name,Buffer.from(b)])),next=new Map(sources),sourceSha256={...data.sourceSha256},diskSha256={...data.diskSha256};
      for(const [name,text]of [['Objects',objectRaw.text],['ComponentList.SC2Components',componentRaw.text],[file,raw.text]]){before.set(name,Buffer.from(text));sourceSha256[name]=bytesHash(Buffer.from(text));diskSha256[name]=bytesHash((await this.workspace.binary.read(name,false)).bytes);}
      if(routeBinding){sourceSha256[routeBinding.file]=routeBinding.sha256;diskSha256[routeBinding.file]=bytesHash((await this.workspace.binary.read(routeBinding.file,false)).bytes);}
      if(padBinding){sourceSha256[padBinding.file]=padBinding.sha256;diskSha256[padBinding.file]=bytesHash((await this.workspace.binary.read(padBinding.file,false)).bytes);}
      next.set('Objects',Buffer.from(doc.source));next.set('ComponentList.SC2Components',Buffer.from(rebuild.size?componentListWithObjects(componentRaw.text):componentRaw.text));
      const ledger={version:1 as const,context:outputContext,...routeBinding?{routeSource:routeBinding}:{},...padBinding?{padSource:padBinding}:{},zones:order.map(id=>{const record=records.get(id)!,original=originalRecords.get(id);return original&&!rebuild.has(id)?resnapped.some(r=>r.id===id)?{...original,objects:record.objects}:original:record;})};landscapeStateSchema.parse(ledger);
      const text=rebuild.size||routeBindingChanged||padBindingChanged?JSON.stringify(ledger)+'\n':raw.text;
      if(Buffer.byteLength(text)>64*1024*1024)throw Error('LANDSCAPE_STATE_TOO_LARGE');next.set(file,Buffer.from(text));
      issues.push({severity:'warning',code:'LANDSCAPE_NATIVE_REVIEW_REQUIRED',message:'Owned height/texture cells, supported native cliff/ramp rows and decoration are reconciled. Declared overlays are rebuilt; model footprints, engine navigation and unowned-object resnapping require separate review.'});
      const summary=this.remember('',operations,before,next,sourceSha256,diskSha256,{},issues,changedVertices,changedTexturePixels);this.plans.get(summary.id)!.browseFingerprint=fingerprint;
      if(routeBinding)this.plans.get(summary.id)!.routeSourceSnapshot={file:routeBinding.file,sha256:routeBinding.sha256};
      if(padBinding)this.plans.get(summary.id)!.padSourceSnapshot={file:padBinding.file,sha256:padBinding.sha256};
      return {...summary,ownership:{file,rebuilt,resnapped,unchanged:order.filter(id=>!rebuild.has(id)&&!resnapped.some(r=>r.id===id)),totalZones:records.size,topologyZones:[...records.values()].filter(r=>r.topology).map(r=>r.id),foundationPreparation,...(routeBinding||old.routeSource||intent.routeSource===null)?{routeSource:{file:routeBinding?.file,sha256:routeBinding?.sha256,clearWidth:routeBinding?.clearWidth,corridors:routeBinding?.corridors.length??0,blockedRouteIds:routeBinding?.blockedRouteIds??[],geometryChanged:routeGeometryChanged,metadataOnly:routeBindingChanged&&!rebuild.size,disabled:!routeBinding,manifestMap:resolvedRouteSource?.manifestMap,mapIdentity:'not_verified',scope:'Positive route and per-member formation center corridors with explicit authored width. Owned measured rest bounds/scatter centers only; no native navigation, unowned-object or collision certification.'}}:{},...(padBinding||old.padSource||intent.padSource===null)?{padSource:{file:padBinding?.file,sha256:padBinding?.sha256,reservations:padBinding?.reservations??[],geometryChanged:padGeometryChanged,metadataOnly:padBindingChanged&&!rebuild.size,disabled:!padBinding,manifestMap:resolvedPadSource?.manifestMap,mapIdentity:'not_verified',scope:'Explicit design rectangles from selected exact placement checks. Owned measured rest bounds/scatter centers only; native predicate execution, engine footprint, unowned objects and terrain flattening remain separate.'}}:{},scope:'Regional height/texture masks, supported native cliff/ramp rows, owned decoration and measured groups with explicit overlay dependencies',preservationScope:'Unselected zones are not rewritten. Changed route/pad-source geometry reviews their owned measured bounds or scatter centers and rejects conflicts; affected ancestor objects receive guarded height-only resnaps.'},atomicComponents:'terrain + Objects + ComponentList + location ownership'};
    }));
  }
  async generate(args: GenerateArgs) {
    args = terrainGenerateSchema.parse(args);
    const s = await this.state(args.directory);
    return this.plan({directory:args.directory,operations:this.generateOperations(args,s)});
  }
  private generateOperations(args:GenerateArgs,s:TerrainState) {
    if(args.textureMode==='preserve')return generateRecipe(args);
    for(const patch of args.materials?.patches??[])if(!s.descriptor.textures.some(t=>t.id===patch.texture))throw Error('TEXTURE_NOT_IN_ACTIVE_PALETTE: '+patch.texture);
    if(args.materials?.patches?.length&&!args.materials.base)return generateRecipe(args);
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
      terrain: Omit<GenerateArgs, "area"> & {routes?:LocationRoute[]};
      maxSlope?: number;
    },
  ) {
    if (!this.placement) throw new Error("PLACEMENT_CONTEXT_UNAVAILABLE");
    const placementArea = args.area;
    const area: TerrainArea =
      placementArea.type === "polygon"
        ? {type:"polygon",points:placementArea.points.map(p=>({x:p.x,y:p.y}))}
        : placementArea.type === "circle"
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
    const {routes,topology,...settings}=terrainLocationSchema.parse(args.terrain);
    if(topology)throw Error('LOCATION_NATIVE_TOPOLOGY_REQUIRES_OWNED_INTENT: use terrain.landscape.plan intent');
    for(const route of routes)if((route.flatten||route.texture)&&!corridorWithinArea(area,route.points,route.width))throw Error('LOCATION_ROUTE_OUTSIDE_AREA: the whole painted/flattened road must fit inside its location; use a separate road plan for cross-zone connections');
    const generation={
      ...settings,
      area,
      seed: args.seed ?? args.terrain.seed,
    };
    const source=await this.state(generation.directory);
    const roads=routes.flatMap(route=>{
      const operations=route.flatten?featureRecipe('road',route):route.texture?[{op:'texture.paint' as const,area:{type:'corridor' as const,points:route.points,width:route.width},texture:route.texture,edgeBlend:route.edgeBlend}]:[];
      return operations.map(op=>({...op,protectedAreas:settings.protectedAreas}));
    });
    const terrainPlan=await this.plan({directory:generation.directory,operations:[...this.generateOperations(generation,source),...roads]});
    const stored = await this.checked(terrainPlan.id);
    const state = await this.state("", terrainPlan.id);
    const placed = await this.placement.createLocation({...args,reservedCorridors:[...(args.reservedCorridors??[]),...routes]});
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
          position: { ...op.object.position, z: op.object.kind === "Unit" ? 0 : sample.height },
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
      reservedRoutes:routes.map(r=>({points:r.points,width:r.width})),
      routeClearanceScope:'Decoration pivot exclusions; measured mesh bounds, engine pathing and buildability need separate checks',
      groundSnapping: true,
    };
  }
}
