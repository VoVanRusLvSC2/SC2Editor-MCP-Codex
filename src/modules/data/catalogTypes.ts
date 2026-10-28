import type { DataDocument } from "./document.js";
export interface CatalogCoverageIssue {
  file: string;
  code: string;
  reason: string;
}
export type CatalogRecords = CatalogRecord[] & { issues: CatalogCoverageIssue[] };
export interface CatalogRecord {
  file: string;
  absolute: string;
  layer: "workspace" | "dependency";
  provenance: string[];
  document: DataDocument;
  engineActive?: boolean;
  activationMode?: string;
  activationWarnings?: string[];
  dependencyAvailability?: string;
  declarationOrder?: number;
}
