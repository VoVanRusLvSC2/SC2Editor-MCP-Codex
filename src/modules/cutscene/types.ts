import type { ParseDiagnostic, XmlAttrs } from "../../core/types.js";

export type CutsceneValueKind =
  | "Bool" | "Int" | "Fixed" | "Decimal" | "String" | "Text" | "Enum" | "Flags"
  | "Color" | "Vec2" | "Vec3" | "Quaternion" | "Angle" | "Time" | "AssetRef"
  | "ObjectRef" | "AnimationRef" | "SoundRef" | "CameraRef" | "Array" | "Struct"
  | "RawNativeValue";

export type CutsceneCoverageStatus =
  | "SUPPORTED"
  | "SUPPORTED_PRESERVE_ONLY"
  | "EDITOR_ONLY"
  | "RUNTIME_ONLY"
  | "UNKNOWN_NEEDS_RESEARCH"
  | "NOT_APPLICABLE";

export interface CutsceneSchemaProperty {
  objectType: string;
  property: string;
  xmlName: string;
  valueType: CutsceneValueKind;
  enumValues?: string[];
  defaultValue?: string;
  keyframeable?: boolean;
  required?: boolean;
  description?: string;
  observedInCorpus: number;
  discoveredFrom: string[];
  discoveredFromTotal?: number;
  discoveredFromTruncated?: boolean;
  confidence: "confirmed" | "documented" | "inferred" | "unknown";
  coverage: CutsceneCoverageStatus;
}

export interface CutsceneSchemaNode {
  nativeType: string;
  category: string;
  parentTypes: string[];
  childTypes: string[];
  observedInCorpus: number;
  discoveredFrom: string[];
  discoveredFromTotal?: number;
  discoveredFromTruncated?: boolean;
  confidence: "confirmed" | "documented" | "inferred" | "unknown";
  coverage: CutsceneCoverageStatus;
}

export interface CutsceneSchemaData {
  schemaVersion: string;
  generatedAt: string;
  gameBuild?: string;
  editorBuild?: string;
  schemaHash?: string;
  sources: Array<{ kind: string; location: string; available: boolean; note?: string }>;
  nodes: CutsceneSchemaNode[];
  properties: CutsceneSchemaProperty[];
  enums: Array<{ name: string; values: string[]; discoveredFrom: string[] }>;
  runtime: {
    functions: Array<{ name: string; signature: string; source: string }>;
    constants: Array<{ name: string; value?: string; source: string }>;
  };
  corpus: {
    discoveredPaths: number;
    parsedFiles: number;
    failedFiles: number;
    files: Array<{ file: string; status: "PASS" | "FAIL" | "SKIPPED_NOT_AVAILABLE_LOCALLY"; diagnostics?: string[] }>;
  };
  editorEvidence?: {
    scannedFiles: number;
    skippedBinaryFiles: number;
    keywords: Record<string, number>;
    identifiers: Array<{ name: string; count: number; files: string[] }>;
  };
}

export interface CutsceneTime {
  input: string;
  unit: "native" | "seconds" | "milliseconds" | "timecode";
  decimalSeconds?: string;
  nativeValue?: string;
}

export interface CutsceneExtensionBag {
  unknownAttributes: Array<{ name: string; value: string }>;
  unknownChildren: number[];
  unknownProperties: Array<{ name: string; value: string }>;
}

export interface CutsceneObjectIR {
  id: string;
  nodeId: number;
  nativeType: string;
  category: string;
  nativeId?: string;
  displayName?: string;
  asset?: { catalog?: string; id?: string; path?: string };
  attributes: XmlAttrs;
  childIds: string[];
  extensions: CutsceneExtensionBag;
  rawSource: string;
}

export interface CutsceneDocumentIR {
  formatVersion?: string;
  id: string;
  name?: string;
  sourceFile?: string;
  rootNativeType: string;
  sceneProperties: XmlAttrs;
  objects: CutsceneObjectIR[];
  timeline: CutsceneObjectIR[];
  bookmarks: CutsceneObjectIR[];
  filters: CutsceneObjectIR[];
  metadata: XmlAttrs;
  diagnostics: ParseDiagnostic[];
  unknownAttributes: Array<{ name: string; value: string }>;
  unknownChildren: number[];
  preserveNative: boolean;
}

export interface CutsceneNodeSelector {
  id?: string;
  nodeId?: number;
  guid?: string;
  name?: string;
  nativeType?: string;
  occurrence?: number;
}

export interface NativeNodeSpec {
  nativeType: string;
  attrs?: Record<string, string | number | boolean>;
  children?: NativeNodeSpec[];
}

export type CutsceneVectorInput = string | [number, number, number];

export interface CutsceneComposeSpec {
  file: string;
  name?: string;
  version?: string;
  duration?: string;
  objects?: NativeNodeSpec[];
  director?: NativeNodeSpec;
  bookmarks?: Array<{ name: string; time?: string; jumpToBookmarkWhenHit?: string }>;
  filters?: NativeNodeSpec[];
  entries?: Array<{ as?: string; parent?: CutsceneNodeSelector | string; node: NativeNodeSpec }>;
  operations?: CutsceneOperation[];
  preserveNative?: boolean;
}

export type CutsceneOperation =
  | { op: "object.add"; as?: string; parent?: CutsceneNodeSelector | string; object: NativeNodeSpec }
  | { op: "object.remove"; object: CutsceneNodeSelector | string }
  | { op: "object.rename"; object: CutsceneNodeSelector | string; name: string }
  | { op: "object.clone"; as?: string; object: CutsceneNodeSelector | string; parent?: CutsceneNodeSelector | string; name?: string }
  | { op: "property.set"; object: CutsceneNodeSelector | string; path: string; value: string | number | boolean; allowUnknown?: boolean }
  | { op: "property.reset"; object: CutsceneNodeSelector | string; path: string }
  | { op: "timeline.add"; as?: string; parent: CutsceneNodeSelector | string; node: NativeNodeSpec }
  | { op: "timeline.remove"; node: CutsceneNodeSelector | string }
  | { op: "keyframe.add"; as?: string; track: CutsceneNodeSelector | string; keyframe: NativeNodeSpec }
  | { op: "keyframe.update"; keyframe: CutsceneNodeSelector | string; values: Record<string, string | number | boolean> }
  | { op: "keyframe.remove"; keyframe: CutsceneNodeSelector | string }
  | { op: "bookmark.add"; as?: string; name: string; time?: string; jumpToBookmarkWhenHit?: string }
  | { op: "bookmark.remove"; bookmark: CutsceneNodeSelector | string }
  | { op: "filter.add"; as?: string; parent?: CutsceneNodeSelector | string; filter: NativeNodeSpec }
  | { op: "filter.remove"; filter: CutsceneNodeSelector | string }
  | { op: "actor.add"; as?: string; parent?: CutsceneNodeSelector | string; name?: string; asset?: { catalog?: "Model"; id?: string; path?: string }; modelLink?: string; modelPath?: string; position?: CutsceneVectorInput; rotation?: CutsceneVectorInput; scale?: CutsceneVectorInput; properties?: Record<string, string | number | boolean>; duration?: string | number; lockedToEnd?: boolean }
  | { op: "actor.face"; actors: Array<CutsceneNodeSelector | string>; target: [number, number, number]; axisOffsetDegrees?: number }
  | { op: "text.add"; as?: string; parent?: CutsceneNodeSelector | string; name: string; text: string; position?: CutsceneVectorInput; enabled?: boolean; sortIndex?: number; duration?: string | number; lockedToEnd?: boolean }
  | { op: "text.animate"; as?: string; object: CutsceneNodeSelector | string; keyframes: Array<{ start?: string | number; value: string }>; enabled?: boolean; sortIndex?: number }
  | { op: "animation.layer.add"; as?: string; object: CutsceneNodeSelector | string; name?: string; enabled?: boolean; filter?: string; sortIndex?: number }
  | { op: "animation.add"; as?: string; layer: CutsceneNodeSelector | string; anim: string; animId?: number; start?: string | number; duration?: string | number; originalDuration?: string | number; priority?: number; looping?: boolean; blendTime?: string | number; blendOutTime?: string | number; startOffset?: string | number; timeScale?: number; weight?: number; rightAligned?: boolean; lockedToEnd?: boolean; playOnce?: boolean; playForever?: boolean; fullMatchLegacy?: boolean; movespeed?: number; originalMoveSpeed?: number; properties?: Record<string, string | number | boolean> }
  | { op: "animation.update"; animation: CutsceneNodeSelector | string; values: Record<string, string | number | boolean> }
  | { op: "animation.remove"; animation: CutsceneNodeSelector | string }
  | { op: "property.animate"; as?: string; object: CutsceneNodeSelector | string; property: string; name?: string; enabled?: boolean; filter?: string; sortIndex?: number; allowUnknown?: boolean; keyframes: Array<{ as?: string; start?: string | number; value: string | number | boolean; time?: string | number; curveInValue?: string; curveOutValue?: string; curveInType?: number; curveOutType?: number }> }
  | { op: "light.add"; as?: string; parent?: CutsceneNodeSelector | string; name: string; nativeType?: "CCutsceneNodeLight" | "CCutsceneNodeEnvironmentLight"; properties?: Record<string, string | number | boolean>; duration?: string | number; lockedToEnd?: boolean }
  | { op: "light.update"; light: CutsceneNodeSelector | string; properties: Record<string, string | number | boolean> }
  | { op: "light.remove"; light: CutsceneNodeSelector | string }
  | { op: "light.activate"; as?: string; light?: CutsceneNodeSelector | string; lightID?: string; lightIndex?: number; blendTime?: string | number; start?: string | number }
  | { op: "fog.upsert"; as?: string; fog?: CutsceneNodeSelector | string; name?: string; color: CutsceneVectorInput; falloff?: number; density?: number; startHeight?: number; duration?: string | number; lockedToEnd?: boolean }
  | { op: "camera.create"; as?: string; id: string; nativeType?: string; duration?: string | number; lockedToEnd?: boolean; properties?: Record<string, string | number | boolean> }
  | { op: "camera.pose"; camera: CutsceneNodeSelector | string; properties: Record<string, string | number | boolean> }
  | { op: "shot.add"; as?: string; camera: CutsceneNodeSelector | string; start: string; end?: string; transition?: NativeNodeSpec }
  | { op: "raw.patch"; start: number; end: number; text: string };

export interface CutsceneValidationDiagnostic {
  level: "L1_XML" | "L2_SCHEMA" | "L3_REFERENCES" | "L4_SEMANTIC" | "L5_EDITOR" | "L6_RUNTIME";
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  nodeId?: number;
}

export interface CutsceneValidationReport {
  validationScope?:string;
  semanticCoverage?:"PARTIAL";
  unresolvedRules?:string[];
  valid: boolean;
  highestCompletedLevel: "L1_XML" | "L2_SCHEMA" | "L3_REFERENCES" | "L4_SEMANTIC" | "L5_EDITOR" | "L6_RUNTIME";
  diagnostics: CutsceneValidationDiagnostic[];
  levels: Record<string, "PASS" | "FAIL" | "NOT_RUN" | "UNAVAILABLE">;
}
