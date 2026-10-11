import path from "node:path";
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
  const data = new DataWorkspace(workspace, dataSchema), browse = new BrowseWorkspace(workspace, data);
  const casc = new CascWorkspace(workspace.root, { onMount: root => { data.addDependencyRoot(root); browse.addDependencyRoot(root); }, onUnmount: root => { data.removeDependencyRoot(root); browse.removeDependencyRoot(root); } });
  try { await casc.restoreMounts(); } catch (error) { if (!(error instanceof Error) || error.message !== "CASC_INSTALL_BUILD_INFO_UNAVAILABLE") throw error; }
  const refreshCasc = async () => {
    if (!data.extraRoots.some(root => root.startsWith(casc.cacheRoot + path.sep))) return;
    await workspace.readDependency(path.join(casc.install, ".build.info"));
    await casc.refreshBuild();
    await casc.restoreMounts();
  };
  data.dependencyRefresh = refreshCasc; browse.setDependencyRefresh(refreshCasc);
  const placement = new PlacementWorkspace(workspace, browse), terrain = new TerrainWorkspace(workspace, browse, placement);
  placement.terrain = terrain;
  const map = new MapWorkspace(workspace,terrain);
  const ai = new AiWorkspace(workspace, aiSchema, data, browse);
  const text = new TextWorkspace(workspace, textSchema);
  const cutscene = new CutsceneWorkspace(workspace, cutsceneSchema), cutsceneAssets = new CutsceneAssetIndex(workspace.root);
  const script = new ScriptWorkspace(workspace);
  const trigger = new TriggerWorkspace(workspace);
  return { casc, script, trigger, workspace, schema, data, browse, placement, terrain, map, ai, text, cutscene, cutsceneSchema, cutsceneAssets };
}
export type Project = Awaited<ReturnType<typeof createProject>>;
