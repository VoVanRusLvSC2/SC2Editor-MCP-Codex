export type AiEvidence = "EDITOR_EXE_EXACT" | "EDITOR_OUTPUT_OBSERVED" | "STRUCTURE_INFERRED" | "UNKNOWN_NEEDS_RESEARCH";
export type AiCoverage = "SUPPORTED" | "SUPPORTED_PRESERVE_ONLY" | "GATED_UNCONFIRMED";

export interface AiSchemaProperty {
  nativeName: string;
  owners: string[];
  valueType: "boolean" | "integer" | "time" | "string" | "player" | "point" | "trigger" | "aidef" | "aidefwave" | "opaque";
  evidence: AiEvidence;
  coverage: AiCoverage;
  description: string;
  defaultValue?: string;
  referenceKind?: "player" | "point" | "region" | "trigger" | "personality" | "wave" | "unit";
}

export interface AiSchemaData {
  schemaVersion: string;
  editorBuild: string;
  editorSha256: string;
  root: string;
  component: { typeCode: "aiai"; path: "CustomAI" };
  nodes: Array<{ nativeName: string; parents: string[]; evidence: AiEvidence; coverage: AiCoverage; description: string }>;
  properties: AiSchemaProperty[];
  triggerTypes: string[];
  runtimeFunctions: string[];
  sources: string[];
}

export interface AiNativeNode {
  id: string;
  nodeId: number;
  nativeType: string;
  parentId?: string;
  attrs: Record<string, string>;
  value?: string;
  children: string[];
  path: string;
  evidence: AiEvidence;
  rawSource?: string;
}

export interface AiDefinition {
  id: string;
  nodeId: number;
  properties: Record<string, string | undefined>;
  waveIds: string[];
  unknownChildren: string[];
  rawSource?: string;
}

export interface AiWave {
  id: string;
  nodeId: number;
  personalityId: string;
  order: number;
  properties: Record<string, string | undefined>;
  composition: Array<{ unit: string; quantity?: number; nativeType: string; path: string; evidence: AiEvidence }>;
  unknownChildren: string[];
  rawSource?: string;
}

export interface AiDocumentIR {
  root: string;
  definitions: AiDefinition[];
  waves: AiWave[];
  nativeNodes: AiNativeNode[];
  diagnostics: Array<{ severity: "error" | "warning" | "info"; code: string; message: string; path: string }>;
}

export type AiSelector = string | { id?: string; nodeId?: number; nativeType?: string; occurrence?: number };
export type AiScalar = string | number | boolean;

export interface AiNativeNodeSpec {
  nativeType: string;
  attrs?: Record<string, AiScalar>;
  value?: AiScalar;
  children?: AiNativeNodeSpec[];
}

export type AiOperation =
  | { op: "definition.create"; as?: string; id: string; properties?: Record<string, AiScalar>; allowUnconfirmedStructure?: boolean }
  | { op: "definition.update"; definition: AiSelector; properties: Record<string, AiScalar>; allowUnconfirmedStructure?: boolean }
  | { op: "definition.rename"; definition: AiSelector; newId: string; updateReferences?: boolean }
  | { op: "definition.clone"; definition: AiSelector; id: string; as?: string }
  | { op: "definition.delete"; definition: AiSelector; force?: boolean }
  | { op: "definition.reorder"; definition: AiSelector; before?: AiSelector; after?: AiSelector }
  | { op: "wave.create"; definition: AiSelector; id: string; as?: string; properties?: Record<string, AiScalar>; composition?: Array<{ unit: string; quantity: number }>; allowUnconfirmedStructure?: boolean }
  | { op: "wave.update"; wave: AiSelector; properties: Record<string, AiScalar>; allowUnconfirmedStructure?: boolean }
  | { op: "wave.rename"; wave: AiSelector; newId: string; updateReferences?: boolean }
  | { op: "wave.clone"; wave: AiSelector; id: string; as?: string }
  | { op: "wave.delete"; wave: AiSelector; force?: boolean }
  | { op: "wave.reorder"; wave: AiSelector; before?: AiSelector; after?: AiSelector }
  | { op: "composition.patch"; wave: AiSelector; mode: "replace" | "add" | "remove"; units: Array<{ unit: string; quantity?: number }>; unitTag?: string; allowUnconfirmedStructure?: boolean }
  | { op: "native.add"; parent?: AiSelector; as?: string; node: AiNativeNodeSpec; allowUnconfirmedStructure?: boolean }
  | { op: "native.set"; node: AiSelector; property: string; value: AiScalar; allowUnknown?: boolean }
  | { op: "native.remove"; node: AiSelector; force?: boolean };

export interface AiValidationDiagnostic {
  level: "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file: string;
  path: string;
  reference?: { kind: string; value: string };
}

export interface AiValidationReport {
  validationScope?:string;
  semanticCoverage?:"PARTIAL";
  unresolvedRules?:string[];
  valid: boolean;
  errors: number;
  warnings: number;
  levels: Record<"L1" | "L2" | "L3" | "L4" | "L5" | "L6", "PASS" | "FAIL" | "UNAVAILABLE" | "UNTESTED">;
  diagnostics: AiValidationDiagnostic[];
}
