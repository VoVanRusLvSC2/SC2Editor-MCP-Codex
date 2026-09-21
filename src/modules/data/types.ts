export type DataScalar = string | number | boolean;

export interface DataFieldPathSegment {
  name: string;
  index?: string;
}

export interface DataField {
  path: string;
  name: string;
  index?: string;
  value?: string;
  link?: string;
  attrs: Record<string, string>;
  children: DataField[];
  sourcePath: string;
  rawSource?: string;
}

export interface DataObject {
  ctype: string;
  domain?: string;
  id?: string;
  parent?: string;
  isDefault: boolean;
  attrs: Record<string, string>;
  fields: DataField[];
  sourcePath: string;
  rawSource?: string;
}

export interface DataReference {
  file: string;
  object: string;
  path: string;
  carrier: "parent" | "Link";
  value: string;
  targetDomain?: string;
  targetType?: string;
  evidence: "NATIVE_TYPED_ATTRIBUTE" | "TARGET_TYPE_UNRESOLVED";
}

export interface DataDiagnostic {
  level: "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file: string;
  path: string;
  reference?: { kind: string; value: string };
}

export interface DataValidationReport {
  validationScope?:string;
  semanticCoverage?:"PARTIAL";
  unresolvedRules?:string[];
  valid: boolean;
  errors: number;
  warnings: number;
  levels: Record<"L1" | "L2" | "L3" | "L4" | "L5" | "L6", "PASS" | "FAIL" | "UNAVAILABLE" | "UNTESTED">;
  diagnostics: DataDiagnostic[];
}

export interface DataNativeFieldSpec {
  name: string;
  index?: string | number;
  value?: DataScalar;
  link?: string;
  attrs?: Record<string, DataScalar>;
  children?: DataNativeFieldSpec[];
}

export interface DataTextureVitalLayerSpec {
  slot: string;
  healthyFile: string;
  damagedFile: string;
}

export type DataObjectSelector = string | { id: string; ctype?: string; domain?: string };

export type DataOperation =
  | { op: "object.create"; as?: string; ctype: string; id: string; parent?: string; attrs?: Record<string, DataScalar>; fields?: DataNativeFieldSpec[] }
  | { op: "object.clone"; as?: string; object: DataObjectSelector; id: string; parent?: string }
  | { op: "object.rename"; object: DataObjectSelector; newId: string; updateReferences?: boolean }
  | { op: "object.delete"; object: DataObjectSelector; force?: boolean }
  | { op: "object.setParent"; object: DataObjectSelector; parent?: string }
  | { op: "object.setAttribute"; object: DataObjectSelector; attribute: string; value: DataScalar }
  | { op: "object.removeAttribute"; object: DataObjectSelector; attribute: string }
  | { op: "field.set"; object: DataObjectSelector; path: string; value: DataScalar }
  | { op: "field.setLink"; object: DataObjectSelector; path: string; link: string }
  | { op: "field.setAttribute"; object: DataObjectSelector; path: string; attribute: string; value: DataScalar }
  | { op: "field.removeAttribute"; object: DataObjectSelector; path: string; attribute: string }
  | { op: "field.remove"; object: DataObjectSelector; path: string }
  | { op: "array.append"; object: DataObjectSelector; path: string; value?: DataScalar; link?: string; attrs?: Record<string, DataScalar> }
  | { op: "native.add"; object: DataObjectSelector; parentPath?: string; field: DataNativeFieldSpec }
  | { op: "recipe.weaponBurn"; as?: string; id: string; carrierEffect: string; carrierCtype?: string; carrierPath?: string; impactEffect: string; duration: number; period: number; periodicDamage: number; visualModel: string; attachSite?: string; damageKind?: string; alignment?: string; editorCategories?: string }
  | { op: "recipe.unitTextureByVital"; as?: string; id: string; unit: string; threshold: number; textures: DataTextureVitalLayerSpec[]; pollInterval?: number };
