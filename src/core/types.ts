export type XmlAttrs = Record<string, string>;

export interface XmlAttrSpan {
  name: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  quote: "\"" | "'";
}

export interface XmlNode {
  id: number;
  tag: string;
  attrs: XmlAttrs;
  attrSpans: XmlAttrSpan[];
  start: number;
  startTagEnd: number;
  endTagStart: number;
  end: number;
  selfClosing: boolean;
  parentId: number | null;
  childIds: number[];
}

export interface ParseDiagnostic {
  severity: "error" | "warning" | "info";
  offset: number;
  message: string;
}

export interface ParsedXml {
  nodes: XmlNode[];
  rootIds: number[];
  diagnostics: ParseDiagnostic[];
}

export interface FrameSummary {
  path: string;
  name: string;
  type: string;
  file?: string;
  template?: string;
  handle?: string;
  children: number;
}

export interface ClippedImageSpec {
  parentPath?: string;
  name: string;
  imageName?: string;
  texture: string;
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
  offsetX?: number;
  offsetY?: number;
  layer?: number;
  textureType?: "None" | "Normal" | "Border" | "HorizontalBorder" | "EndCap" | "NineSlice" | "Circular" | string;
  textureCoords?: { top: number; left: number; bottom: number; right: number; layer?: number };
}

export interface AnchorSpec {
  side: "Top" | "Left" | "Right" | "Bottom" | "All";
  relative: string;
  pos?: "Min" | "Mid" | "Max" | string;
  offset?: number;
}

export interface FrameDetails extends FrameSummary {
  properties: Record<string, string | XmlAttrs | Array<string | XmlAttrs>>;
  elements: ElementDetails[];
  anchors: AnchorSpec[];
  childPaths: string[];
  source: string;
}

export interface ElementDetails {
  tag: string;
  attrs: XmlAttrs;
  children: ElementDetails[];
  source: string;
}

export type ScalarValue = string | number | boolean;

export interface ElementSpec {
  tag: string;
  attrs?: Record<string, ScalarValue>;
  value?: ScalarValue;
  children?: ElementSpec[];
}

export interface PropertySelector {
  index?: string | number;
  layer?: string | number;
  attrs?: Record<string, ScalarValue>;
  occurrence?: number;
}

export interface StateConditionSpec {
  type: string;
  frame?: string;
  operator?: string;
  attrs?: Record<string, ScalarValue>;
}

export interface StateActionSpec {
  type: string;
  frame?: string;
  on?: string;
  undo?: boolean;
  attrs?: Record<string, ScalarValue>;
}

export interface StateSpec {
  name: string;
  when?: StateConditionSpec[];
  actions?: StateActionSpec[];
}

export interface StateGroupSpec {
  name: string;
  template?: string;
  file?: string;
  log?: boolean;
  defaultState?: string;
  states?: StateSpec[];
}

export interface AnimationEventSpec {
  event: string;
  action?: string;
  frame?: string;
}

export interface AnimationDriverSpec {
  type: string;
  attrs?: Record<string, ScalarValue>;
}

export interface AnimationKeySpec {
  type: string;
  time?: number;
  attrs?: Record<string, ScalarValue>;
}

export interface AnimationControllerSpec {
  type: string;
  name?: string;
  frame?: string;
  end?: string;
  attrs?: Record<string, ScalarValue>;
  keys?: AnimationKeySpec[];
}

export interface AnimationSpec {
  name: string;
  template?: string;
  file?: string;
  speed?: number;
  flags?: string;
  events?: AnimationEventSpec[];
  drivers?: AnimationDriverSpec[];
  controllers?: AnimationControllerSpec[];
}

export interface ValidationDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  file?: string;
  framePath?: string;
  source?: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: number;
  warnings: number;
  diagnostics: ValidationDiagnostic[];
}

export interface MutationResult {
  changed: boolean;
  beforeSha256: string;
  afterSha256: string;
  file: string;
  dryRun: boolean;
  staged?: boolean;
  saved?: boolean;
  summary: string;
  preview?: string;
}

export interface CreateFrameOperation {
  op: "create_frame";
  as?: string;
  parentPath?: string;
  type: string;
  name: string;
  template?: string;
  frameFile?: string;
  properties?: ElementSpec[];
  anchors?: AnchorSpec[];
  allowUnknownType?: boolean;
  allowUnknownProperties?: boolean;
  allowBlizzardOnly?: boolean;
}

export type LayoutOperation =
  | CreateFrameOperation
  | { op: "clone_frame"; as?: string; sourcePath: string; parentPath?: string; name: string }
  | { op: "delete_frame"; framePath: string }
  | {
    op: "set_property";
    framePath: string;
    property: string;
    value?: ScalarValue;
    attrs?: Record<string, ScalarValue>;
    selector?: PropertySelector;
    children?: ElementSpec[];
    replace?: boolean;
    remove?: boolean;
    allowUnknown?: boolean;
    allowReadonly?: boolean;
  }
  | { op: "set_anchor"; framePath: string; anchor: AnchorSpec }
  | { op: "apply_template"; framePath: string; template: string }
  | { op: "text.bindStyle"; framePath: string; style: string }
  | { op: "upsert_state_group"; framePath: string; stateGroup: StateGroupSpec }
  | { op: "upsert_animation"; framePath: string; animation: AnimationSpec }
  | { op: "add_include"; includePath: string }
  | { op: "remove_include"; includePath: string }
  | ({ op: "create_clipped_image"; as?: string } & ClippedImageSpec);

export interface AppliedOperation {
  index: number;
  op: LayoutOperation["op"];
  target?: string;
  alias?: string;
  templateUsage?: unknown;
  runtimeWarning?: string;
}

export interface ApplyTransactionResult {
  mutation: MutationResult;
  accepted: boolean;
  applied: AppliedOperation[];
  aliases: Record<string, string>;
  validation?: ValidationReport;
  efficiency: {
    toolCalls: 1;
    operations: number;
    includesValidation: boolean;
    includesDiff: true;
  };
}
