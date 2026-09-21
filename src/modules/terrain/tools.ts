import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { TerrainWorkspace } from "./workspace.js";
import type { TerrainOperation } from "./types.js";
import { parseTerrainRecipe } from "./xmlRecipe.js";
import {
  terrainOperationSchema,
  terrainPointSchema,
  terrainAreaSchema,
  terrainPlanSchema,
  terrainGenerateSchema, terrainLandscapeSchema,
  terrainFeatureSchema,
  terrainApplySchema,
} from "./schemas.js";
const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
export interface TerrainToolContext {
  workspace: TerrainWorkspace;
}
export function registerTerrainTools(
  server: McpServer,
  context: TerrainToolContext,
): void {
  const terrain = context.workspace;
  const directory = z.object({ directory: z.string().default("") }).strict();
  server.registerTool("terrain.components.inspect",{description:"Check native cell flags, sync cliff grid and vertex-color entry boundaries against map dimensions. Raw flags/sub-data are not verified pathing or color brush semantics.",inputSchema:directory},async a=>textResult(await terrain.inspectComponents(a.directory)));
  server.registerTool(
    "terrain.inspect",
    {
      description:
        "Inspect native XML + binary terrain components, versions, physical bounds, palette and water. Does not claim pathing or Editor acceptance.",
      inputSchema: directory,
    },
    async (a) => textResult(await terrain.inspect(a.directory)),
  );
  server.registerTool(
    "terrain.capabilities",
    {
      description:
        "Report map-specific supported writers and explicit native cliff/ramp/pathing limitations.",
      inputSchema: directory,
    },
    async (a) => textResult(await terrain.capabilities(a.directory)),
  );
  server.registerTool("terrain.lighting.inspect",{description:"Inspect active tileset lighting binding and local native CLight states; dependency binding is returned separately, Editor validation not run.",inputSchema:directory},async a=>textResult(await terrain.lighting(a.directory)));
  server.registerTool("terrain.lighting.plan",{description:"Plan native CTerrain lighting assignment and CLight ambient/HDR settings. Use a new preset id with parent to isolate edits. Stage/save through Terrain transactions.",inputSchema:terrainPlanSchema},async a=> {if(!a.operations.every(o=>o.op.startsWith("lighting.")))throw new Error("LIGHTING_OPERATIONS_ONLY");return textResult(await terrain.plan(a as import("./types.js").TerrainPlanRequest));});
  server.registerTool("terrain.landscape.plan",{description:"Generate an existing map landscape and optionally assign a resolved native lighting preset in one transaction. Uses existing palette; does not create a clean map or native cliffs.",inputSchema:terrainLandscapeSchema},async a=>textResult(await terrain.landscape(a)));
  server.registerTool("terrain.water.inspect", {
    description:"Inspect flat v110 water rectangles, opaque body-section status and local CWater states. Rectangle extents are conservative exclusions, not wet-ground/pathing proof.",inputSchema:directory,
  },async a => { const state = await terrain.state(a.directory);return textResult({water:state.water?.list(),materials:state.waterCatalog?.list(),editor:"not run"}); });
  server.registerTool("terrain.water.plan", {
    description:"Plan flat v110 water create/update/remove and CWater material/state settings together. Rectangle edges require the observed 8-cell grid; native body sections stay read-only. Use terrain.apply/save for committing.",
    inputSchema:z.object({directory:z.string().default(""),operations:z.array(terrainOperationSchema).min(1).max(100).refine(ops => ops.every(op => op.op.startsWith("water.")),"Water operations only")}).strict(),
  },async a => textResult(await terrain.plan(a as import("./types.js").TerrainPlanRequest)));
  server.registerTool(
    "terrain.sample",
    {
      description:
        "Sample world-space height, slope, mask, texture weights and template-based liquid at up to 500 points, optionally from a planned result.",
      inputSchema: z
        .object({
          directory: z.string().default(""),
          points: z.array(terrainPointSchema).min(1).max(500),
          planId: z.string().optional(),
        })
        .strict(),
    },
    async (a) =>
      textResult(await terrain.sample(a.points, a.directory, a.planId)),
  );
  server.registerTool(
    "terrain.analyze",
    {
      description:
        "Analyze heights, slopes and protected geometry in an area or whole map.",
      inputSchema: z
        .object({
          directory: z.string().default(""),
          area: terrainAreaSchema.optional(),
          planId: z.string().optional(),
        })
        .strict(),
    },
    async (a) =>
      textResult(await terrain.analyze(a.directory, a.area, a.planId)),
  );
  server.registerTool(
    "terrain.palette.get",
    {
      description:
        "Read the actual 64-slot palette, texture sets, cliffs and per-block active sets.",
      inputSchema: directory,
    },
    async (a) => textResult(await terrain.palette(a.directory)),
  );
  server.registerTool(
    "terrain.styles.list",
    {
      description:
        "List deterministic forest/desert/city/snow/jungle/swamp/volcanic/badlands/coastal/platform recipes and required material roles.",
      inputSchema: z.object({}).strict(),
    },
    async () => textResult(terrain.styles()),
  );
  server.registerTool(
    "terrain.assets",
    {
      description:
        "Search terrain texture, tileset, cliff or water catalog objects through the existing browse dependency-aware index.",
      inputSchema: z
        .object({
          query: z.string().default(""),
          kind: z
            .enum(["texture", "tileset", "cliff", "water", "lighting"])
            .default("texture"),
        })
        .strict(),
    },
    async (a) => textResult(await terrain.assets(a.query, a.kind)),
  );
  server.registerTool(
    "terrain.plan",
    {
      description:
        "Compile a bounded operation batch into an isolated byte-preserving plan. Height/texture sync rules are reference-supported; unsupported native operations fail explicitly.",
      inputSchema: terrainPlanSchema,
    },
    async (a) =>
      textResult(
        await terrain.plan(
          a as {
            directory: string;
            operations: TerrainOperation[];
            maxSlope?: number;
          },
        ),
      ),
  );
  server.registerTool(
    "terrain.generate",
    {
      description:
        "Plan styled relief and painting using exact existing active-palette textures. Missing style materials are rejected rather than invented.",
      inputSchema: terrainGenerateSchema,
    },
    async (a) => textResult(await terrain.generate(a)),
  );
  for (const name of [
    "road",
    "river",
    "lake",
    "mountain",
    "valley",
    "plateau",
    "crater",
    "coast",
    "transition",
  ])
    server.registerTool(
      `terrain.${name}`,
      {
        description: `Plan a ${name} feature using bounded height/texture operations. River/lake carve ground only; flat water rectangles require the 8-cell grid; native body-section and cliff/ramp operations are unsupported.`,
        inputSchema: terrainFeatureSchema,
      },
      async (a) => textResult(await terrain.feature(name, a)),
    );
  server.registerTool(
    "terrain.recipe.plan",
    {
      description:
        "Parse strict TerrainRecipe XML and compile a terrain plan in one call; never writes. Returns a compact plan for preview/apply.",
      inputSchema: z.object({ xml: z.string().min(1).max(1000000) }).strict(),
    },
    async (a) => textResult(await terrain.plan(parseTerrainRecipe(a.xml))),
  );
  server.registerTool(
    "terrain.recipe.parse",
    {
      description:
        "Parse our TerrainRecipe XML DSL into a validated operation request. This is not native SC2 XML.",
      inputSchema: z.object({ xml: z.string().min(1).max(1000000) }).strict(),
    },
    async (a) => textResult(parseTerrainRecipe(a.xml)),
  );
  server.registerTool(
    "terrain.preview",
    {
      description:
        "Return a compact plan diff and a diagnostic PNG of height/texture/water/cliff masks, without mutating the map or rendering SC2 assets.",
      inputSchema: z
        .object({
          planId: z.string().optional(),
          directory: z.string().default(""),
          mode: z
            .enum(["height", "texture", "water", "cliff"])
            .default("height"),
          size: z.number().int().min(16).max(512).default(128),
        })
        .strict(),
    },
    async (a) => {
      const p = await terrain.preview(a.planId, a.directory, a.mode, a.size);
      const { imageBase64, ...summary } = p;
      return {
        content: [
          ...textResult(summary).content,
          { type: "image" as const, data: imageBase64, mimeType: "image/png" },
        ],
      };
    },
  );
  server.registerTool(
    "terrain.validate",
    {
      description:
        "Check supported serialization, source hashes and plan constraints; report Editor/runtime checks as not run.",
      inputSchema: z
        .object({
          planId: z.string().optional(),
          directory: z.string().default(""),
        })
        .strict(),
    },
    async (a) => textResult(await terrain.validate(a.planId, a.directory)),
  );
  server.registerTool(
    "terrain.apply",
    {
      description:
        "Apply an existing validated terrain or combined-location plan with stale-source checks, byte backups and grouped staging. Dry-run defaults to true.",
      inputSchema: terrainApplySchema,
    },
    async ({ planId, ...options }) =>
      textResult(await terrain.apply(planId, options)),
  );
  server.registerTool(
    "terrain.save",
    {
      description:
        "Commit all files of a staged terrain transaction together. Dry-run defaults to true; refuses files edited since staging.",
      inputSchema: z
        .object({
          transactionId: z.string().min(1),
          dryRun: z.boolean().default(true),
          backup: z.boolean().default(true),
        })
        .strict(),
    },
    async ({ transactionId, ...options }) =>
      textResult(await terrain.save(transactionId, options)),
  );
  server.registerTool(
    "terrain.rollback",
    {
      description:
        "Discard a staged terrain transaction or restore all committed bytes using its in-session journal, including removing files newly created by that transaction. Refuses external changes; defaults to dry-run.",
      inputSchema: z
        .object({
          transactionId: z.string().min(1),
          dryRun: z.boolean().default(true),
        })
        .strict(),
    },
    async (a) => textResult(await terrain.rollback(a.transactionId, a.dryRun)),
  );
}
