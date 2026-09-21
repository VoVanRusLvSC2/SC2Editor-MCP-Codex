import type { DataField, DataObject } from "../data/types.js";

export type BrowseAvailability =
  | "MAP_LOCAL"
  | "AVAILABLE_THROUGH_DEPENDENCY"
  | "INSTALLED_BUT_NOT_DECLARED"
  | "MISSING_DEPENDENCY"
  | "UNRESOLVED"
  | "UNKNOWN";

export type BrowseEvidence =
  | "PROVEN_BY_REAL_MAP"
  | "PROVEN_BY_ROUNDTRIP"
  | "PROVEN_BY_EXE"
  | "SUPPORTED_BY_DECOMPILATION"
  | "OBSERVED_CATALOG_XML"
  | "OBSERVED_STRING_TABLE"
  | "OBSERVED_ASSET_PATH"
  | "INFERRED"
  | "UNKNOWN";

export interface BrowseReference {
  direction: "outgoing" | "incoming";
  field: string;
  catalogType?: string;
  id: string;
  source: "Link" | "parent" | "typed-field" | "id-match";
  evidence: BrowseEvidence;
}

export interface BrowsePlaceableRepresentation {
  kind: "Unit" | "Doodad";
  objectElement: "ObjectUnit" | "ObjectDoodad";
  idAttribute: "UnitType" | "Type";
  id: string;
  evidence: BrowseEvidence;
}

export interface BrowseEntry {
  key: string;
  id: string;
  ctype: string;
  catalogType: string;
  objectKind: string;
  displayName: string;
  localizedNames: Record<string, string>;
  textKeys: string[];
  file: string;
  sourceLayer: "workspace" | "dependency" | "installed";
  dependency: string;
  availability: BrowseAvailability;
  engineActive?:boolean;
  activationMode?:string;
  parent?: string;
  assetPaths: string[];
  outgoing: BrowseReference[];
  incoming: BrowseReference[];
  placeable: boolean;
  placeableRepresentation?: BrowsePlaceableRepresentation;
  evidence: BrowseEvidence[];
  warnings: string[];
  definition: DataObject;
  effective?: {
    templateChain: Array<{ id?: string; ctype: string; file: string; layer: string }>;
    fields: Record<string, { path: string; value?: string; link?: string; attrs: Record<string, string>; declaredBy?: string; file?: string }>;
  };
}

export interface BrowseSearchQuery {
  query?: string;
  ids?: string[];
  catalogType?: string;
  objectKind?: string;
  dependency?: string;
  sourceLayer?: "workspace" | "dependency" | "installed";
  locale?: string;
  availability?: BrowseAvailability;
  hasModel?: boolean;
  hasTexture?: boolean;
  placeable?: boolean;
  limit?: number;
  offset?: number;
  compact?: boolean;
}

export interface BrowseSearchResult {
  key: string;
  id: string;
  ctype: string;
  catalogType: string;
  objectKind: string;
  displayName: string;
  source: string;
  sourceLayer: BrowseEntry["sourceLayer"];
  dependency: string;
  availability: BrowseAvailability;
  assetPaths: string[];
  related: Array<{ catalogType?: string; id: string }>;
  placeable: boolean;
  placeableRepresentation?: BrowsePlaceableRepresentation;
  score: number;
  confidence: number;
  matchedBy: string[];
  evidence: BrowseEvidence[];
  warnings: string[];
}

export interface PhysicalAssetEntry {
  path: string;
  file: string;
  kind: "Model" | "Texture" | "Sound" | "Icon" | "Animation" | "Asset";
  sourceLayer: BrowseEntry["sourceLayer"];
  dependency: string;
  availability: BrowseAvailability;
  referencedBy: Array<{ catalogType: string; id: string; field: string }>;
  evidence: BrowseEvidence[];
}

export interface BrowseIndexSnapshot {
  fingerprint: string;
  builtAt: string;
  entries: BrowseEntry[];
  assets: PhysicalAssetEntry[];
  files: Array<{ path: string; size: number; mtimeMs: number; sourceLayer: BrowseEntry["sourceLayer"]; dependency: string }>;
  warnings: string[];
}

export interface FlattenedDataField {
  field: DataField;
  path: string;
  value?: string;
  link?: string;
}
