import type { BrowseEvidence, BrowseSearchResult } from "../browse/types.js";

export interface Position3 {
  x: number;
  y: number;
  z: number;
}
export interface Scale3 {
  x: number;
  y: number;
  z: number;
}
export interface PlacementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  minZ?: number;
  maxZ?: number;
}
export type PlacementArea =
  | { type: "circle"; center: Position3; radius: number }
  | {
      type: "rectangle";
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      z: number;
    };
export type ExclusionZone =
  | { type: "circle"; center: { x: number; y: number }; radius: number }
  | {
      type: "rectangle";
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };

export interface PlacementObject {
  objectId?: number;
  kind: "Unit" | "Doodad";
  catalogId: string;
  sourceKey?: string;
  position: Position3;
  rotation?: number;
  scale?: Scale3;
  owner?: number;
  variation?: number;
  flags?: Record<string, string>;
  customAttributes?: Record<string, string>;
}

export type PlacementMutation =
  | { op: "add"; object: PlacementObject }
  | { op: "move"; objectId: number; position: Position3 }
  | { op: "rotate"; objectId: number; rotation: number }
  | { op: "scale"; objectId: number; scale: Scale3 }
  | { op: "setHeightAbsolute"; objectId: number; value: boolean }
  | { op: "remove"; objectId: number };

export interface PlacementValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  objectId?: number;
}

export interface PlacementValidationReport {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: PlacementValidationIssue[];
  checks: {
    xml: "PASS" | "FAIL";
    duplicateIds: "PASS" | "FAIL";
    bounds: "PASS" | "FAIL" | "UNAVAILABLE";
    dependency: "PASS" | "FAIL" | "UNAVAILABLE";
    minimumDistance: "PASS" | "FAIL" | "UNAVAILABLE";
    pathing: "UNAVAILABLE";
    runtimeCollision: "UNAVAILABLE";
  };
}

export interface PlacementPlan {
  id: string;
  requestHash: string;
  createdAt: string;
  objectFile: string;
  componentListFile: string;
  sourceSha256: Record<string, string>;
  diskSha256: Record<string, string>;
  operations: PlacementMutation[];
  candidates: BrowseSearchResult[];
  seed?: number;
  minimumDistance?: number;
  bounds?: PlacementBounds;
  evidence: BrowseEvidence[];
  warnings: string[];
  applied: boolean;
  appliedAt?: string;
}

export type PlacementLayout =
  | { type: "single" }
  | { type: "line"; spacing: number; angle?: number }
  | { type: "grid"; columns: number; spacingX: number; spacingY: number }
  | { type: "circle"; radius: number; startAngle?: number }
  | {
      type: "scatter";
      area: PlacementArea;
      minimumDistance?: number;
      seed?: number;
      exclusionZones?: ExclusionZone[];
    };

export type LocationType =
  | "forest"
  | "desert"
  | "city"
  | "village"
  | "industrial"
  | "militaryBase"
  | "ruins"
  | "swamp"
  | "cave"
  | "alien"
  | "terran"
  | "protoss"
  | "zerg"
  | "mixedNature"
  | "custom";
