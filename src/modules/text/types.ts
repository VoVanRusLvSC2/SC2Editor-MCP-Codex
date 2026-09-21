export type TextConfidence = "CONFIRMED" | "OBSERVED" | "INFERRED" | "UNKNOWN";
export type TextCoverage = "SUPPORTED" | "SUPPORTED_PRESERVE_ONLY" | "EDITOR_ONLY" | "RUNTIME_ONLY" | "UNKNOWN_NEEDS_RESEARCH";

export interface FontStylePropertySchema {
  property: string;
  nativeName: string;
  valueType: "string" | "integer" | "decimal" | "color" | "enum" | "flags" | "font";
  defaultValue?: string;
  enumValues?: string[];
  minimum?: number;
  maximum?: number;
  inheritable: boolean;
  editorSupport: boolean;
  runtimeSupport: "CONFIRMED" | "UNTESTED";
  discoveredFrom: string[];
  confidence: TextConfidence;
  coverage: TextCoverage;
  description?: string;
}

export interface TextSchemaData {
  schemaVersion: string;
  editorBuild: string;
  editorSha256: string;
  generatedAt: string;
  properties: FontStylePropertySchema[];
  styleFlags: string[];
  fontFlags: string[];
  horizontalJustify: string[];
  verticalJustify: string[];
  glowModes: string[];
  sources: string[];
}

export interface NativeStyleValue {
  nativeValue: string;
  reference?: string;
  resolvedValue?: string;
}

export interface ResolvedFontStyle {
  name: string;
  sourceFile: string;
  template?: string;
  declared: Record<string, NativeStyleValue>;
  effective: Record<string, NativeStyleValue>;
  resolutionTrace: string[];
  consumers: string[];
}

export interface RichTextAttribute {
  name: string;
  value: string;
  quote: "\"" | "'";
}

export type RichTextNode =
  | { kind: "text"; raw: string }
  | { kind: "tag"; nativeName: string; attrs: RichTextAttribute[]; selfClosing: boolean; children: RichTextNode[]; rawOpen: string; rawClose?: string; known: boolean }
  | { kind: "raw"; raw: string; reason: string };

export interface RichTextDocument {
  source: string;
  nodes: RichTextNode[];
  diagnostics: Array<{ severity: "error" | "warning"; offset: number; message: string }>;
}

export interface TextValidationDiagnostic {
  level: "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  target?: string;
}

export interface TextValidationReport {
  validationScope?:string;
  semanticCoverage?:"PARTIAL";
  unresolvedRules?:string[];
  valid: boolean;
  errors: number;
  warnings: number;
  levels: Record<string, "PASS" | "FAIL" | "UNAVAILABLE" | "UNTESTED">;
  diagnostics: TextValidationDiagnostic[];
}

export type TextOperation =
  | { op: "style.add" | "style.set"; id: string; values: Record<string, string | number | boolean | string[]>; template?: string }
  | { op: "style.clone"; source: string; id: string }
  | { op: "style.setTemplate"; id: string; template: string }
  | { op: "style.rename"; id: string; newId: string }
  | { op: "style.delete"; id: string }
  | { op: "constant.add" | "constant.set"; id: string; value: string | number | boolean }
  | { op: "constant.remove"; id: string }
  | { op: "fontGroup.set"; id: string; fonts: string[]; requiredToLoad?: string }
  | { op: "text.set"; key: string; value: string; locale?: string }
  | { op: "text.setLocalized"; key: string; values: Record<string, string> }
  | { op: "text.remove"; key: string; locale?: string }
  | { op: "richText.style"; key: string; style: string; start: number; end: number; locale?: string }
  | { op: "richText.color"; key: string; color: string; start: number; end: number; locale?: string }
  | { op: "richText.newLine"; key: string; offset: number; locale?: string }
  | { op: "richText.noWrap"; key: string; start: number; end: number; locale?: string }
  | { op: "font.import"; source: string; target: string };

export interface TextApplyRequest {
  styleFile?: string;
  stringFiles?: Record<string, string>;
  operations: TextOperation[];
  dryRun?: boolean;
  stage?: boolean;
  backup?: boolean;
  validate?: boolean;
  allowInvalid?: boolean;
  expectedSha256?: Record<string, string>;
}
