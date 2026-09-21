import { ScriptWorkspace } from "../modules/script/workspace.js";
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
export async function createProject(root: string) {
  const [schema, cutsceneSchema, textSchema, dataSchema, aiSchema] = await Promise.all([
    SchemaRegistry.loadBundled(), CutsceneSchemaRegistry.load(), TextSchemaRegistry.load(), Promise.resolve(DataSchemaRegistry.lazy()), AiSchemaRegistry.load(),
  ]);
  const workspace = new Workspace(root, schema);
  await workspace.recover();
  const data = new DataWorkspace(workspace, dataSchema), browse = new BrowseWorkspace(workspace, data);
  const placement = new PlacementWorkspace(workspace, browse), terrain = new TerrainWorkspace(workspace, browse, placement);
  placement.terrain = terrain;
  const map = new MapWorkspace(workspace,terrain);
  const ai = new AiWorkspace(workspace, aiSchema, data, browse);
  const text = new TextWorkspace(workspace, textSchema);
  const cutscene = new CutsceneWorkspace(workspace, cutsceneSchema), cutsceneAssets = new CutsceneAssetIndex(workspace.root);
  const script = new ScriptWorkspace(workspace);
  return { script, workspace, schema, data, browse, placement, terrain, map, ai, text, cutscene, cutsceneSchema, cutsceneAssets };
}
export type Project = Awaited<ReturnType<typeof createProject>>;
