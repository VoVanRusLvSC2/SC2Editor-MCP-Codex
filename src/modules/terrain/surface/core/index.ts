export { SurfaceSnapshot, safeComponentPath } from './snapshot.js';
export type { ComponentSummary, ConsistencyResult } from './snapshot.js';
export { decodeComponent, componentKind, surfaceKinds } from './registry.js';
export type { DecodeOptions, ComponentDecode, DecodeStatus } from './registry.js';
export { planCellEdit, planSummary, materializePlan } from './patch.js';
export type { CellEdit, PatchPlan } from './patch.js';
export { patchTerrainNumericAttribute } from './xml-patch.js';
export { inspectSurfaceCatalog, inspectDds } from './catalog.js';
export { catalogRecordKind, parseCatalogVector, catalogFieldOccurrences, catalogTokenDeclarations,
  previewCatalogTemplate, inspectCatalogReferences, inspectCliffDoodadHeightCodes,
  inspectAuthoredCliffHeights } from './catalog-data.js';
export type { CatalogTokenDeclaration, CatalogTemplatePreview, CatalogReference,
  CatalogFieldOccurrence } from './catalog-data.js';
