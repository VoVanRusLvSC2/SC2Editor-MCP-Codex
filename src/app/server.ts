import { projectPreflight } from "./preflight.js";
import { registerScriptTools } from "../modules/script/tools.js";
import { createUiServer } from "../mcp/uiServer.js";
import type { Project } from "./project.js";
import * as z from "zod/v4";
import { projectCoverage } from "./coverage.js";
import { registerMapTools } from "../modules/map/tools.js";
import { moduleProfiles, publicModules, resolveModuleSelection } from "./moduleSelection.js";

export function createProjectServer(project: Project) {
  const selection = resolveModuleSelection();
  const enabled = (name: typeof publicModules[number]) => selection.modules.has(name);
  const server = createUiServer(project.workspace, project.schema,
    enabled("cutscene") ? { workspace: project.cutscene, schema: project.cutsceneSchema, assets: project.cutsceneAssets } : undefined,
    enabled("text") ? { workspace: project.text } : undefined,
    enabled("data") ? { workspace: project.data } : undefined,
    enabled("browse") ? { workspace: project.browse } : undefined,
    enabled("placement") ? { workspace: project.placement } : undefined,
    enabled("ai") ? { workspace: project.ai } : undefined,
    enabled("terrain") ? { workspace: project.terrain } : undefined);
  if (enabled("map")) registerMapTools(server,project.map);
  if (enabled("script")) registerScriptTools(server,project.script);
  server.registerTool("modkit.capabilities", {
    description: "Compact public entry point: report enabled SC2 authoring modules and restart profiles before selecting module-specific tools.",
    inputSchema: z.object({}).strict(),
  }, async () => ({ content: [{ type: "text" as const, text: JSON.stringify({
    protocol: "public-mk3-compat-1",
    selection: { profile: selection.profile, source: selection.source, modules: [...selection.modules], unknown: selection.unknown },
    availableModules: publicModules,
    profiles: moduleProfiles(),
    configure: { profile: "Set SC2_MCP_PROFILE to ui, cutscene, data, terrain, script, authoring or all", custom: "Set SC2_MCP_MODULES to a comma-separated module list; ui is always included" },
    dataSchema: project.data.schema.loadState(),
    note: "Static validation is not SC2 Editor/runtime proof.",
  }, null, 2) }] }));
  server.registerTool("ui.project_status", {
    description: "Audit coverage and limitations of all ten modules; separate registry evidence from actual Editor/runtime validation. Read-only.",
    inputSchema: z.object({}).strict(),
  }, async () => ({ content: [{ type: "text" as const, text: JSON.stringify(projectCoverage(project), null, 2) }] }));
  server.registerTool("ui.test_readiness",{description:"Gather known offline map/terrain/UI/cutscene/text/data/placement/AI/script checks and pending drafts before Editor tests. PASS is not full standard-function or engine coverage.",inputSchema:z.object({}).strict()},async()=>({content:[{type:"text" as const,text:JSON.stringify(await projectPreflight(project))}]}));
  return server;
}
