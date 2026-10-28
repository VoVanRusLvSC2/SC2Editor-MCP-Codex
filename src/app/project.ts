import { LightingWorkspace } from "../modules/lighting/workspace.js";
import { NativeEditorBridge } from "../integrations/native/bridge.js";
import { NativeGameBridge } from "../integrations/game/bridge.js";
import { ProjectTestWorkspace } from "../modules/testing/workspace.js";
import { NativeWorkflowGate } from "../modules/testing/gate.js";
import { CutscenePreviewWorkspace } from "../modules/cutscenePreview/workspace.js";
import { DialogPreviewWorkspace } from "../modules/uiPreview/dialogWorkspace.js";
import { UiPreviewWorkspace } from "../modules/uiPreview/workspace.js";
import { AssetWorkspace } from "../modules/assets/workspace.js";
import path from "node:path";
import {
  ModkitIntegration,
  ModkitCascBackend,
  modkitAvailable,
} from "../integrations/modkit/runtime.js";
import { MapPreviewWorkspace } from "../modules/map/preview.js";
import { NativeMinimapWorkspace } from "../modules/map/nativeMinimap.js";
import { ModkitTerrainWorkspace } from "../modules/terrain/modkitWorkspace.js";
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

import { ResourceScope } from "../core/resourceScope.js";
import { ModuleContainer } from "./moduleContainer.js";
import { resolveModuleSelection, type ModuleSelection } from "./moduleSelection.js";

interface ProjectServices {
  nativeGate: NativeWorkflowGate;
  testing: ProjectTestWorkspace;
  nativeGame: NativeGameBridge;
  nativeEditor: NativeEditorBridge;
  modkit: ModkitIntegration;
  casc: CascWorkspace;
  data: DataWorkspace;
  browse: BrowseWorkspace;
  lighting: LightingWorkspace;
  placement: PlacementWorkspace;
  terrain: TerrainWorkspace;
  map: MapWorkspace;
  mapPreview: MapPreviewWorkspace;
  modkitTerrain: ModkitTerrainWorkspace;
  settings: SettingsWorkspace;
  document: DocumentWorkspace;
  ai: AiWorkspace;
  text: TextWorkspace;
  cutscene: CutsceneWorkspace;
  cutsceneAssets: CutsceneAssetIndex;
  script: ScriptWorkspace;
  trigger: TriggerWorkspace;
  assets: AssetWorkspace;
  uiPreview: UiPreviewWorkspace;
  dialogPreview: DialogPreviewWorkspace;
  cutscenePreview: CutscenePreviewWorkspace;
}

/** Shared composition; providers are initialized by actual consumers, not hidden tool count. */
export async function createProject(
  root: string,
  options: { loadUiSchema?: boolean; selection?: ModuleSelection } = {},
) {
  const selection = options.selection ?? resolveModuleSelection();
  const [schema, cutsceneSchema, textSchema, dataSchema, aiSchema] = await Promise.all([
    options.loadUiSchema === false
      ? Promise.resolve(new SchemaRegistry())
      : SchemaRegistry.loadBundled(),
    CutsceneSchemaRegistry.load(),
    TextSchemaRegistry.load(),
    Promise.resolve(DataSchemaRegistry.lazy()),
    AiSchemaRegistry.load(),
  ]);
  const workspace = new Workspace(root, schema),
    scope = new ResourceScope();
  await workspace.recover();
  let initialCatalog: Promise<void> | undefined;
  const initializeCatalog = () =>
    (initialCatalog ??= (async () => {
      try {
        await services.casc.restoreMounts();
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "CASC_INSTALL_BUILD_INFO_UNAVAILABLE")
          throw error;
      }
      if (modkitAvailable())
        services.data.nativeCatalogFiles = new Set(
          await (await services.modkit.port()).catalogFiles(),
        );
    })().catch((error) => {
      initialCatalog = undefined;
      throw error;
    }));
  const refreshCasc = async () => {
    await initializeCatalog();
    const { data, casc } = services;
    if (!data.extraRoots.some((root) => root.startsWith(casc.cacheRoot + path.sep))) return;
    await workspace.readDependency(path.join(casc.install, ".build.info"));
    await casc.refreshBuild();
    await casc.restoreMounts();
  };
  const container: ModuleContainer<ProjectServices> = new ModuleContainer<ProjectServices>({
    nativeGate: () => new NativeWorkflowGate(),
    nativeEditor: () => scope.own("Editor bridge", new NativeEditorBridge(workspace)),
    nativeGame: () => scope.own("Game bridge", new NativeGameBridge(workspace)),
    testing: () =>
      scope.own(
        "test workflows",
        new ProjectTestWorkspace(workspace, {
          runtime: { game: services.nativeGame, editor: services.nativeEditor },
          gate: services.nativeGate,
        }),
      ),
    modkit: () =>
      scope.own(
        "ModKit",
        new ModkitIntegration(
          workspace,
          path.resolve(process.env.SC2_CASC_ROOT ?? "C:/Program Files (x86)/StarCraft II"),
          () => services.data.extraRoots,
        ),
      ),
    casc: () => {
      const useModkit =
        process.env.SC2_CASC_BACKEND === "modkit" ||
        (process.env.SC2_CASC_BACKEND !== "native" && modkitAvailable());
      // Materialize the dependency before its consumer to preserve reverse disposal order.
      const modkit = useModkit ? services.modkit : undefined;
      return scope.own(
        "CASC",
        new CascWorkspace(workspace.root, {
          ...(modkit
            ? { backendName: "ModKit", backendFactory: () => new ModkitCascBackend(modkit) }
            : {}),
          onMount: (root) => {
            services.data.addDependencyRoot(
              root,
              root.replaceAll("\\", "/").match(/\/views\/((?:mods|campaigns)\/[^/]+)$/i)?.[1],
            );
            services.browse.addDependencyRoot(root);
          },
          onUnmount: (root) => {
            services.data.removeDependencyRoot(root);
            services.browse.removeDependencyRoot(root);
          },
        }),
      );
    },
    data: () => {
      const data = new DataWorkspace(workspace, dataSchema);
      data.dependencyRefresh = refreshCasc;
      data.animationModelReader = (resources, sources) =>
        services.assets.modelAnimationInventory(resources, sources);
      return data;
    },
    browse: () => {
      const browse = new BrowseWorkspace(workspace, services.data);
      browse.setDependencyRefresh(refreshCasc);
      return browse;
    },
    lighting: () => new LightingWorkspace(workspace, services.casc),
    placement: () => {
      const placement = new PlacementWorkspace(workspace, services.browse);
      placement.terrain = {
        sample: (...args) => services.terrain.sample(...args),
        surface: (...args) => services.terrain.surface(...args),
        state: (...args) => services.terrain.state(...args),
        createLocation: (...args) => services.terrain.createLocation(...args),
      };
      return placement;
    },
    terrain: () =>
      new TerrainWorkspace(workspace, services.browse, services.placement, services.lighting),
    map: () => new MapWorkspace(workspace, services.terrain),
    mapPreview: () =>
      new MapPreviewWorkspace(
        services.modkit,
        new NativeMinimapWorkspace(
          services.modkit,
          services.map,
          services.nativeGate.protect(services.nativeEditor),
        ),
      ),
    modkitTerrain: () => new ModkitTerrainWorkspace(services.modkit),
    settings: () => new SettingsWorkspace(workspace),
    document: () => new DocumentWorkspace(workspace, services.casc),
    ai: () => new AiWorkspace(workspace, aiSchema, services.data, services.browse),
    text: () => new TextWorkspace(workspace, textSchema),
    cutscene: () => new CutsceneWorkspace(workspace, cutsceneSchema),
    cutsceneAssets: () => new CutsceneAssetIndex(workspace.root),
    script: () => new ScriptWorkspace(workspace),
    trigger: () => {
      const trigger = new TriggerWorkspace(workspace, undefined, services.data, services.casc);
      trigger.nativeGuiArtifact = (id) =>
        services.nativeGate.protect(services.nativeEditor).guiArtifact(id);
      return trigger;
    },
    assets: () => new AssetWorkspace(workspace, services.casc),
    uiPreview: () => new UiPreviewWorkspace(workspace, services.casc, textSchema),
    dialogPreview: () => new DialogPreviewWorkspace(services.uiPreview, services.trigger),
    cutscenePreview: () => new CutscenePreviewWorkspace(workspace, services.casc),
  });
  const services: ProjectServices = container.services;
  return Object.assign(services, {
    workspace,
    schema,
    cutsceneSchema,
    selection,
    initializedModules: () => container.initialized(),
    close: () => {
      container.seal();
      return scope.close();
    },
  });
}
export type Project = Awaited<ReturnType<typeof createProject>>;
