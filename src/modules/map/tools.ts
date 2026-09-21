import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { MapWorkspace } from "./workspace.js";
import { terrainOperationSchema, terrainLandscapeSchema } from "../terrain/schemas.js";

const result = (value: unknown) => ({ content:[{ type:"text" as const,text:JSON.stringify(value,null,2) }] });
const directory = z.string().default("");
const dryRun = z.boolean().default(true);
const bounds = z.object({ left:z.number().int().min(0).max(256),bottom:z.number().int().min(0).max(256),right:z.number().int().min(1).max(256),top:z.number().int().min(1).max(256) }).strict();
const patch = z.object({ playableBounds:bounds.optional(),fogMaskStyle:z.enum(["None","Dark","Black","BlackNoUnhide"]).optional(),minimapResolution:z.number().int().min(1).max(4).optional() }).strict();
export const mapCreateSchema = z.object({
  blueprintId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), destinationDirectory:z.string().min(1), dryRun,
  expectedBlueprintSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(), metadataPatch:patch.optional(),
  landscape:terrainLandscapeSchema.omit({directory:true,lighting:true}).optional(),
  terrainOperations:z.array(terrainOperationSchema).min(1).max(100).optional(),
}).strict();
export const mapBlueprintRegistrationSchema = z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),directory,dryRun}).strict();
export function registerMapTools(server: McpServer, map: MapWorkspace) {
  server.registerTool("map.blueprint.inspect",{description:"Check an existing native map as a template: hash the full manifest and archive metadata, report inherited objects/scripts and known foundation defects. Does not certify cleanliness or engine acceptance.",inputSchema:z.object({directory}).strict()},async a=>result(await map.inspectBlueprint(a.directory)));
  server.registerTool("map.blueprint.list",{description:"List locally registered native templates and their pinned content hashes. Registry summaries are reverified when creating a map.",inputSchema:z.object({}).strict()},async()=>result(await map.listBlueprints()));
  server.registerTool("map.blueprint.register",{description:"Register a valid existing component directory as a content-pinned map template. All scenario content is inherited; no automatic stripping. dryRun defaults true.",inputSchema:mapBlueprintRegistrationSchema},async a=>result(await map.registerBlueprint(a.id,a.directory,a.dryRun)));
  server.registerTool("map.create",{description:"Create a new map component directory from a registered native template, optionally generate landscape, apply terrain operations and MapInfo patches before publication. dryRun performs the real transforms privately. Preserves objects/scripts/unknown files; no resize or arbitrary from-scratch guarantee. During creation use existing palette/local catalog dependencies; external asset additions use the normal modules after creation.",inputSchema:mapCreateSchema},async a=>result(await map.create(a)));
  server.registerTool("map.capabilities",{ description:"Report verified archive and MapInfo writers and explicit clean-creation/resize gaps. Read-only.",inputSchema:z.object({}).strict() },async () => result(map.capabilities()));
  server.registerTool("map.inspect",{ description:"Inspect component manifest, native MapInfo v39 integrity, document roots and Terrain dimensions. Does not prove Editor acceptance.",inputSchema:z.object({ directory }).strict() },async a => result(await map.inspect(a.directory)));
  server.registerTool("map.validate",{ description:"Validate known map foundation and cross-component dimensions; player/variant/Header semantics remain opaque.",inputSchema:z.object({ directory }).strict() },async a => result(await map.validate(a.directory)));
  server.registerTool("map.archive.inspect",{ description:"Enumerate packed SC2Map/SC2Mod entries with the bundled StormLib helper, including locales and flags.",inputSchema:z.object({ archive:z.string().min(1) }).strict() },async a => result(await map.inspectPacked(a.archive)));
  server.registerTool("map.import",{ description:"Extract a packed map into a new component directory, preserve archive entry metadata; existing destinations are rejected. dryRun defaults true.",inputSchema:z.object({ archive:z.string().min(1),directory:z.string().min(1),dryRun }).strict() },async a => result(await map.import(a.archive,a.directory,a.dryRun)));
  server.registerTool("map.export",{ description:"Export committed map snapshot, reopen and compare every entry hash before publishing. Pending drafts block export. Root maps use .sc2mcp-output/result.SC2Map. Paths stay within SC2_UI_ROOT.",inputSchema:z.object({ directory,archive:z.string().min(1),dryRun,backup:z.boolean().default(true) }).strict() },async a => result(await map.export(a.directory,a.archive,a.dryRun,a.backup)));
  server.registerTool("map.clone",{ description:"Copy a complete native map into a new sibling component directory, preserving scripts and unknown components. A scenario clone is not a clean new map.",inputSchema:z.object({ directory,destinationDirectory:z.string().min(1),dryRun }).strict() },async a => result(await map.clone(a.directory,a.destinationDirectory,a.dryRun)));
  server.registerTool("map.metadata.plan",{ description:"Plan lossless MapInfo v39 playable bounds, fog or minimap edits; recompute verified integrity hash and pin the complete file manifest.",inputSchema:z.object({ directory,patch }).strict() },async a => result(await map.planMetadata(a.directory,a.patch)));
  server.registerTool("map.metadata.apply",{ description:"Apply a checked metadata plan through the shared byte transaction coordinator. dryRun and staging default true; dependency guards survive until save.",inputSchema:z.object({ planId:z.string().min(1),dryRun,stage:z.boolean().default(true),backup:z.boolean().default(true) }).strict() },async a => result(await map.applyMetadata(a.planId,{ dryRun:a.dryRun,stage:a.stage,backup:a.backup })));
  server.registerTool("map.save",{ description:"Save the complete staged byte group with disk and complete-map dependency guards. dryRun defaults true.",inputSchema:z.object({ transactionId:z.string().min(1),dryRun,backup:z.boolean().default(true) }).strict() },async a => result(await map.save(a.transactionId,{ dryRun:a.dryRun,backup:a.backup })));
  server.registerTool("map.discard",{ description:"Discard the complete staged byte group; disk is unchanged. dryRun defaults true.",inputSchema:z.object({ transactionId:z.string().min(1),dryRun }).strict() },async a => result(map.discard(a.transactionId,a.dryRun)));
}
