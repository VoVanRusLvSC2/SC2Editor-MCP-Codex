import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { BrowseWorkspace } from "./workspace.js";
import type { BrowseSearchQuery, PhysicalAssetEntry } from "./types.js";

function textResult(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }; }

const selector = {
  key: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  catalogType: z.string().min(1).optional(),
};

export interface BrowseToolContext { workspace: BrowseWorkspace }

export function registerBrowseTools(server: McpServer, context: BrowseToolContext): void {
  const browse = context.workspace;

  server.registerTool("browse.index", {
    description: "Build or incrementally refresh the deterministic fingerprinted index over current-map, declared-dependency and optional installed SC2 catalog/text/asset roots.",
    inputSchema: z.object({ force: z.boolean().default(false) }),
  }, async ({ force }) => textResult(force ? await browse.refresh() : await browse.status(await browse.index())));

  server.registerTool("browse.status", {
    description: "Return compact browse-index roots, fingerprint, counts, availability layers and warnings without returning the full catalog.",
    inputSchema: z.object({}),
  }, async () => textResult(await browse.status()));

  server.registerTool("browse.search", {
    description: "Ranked and paginated search over real SC2 catalog ids, localized names, text keys, filenames, asset paths and related object ids. Results explain ranking and placeability.",
    inputSchema: z.object({
      query: z.string().optional(), ids: z.array(z.string()).max(500).optional(), catalogType: z.string().optional(), objectKind: z.string().optional(), dependency: z.string().optional(),
      sourceLayer: z.enum(["workspace", "dependency", "installed"]).optional(), locale: z.string().optional(),
      availability: z.enum(["MAP_LOCAL", "AVAILABLE_THROUGH_DEPENDENCY", "INSTALLED_BUT_NOT_DECLARED", "MISSING_DEPENDENCY", "UNRESOLVED", "UNKNOWN"]).optional(),
      hasModel: z.boolean().optional(), hasTexture: z.boolean().optional(), placeable: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).default(25), offset: z.number().int().min(0).default(0), compact: z.boolean().default(true),
    }),
  }, async (args) => textResult(await browse.search(args as BrowseSearchQuery)));

  server.registerTool("browse.get", {
    description: "Get source definition, effective inherited definition, provenance, localized keys, references, assets and placeable representation for an exact indexed object.",
    inputSchema: z.object({ ...selector, dependency: z.string().optional(), includeRaw: z.boolean().default(false) }),
  }, async (args) => textResult(await browse.get(args)));

  server.registerTool("browse.resolve", {
    description: "Resolve an exact id or ranked user query to one evidence-backed object. Ambiguity is returned, never guessed. Reports dependency readiness and placement representation.",
    inputSchema: z.object({ ...selector, query: z.string().optional(), dependency: z.string().optional() }),
  }, async (args) => textResult(await browse.resolve(args)));

  server.registerTool("browse.related", {
    description: "Traverse incoming/outgoing catalog relations such as Unit↔Actor→Model→asset or Doodad→Model with bounded depth and output.",
    inputSchema: z.object({ ...selector, direction: z.enum(["incoming", "outgoing", "both"]).default("both"), depth: z.number().int().min(1).max(8).default(3), limit: z.number().int().min(1).max(500).default(100) }),
  }, async (args) => textResult(await browse.related(args)));

  server.registerTool("browse.dependencies", {
    description: "List current-map, declared-dependency and installed-but-not-declared roots with indexed file/object counts and explicit availability status.",
    inputSchema: z.object({}),
  }, async () => textResult(await browse.dependencies()));

  server.registerTool("browse.catalogs", {
    description: "List all observed catalog types, including unknown/generic C* types, with object and placeable counts.",
    inputSchema: z.object({}),
  }, async () => textResult(await browse.catalogs()));

  server.registerTool("browse.assets", {
    description: "Search physical and catalog-referenced model, texture, icon, sound and video asset paths without treating a bare file as placeable.",
    inputSchema: z.object({ query: z.string().optional(), kind: z.enum(["Model", "Texture", "Sound", "Icon", "Animation", "Asset"]).optional(), dependency: z.string().optional(), limit: z.number().int().min(1).max(200).default(25), offset: z.number().int().min(0).default(0) }),
  }, async (args) => textResult(await browse.assets(args as { query?: string; kind?: PhysicalAssetEntry["kind"]; dependency?: string; limit?: number; offset?: number })));

  server.registerTool("browse.usage", {
    description: "Return indexed incoming uses of an exact catalog object across current source layers.",
    inputSchema: z.object(selector),
  }, async (args) => textResult(await browse.usage(args)));

  server.registerTool("browse.validate", {
    description: "Validate index determinism inputs and report duplicate ids across layers and unresolved typed references without claiming runtime validation.",
    inputSchema: z.object({}),
  }, async () => textResult(await browse.validate()));
}
