import {registerAuthoringTools} from './authoringTools.js';
import {registerNativeEditorTools} from '../integrations/native/tools.js';
import {registerLightingTools} from '../modules/lighting/tools.js';
import {registerModkitIntegrationTools} from '../integrations/modkit/tools.js';
import {registerModkitTerrainTools} from '../modules/terrain/modkitTools.js';
import {registerCutscenePreviewTools} from '../modules/cutscenePreview/tools.js';
import {registerPreviewBatch} from '../modules/uiPreview/batchTools.js';
import {registerDialogPreviewTools} from "../modules/uiPreview/dialogTools.js";
import {registerUiPreviewTools} from "../modules/uiPreview/tools.js";
import {registerAssetTools} from "../modules/assets/tools.js";
import { registerDocumentTools } from "../modules/document/tools.js";
import { registerSettingsTools } from "../modules/settings/tools.js";
import { registerCascTools } from "../modules/casc/tools.js";
import { projectPreflight } from "./preflight.js";
import { registerScriptTools } from "../modules/script/tools.js";
import { registerTriggerTools } from "../modules/trigger/tools.js";
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
    enabled("terrain") ? { workspace: project.terrain } : undefined, enabled("ui"));
  if (enabled("document")) registerDocumentTools(server, project.document);
  if (enabled("settings")) registerSettingsTools(server, project.settings);
  if (enabled("casc")) registerCascTools(server, project.casc);
  if(enabled("lighting")||enabled("terrain")||enabled("cutscene")||enabled("cutscene-preview"))registerLightingTools(server,project.lighting);
  if(enabled("cutscene")||enabled("cutscene-preview"))registerCutscenePreviewTools(server,project.cutscenePreview);
  if (enabled("assets")) registerAssetTools(server,project.assets);
  if (enabled("ui")){ registerUiPreviewTools(server,project.uiPreview); registerDialogPreviewTools(server,project.dialogPreview); registerPreviewBatch(server,project.dialogPreview); }
  if (enabled("map")) registerMapTools(server,project.map);
  if (enabled('editor')) registerNativeEditorTools(server,project.nativeEditor);
  if(enabled('terrain'))registerModkitTerrainTools(server,project.modkitTerrain,project.placement);
  if(enabled('map')||enabled('data')||enabled('casc'))registerModkitIntegrationTools(server,project.modkit,{data:enabled('data'),map:enabled('map')},project.mapPreview);
  if (enabled("script")) registerScriptTools(server,project.script);
  if (enabled("script")) registerTriggerTools(server,project.trigger);
  registerAuthoringTools(server,project,{script:enabled('script'),terrain:enabled('terrain')&&enabled('placement')&&enabled('browse')});
  server.registerTool("modkit.save",{description:"Save complete staged text or binary transaction group containing a file, with stale guards and backup.",inputSchema:z.object({file:z.string().min(1),backup:z.boolean().default(true)}).strict()},async args=>({content:[{type:"text" as const,text:JSON.stringify(await (project.workspace.binary.hasDraft(args.file)?project.workspace.binary.saveContaining(args.file,{dryRun:false,backup:args.backup}):project.workspace.save(args.file,{backup:args.backup})))}]}));
  server.registerTool("modkit.discard",{description:"Discard complete staged group containing a file without disk writes.",inputSchema:z.object({file:z.string().min(1)}).strict()},async args=>({content:[{type:"text" as const,text:JSON.stringify({discarded:project.workspace.discard(args.file)})}]}));
  server.registerTool("modkit.capabilities", {
    description: "Compact public entry point: report enabled SC2 authoring modules and restart profiles before selecting module-specific tools.",
    inputSchema: z.object({}).strict(),
  }, async () => ({ content: [{ type: "text" as const, text: JSON.stringify({
    protocol: "public-mk3-compat-1",
    selection: { profile: selection.profile, source: selection.source, modules: [...selection.modules], unknown: selection.unknown },
    availableModules: publicModules,
    profiles: moduleProfiles(),
    configure: { profile: "Set SC2_MCP_PROFILE to workflow, map-builder, editor, minimal, focused-data, focused-script, focused-authoring, ui, cutscene, cutscene-preview, data, terrain, casc, assets, settings, landscape, document, script, authoring or all", custom: "Set SC2_MCP_MODULES to a comma-separated module list; ui is always included" },
    dataSchema: project.data.schema.loadState(),
    modkitRuntime:project.modkit.status(),
    nativeEditor:project.nativeEditor.configuration(),
    casc: { enabled: enabled("casc"), ...project.casc.configuration() },
    authoring: {
      cutscenePreview: enabled("cutscene")||enabled("cutscene-preview")?{tool:"cutscene.preview",renderTool:"cutscene.render",webglCapture:{browser:"installed Edge/Chrome",background:true,nativePixelValidated:false},coverageTool:"cutscene.coverage",facialInfoTool:"cutscene.facial_info",audio:true,facialFxa:{format:"FACE/1731",linearGraphs:true,hermiteCurves:true,auxiliaryBindings:false},manualPages:35,allManualFeaturesSupported:false,offline:true,geometry:true,skeletalM3M3A:true,renderer:"WebGL2",lighting:"SC2 source-derived material/light equations; pass graph approximate",materialAnimation:{nativeIds:true,typedChannelTypes:13,propertyScoped:true,stcPriority:true,sourceBundleIdentity:true,nativeHeaderModeMerge:true,weightsEngineValidated:false},nativeShaderEquations:true,directCameraClipNormalization:true,defaultFogDensity:0,fog:true,localLights:true,rtt:true,embeddedCameras:true,persistentTimeline:true,gpuSkinning:true,materials:true,particles:true,ribbons:true,weightedLayerBlending:true,engineValidated:false}:"DISABLED",
      settings: enabled("settings") ? project.settings.capabilities() : "DISABLED",
      gui: enabled("script") ? { tools:["trigger.describe_function","trigger.plan","trigger.validate","trigger.apply"],verifiedFunctions:9,argumentSubset:["literal","variable","preset","gamelink","PlayerGroupAll"],compiler:"NOT_EXECUTED" } : "DISABLED",
      labels: enabled("script") ? { tools:["trigger.labels","trigger.label_of"],discovery:"READ_ONLY",assignment:"UNSUPPORTED_EDITOR_FORMAT" } : "DISABLED",
      data: enabled("data") ? { referenceCoverage:"PARTIAL",effective:"PARTIAL",unknownIsUnused:false } : "DISABLED",
    },
    note: "Static validation is not SC2 Editor/runtime proof.",
  }, null, 2) }] }));
  if (enabled("ui")) {
  server.registerTool("ui.project_status", {
    description: "Audit coverage and limitations of enabled modules; separate registry evidence from actual Editor/runtime validation. Read-only.",
    inputSchema: z.object({}).strict(),
  }, async () => ({ content: [{ type: "text" as const, text: JSON.stringify(projectCoverage(project), null, 2) }] }));
  server.registerTool("ui.test_readiness",{description:"Gather known offline map/terrain/UI/cutscene/text/data/placement/AI/script checks and pending drafts before Editor tests. PASS is not full standard-function or engine coverage.",inputSchema:z.object({}).strict()},async()=>({content:[{type:"text" as const,text:JSON.stringify(await projectPreflight(project))}]}));
  }
  return server;
}
