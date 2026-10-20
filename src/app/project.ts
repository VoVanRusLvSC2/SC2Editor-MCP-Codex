import {LightingWorkspace} from '../modules/lighting/workspace.js';
import {NativeEditorBridge} from '../integrations/native/bridge.js';
import {CutscenePreviewWorkspace} from '../modules/cutscenePreview/workspace.js';
import {DialogPreviewWorkspace} from "../modules/uiPreview/dialogWorkspace.js";
import {UiPreviewWorkspace} from "../modules/uiPreview/workspace.js";
import {AssetWorkspace} from "../modules/assets/workspace.js";
import path from "node:path";
import {ModkitIntegration,ModkitCascBackend,modkitAvailable} from '../integrations/modkit/runtime.js';
import {MapPreviewWorkspace} from '../modules/map/preview.js';
import {ModkitTerrainWorkspace} from '../modules/terrain/modkitWorkspace.js';
import { DocumentWorkspace } from "../modules/document/workspace.js";
import { SettingsWorkspace } from "../modules/settings/workspace.js";
import { CascWorkspace } from "../modules/casc/workspace.js";
import { ScriptWorkspace } from "../modules/script/workspace.js";
import { TriggerWorkspace } from "../modules/trigger/workspace.js";
import { Workspace } from "../core/workspace.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";
import { CutsceneSchemaRegistry } from "../modules/cutscene/schemaRegistry.js";
import { CutsceneWorkspace } from "../modules/cutscene/workspace.js";
import { CutsceneAssetIndex } from "../modules/cutscene/assets.js";
import { TextSchemaRegistry } from "../modules/text/schemaRegistry.js";
import { TextWorkspace } from "../modules/text/workspace.js";
import { DataSchemaRegistry } from "../modules/data/schemaRegistry.js";
import { DataWorkspace } from "../modules/data/workspace.js";
import { BrowseWorkspace } from "../modules/browse/workspace.js";
import { PlacementWorkspace } from "../modules/placement/workspace.js";
import { TerrainWorkspace } from "../modules/terrain/workspace.js";
import { MapWorkspace } from "../modules/map/workspace.js";
import { AiSchemaRegistry } from "../modules/ai/schemaRegistry.js";
import { AiWorkspace } from "../modules/ai/workspace.js";

/** One composition root for MCP, GUI and integration tests. */
export async function createProject(root: string, options: {loadUiSchema?:boolean} = {}) {
  const [schema, cutsceneSchema, textSchema, dataSchema, aiSchema] = await Promise.all([
    options.loadUiSchema===false ? Promise.resolve(new SchemaRegistry()) : SchemaRegistry.loadBundled(), CutsceneSchemaRegistry.load(), TextSchemaRegistry.load(), Promise.resolve(DataSchemaRegistry.lazy()), AiSchemaRegistry.load(),
  ]);
  const workspace = new Workspace(root, schema);
  await workspace.recover();
  const nativeEditor=new NativeEditorBridge(workspace);
  const data = new DataWorkspace(workspace, dataSchema), browse = new BrowseWorkspace(workspace, data);
  const modkit=new ModkitIntegration(workspace,path.resolve(process.env.SC2_CASC_ROOT??'C:/Program Files (x86)/StarCraft II'),()=>data.extraRoots);
  const useModkitCasc=process.env.SC2_CASC_BACKEND==='modkit'||(process.env.SC2_CASC_BACKEND!=='native'&&modkitAvailable());
  const casc = new CascWorkspace(workspace.root, { ...(useModkitCasc?{backendName:'ModKit',backendFactory:()=>new ModkitCascBackend(modkit)}:{}),onMount: root => {data.addDependencyRoot(root,root.replaceAll('\\','/').match(/\/views\/((?:mods|campaigns)\/[^/]+)$/i)?.[1]); browse.addDependencyRoot(root); }, onUnmount: root => { data.removeDependencyRoot(root); browse.removeDependencyRoot(root); } });
  try { await casc.restoreMounts(); } catch (error) { if (!(error instanceof Error) || error.message !== "CASC_INSTALL_BUILD_INFO_UNAVAILABLE") throw error; }
  if(modkitAvailable())data.nativeCatalogFiles=new Set(await (await modkit.port()).catalogFiles());
  const refreshCasc = async () => {
    if (!data.extraRoots.some(root => root.startsWith(casc.cacheRoot + path.sep))) return;
    await workspace.readDependency(path.join(casc.install, ".build.info"));
    await casc.refreshBuild();
    await casc.restoreMounts();
  };
  data.dependencyRefresh = refreshCasc; browse.setDependencyRefresh(refreshCasc);
  const lighting=new LightingWorkspace(workspace,casc);
  const placement = new PlacementWorkspace(workspace, browse), terrain = new TerrainWorkspace(workspace, browse, placement,lighting);
  placement.terrain = terrain;
  const map = new MapWorkspace(workspace,terrain);
  const mapPreview=new MapPreviewWorkspace(modkit);
  const modkitTerrain=new ModkitTerrainWorkspace(modkit);
  const settings = new SettingsWorkspace(workspace);
  const document = new DocumentWorkspace(workspace,casc);
  const ai = new AiWorkspace(workspace, aiSchema, data, browse);
  const text = new TextWorkspace(workspace, textSchema);
  const cutscene = new CutsceneWorkspace(workspace, cutsceneSchema), cutsceneAssets = new CutsceneAssetIndex(workspace.root);
  const script = new ScriptWorkspace(workspace);
  const trigger = new TriggerWorkspace(workspace, undefined, data, casc);
  const assets=new AssetWorkspace(workspace,casc);
  const uiPreview=new UiPreviewWorkspace(workspace,casc,textSchema);
  const dialogPreview=new DialogPreviewWorkspace(uiPreview,trigger);
  const cutscenePreview=new CutscenePreviewWorkspace(workspace,casc);
  return { nativeEditor,modkit,modkitTerrain,mapPreview,lighting, cutscenePreview, dialogPreview, uiPreview, assets, document, settings, casc, script, trigger, workspace, schema, data, browse, placement, terrain, map, ai, text, cutscene, cutsceneSchema, cutsceneAssets };
}
export type Project = Awaited<ReturnType<typeof createProject>>;
