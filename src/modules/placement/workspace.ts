import type { TerrainWorkspace } from "../terrain/workspace.js";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { Workspace } from "../../core/workspace.js";
import { BrowseWorkspace } from "../browse/workspace.js";
import type { BrowseSearchResult } from "../browse/types.js";
import { componentListWithObjects, PlacementDocument } from "./document.js";
import { planPositions, seededRandom } from "./planner.js";
import { DistanceIndex } from "./spatialIndex.js";
import { compactPlacementPlan } from "./summary.js";
import {
  scatterDoodadsSchema,
  snapObjectsSchema,
  type ScatterDoodadsArgs,
  type SnapObjectsArgs,
} from "./decorationSchemas.js";
import type {
  ExclusionZone,
  LocationType,
  PlacementArea,
  PlacementBounds,
  PlacementLayout,
  PlacementMutation,
  PlacementPlan,
  PlacementValidationIssue,
  PlacementValidationReport,
  Position3,
  Scale3,
} from "./types.js";

const LOCATION_TERMS: Record<LocationType, string[]> = {
  forest: ["tree", "plant", "bush", "rock", "log"],
  desert: ["desert", "dune", "rock", "dry", "debris"],
  city: ["city", "building", "street", "light", "crate", "vehicle"],
  village: ["house", "hut", "fence", "tree", "crate"],
  industrial: ["industrial", "pipe", "platform", "machine", "container"],
  militaryBase: ["bunker", "military", "barrier", "turret", "light"],
  ruins: ["ruin", "wreck", "debris", "broken", "fire"],
  swamp: ["swamp", "plant", "tree", "water", "rock"],
  cave: ["cave", "rock", "crystal", "stalagmite"],
  alien: ["alien", "organic", "crystal", "plant"],
  terran: ["terran", "crate", "light", "building", "debris"],
  protoss: ["protoss", "aiur", "crystal", "temple"],
  zerg: ["zerg", "creep", "organic", "bone"],
  mixedNature: ["tree", "plant", "rock", "grass", "log"],
  custom: [],
};

interface PlanObjectArgs {
  objectFile?: string;
  componentListFile?: string;
  query?: string;
  id?: string;
  key?: string;
  catalogType?: string;
  position: Position3;
  snapToTerrain?: boolean;
  terrainDirectory?: string;
  maxSlope?: number;
  rotation?: number;
  scale?: number | Scale3;
  owner?: number;
  variation?: number;
  flags?: Record<string, string>;
  count?: number;
  layout?: PlacementLayout;
  bounds?: PlacementBounds;
}

function normalizedScale(scale?: number | Scale3): Scale3 | undefined {
  if (scale === undefined) return undefined;
  return typeof scale === "number" ? { x: scale, y: scale, z: scale } : scale;
}

function textHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function requestHash(value: unknown): string {
  return textHash(JSON.stringify(value));
}
function planId(hash: string): string {
  return `placement_${hash.slice(0, 20)}`;
}
function positionInBounds(
  position: Position3,
  bounds: PlacementBounds,
): boolean {
  return (
    position.x >= bounds.minX &&
    position.x <= bounds.maxX &&
    position.y >= bounds.minY &&
    position.y <= bounds.maxY &&
    (bounds.minZ === undefined || position.z >= bounds.minZ) &&
    (bounds.maxZ === undefined || position.z <= bounds.maxZ)
  );
}

export class PlacementWorkspace {
  terrain?: TerrainWorkspace;
  private readonly plans = new Map<string, PlacementPlan>();
  constructor(
    readonly workspace: Workspace,
    readonly browse: BrowseWorkspace,
  ) {}

  private async remember(
    input: Omit<
      PlacementPlan,
      | "id"
      | "requestHash"
      | "createdAt"
      | "applied"
      | "sourceSha256"
      | "diskSha256"
    > & { request: unknown },
  ): Promise<PlacementPlan> {
    const hash = requestHash(input.request);
    const existing = [...this.plans.values()].find(
      (plan) => plan.requestHash === hash,
    );
    if (existing) return existing;
    const sourceSha256: Record<string, string> = {};
    const diskSha256: Record<string, string> = {};
    for (const file of [input.objectFile, input.componentListFile]) {
      const effective = await this.workspace.readRaw(file);
      const disk = await this.workspace.readRaw(file, false);
      sourceSha256[effective.file] = textHash(effective.text);
      diskSha256[disk.file] = textHash(disk.text);
    }
    const plan: PlacementPlan = {
      id: planId(hash),
      requestHash: hash,
      createdAt: new Date().toISOString(),
      objectFile: input.objectFile,
      componentListFile: input.componentListFile,
      // Format examples currently come from a local reference implementation,
      // not an editor round-trip performed by this project. Do not promote them.
      operations: input.operations,
      candidates: input.candidates,
      evidence: input.evidence.map((entry) =>
        entry === "PROVEN_BY_REAL_MAP" ? "INFERRED" : entry,
      ),
      warnings: [
        ...input.warnings,
        "Placement format is reference-supported; this build has not been opened/saved by SC2Editor.",
        ...(!input.bounds
          ? [
              "Map bounds are unavailable: supply explicit bounds before trusting coordinates.",
            ]
          : []),
      ],
      applied: false,
      sourceSha256,
      diskSha256,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.minimumDistance !== undefined
        ? { minimumDistance: input.minimumDistance }
        : {}),
      ...(input.bounds ? { bounds: input.bounds } : {}),
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  private async resolvePlaceable(
    kind: "Unit" | "Doodad",
    args: { query?: string; id?: string; key?: string; catalogType?: string },
  ) {
    const result = await this.browse.resolve({
      key: args.key,
      id: args.id,
      query: args.query,
      catalogType: args.catalogType ?? (kind === "Unit" ? "Unit" : undefined),
    });
    if (!result.resolved)
      throw new Error(
        `Could not resolve one ${kind}: ${result.reason}; inspect browse.search candidates first`,
      );
    const object = result.object;
    if (!object) throw new Error(`Resolved ${kind} has no indexed object`);
    if (
      !result.placeableRepresentation ||
      result.placeableRepresentation.kind !== kind
    )
      throw new Error(
        `${object.catalogType}:${object.id} is not an indexed placeable ${kind}`,
      );
    if (!result.dependencyReady)
      throw new Error(
        `${object.id} is ${object.availability}; declare its dependency before placement`,
      );
    return object;
  }

  private async addKind(
    kind: "Unit" | "Doodad",
    args: PlanObjectArgs,
  ): Promise<PlacementPlan> {
    const resolved = await this.resolvePlaceable(kind, args);
    const count = args.count ?? 1;
    const layout = args.layout ?? { type: "single" as const };
    const positions = planPositions(args.position, count, layout);
    let terrainHashes:
      | {
          sourceSha256?: Record<string, string>;
          diskSha256?: Record<string, string>;
        }
      | undefined;
    if (args.snapToTerrain) {
      if (!this.terrain) throw new Error("Terrain context is unavailable");
      const sampled = await this.terrain.sample(
        positions,
        args.terrainDirectory,
      );
      terrainHashes = sampled;
      for (const [i, point] of sampled.samples.entries()) {
        if (
          point.mask === 0 ||
          (args.maxSlope !== undefined && point.slope > args.maxSlope)
        )
          throw new Error(
            "Placement point is on a terrain hole or excessive slope",
          );
        positions[i].z = point.height;
      }
    }
    const operations: PlacementMutation[] = positions.map((position) => ({
      op: "add",
      object: {
        kind,
        catalogId: resolved.id,
        sourceKey: resolved.key,
        position,
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(normalizedScale(args.scale)
          ? { scale: normalizedScale(args.scale)! }
          : {}),
        ...(kind === "Unit" && args.owner !== undefined
          ? { owner: args.owner }
          : {}),
        ...(args.variation !== undefined ? { variation: args.variation } : {}),
        ...(args.snapToTerrain && kind === "Doodad"
          ? { flags: { ...args.flags, HeightAbsolute: "1" } }
          : args.flags
            ? { flags: args.flags }
            : {}),
      },
    }));
    const plan = await this.remember({
      request: {
        type: `add${kind}`,
        ...args,
        resolved: resolved.key,
        terrainHashes,
      },
      objectFile: args.objectFile ?? "Objects",
      componentListFile:
        args.componentListFile ?? "ComponentList.SC2Components",
      operations,
      candidates: [
        (
          await this.browse.search({
            ids: [resolved.id],
            catalogType: resolved.catalogType,
            dependency: resolved.dependency,
            limit: 1,
          })
        ).results[0]!,
      ],
      evidence: ["PROVEN_BY_REAL_MAP", "OBSERVED_CATALOG_XML"],
      warnings: [
        args.snapToTerrain
          ? "Z is sampled from Terrain; native model footprints/pathing remain unverified."
          : "Z is written exactly as supplied; enable snapToTerrain to sample the ground.",
      ],
      ...(args.bounds ? { bounds: args.bounds } : {}),
      ...(layout.type === "scatter"
        ? {
            seed: layout.seed ?? 1,
            minimumDistance: layout.minimumDistance ?? 0,
          }
        : {}),
    });
    if (terrainHashes) {
      Object.assign(plan.sourceSha256, terrainHashes.sourceSha256);
      Object.assign(plan.diskSha256, terrainHashes.diskSha256);
    }
    return plan;
  }

  async addUnit(args: PlanObjectArgs) {
    return this.addKind("Unit", args);
  }
  async addDoodad(args: PlanObjectArgs) {
    return this.addKind("Doodad", args);
  }

  async addBatch(args: {
    objectFile?: string;
    componentListFile?: string;
    objects: Array<
      Omit<
        PlanObjectArgs,
        "objectFile" | "componentListFile" | "count" | "layout"
      > & { kind: "Unit" | "Doodad" }
    >;
    bounds?: PlacementBounds;
  }) {
    if (!args.objects.length || args.objects.length > 5_000)
      throw new Error("placement.addBatch accepts 1..5000 objects");
    const operations: PlacementMutation[] = [];
    const candidates: BrowseSearchResult[] = [];
    for (const object of args.objects) {
      const resolved = await this.resolvePlaceable(object.kind, object);
      operations.push({
        op: "add",
        object: {
          kind: object.kind,
          catalogId: resolved.id,
          sourceKey: resolved.key,
          position: object.position,
          ...(object.rotation !== undefined
            ? { rotation: object.rotation }
            : {}),
          ...(normalizedScale(object.scale)
            ? { scale: normalizedScale(object.scale)! }
            : {}),
          ...(object.kind === "Unit" && object.owner !== undefined
            ? { owner: object.owner }
            : {}),
          ...(object.variation !== undefined
            ? { variation: object.variation }
            : {}),
          ...(object.flags ? { flags: object.flags } : {}),
        },
      });
      const compact = await this.browse.search({
        ids: [resolved.id],
        catalogType: resolved.catalogType,
        dependency: resolved.dependency,
        limit: 1,
      });
      if (compact.results[0]) candidates.push(compact.results[0]);
    }
    return this.remember({
      request: { type: "batch", ...args },
      objectFile: args.objectFile ?? "Objects",
      componentListFile:
        args.componentListFile ?? "ComponentList.SC2Components",
      operations,
      candidates,
      evidence: ["PROVEN_BY_REAL_MAP", "OBSERVED_CATALOG_XML"],
      warnings: ["Runtime collision and pathing are not checked."],
      ...(args.bounds ? { bounds: args.bounds } : {}),
    });
  }

  async scatterDoodads(input: ScatterDoodadsArgs) {
    const args = scatterDoodadsSchema.parse(input);
    if (!this.terrain) throw new Error("Terrain context is unavailable");
    const surface = await this.terrain.surface(args.terrainDirectory);
    if (args.avoidWater && !surface.waterCoverageKnown)
      throw new Error("TERRAIN_WATER_COVERAGE_UNAVAILABLE");
    if (args.textures && !surface.texturesKnown)
      throw new Error("TERRAIN_TEXTURE_COVERAGE_UNAVAILABLE");
    const b =
      args.area.type === "rectangle"
        ? args.area
        : {
            minX: args.area.center.x - args.area.radius,
            minY: args.area.center.y - args.area.radius,
            maxX: args.area.center.x + args.area.radius,
            maxY: args.area.center.y + args.area.radius,
          };
    if (
      b.minX < surface.bounds.minX ||
      b.minY < surface.bounds.minY ||
      b.maxX > surface.bounds.maxX ||
      b.maxY > surface.bounds.maxY
    )
      throw new Error("DECORATION_AREA_OUT_OF_TERRAIN_BOUNDS");
    const choices: Array<{
      resolved: Awaited<ReturnType<PlacementWorkspace["resolvePlaceable"]>>;
      weight: number;
    }> = [];
    const candidates: BrowseSearchResult[] = [];
    for (const object of args.objects) {
      const resolved = await this.resolvePlaceable("Doodad", object);
      choices.push({ resolved, weight: object.weight });
      if (!candidates.some((c) => c.key === resolved.key)) {
        const compact = await this.browse.search({
          ids: [resolved.id],
          catalogType: resolved.catalogType,
          dependency: resolved.dependency,
          limit: 1,
        });
        if (compact.results[0]) candidates.push(compact.results[0]);
      }
    }
    const raw = await this.workspace.readRaw(args.objectFile);
    const document = raw.text
      ? new PlacementDocument(raw.text, args.objectFile)
      : PlacementDocument.create(args.objectFile);
    if (document.validate().some((i) => i.severity === "error"))
      throw new Error("INVALID_EXISTING_OBJECTS");
    const existingPoints = args.avoidExisting
      ? document
          .list()
          .filter(
            (o) =>
              ["ObjectDoodad", "ObjectUnit"].includes(o.kind) && o.position,
          )
          .map((o) => {
            const [x, y, z] = o.position!.split(",").map(Number);
            return { x, y, z };
          })
      : [];
    let attempts = 0;
    const rejected = {
      holes: 0,
      protected: 0,
      water: 0,
      height: 0,
      slope: 0,
      texture: 0,
    };
    const positions = planPositions(
      { x: b.minX, y: b.minY, z: 0 },
      args.count,
      {
        type: "scatter",
        area: args.area,
        minimumDistance: args.minimumDistance,
        seed: args.seed,
        exclusionZones: args.exclusionZones,
      },
      {
        existingPoints,
        maxAttempts: args.maxAttempts,
        acceptPoint: (p) => {
          attempts++;
          const point = args.textures
            ? surface.sample(p)
            : surface.sampleGround(p);
          if (point.mask === 0) {
            rejected.holes++;
            return false;
          }
          if (args.avoidProtected && point.protected) {
            rejected.protected++;
            return false;
          }
          if (args.avoidWater && point.water?.length) {
            rejected.water++;
            return false;
          }
          if (
            (args.minHeight !== undefined && point.height < args.minHeight) ||
            (args.maxHeight !== undefined && point.height > args.maxHeight)
          ) {
            rejected.height++;
            return false;
          }
          if (
            point.slope > args.maxSlope ||
            (args.minSlope !== undefined && point.slope < args.minSlope)
          ) {
            rejected.slope++;
            return false;
          }
          if (
            args.textures &&
            !args.textures.some((t) =>
              point.textures?.some(
                (v) => v.id === t.id && v.weight >= t.minWeight,
              ),
            )
          ) {
            rejected.texture++;
            return false;
          }
          p.z = point.height + args.heightOffset;
          return true;
        },
      },
    );
    const random = seededRandom(args.seed ^ 0x51c2),
      totalWeight = choices.reduce((n, c) => n + c.weight, 0);
    const operations: PlacementMutation[] = positions.map((position) => {
      const roll = random() * totalWeight;
      let sum = 0;
      let choice = choices[choices.length - 1]!;
      for (const candidate of choices) {
        sum += candidate.weight;
        if (roll < sum) {
          choice = candidate;
          break;
        }
      }
      const scale =
        args.scaleRange.min +
        random() * (args.scaleRange.max - args.scaleRange.min);
      return {
        op: "add",
        object: {
          kind: "Doodad",
          catalogId: choice.resolved.id,
          sourceKey: choice.resolved.key,
          position,
          rotation:
            args.rotationRange.min +
            random() * (args.rotationRange.max - args.rotationRange.min),
          scale: { x: scale, y: scale, z: scale },
          flags: { HeightAbsolute: "1" },
        },
      };
    });
    const plan = await this.remember({
      request: {
        type: "scatterDoodads",
        ...args,
        candidates: choices.map((c) => c.resolved.key),
        terrainHashes: surface.sourceSha256,
        terrainDiskHashes: surface.diskSha256,
      },
      objectFile: args.objectFile,
      componentListFile: args.componentListFile,
      operations,
      candidates,
      seed: args.seed,
      minimumDistance: args.minimumDistance,
      bounds: surface.bounds,
      evidence: ["OBSERVED_CATALOG_XML", "INFERRED"],
      warnings: [
        "Ground height, slope, palette and rectangular water are diagnostics; native pathing/model footprints and runtime collisions remain unverified.",
        "Doodads use the observed HeightAbsolute=1 flag and sampled world Z.",
      ],
    });
    if (!plan.applied && plan.sourceSha256[raw.file] !== textHash(raw.text))
      throw new Error("OBJECTS_CHANGED_DURING_PLANNING");
    Object.assign(plan.sourceSha256, surface.sourceSha256);
    Object.assign(plan.diskSha256, surface.diskSha256);
    return {
      plan,
      summary: {
        objects: positions.length,
        surfaceCandidatesChecked: attempts,
        rejected,
        seed: args.seed,
        minimumDistance: args.minimumDistance,
        avoidExisting: args.avoidExisting,
        waterCoverage: surface.waterCoverageKnown
          ? "decoded rectangular entries"
          : "unavailable; filter explicitly disabled",
        collision: "UNAVAILABLE",
      },
    };
  }

  async snapObjects(input: SnapObjectsArgs) {
    const args = snapObjectsSchema.parse(input);
    if (!this.terrain) throw new Error("Terrain context is unavailable");
    const surface = await this.terrain.surface(args.terrainDirectory);
    if (args.avoidWater && !surface.waterCoverageKnown)
      throw new Error("TERRAIN_WATER_COVERAGE_UNAVAILABLE");
    const raw = await this.workspace.readRaw(args.objectFile),
      document = new PlacementDocument(raw.text, args.objectFile);
    if (document.validate().some((i) => i.severity === "error"))
      throw new Error("INVALID_EXISTING_OBJECTS");
    const objects = new Map(document.list().map((o) => [o.id, o]));
    const operations: PlacementMutation[] = [];
    for (const objectId of args.objectIds) {
      const object = objects.get(objectId);
      if (
        !object?.position ||
        !["ObjectUnit", "ObjectDoodad"].includes(object.kind)
      )
        throw new Error(`SNAP_OBJECT_NOT_PLACEABLE: ${objectId}`);
      const [x, y] = object.position.split(",").map(Number),
        point = surface.sampleGround({ x, y });
      if (
        point.mask === 0 ||
        point.slope > args.maxSlope ||
        (args.avoidWater && point.water?.length)
      )
        throw new Error(`SNAP_OBJECT_ON_HOLE_WATER_OR_SLOPE: ${objectId}`);
      operations.push({
        op: "move",
        objectId,
        position: { x, y, z: point.height + args.heightOffset },
      });
      if (object.kind === "ObjectDoodad" && object.flags.HeightAbsolute !== "1")
        operations.push({ op: "setHeightAbsolute", objectId, value: true });
    }
    const plan = await this.remember({
      request: {
        type: "snapObjects",
        ...args,
        objectHash: textHash(raw.text),
        terrainHashes: surface.sourceSha256,
        terrainDiskHashes: surface.diskSha256,
      },
      objectFile: args.objectFile,
      componentListFile: args.componentListFile,
      operations,
      candidates: [],
      bounds: surface.bounds,
      evidence: ["INFERRED"],
      warnings: [
        "Existing IDs, XY, rotation, scale and unknown XML are preserved; Doodads set observed HeightAbsolute=1. Native geometry/runtime acceptance is unverified.",
      ],
    });
    if (!plan.applied && plan.sourceSha256[raw.file] !== textHash(raw.text))
      throw new Error("OBJECTS_CHANGED_DURING_PLANNING");
    Object.assign(plan.sourceSha256, surface.sourceSha256);
    Object.assign(plan.diskSha256, surface.diskSha256);
    return { plan, objects: args.objectIds.length, groundSnapping: true };
  }

  async mutate(args: {
    op: "move" | "rotate" | "scale" | "remove";
    objectFile?: string;
    componentListFile?: string;
    objectId: number;
    position?: Position3;
    rotation?: number;
    scale?: number | Scale3;
    bounds?: PlacementBounds;
  }) {
    let operation: PlacementMutation;
    if (args.op === "move") {
      if (!args.position) throw new Error("move requires position");
      operation = {
        op: "move",
        objectId: args.objectId,
        position: args.position,
      };
    } else if (args.op === "rotate") {
      if (args.rotation === undefined)
        throw new Error("rotate requires rotation");
      operation = {
        op: "rotate",
        objectId: args.objectId,
        rotation: args.rotation,
      };
    } else if (args.op === "scale") {
      const scale = normalizedScale(args.scale);
      if (!scale) throw new Error("scale requires scale");
      operation = { op: "scale", objectId: args.objectId, scale };
    } else operation = { op: "remove", objectId: args.objectId };
    return this.remember({
      request: args,
      objectFile: args.objectFile ?? "Objects",
      componentListFile:
        args.componentListFile ?? "ComponentList.SC2Components",
      operations: [operation],
      candidates: [],
      evidence: ["PROVEN_BY_REAL_MAP"],
      warnings:
        args.op === "remove"
          ? [
              "Trigger/Galaxy references to placed object IDs are not discoverable and are not updated.",
            ]
          : [],
      ...(args.bounds ? { bounds: args.bounds } : {}),
    });
  }

  async scan(objectFile = "Objects") {
    const raw = await this.workspace.readRaw(objectFile);
    const document =
      raw.exists || raw.staged
        ? new PlacementDocument(raw.text, raw.file)
        : PlacementDocument.create(raw.file);
    const objects = document.list();
    return {
      file: raw.file,
      exists: raw.exists,
      staged: raw.staged,
      sha256: document.sha256,
      version: scanVersion(document.source),
      objects,
      counts: Object.fromEntries(
        [...new Set(objects.map((entry) => entry.kind))].map((kind) => [
          kind,
          objects.filter((entry) => entry.kind === kind).length,
        ]),
      ),
      validation: await this.validateDocument(document),
    };
  }

  async createLocation(args: {
    locationType: LocationType;
    queries?: string[];
    area: PlacementArea;
    objectCount?: number;
    objectBudget?: number;
    density?: number;
    seed?: number;
    minimumDistance?: number;
    scaleRange?: { min: number; max: number };
    rotationRange?: { min: number; max: number };
    exclusionZones?: ExclusionZone[];
    candidateOverrides?: string[];
    excludedObjects?: string[];
    dependency?: string;
    objectFile?: string;
    componentListFile?: string;
    bounds?: PlacementBounds;
    landmarkCount?: number;
    includeUnits?: boolean;
  }) {
    if (args.includeUnits)
      throw new Error(
        "createLocation includeUnits is not enabled in this evidence tier; add units explicitly with placement.addUnit",
      );
    const queries = [
      ...(args.queries ?? []),
      ...LOCATION_TERMS[args.locationType],
      ...(args.candidateOverrides ?? []),
    ];
    if (!queries.length)
      throw new Error("custom location requires queries or candidateOverrides");
    const excluded = new Set(
      (args.excludedObjects ?? []).map((value) => value.toLowerCase()),
    );
    const candidateMap = new Map<string, BrowseSearchResult>();
    const searches: Array<{ query: string; total: number; accepted: number }> =
      [];
    for (const query of uniqueStrings(queries)) {
      const result = await this.browse.search({
        query,
        objectKind: "Doodad",
        dependency: args.dependency,
        placeable: true,
        limit: 40,
      });
      let accepted = 0;
      for (const candidate of result.results) {
        if (excluded.has(candidate.id.toLowerCase())) continue;
        if (
          !["MAP_LOCAL", "AVAILABLE_THROUGH_DEPENDENCY"].includes(
            candidate.availability,
          )
        )
          continue;
        candidateMap.set(candidate.key, candidate);
        accepted++;
      }
      searches.push({ query, total: result.total, accepted });
    }
    const candidates = [...candidateMap.values()].sort(
      (a, b) => b.score - a.score || a.id.localeCompare(b.id),
    );
    if (!candidates.length)
      throw new Error(
        `No dependency-ready placeable Doodads found for ${args.locationType}; searches=${JSON.stringify(searches)}`,
      );
    const objectCount =
      args.objectCount ??
      args.objectBudget ??
      Math.max(
        1,
        Math.floor(
          areaMeasure(args.area) * Math.max(0.001, args.density ?? 0.02),
        ),
      );
    if (
      !Number.isInteger(objectCount) ||
      objectCount < 1 ||
      objectCount > 5_000
    )
      throw new Error("createLocation object count must be 1..5000");
    const seed = args.seed ?? 1;
    const random = seededRandom(seed);
    const settlement = [
      "city",
      "village",
      "industrial",
      "militaryBase",
    ].includes(args.locationType);
    const areaBounds =
      args.area.type === "circle"
        ? {
            minX: args.area.center.x - args.area.radius,
            maxX: args.area.center.x + args.area.radius,
            minY: args.area.center.y - args.area.radius,
            maxY: args.area.center.y + args.area.radius,
          }
        : args.area;
    const centerX = (areaBounds.minX + areaBounds.maxX) / 2;
    const centerY = (areaBounds.minY + areaBounds.maxY) / 2;
    const corridorHalfWidth =
      Math.min(
        areaBounds.maxX - areaBounds.minX,
        areaBounds.maxY - areaBounds.minY,
      ) * 0.04;
    const reservedPaths: ExclusionZone[] = settlement
      ? [
          {
            type: "rectangle",
            minX: areaBounds.minX,
            maxX: areaBounds.maxX,
            minY: centerY - corridorHalfWidth,
            maxY: centerY + corridorHalfWidth,
          },
          {
            type: "rectangle",
            minX: centerX - corridorHalfWidth,
            maxX: centerX + corridorHalfWidth,
            minY: areaBounds.minY,
            maxY: areaBounds.maxY,
          },
        ]
      : [];
    const exclusionZones = [...(args.exclusionZones ?? []), ...reservedPaths];
    const positions = planPositions(
      args.area.type === "circle"
        ? args.area.center
        : { x: args.area.minX, y: args.area.minY, z: args.area.z },
      objectCount,
      {
        type: "scatter",
        area: args.area,
        minimumDistance: args.minimumDistance ?? 0,
        seed,
        exclusionZones,
      },
    );
    const scaleMin = args.scaleRange?.min ?? 1;
    const scaleMax = args.scaleRange?.max ?? scaleMin;
    const rotationMin = args.rotationRange?.min ?? 0;
    const rotationMax = args.rotationRange?.max ?? Math.PI * 2;
    if (scaleMin <= 0 || scaleMax < scaleMin)
      throw new Error("Invalid scaleRange");
    const landmarkCount = Math.max(
      0,
      Math.min(args.landmarkCount ?? 0, objectCount),
    );
    const operations: PlacementMutation[] = positions.map((position, index) => {
      const candidate = candidates[Math.floor(random() * candidates.length)]!;
      const scaleValue = scaleMin + random() * (scaleMax - scaleMin);
      const landmarkScale =
        index < landmarkCount ? scaleValue * 1.25 : scaleValue;
      return {
        op: "add",
        object: {
          kind: "Doodad",
          catalogId: candidate.id,
          sourceKey: candidate.key,
          position,
          rotation: rotationMin + random() * (rotationMax - rotationMin),
          scale: { x: landmarkScale, y: landmarkScale, z: landmarkScale },
        },
      };
    });
    const plan = this.remember({
      request: {
        type: "createLocation",
        ...args,
        candidateKeys: candidates.map((entry) => entry.key),
      },
      objectFile: args.objectFile ?? "Objects",
      componentListFile:
        args.componentListFile ?? "ComponentList.SC2Components",
      operations,
      candidates,
      seed,
      minimumDistance: args.minimumDistance ?? 0,
      evidence: ["PROVEN_BY_REAL_MAP", "OBSERVED_CATALOG_XML"],
      warnings: [
        "This is an object-based location layout. Terrain textures, cliffs, pathing and ground-height sampling are not modified.",
        "Paths and runtime collision are not claimed unless supplied as exclusion zones.",
      ],
      ...(args.bounds ? { bounds: args.bounds } : {}),
    });
    return {
      plan: await plan,
      searches,
      composition: {
        mode: settlement
          ? "settlement-quadrants-with-reserved-crossroads"
          : "object-based-location",
        locationType: args.locationType,
        objects: operations.length,
        candidates: candidates.length,
        landmarks: landmarkCount,
        reservedPaths,
        exclusionZones,
        pathingProof:
          "UNAVAILABLE: corridors constrain object centers, not model footprints",
      },
    };
  }

  async decorate(
    args: Omit<
      Parameters<PlacementWorkspace["createLocation"]>[0],
      "locationType"
    >,
  ) {
    return this.createLocation({ ...args, locationType: "custom" });
  }

  plan(id: string): PlacementPlan {
    const plan = this.plans.get(id);
    if (!plan) throw new Error(`Placement plan not found: ${id}`);
    return plan;
  }

  async preview(id: string) {
    const plan = this.plan(id);
    const raw = await this.workspace.readRaw(plan.objectFile);
    const document =
      raw.exists || raw.staged
        ? new PlacementDocument(raw.text, raw.file)
        : PlacementDocument.create(raw.file);
    for (const file of Object.keys(plan.sourceSha256)) {
      if (file !== plan.objectFile && file !== plan.componentListFile) {
        const effective = await this.workspace.binary.read(file);
        const disk = await this.workspace.binary.read(file, false);
        if (
          createHash("sha256").update(effective.bytes).digest("hex") !==
            plan.sourceSha256[file] ||
          createHash("sha256").update(disk.bytes).digest("hex") !==
            plan.diskSha256[file]
        )
          throw new Error(`STALE_PLACEMENT_PLAN: terrain ${file}`);
        continue;
      }
      const effective = await this.workspace.readRaw(file);
      const disk = await this.workspace.readRaw(file, false);
      if (
        textHash(effective.text) !== plan.sourceSha256[effective.file] ||
        textHash(disk.text) !== plan.diskSha256[disk.file]
      )
        throw new Error(
          `STALE_PLACEMENT_PLAN: ${file} changed after planning; create a new plan with a different request/seed`,
        );
    }
    const before = document.source;
    const applied = document.apply(plan.operations);
    const validation = await this.validateDocument(document, plan);
    return {
      plan: compactPlacementPlan(plan, 50),
      applied,
      validation,
      diff: sourceDiff(before, document.source),
      beforeSha256: createHash("sha256").update(before).digest("hex"),
      afterSha256: document.sha256,
    };
  }

  async validate(planId?: string, objectFile = "Objects") {
    if (planId) return (await this.preview(planId)).validation;
    const raw = await this.workspace.readRaw(objectFile);
    const document =
      raw.exists || raw.staged
        ? new PlacementDocument(raw.text, raw.file)
        : PlacementDocument.create(raw.file);
    return this.validateDocument(document);
  }

  private async validateDocument(
    document: PlacementDocument,
    plan?: PlacementPlan,
  ): Promise<PlacementValidationReport> {
    const issues: PlacementValidationIssue[] = document.validate();
    if (plan) {
      if (
        Object.keys(plan.sourceSha256).some(
          (file) =>
            file !== plan.objectFile &&
            file !== plan.componentListFile &&
            plan.sourceSha256[file] !== plan.diskSha256[file],
        )
      )
        issues.push({
          severity: "error",
          code: "TERRAIN_HAS_UNCOMMITTED_DRAFT",
          message:
            "Save or discard Terrain drafts and replan standalone ground-based placement; combined terrain/object commits use placement.createLocation with terrain.",
        });
      const keys = new Set(
        plan.operations.flatMap((op) =>
          op.op === "add" && op.object.sourceKey ? [op.object.sourceKey] : [],
        ),
      );
      const current = await this.browse.index();
      for (const key of keys) {
        const candidate = current.entries.find((entry) => entry.key === key);
        if (
          !candidate ||
          !candidate.placeable ||
          !["MAP_LOCAL", "AVAILABLE_THROUGH_DEPENDENCY"].includes(
            candidate.availability,
          )
        )
          issues.push({
            severity: "error",
            code: "DEPENDENCY_UNAVAILABLE",
            message: `Placement source is no longer dependency-ready: ${key}`,
          });
      }
    }
    if (plan?.bounds)
      for (const operation of plan.operations) {
        const position =
          operation.op === "add" || operation.op === "move"
            ? operation.op === "add"
              ? operation.object.position
              : operation.position
            : undefined;
        if (position && !positionInBounds(position, plan.bounds))
          issues.push({
            severity: "error",
            code: "OUT_OF_BOUNDS",
            message: `Position ${position.x},${position.y},${position.z} is outside explicit bounds`,
          });
      }
    if (plan?.minimumDistance !== undefined && plan.minimumDistance > 0) {
      const positions = plan.operations.flatMap((operation) =>
        operation.op === "add" ? [operation.object.position] : [],
      );
      const index = new DistanceIndex<Position3 & { index: number }>(
        plan.minimumDistance,
      );
      let distanceErrors = 0;
      for (const [right, point] of positions.entries()) {
        for (const other of index.near(point))
          if (distanceErrors++ < 100)
            issues.push({
              severity: "error",
              code: "MINIMUM_DISTANCE",
              message: `Planned objects ${other.index} and ${right} are closer than ${plan.minimumDistance}`,
            });
        index.add({ ...point, index: right });
      }
    }
    const errors = issues.filter((entry) => entry.severity === "error").length;
    const warnings = issues.filter(
      (entry) => entry.severity === "warning",
    ).length;
    return {
      valid: errors === 0,
      errors,
      warnings,
      issues,
      checks: {
        xml: issues.some((entry) => entry.code === "MALFORMED_XML")
          ? "FAIL"
          : "PASS",
        duplicateIds: issues.some(
          (entry) => entry.code === "DUPLICATE_OBJECT_ID",
        )
          ? "FAIL"
          : "PASS",
        bounds: plan?.bounds
          ? issues.some((entry) => entry.code === "OUT_OF_BOUNDS")
            ? "FAIL"
            : "PASS"
          : "UNAVAILABLE",
        dependency: plan
          ? issues.some((entry) => entry.code === "DEPENDENCY_UNAVAILABLE")
            ? "FAIL"
            : "PASS"
          : "UNAVAILABLE",
        minimumDistance:
          plan?.minimumDistance !== undefined
            ? issues.some((entry) => entry.code === "MINIMUM_DISTANCE")
              ? "FAIL"
              : "PASS"
            : "UNAVAILABLE",
        pathing: "UNAVAILABLE",
        runtimeCollision: "UNAVAILABLE",
      },
    };
  }

  async apply(
    id: string,
    options: {
      dryRun?: boolean;
      stage?: boolean;
      backup?: boolean;
      expectedSha256?: Record<string, string>;
    } = {},
  ) {
    const plan = this.plan(id);
    if (plan.applied)
      return {
        accepted: true,
        alreadyApplied: true,
        planId: id,
        appliedAt: plan.appliedAt,
        changed: false,
      };
    const preview = await this.preview(id);
    if (!preview.validation.valid)
      return {
        accepted: false,
        planId: id,
        validation: preview.validation,
        diff: preview.diff,
      };
    const transaction = await this.workspace.applyRawTransaction(
      [plan.objectFile, plan.componentListFile],
      (sources) => {
        const next = new Map(sources);
        const source = sources.get(plan.objectFile) ?? "";
        const document = source
          ? new PlacementDocument(source, plan.objectFile)
          : PlacementDocument.create(plan.objectFile);
        for (const [file, sourceText] of sources)
          if (textHash(sourceText) !== plan.sourceSha256[file])
            throw new Error(`STALE_PLACEMENT_PLAN: ${file}`);
        document.apply(plan.operations);
        const reparsed = new PlacementDocument(
          document.source,
          plan.objectFile,
        );
        const issues = reparsed.validate();
        if (issues.some((entry) => entry.severity === "error"))
          throw new Error(
            `Placement round-trip validation failed: ${JSON.stringify(issues.slice(0, 10))}`,
          );
        next.set(plan.objectFile, document.source);
        next.set(
          plan.componentListFile,
          componentListWithObjects(sources.get(plan.componentListFile) ?? ""),
        );
        return next;
      },
      {
        dryRun: options.dryRun ?? true,
        stage: options.stage ?? true,
        backup: options.backup ?? true,
        expectedSha256: { ...options.expectedSha256, ...plan.diskSha256 },
        summary: `Apply placement plan ${id} atomically`,
      },
    );
    if (!(options.dryRun ?? true)) {
      plan.applied = true;
      plan.appliedAt = new Date().toISOString();
    }
    return {
      accepted: true,
      planId: id,
      transaction,
      validation: preview.validation,
      applied: !(options.dryRun ?? true),
      idempotency: "The same in-memory plan cannot be committed twice.",
    };
  }

  async rollback(
    objectFile = "Objects",
    componentListFile = "ComponentList.SC2Components",
    dryRun = true,
  ) {
    const files = [objectFile, componentListFile];
    const staged = (
      await Promise.all(files.map((file) => this.workspace.readRaw(file)))
    ).filter((raw) => raw.staged);
    if (staged.length) {
      if (!dryRun) for (const raw of staged) this.workspace.discard(raw.file);
      return {
        rolledBack: !dryRun,
        mode: "discard-staged-draft",
        dryRun,
        files: staged.map((raw) => raw.file),
      };
    }
    const backupPath = `${this.workspace.resolveUserPath(objectFile)}.sc2uimcp.bak`;
    const backup = await fs.readFile(backupPath, "utf8").catch(() => undefined);
    if (backup === undefined)
      throw new Error(`No staged draft or backup exists for ${objectFile}`);
    const restores = new Map([[objectFile, backup]]);
    const componentBackup = await fs
      .readFile(
        `${this.workspace.resolveUserPath(componentListFile)}.sc2uimcp.bak`,
        "utf8",
      )
      .catch(() => undefined);
    if (componentBackup !== undefined)
      restores.set(componentListFile, componentBackup);
    const transaction = await this.workspace.applyRawTransaction(
      [...restores.keys()],
      (sources) => new Map([...sources, ...restores]),
      {
        dryRun,
        stage: false,
        backup: false,
        summary: `Rollback placement files from backups`,
      },
    );
    return { rolledBack: !dryRun, mode: "backup-restore", dryRun, transaction };
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function areaMeasure(area: PlacementArea): number {
  return area.type === "circle"
    ? Math.PI * area.radius * area.radius
    : Math.abs((area.maxX - area.minX) * (area.maxY - area.minY));
}
function scanVersion(source: string): string | null {
  return (
    source.match(/<PlacedObjects\b[^>]*\bVersion=["']([^"']+)/i)?.[1] ?? null
  );
}
function sourceDiff(
  before: string,
  after: string,
): {
  changed: boolean;
  addedBytes: number;
  removedBytes: number;
  preview: string;
} {
  if (before === after)
    return {
      changed: false,
      addedBytes: 0,
      removedBytes: 0,
      preview: "No changes",
    };
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  return {
    changed: true,
    addedBytes: Buffer.byteLength(added),
    removedBytes: Buffer.byteLength(removed),
    preview: `--- before\n${removed.slice(0, 2000)}\n+++ after\n${added.slice(0, 5000)}${added.length > 5000 ? "\n… truncated …" : ""}`,
  };
}
