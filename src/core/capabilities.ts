import { APP_VERSION } from "../app/version.js";
import path from "node:path";
import { statSync } from "node:fs";
import { archiveBackendAvailable } from "../archive/archiveAdapter.js";

export interface BridgeCapabilities {
  version: string;
  semanticEditing: {
    available: true;
    transactionalApply: true;
    maxOperationsPerApply: 100;
    stagedDrafts: true;
    atomicSave: true;
    multiFileCommit: "COMPENSATED_NOT_CRASH_ATOMIC";
    persistentRecoveryJournal: true;
    crossProcessWriteLock: true;
    backup: true;
  };
  workspace: {
    root: string;
    kind: "component-directory" | "packed-archive-path";
    directlyEditable: boolean;
  };
  runtime: {
    adapterConfigured: boolean;
    protocol: "sc2-ui-runtime-adapter-v1";
    actualGameValidation: boolean;
    limitation?: string;
  };
  archives: {
    adapterConfigured: boolean;
    backendAvailable: boolean;
    exportContentVerification: true;
    protocol: "sc2-ui-archive-adapter-v1";
    packedMapReadWrite: boolean;
    limitation?: string;
  };
  browse: {
    available: true;
    incrementalFingerprintIndex: true;
    localizedNames: true;
    declaredAndInstalledLayersSeparated: true;
  };
  placement: {
    availableForComponentDirectories: boolean;
    objectFormat: "plain-xml-placedobjects-v27-observed";
    unitAndDoodadSeparated: true;
    createLocation: true;
    pathingValidation: false;
    runtimeCollisionValidation: false;
  };
  terrain: {
    availableForComponentDirectories: boolean;
    bytePreservingTransactions: true;
    groupedStaging: true;
    groundSampling: true;
    nativeCliffRampEditing: false;
    pathingValidation: false;
    editorValidation: "NOT_EXECUTED";
  };
  script: {availableForComponentDirectories:boolean;structuralEditing:true;targetCompilerValidation:false;fullTypeChecking:false};
  ai: {
    availableForComponentDirectories: boolean;
    component: "CustomAI";
    maxOperationsPerApply: 250;
    triggerReferenceEditing: false;
    terrainEditing: false;
    populatedWaveSerialization: "OPT_IN_UNCONFIRMED";
    editorValidation: "NOT_EXECUTED";
    runtimeValidation: "NOT_EXECUTED";
  };
}

export function bridgeCapabilities(root: string): BridgeCapabilities {
  const extension = path.extname(root).toLowerCase();
  let packed = extension === ".sc2map" || extension === ".sc2mod";
  try { if (statSync(root).isDirectory()) packed = false; } catch { /* Unopened paths retain extension-based classification. */ }
  const runtimeConfigured = Boolean(process.env.SC2_UI_RUNTIME_ADAPTER);
  const archiveConfigured = Boolean(process.env.SC2_UI_ARCHIVE_ADAPTER);
  return {
    version: APP_VERSION,
    semanticEditing: {
      available: true,
      transactionalApply: true,
      maxOperationsPerApply: 100,
      stagedDrafts: true,
      atomicSave: true,
      multiFileCommit: "COMPENSATED_NOT_CRASH_ATOMIC",
      persistentRecoveryJournal: true,
      crossProcessWriteLock: true,
      backup: true,
    },
    workspace: {
      root,
      kind: packed ? "packed-archive-path" : "component-directory",
      directlyEditable: !packed,
    },
    runtime: {
      adapterConfigured: runtimeConfigured,
      protocol: "sc2-ui-runtime-adapter-v1",
      actualGameValidation: false,
      limitation: "NOT_EXECUTED: adapter configuration is not proof of game-runtime validation.",
    },
    archives: {
      adapterConfigured: archiveConfigured,
      backendAvailable: archiveBackendAvailable(),
      exportContentVerification: true,
      protocol: "sc2-ui-archive-adapter-v1",
      packedMapReadWrite: false,
      limitation: "Bundled MPQ backend verifies entry content per export; this capability does not prove every archive variant or Editor/game acceptance.",
    },
    browse: {
      available: true,
      incrementalFingerprintIndex: true,
      localizedNames: true,
      declaredAndInstalledLayersSeparated: true,
    },
    placement: {
      availableForComponentDirectories: !packed,
      objectFormat: "plain-xml-placedobjects-v27-observed",
      unitAndDoodadSeparated: true,
      createLocation: true,
      pathingValidation: false,
      runtimeCollisionValidation: false,
    },
    terrain: {
      availableForComponentDirectories: !packed,
      bytePreservingTransactions: true,
      groupedStaging: true,
      groundSampling: true,
      nativeCliffRampEditing: false,
      pathingValidation: false,
      editorValidation: "NOT_EXECUTED",
    },
    script:{availableForComponentDirectories:!packed,structuralEditing:true,targetCompilerValidation:false,fullTypeChecking:false},
    ai: {
      availableForComponentDirectories: !packed,
      component: "CustomAI",
      maxOperationsPerApply: 250,
      triggerReferenceEditing: false,
      terrainEditing: false,
      populatedWaveSerialization: "OPT_IN_UNCONFIRMED",
      editorValidation: "NOT_EXECUTED",
      runtimeValidation: "NOT_EXECUTED",
    },
  };
}
