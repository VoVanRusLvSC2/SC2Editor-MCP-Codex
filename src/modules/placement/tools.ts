import {PointWorkspace,pointPlanSchema} from "./points.js";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PlacementWorkspace } from "./workspace.js";
import { terrainGenerateOptions } from "../terrain/schemas.js";
import {
  scatterDoodadsSchema,
  snapObjectsSchema,
} from "./decorationSchemas.js";
import { compactPlacementPlan } from "./summary.js";
import type {
  PlacementBounds,
  PlacementLayout,
  Position3,
  Scale3,
} from "./types.js";

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

const position = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
const scale3 = z.object({
  x: z.number().positive(),
  y: z.number().positive(),
  z: z.number().positive(),
});
const scale = z.union([z.number().positive(), scale3]);
const bounds = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
  minZ: z.number().optional(),
  maxZ: z.number().optional(),
});
const area = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    center: position,
    radius: z.number().positive(),
  }),
  z.object({
    type: z.literal("rectangle"),
    minX: z.number(),
    minY: z.number(),
    maxX: z.number(),
    maxY: z.number(),
    z: z.number(),
  }),
]);
const exclusion = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    center: z.object({ x: z.number(), y: z.number() }),
    radius: z.number().positive(),
  }),
  z.object({
    type: z.literal("rectangle"),
    minX: z.number(),
    minY: z.number(),
    maxX: z.number(),
    maxY: z.number(),
  }),
]);
const layout = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single") }),
  z.object({
    type: z.literal("line"),
    spacing: z.number().positive(),
    angle: z.number().optional(),
  }),
  z.object({
    type: z.literal("grid"),
    columns: z.number().int().positive(),
    spacingX: z.number().positive(),
    spacingY: z.number().positive(),
  }),
  z.object({
    type: z.literal("circle"),
    radius: z.number().positive(),
    startAngle: z.number().optional(),
  }),
  z.object({
    type: z.literal("scatter"),
    area,
    minimumDistance: z.number().nonnegative().optional(),
    seed: z.number().int().optional(),
    exclusionZones: z.array(exclusion).max(100).optional(),
  }),
]);
const commonFiles = {
  objectFile: z.string().default("Objects"),
  componentListFile: z.string().default("ComponentList.SC2Components"),
};
const selector = {
  query: z.string().optional(),
  id: z.string().optional(),
  key: z.string().optional(),
  catalogType: z.string().optional(),
};
const addCommon = {
  ...commonFiles,
  ...selector,
  position,
  snapToTerrain: z.boolean().default(false),
  terrainDirectory: z.string().optional(),
  maxSlope: z.number().finite().nonnegative().optional(),
  rotation: z.number().optional(),
  scale: scale.optional(),
  owner: z.number().int().min(0).max(15).optional(),
  variation: z.number().int().nonnegative().optional(),
  flags: z.record(z.string(), z.string()).optional(),
  count: z.number().int().min(1).max(5000).default(1),
  layout: layout.optional(),
  bounds: bounds.optional(),
};
const location = {
  queries: z.array(z.string()).max(30).optional(),
  area,
  objectCount: z.number().int().min(1).max(5000).optional(),
  objectBudget: z.number().int().min(1).max(5000).optional(),
  density: z.number().positive().optional(),
  seed: z.number().int().default(1),
  minimumDistance: z.number().nonnegative().default(0),
  scaleRange: z
    .object({ min: z.number().positive(), max: z.number().positive() })
    .optional(),
  rotationRange: z.object({ min: z.number(), max: z.number() }).optional(),
  exclusionZones: z.array(exclusion).max(100).optional(),
  candidateOverrides: z.array(z.string()).max(100).optional(),
  excludedObjects: z.array(z.string()).max(500).optional(),
  dependency: z.string().optional(),
  ...commonFiles,
  bounds: bounds.optional(),
  landmarkCount: z.number().int().min(0).max(100).optional(),
  includeUnits: z.boolean().default(false),
  terrain: z.object(terrainGenerateOptions).strict().optional(),
  maxSlope: z.number().finite().nonnegative().optional(),
};

export interface PlacementToolContext {
  workspace: PlacementWorkspace;
}
export const addPlacementSchema = z.object(addCommon);
export const createLocationSchema = z.object({
  locationType: z.enum([
    "forest",
    "desert",
    "city",
    "village",
    "industrial",
    "militaryBase",
    "ruins",
    "swamp",
    "cave",
    "alien",
    "terran",
    "protoss",
    "zerg",
    "mixedNature",
    "custom",
  ]),
  ...location,
});

export function registerPlacementTools(
  server: McpServer,
  context: PlacementToolContext,
): void {
  const placement = context.workspace;
  let pointContext:PointWorkspace|undefined;
  const points=()=>pointContext ??=new PointWorkspace(placement.workspace);
  server.registerTool("placement.points.inspect",{description:"Inspect native ObjectPoint entries, preserving all other Objects data.",inputSchema:z.object({directory:z.string().default("")}).strict()},async a=>textResult(await points().inspect(a.directory)));
  server.registerTool("placement.points.plan",{description:"Plan v27 native points create/update/remove. StartLoc is a point marker; assigning it to a player is separate metadata work.",inputSchema:pointPlanSchema},async a=>textResult(await points().plan(a)));
  server.registerTool("placement.points.apply",{description:"Stage a point plan and component manifest together; defaults to dry run. Commit with ui.save on the returned Objects file; discard with ui.discard.",inputSchema:z.object({planId:z.string().min(1),dryRun:z.boolean().default(true)}).strict()},async a=>textResult(await points().apply(a.planId,a.dryRun)));

  server.registerTool(
    "placement.scatterDoodads",
    {
      description:
        "Plan a seeded weighted mix of real Doodads on sampled Terrain, with height/slope/texture filters, water/native-geometry exclusions and minimum distance from planned and existing object centers. Does not claim model collision/pathing.",
      inputSchema: scatterDoodadsSchema,
    },
    async (args) => {
      const result = await placement.scatterDoodads(args);
      return textResult({ ...result, plan: compactPlacementPlan(result.plan) });
    },
  );
  server.registerTool(
    "placement.snapToTerrain",
    {
      description:
        "Plan ground-height updates for selected existing Unit/Doodad IDs while preserving XY and unknown XML; sets observed Doodad HeightAbsolute=1. Rejects holes, water and excessive slope; never writes until placement.apply.",
      inputSchema: snapObjectsSchema,
    },
    async (args) => {
      const result = await placement.snapObjects(args);
      return textResult({ ...result, plan: compactPlacementPlan(result.plan) });
    },
  );
  server.registerTool(
    "placement.scan",
    {
      description:
        "Parse the real plain-XML Objects component losslessly and report ObjectUnit/ObjectDoodad/generic placed objects, ids and validation.",
      inputSchema: z.object({ objectFile: z.string().default("Objects") }),
    },
    async ({ objectFile }) => textResult(await placement.scan(objectFile)),
  );
  server.registerTool(
    "placement.addUnit",
    {
      description:
        "Resolve one real dependency-ready Unit through browse.*, then create a safe previewable placement plan. Supports single/line/grid/circle/scatter.",
      inputSchema: z.object(addCommon),
    },
    async (args) =>
      textResult(
        await placement.addUnit({
          ...args,
          position: args.position as Position3,
          scale: args.scale as number | Scale3 | undefined,
          layout: args.layout as PlacementLayout | undefined,
          bounds: args.bounds as PlacementBounds | undefined,
        }),
      ),
  );
  server.registerTool(
    "placement.addDoodad",
    {
      description:
        "Resolve one real dependency-ready Doodad through browse.*, then create a safe previewable placement plan. Does not guess a Type id.",
      inputSchema: z.object(addCommon),
    },
    async (args) =>
      textResult(
        await placement.addDoodad({
          ...args,
          position: args.position as Position3,
          scale: args.scale as number | Scale3 | undefined,
          layout: args.layout as PlacementLayout | undefined,
          bounds: args.bounds as PlacementBounds | undefined,
        }),
      ),
  );
  server.registerTool(
    "placement.addBatch",
    {
      description:
        "Resolve and plan up to 5000 mixed Unit/Doodad placements as one atomic transaction.",
      inputSchema: z.object({
        ...commonFiles,
        bounds: bounds.optional(),
        objects: z
          .array(
            z.object({
              kind: z.enum(["Unit", "Doodad"]),
              ...selector,
              position,
              rotation: z.number().optional(),
              scale: scale.optional(),
              owner: z.number().int().min(0).max(15).optional(),
              variation: z.number().int().nonnegative().optional(),
              flags: z.record(z.string(), z.string()).optional(),
            }),
          )
          .min(1)
          .max(5000),
      }),
    },
    async (args) =>
      textResult(
        await placement.addBatch(
          args as Parameters<PlacementWorkspace["addBatch"]>[0],
        ),
      ),
  );
  server.registerTool(
    "placement.move",
    {
      description:
        "Create a minimal-diff plan to move one placed object by numeric object Id.",
      inputSchema: z.object({
        ...commonFiles,
        objectId: z.number().int().positive(),
        position,
        bounds: bounds.optional(),
      }),
    },
    async (args) =>
      textResult(
        await placement.mutate({ ...args, op: "move" } as Parameters<
          PlacementWorkspace["mutate"]
        >[0]),
      ),
  );
  server.registerTool(
    "placement.rotate",
    {
      description:
        "Create a minimal-diff plan to rotate one placed object. Rotation is written in the real map's numeric field; real maps demonstrate radian values.",
      inputSchema: z.object({
        ...commonFiles,
        objectId: z.number().int().positive(),
        rotation: z.number(),
      }),
    },
    async (args) =>
      textResult(
        await placement.mutate({ ...args, op: "rotate" } as Parameters<
          PlacementWorkspace["mutate"]
        >[0]),
      ),
  );
  server.registerTool(
    "placement.scale",
    {
      description:
        "Create a minimal-diff plan to set the real three-component Scale attribute.",
      inputSchema: z.object({
        ...commonFiles,
        objectId: z.number().int().positive(),
        scale,
      }),
    },
    async (args) =>
      textResult(
        await placement.mutate({ ...args, op: "scale" } as Parameters<
          PlacementWorkspace["mutate"]
        >[0]),
      ),
  );
  server.registerTool(
    "placement.remove",
    {
      description:
        "Create a minimal source-span removal plan. Trigger/Galaxy references cannot currently be proven and are warned about.",
      inputSchema: z.object({
        ...commonFiles,
        objectId: z.number().int().positive(),
      }),
    },
    async (args) =>
      textResult(await placement.mutate({ ...args, op: "remove" })),
  );
  server.registerTool(
    "placement.decorate",
    {
      description:
        "Build one deterministic custom object-decoration batch from browse-resolved real Doodads. Terrain composition uses placement.createLocation.",
      inputSchema: z.object(location),
    },
    async (args) => {
      if (args.terrain)
        throw new Error(
          "Use placement.createLocation to combine terrain and objects",
        );
      return textResult(
        await placement.decorate(
          args as Parameters<PlacementWorkspace["decorate"]>[0],
        ),
      );
    },
  );
  server.registerTool(
    "placement.createLocation",
    {
      description:
        "Create one complete object-based forest/desert/city/village/industrial/base/ruins/swamp/cave/alien/Terran/Protoss/Zerg/custom location plan. Uses browse.*, deterministic seed, spacing and exclusions; one plan becomes one atomic transaction.",
      inputSchema: z.object({
        locationType: z.enum([
          "forest",
          "desert",
          "city",
          "village",
          "industrial",
          "militaryBase",
          "ruins",
          "swamp",
          "cave",
          "alien",
          "terran",
          "protoss",
          "zerg",
          "mixedNature",
          "custom",
        ]),
        ...location,
      }),
    },
    async (args) => {
      if (args.terrain) {
        if (!placement.terrain)
          throw new Error("Terrain context is unavailable");
        return textResult(
          await placement.terrain.createLocation({
            ...args,
            terrain: args.terrain,
          }),
        );
      }
      return textResult(
        await placement.createLocation(
          args as Parameters<PlacementWorkspace["createLocation"]>[0],
        ),
      );
    },
  );
  server.registerTool(
    "placement.preview",
    {
      description:
        "Render a structured dry-run and minimal source diff for an existing placement plan without changing disk or staged state.",
      inputSchema: z.object({ planId: z.string().min(1) }),
    },
    async ({ planId }) => textResult(await placement.preview(planId)),
  );
  server.registerTool(
    "placement.validate",
    {
      description:
        "Validate Objects XML, required ids/types, duplicate ids, plan dependencies, explicit bounds and minimum distance. Pathing/runtime collision remain explicitly unavailable.",
      inputSchema: z.object({
        planId: z.string().optional(),
        objectFile: z.string().default("Objects"),
      }),
    },
    async ({ planId, objectFile }) =>
      textResult(await placement.validate(planId, objectFile)),
  );
  server.registerTool(
    "placement.apply",
    {
      description:
        "Apply one validated placement plan through the shared lossless atomic transaction layer. Defaults to dry-run; supports staging, backup, reparse and in-session idempotency.",
      inputSchema: z.object({
        planId: z.string().min(1),
        dryRun: z.boolean().default(true),
        stage: z.boolean().default(true),
        backup: z.boolean().default(true),
        expectedSha256: z.record(z.string(), z.string()).optional(),
      }),
    },
    async ({ planId, ...options }) =>
      textResult(await placement.apply(planId, options)),
  );
  server.registerTool(
    "placement.rollback",
    {
      description:
        "Discard staged Objects/ComponentList changes or restore Objects from the shared transaction backup. Backup restore defaults to dry-run.",
      inputSchema: z.object({
        ...commonFiles,
        dryRun: z.boolean().default(true),
      }),
    },
    async ({ objectFile, componentListFile, dryRun }) =>
      textResult(
        await placement.rollback(objectFile, componentListFile, dryRun),
      ),
  );
}
