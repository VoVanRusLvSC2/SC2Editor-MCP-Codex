import { Workspace } from "../../core/workspace.js";
import { bytesHash } from "../../core/binaryTransactions.js";
import { PlacementDocument, componentListWithObjects } from "../placement/document.js";
import type { PlacementWorkspace } from "../placement/workspace.js";
import type { BrowseWorkspace } from "../browse/workspace.js";
import type { TerrainState } from "./operations.js";
import type { TerrainArea, TerrainIssue, TerrainPlanSummary, TerrainPlanRequest } from "./types.js";
import { featureRecipe, type GenerateArgs } from "./recipes.js";
import type { LocationRoute } from "../placement/types.js";
import { terrainLocationSchema } from "./schemas.js";
import { corridorWithinArea } from "./geometry.js";

export type TerrainLocationRequest = Parameters<PlacementWorkspace["createLocation"]>[0] & {
  terrain: Omit<GenerateArgs, "area"> & { routes?: LocationRoute[] };
  maxSlope?: number;
};
export type LocationPlacementPort = Pick<
  PlacementWorkspace,
  "createLocation" | "preview" | "addBatch" | "validateDocument"
>;
interface LocationTerrainPort {
  workspace: Workspace;
  browse?: Pick<BrowseWorkspace, "index">;
  placement?: LocationPlacementPort;
  state(directory?: string, planId?: string): Promise<TerrainState>;
  plan(args: TerrainPlanRequest): Promise<TerrainPlanSummary>;
  checked(id: string): Promise<{
    summary: TerrainPlanSummary;
    before: Map<string, Buffer>;
    next: Map<string, Buffer>;
    dependencyHashes: Record<string, string>;
  }>;
  generateOperations(args: GenerateArgs, state: TerrainState): TerrainPlanRequest["operations"];
  remember(
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
  ): TerrainPlanSummary;
  pinBrowseFingerprint(id: string, fingerprint: string): void;
}
/** Coordinate terrain and objects in one guarded plan, without owning their repositories. */
export async function planTerrainLocation(port: LocationTerrainPort, args: TerrainLocationRequest) {
  if (!port.placement) throw new Error("PLACEMENT_CONTEXT_UNAVAILABLE");
  const placementArea = args.area;
  const area: TerrainArea =
    placementArea.type === "polygon"
      ? { type: "polygon", points: placementArea.points.map((p) => ({ x: p.x, y: p.y })) }
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
  const { routes, topology, ...settings } = terrainLocationSchema.parse(args.terrain);
  if (topology)
    throw Error(
      "LOCATION_NATIVE_TOPOLOGY_REQUIRES_OWNED_INTENT: use terrain.landscape.plan intent",
    );
  for (const route of routes)
    if ((route.flatten || route.texture) && !corridorWithinArea(area, route.points, route.width))
      throw Error(
        "LOCATION_ROUTE_OUTSIDE_AREA: the whole painted/flattened road must fit inside its location; use a separate road plan for cross-zone connections",
      );
  const generation = {
    ...settings,
    area,
    seed: args.seed ?? args.terrain.seed,
  };
  const source = await port.state(generation.directory);
  const roads = routes.flatMap((route) => {
    const operations = route.flatten
      ? featureRecipe("road", route)
      : route.texture
        ? [
            {
              op: "texture.paint" as const,
              area: { type: "corridor" as const, points: route.points, width: route.width },
              texture: route.texture,
              edgeBlend: route.edgeBlend,
            },
          ]
        : [];
    return operations.map((op) => ({ ...op, protectedAreas: settings.protectedAreas }));
  });
  const terrainPlan = await port.plan({
    directory: generation.directory,
    operations: [...port.generateOperations(generation, source), ...roads],
  });
  const stored = await port.checked(terrainPlan.id);
  const state = await port.state("", terrainPlan.id);
  const placed = await port.placement.createLocation({
    ...args,
    reservedCorridors: [...(args.reservedCorridors ?? []), ...routes],
  });
  const preview = await port.placement.preview(placed.plan.id);
  if (!preview.validation.valid) throw new Error("LOCATION_PLACEMENT_VALIDATION_FAILED");
  const objectFile = placed.plan.objectFile,
    componentFile = placed.plan.componentListFile;
  const raw = await port.workspace.readRaw(objectFile),
    component = await port.workspace.readRaw(componentFile);
  const document = raw.text
    ? new PlacementDocument(raw.text, objectFile)
    : PlacementDocument.create(objectFile);
  const operations = placed.plan.operations.map((op) => {
    if (op.op !== "add") return op;
    const sample = state.heights.sample(op.object.position);
    if (sample.mask === 0 || (args.maxSlope !== undefined && sample.slope > args.maxSlope))
      throw new Error("LOCATION_OBJECT_ON_HOLE_OR_EXCESSIVE_SLOPE: adjust exclusions or seed");
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
    const key = port.workspace.binary.key(file);
    if (next.has(key) && !next.get(key)!.equals(bytes))
      throw new Error("LOCATION_COMPONENT_FILE_CONFLICT");
    before.set(key, bytes);
    sourceSha256[key] = bytesHash(bytes);
    diskSha256[key] = bytesHash((await port.workspace.binary.read(key, false)).bytes);
  }
  next.set(port.workspace.binary.key(objectFile), Buffer.from(document.source));
  next.set(
    port.workspace.binary.key(componentFile),
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
  const summary = port.remember(
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
  if (port.browse) port.pinBrowseFingerprint(summary.id, (await port.browse.index()).fingerprint);
  return {
    plan: summary,
    objects: operations.length,
    composition: placed.composition,
    atomicComponents: "terrain + Objects + ComponentList",
    reservedRoutes: routes.map((r) => ({ points: r.points, width: r.width })),
    routeClearanceScope:
      "Decoration pivot exclusions; measured mesh bounds, engine pathing and buildability need separate checks",
    groundSnapping: true,
  };
}
