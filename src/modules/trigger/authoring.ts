import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { projectPath } from "../../app/paths.js";
import { scanXml, decodeXmlValue } from "../../core/xmlScanner.js";
import { checkRegistrationSignature } from "./registration.js";
import { typeElementFragment, encode, localRef } from "./xmlFragments.js";
export { encode, localRef } from "./xmlFragments.js";

export { GUI_VARIABLE_TYPES } from "./typeSystem.js";
import {
  GUI_VARIABLE_TYPES,
  definitionsFor,
  sameGuiType,
  type GuiTypeRef,
  type GuiArraySize,
  type GuiMemberAccess,
  type GuiDefinitions,
} from "./typeSystem.js";
export type GuiValue =
  | {
      kind: "literal";
      type: (typeof GUI_VARIABLE_TYPES)[number];
      value: string | number | boolean | null;
    }
  | {
      kind: "variable";
      library?: string;
      id?: string;
      name?: string;
      indices?: GuiValue[];
      members?: GuiMemberAccess[];
    }
  | {
      kind: "parameter";
      id?: string;
      name?: string;
      indices?: GuiValue[];
      members?: GuiMemberAccess[];
    }
  | { kind: "preset"; id?: string; name?: string; library?: string; preset?: string }
  | { kind: "presetBits"; preset: string; values: string[]; library?: string }
  | { kind: "gamelink"; domain: string; id: string }
  | { kind: "unit"; objectId: number }
  | { kind: "trigger"; id?: string; name?: string; library?: string }
  | { kind: "text"; value: string; translations?: Record<string, string> }
  | { kind: "nativeCall"; function: string }
  | {
      kind: "call";
      function: string;
      args: Record<string, GuiValue | GuiValue[]>;
      children?: GuiChild[];
    }
  | { kind: "block" | "customScript"; source: string };
export interface GuiChild {
  role: string;
  call: GuiCall;
}
export type GuiCall =
  | {
      kind: "Event" | "Action" | "Condition";
      function: string;
      args: Record<string, GuiValue | GuiValue[]>;
      children?: GuiChild[];
    }
  | {
      kind: "Registration";
      function: string;
      trigger: GuiValue;
      args: Record<string, GuiValue | GuiValue[]>;
    };
export interface GuiVariable extends GuiType {
  name: string;
  type: (typeof GUI_VARIABLE_TYPES)[number];
  constant?: boolean;
  arraySizes?: GuiArraySize[];
  scope?: "global" | "local";
  gameType?: string;
  initial?: GuiValue;
  translations?: Record<string, string>;
}
export interface GuiParameter extends GuiType {
  name: string;
  type: (typeof GUI_VARIABLE_TYPES)[number];
  default?: GuiValue;
  limits?: string;
  reference?: boolean;
  multiple?: boolean;
  variableOnly?: boolean;
  preload?: boolean;
  matchConstant?: boolean;
  alternateDisplay?: boolean;
  gameType?: string;
  translations?: Record<string, string>;
}
export interface GuiFunction {
  flags?: Array<"CreateThread" | "Hidden" | "NoScriptPrefix">;
  grammar?: string;
  hint?: string;
  name: string;
  kind: "Action" | "Condition" | "Event" | "Function";
  parameters?: GuiParameter[];
  returnType?: GuiType;
  variables?: GuiVariable[];
  calls: GuiCall[];
  returns?: GuiValue;
  translations?: Record<string, string>;
}
export interface GuiPreset {
  name: string;
  baseType: "int" | "fixed" | "bool" | "string";
  integer?: boolean;
  asBits?: boolean;
  generateConstants?: boolean;
  translations?: Record<string, string>;
  values: Array<{
    name: string;
    value?: string | number | boolean;
    default?: boolean;
    translations?: Record<string, string>;
  }>;
}
export interface GuiStructure {
  name: string;
  translations?: Record<string, string>;
  fields: GuiVariable[];
}
export interface GuiRequest {
  presets?: GuiPreset[];
  structures?: GuiStructure[];
  functions?: GuiFunction[];
  targetTrigger?: string;
  create?: {
    library?: string;
    identifier: string;
    category?: string;
    folder?: string;
    genre?: import("./organization.js").OrganizationArgs["genre"];
    translations?: Record<string, string>;
  };
  calls: GuiCall[];
  variables?: GuiVariable[];
  stringFiles?: string[];
}
export interface Parameter extends GuiType {
  variableType?: string;
  selectorPresetId?: string;
  presetLibrary?: string;
  id: string;
  name: string;
  type: string;
  library?: string;
  defaultValue?: GuiValue;
  defaultXml?: string;
  defaultLibrary?: string;
  gameType?: string;
  flags: string[];
  limits?: string;
  presetId?: string;
  presets?: Array<{ id: string; name: string }>;
}
export interface FunctionDef {
  name: string;
  id: string;
  library: string;
  flags: string[];
  origin?: "map" | "dependency";
  returnType?: string;
  returnGuiType?: GuiType;
  returnGameType?: string;
  parameters: Parameter[];
  subFunctions?: Array<{ id: string; name: string; kind: string }>;
  xml?: string;
}
export interface Registry {
  mapScope?: string;
  typeDefinitions?: GuiDefinitions;
  externalVariables?: ReturnType<typeof inspectGuiVariables>;
  schemaVersion: number;
  build: number;
  source: string;
  sha256: string;
  functions: FunctionDef[];
  nativeExpressions?: Array<{
    name: string;
    id: string;
    type: string;
    library: string;
    xml?: string;
  }>;
  definitions?: FunctionDef[];
  labels?: Array<{
    library: string;
    type: "Label";
    id: string;
    names: { enUS: string | null; ruRU: string | null };
    icon: string | null;
    color: string | null;
  }>;
  localeSources?: Record<string, { path: string; sha256: string }>;
}
export interface GuiType {
  type: string;
  gameType?: string;
  presetId?: string;
  structureId?: string;
  typeLibrary?: string;
  typeElement?: GuiTypeRef;
  arrayRank?: number;
  constant?: boolean;
}
export interface GuiText {
  key: string;
  value: string;
  translations?: Record<string, string>;
}
export interface RenderContext {
  functionId?: string;
  returnType?: GuiType;
  triggerId?: string;
  initializing?: string;
  globalOnly?: boolean;
  inLoop?: boolean;
  onText?: (text: GuiText) => void;
}
let cached: Registry | undefined,
  revision: string | undefined,
  cachedFile: string | undefined,
  cachedFileDigest: string | undefined;
export const registry = (file = projectPath("generated/trigger-authoring-registry.json")) => {
  const stat = statSync(file),
    next = stat.size + ":" + stat.mtimeMs;
  if (revision !== next || cachedFile !== file) {
    cachedFile = file;
    revision = next;
    const source = readFileSync(file, "utf8");
    cachedFileDigest = digest(source);
    cached = JSON.parse(source) as Registry;
  }
  return cached!;
};
export function registrySourceDigest(
  file = projectPath("generated/trigger-authoring-registry.json"),
) {
  registry(file);
  return cachedFileDigest!;
}
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const registryHashes = new WeakMap<Registry, string>();
export function registryDigest(r: Registry) {
  let value = registryHashes.get(r);
  if (!value) {
    value = digest(JSON.stringify(r));
    registryHashes.set(r, value);
  }
  return value;
}
const allowedTypes = new Set<string>([
  ...GUI_VARIABLE_TYPES,
  "preset",
  "anynumber",
  "anycompare",
  "anyvariable",
  "sameas",
  "sameasparent",
  "anytype",
  "anygamelink",
  "anypreset",
  "return",
]);
const allowedFlags = new Set([
  "FlagNative",
  "FlagAction",
  "FlagEvent",
  "FlagCall",
  "FlagCondition",
  "FlagSubFunctions",
  "FlagAllowBreak",
  "FlagOperator",
  "FlagNoScriptPrefix",
  "FlagCreateThread",
  "FlagHidden",
]);
const allowedParamFlags = new Set([
  "ParamFlagPreload",
  "ParamFlagReference",
  "ParamFlagMatchConst",
  "ParamFlagVariableOnly",
  "ParamFlagAltDisplay",
  "ParamFlagMultiple",
]);

/** Eligibility describes known XML forms, not an SC2 compiler/engine guarantee. */
export function functionSupport(f: FunctionDef) {
  const reasons: string[] = [];
  if (f.library !== "Ntve" && !f.origin)
    reasons.push("Only verified built-in definitions are supported");
  for (const flag of f.flags)
    if (!allowedFlags.has(flag)) reasons.push("Unsupported function flag: " + flag);
  if (
    !f.flags.some((flag) => ["FlagAction", "FlagEvent", "FlagCondition", "FlagCall"].includes(flag))
  )
    reasons.push("No callable GUI role");
  if (new Set(f.parameters.map((p) => p.id)).size !== f.parameters.length)
    reasons.push("Duplicate parameter definitions");
  for (const p of f.parameters) {
    if (!allowedTypes.has(p.type)) reasons.push("Unsupported parameter type: " + String(p.type));
    for (const flag of p.flags ?? [])
      if (!allowedParamFlags.has(flag)) reasons.push("Unsupported parameter flag: " + flag);
    if (p.type === "preset" && !p.presets?.length && !p.typeElement?.id)
      reasons.push("Preset members unavailable");
    if (p.type === "sameas" && !f.parameters.some((other) => other.id === p.presetId))
      reasons.push("Polymorphic type source unavailable");
    if (p.type === "gamelink" && !p.gameType) reasons.push("Game domain unavailable");
  }
  if (
    f.returnType &&
    (!allowedTypes.has(f.returnType) ||
      ["sameas", "anynumber", "anycompare", "anyvariable"].includes(f.returnType) ||
      (f.returnType === "gamelink" && !f.returnGameType) ||
      (["preset", "struct"].includes(f.returnType) && !f.returnGuiType?.typeElement))
  )
    reasons.push("Return type details unavailable: " + f.returnType);
  if (f.subFunctions?.some((s) => !["Condition", "Action"].includes(s.kind)))
    reasons.push("Unsupported child role");
  return { supported: reasons.length === 0, reasons: [...new Set(reasons)] };
}
/** Runtime registration is a distinct role. Ordinary Event serialization does
 * not establish the compiler-supplied trigger argument or native API binding. */
export function registrationSupport(f: FunctionDef) {
  if (!f.flags.includes("FlagEvent")) return undefined;
  const reasons = [...functionSupport(f).reasons];
  try {
    checkRegistrationSignature(f);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  return {
    supported: reasons.length === 0,
    callKind: "Registration" as const,
    targetType: "trigger" as const,
    reasons: [...new Set(reasons)],
  };
}
function definitions(r: Registry) {
  return r.definitions ?? r.functions;
}
const functionIndexes = new WeakMap<
  Registry,
  { ids: Map<string, FunctionDef[]>; names: Map<string, FunctionDef[]> }
>();
function functionIndex(r: Registry) {
  let index = functionIndexes.get(r);
  if (index) return index;
  index = { ids: new Map(), names: new Map() };
  for (const f of definitions(r)) {
    index.ids.set(f.id, [...(index.ids.get(f.id) ?? []), f]);
    index.names.set(f.name, [...(index.names.get(f.name) ?? []), f]);
  }
  functionIndexes.set(r, index);
  return index;
}
function compatible(expected: GuiType, actual: GuiType) {
  if (expected.type === "anynumber") return ["int", "fixed"].includes(actual.type);
  if (expected.type === "anycompare")
    return !["struct", "text"].includes(actual.type) && (actual.arrayRank ?? 0) === 0;
  if (expected.type === "anyvariable") return (actual.arrayRank ?? 0) === 0;
  if (expected.type === "anygamelink") return actual.type === "gamelink";
  if (expected.type === "anypreset") return actual.type === "preset";
  if (expected.type === "anytype") return (actual.arrayRank ?? 0) === 0;
  return sameGuiType(expected, actual);
}
export function resolveFunction(
  name: string,
  r: Registry,
  role?: GuiCall["kind"] | "Expression",
  expected?: GuiType,
) {
  const scopeSplit = name.indexOf("::"),
    explicitLibrary = scopeSplit >= 0 ? name.slice(0, scopeSplit) : undefined;
  name = scopeSplit >= 0 ? name.slice(scopeSplit + 2) : name;
  const prefix = name.startsWith("custom:")
      ? "map"
      : name.startsWith("native:")
        ? "native"
        : undefined,
    lookup = prefix ? name.slice(name.indexOf(":") + 1) : name;
  const index = functionIndex(r);
  let found = (index.ids.get(lookup) ?? index.names.get(lookup) ?? []).filter(
    (f) =>
      (explicitLibrary === undefined || f.library === explicitLibrary) &&
      (!prefix || (prefix === "map" ? f.origin === "map" : f.origin !== "map")),
  );
  if (explicitLibrary === undefined && r.mapScope !== undefined) {
    const exactId = index.ids.has(lookup),
      local = found.filter((f) => f.origin !== "map" || f.library === r.mapScope);
    if (!exactId || local.length) found = local;
  }
  if (!found.length) throw new Error("GUI_FUNCTION_UNSUPPORTED: " + name);
  if (role)
    found = found.filter((f) =>
      role === "Expression"
        ? !!f.returnType && (f.flags.includes("FlagCall") || f.flags.includes("FlagCondition"))
        : f.flags.includes("Flag" + role) ||
          (role === "Condition" && f.returnType === "bool" && f.flags.includes("FlagCall")),
    );
  if (expected)
    found = found.filter(
      (f) =>
        !!f.returnType &&
        compatible(expected, f.returnGuiType ?? { type: f.returnType, gameType: f.returnGameType }),
    );
  const eligible = found.filter((f) => functionSupport(f).supported);
  if (eligible.length) found = eligible;
  // Preserve the previously published nine name bindings; new overloads require
  // their definition ID or an expected expression return type.
  if (found.length > 1 && !found.some((f) => f.origin === "map")) {
    const legacy = r.functions.find(
      (f) => f.name === lookup && found.some((candidate) => candidate.id === f.id),
    );
    if (legacy) found = [legacy];
  }
  if (found.length !== 1)
    throw new Error(
      found.length ? "GUI_FUNCTION_AMBIGUOUS: " + name : "GUI_FUNCTION_ROLE_OR_TYPE: " + name,
    );
  const support = functionSupport(found[0]);
  if (!support.supported)
    throw new Error("GUI_FUNCTION_UNSUPPORTED: " + name + " " + support.reasons.join(", "));
  return found[0];
}
export function describeFunction(name: string, r = registry()) {
  const found = definitions(r).filter((f) => f.id === name || f.name === name);
  let selected = found;
  if (selected.length > 1) {
    const legacy = r.functions.find((f) => f.name === name);
    if (legacy) selected = [legacy];
  }
  if (selected.length !== 1)
    throw new Error(
      selected.length ? "GUI_FUNCTION_AMBIGUOUS: " + name : "GUI_FUNCTION_UNSUPPORTED: " + name,
    );
  const f = selected[0];
  return {
    ...f,
    build: r.build,
    provenance: { source: r.source, sha256: r.sha256 },
    serializerSupported: functionSupport(f).supported,
    support: functionSupport(f),
    registration: registrationSupport(f),
    supportedValues: [
      "literal",
      "variable:id-or-name:indices-and-members",
      "parameter:id-or-name:indices-and-members",
      "preset:id-or-name",
      "presetBits",
      "gamelink",
      "unit:placed-object",
      "trigger:id-or-name",
      "text:localized",
      "nativeCall:zeroArgReturn",
      "call:typed-recursive",
      "multiple-values:declared-parameters",
    ],
    arguments: "Parameter IDs or unique definition names; duplicate aliases rejected",
    unsupportedValues: ["block", "customScript"],
    compiler: "NOT_EXECUTED",
  };
}
export function inspectGuiVariables(xml: string, library = "") {
  const p = scanXml(xml);
  const libOf = (node: (typeof p.nodes)[number]) => {
    let current = node;
    while (current.parentId !== null) {
      current = p.nodes[current.parentId];
      if (current.tag === "Library") return current.attrs.Id ?? "";
    }
    return p.nodes.find((n) => n.tag === "Standard")?.attrs.Id ?? "";
  };
  return p.nodes
    .filter((n) => n.tag === "Element" && n.attrs.Type === "Variable" && libOf(n) === library)
    .map((n) => {
      const variableType = n.childIds.map((i) => p.nodes[i]).find((c) => c.tag === "VariableType");
      const children = variableType?.childIds.map((i) => p.nodes[i]) ?? [];
      const identifier = n.childIds.map((i) => p.nodes[i]).find((c) => c.tag === "Identifier");
      const owners = p.nodes
        .filter(
          (ref) =>
            ref.tag === "Variable" &&
            ref.attrs.Type === "Variable" &&
            ref.attrs.Id === n.attrs.Id &&
            (ref.attrs.Library ?? libOf(ref)) === library &&
            ref.parentId !== null,
        )
        .map((ref) => p.nodes[ref.parentId!])
        .filter(
          (owner) =>
            owner.tag === "Element" &&
            ["Trigger", "FunctionDef", "Structure"].includes(owner.attrs.Type),
        );
      const valueRef = n.childIds
          .map((i) => p.nodes[i])
          .find((c) => c.tag === "Value" && c.attrs.Type === "Param"),
        initializer = valueRef
          ? p.nodes.find(
              (e) =>
                e.tag === "Element" &&
                e.attrs.Type === "Param" &&
                e.attrs.Id === valueRef.attrs.Id &&
                libOf(e) === (valueRef.attrs.Library ?? library),
            )
          : undefined,
        value = initializer?.childIds.map((i) => p.nodes[i]).find((c) => c.tag === "Value");
      return {
        initialScalar: value
          ? decodeXmlValue(xml.slice(value.startTagEnd, value.endTagStart))
          : undefined,
        id: n.attrs.Id,
        name: identifier
          ? decodeXmlValue(xml.slice(identifier.startTagEnd, identifier.endTagStart))
          : "",
        library,
        type: children.find((c) => c.tag === "Type")?.attrs.Value ?? "",
        gameType: children.find((c) => c.tag === "GameType")?.attrs.Value,
        presetId: children.find((c) => c.tag === "TypeElement")?.attrs.Id,
        ownerIds: owners.map((o) => o.attrs.Id),
        scope: owners.some((o) => o.attrs.Type === "Structure")
          ? ("member" as const)
          : owners.length
            ? ("local" as const)
            : ("global" as const),
        typeElement: children.find((c) => c.tag === "TypeElement")
          ? {
              id: children.find((c) => c.tag === "TypeElement")!.attrs.Id,
              library: children.find((c) => c.tag === "TypeElement")!.attrs.Library ?? library,
              type: children.find((c) => c.tag === "TypeElement")!.attrs.Type as
                "Preset" | "Structure",
            }
          : undefined,
        arraySizes: children
          .filter((c) => c.tag === "ArraySize")
          .map((c) => ({
            dim: Number(c.attrs.Dim),
            value: c.attrs.Value,
            variableId: c.attrs.Id,
            library: c.attrs.Library ?? library,
          })),
        constant: [...children, ...n.childIds.map((i) => p.nodes[i])].some((c) =>
          ["FlagConstant", "FlagConst", "Constant"].includes(c.tag),
        ),
        array: [...children, ...n.childIds.map((i) => p.nodes[i])].some((c) =>
          /Array|Dimension/.test(c.tag),
        ),
      };
    });
}
function variable(
  value: Extract<GuiValue, { kind: "variable" }>,
  xml: string,
  library: string,
  context: RenderContext,
  index = inspectGuiVariables(xml, library),
) {
  const requestedLibrary = value.library ?? library;
  let candidates = index.filter(
    (v) => v.library === requestedLibrary && (value.id ? v.id === value.id : v.name === value.name),
  );
  if (value.id && value.name) candidates = candidates.filter((v) => v.name === value.name);
  const visible = candidates.filter(
    (v) =>
      v.scope === "global" ||
      (v.library === library &&
        !context.globalOnly &&
        !!(context.functionId ?? context.triggerId) &&
        v.ownerIds.length === 1 &&
        v.ownerIds[0] === (context.functionId ?? context.triggerId)),
  );
  const locals = visible.filter((v) => v.scope === "local");
  if (!value.id && locals.length) candidates = locals;
  else candidates = visible;
  if (candidates.length !== 1)
    throw new Error(
      candidates.length ? "GUI_VARIABLE_AMBIGUOUS" : "GUI_VARIABLE_UNRESOLVED_OR_SCOPE",
    );
  const v = candidates[0];
  if (v.id === context.initializing && v.library === library)
    throw new Error("GUI_VARIABLE_SELF_INITIALIZER");
  if (!allowedTypes.has(v.type)) throw new Error("GUI_VARIABLE_TYPE_UNSUPPORTED");
  return v;
}
export function validateGuiRequestSize(request: GuiRequest) {
  let nodes = 0;
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 48) throw new Error("GUI_REQUEST_DEPTH_LIMIT");
    if (v === null || typeof v !== "object") return;
    if (seen.has(v)) throw new Error("GUI_REQUEST_CYCLE");
    seen.add(v);
    if (++nodes > 5000) throw new Error("GUI_REQUEST_NODE_LIMIT");
    for (const child of Object.values(v)) walk(child, depth + 1);
    seen.delete(v);
  };
  walk(request, 0);
  if (Buffer.byteLength(JSON.stringify(request)) > 1024 * 1024)
    throw new Error("GUI_REQUEST_BYTE_LIMIT");
  if (
    (request.calls?.length ?? 0) > 100 ||
    (request.variables?.length ?? 0) > 64 ||
    (request.functions?.length ?? 0) > 32 ||
    (request.presets?.length ?? 0) > 32 ||
    (request.structures?.length ?? 0) > 32
  )
    throw new Error("GUI_BATCH_LIMIT");
}
export function collectGuiValues(request: GuiRequest) {
  const values: GuiValue[] = [];
  const value = (v: GuiValue) => {
    values.push(v);
    if (v.kind === "variable" || v.kind === "parameter") {
      v.indices?.forEach(value);
      v.members?.forEach((m) => m.indices?.forEach(value));
    }
    if (v.kind === "call") {
      Object.values(v.args).forEach((a) => (Array.isArray(a) ? a.forEach(value) : value(a)));
      v.children?.forEach((c) => call(c.call));
    }
  };
  const call = (c: GuiCall) => {
    if (c.kind === "Registration") value(c.trigger);
    Object.values(c.args).forEach((a) => (Array.isArray(a) ? a.forEach(value) : value(a)));
    if (c.kind !== "Registration") c.children?.forEach((c) => call(c.call));
  };
  request.calls.forEach(call);
  request.variables?.forEach((v) => {
    if (v.initial) value(v.initial);
  });
  request.functions?.forEach((f) => {
    f.calls.forEach(call);
    f.variables?.forEach((v) => {
      if (v.initial) value(v.initial);
    });
    f.parameters?.forEach((p) => {
      if (p.default) value(p.default);
    });
    if (f.returns) value(f.returns);
  });
  request.structures?.forEach((s) =>
    s.fields.forEach((v) => {
      if (v.initial) value(v.initial);
    }),
  );
  return values;
}

function canonicalScalarDefaultString(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const scalar = JSON.parse(value);
    return (
      (scalar === null || scalar === false || scalar === 0) && JSON.stringify(scalar) === value
    );
  } catch {
    return false;
  }
}

class Renderer {
  readonly elements: string[] = [];
  private nodes = 0;
  private readonly variables: ReturnType<typeof inspectGuiVariables>;
  private readonly definitions: GuiDefinitions;
  constructor(
    private readonly library: string,
    private readonly nextId: () => string,
    private readonly xml: string,
    private readonly r: Registry,
    private readonly context: RenderContext,
  ) {
    this.variables = [
      ...inspectGuiVariables(xml, library),
      ...(r.externalVariables ?? []).filter((v) => v.library !== library),
    ];
    this.definitions = definitionsFor(xml, library, r);
  }
  initializer(value: GuiValue, type: GuiType, paramId: string, context: RenderContext) {
    const variable = this.variables.find(
      (v) => v.id === context.initializing && v.library === this.library,
    );
    if (
      variable &&
      !variable.constant &&
      type.type === "string" &&
      value.kind === "literal" &&
      value.type === "string" &&
      canonicalScalarDefaultString(value.value)
    ) {
      // The original Editor elides these scalar spellings in Variable/Value,
      // even with ValueType=string. A stock expression keeps the explicit value.
      const concat = resolveFunction("native:CombineStrings", this.r, "Expression", {
        type: "string",
      });
      if (concat.parameters.length !== 2 || concat.parameters.some((p) => p.type !== "string"))
        throw Error("GUI_STRING_INITIALIZER_CARRIER_SIGNATURE");
      value = {
        kind: "call",
        function: "native:CombineStrings",
        args: {
          [concat.parameters[0].id]: { kind: "literal", type: "string", value: "" },
          [concat.parameters[1].id]: value,
        },
      };
    }
    return this.value(value, type, paramId, context, 0);
  }
  private allocate() {
    if (++this.nodes > 2000) throw new Error("GUI_RENDER_NODE_LIMIT");
    return this.nextId();
  }
  private infer(v: GuiValue, context: RenderContext, expected?: GuiType): GuiType {
    if (v.kind === "literal") return { type: v.type };
    if (v.kind === "variable" || v.kind === "parameter") return this.access(v, context).type;
    if (v.kind === "preset" || v.kind === "presetBits")
      return this.selectedPreset(v, expected).type;
    if (v.kind === "gamelink") return { type: "gamelink", gameType: v.domain };
    if (v.kind === "unit") return { type: "unit" };
    if (v.kind === "trigger") {
      this.trigger(v);
      return { type: "trigger" };
    }
    if (v.kind === "text") return { type: "text" };
    if (v.kind === "call" || v.kind === "nativeCall") {
      const f = resolveFunction(v.function, this.r, "Expression", expected);
      return f.returnGuiType ?? { type: f.returnType!, gameType: f.returnGameType };
    }
    throw new Error("GUI_EXPRESSION_UNSUPPORTED: " + v.kind);
  }
  private parameter(v: Extract<GuiValue, { kind: "parameter" }>, context: RenderContext) {
    const f = functionIndex(this.r)
      .ids.get(context.functionId ?? "")
      ?.find((f) => f.library === this.library && f.origin === "map");
    const found =
      f?.parameters.filter(
        (p) =>
          (v.id ? p.id === v.id : p.name === v.name) && (!v.id || !v.name || p.name === v.name),
      ) ?? [];
    if (found.length !== 1) throw new Error("GUI_PARAMETER_UNRESOLVED_OR_SCOPE");
    return found[0];
  }
  private trigger(v: Extract<GuiValue, { kind: "trigger" }>) {
    const tree = scanXml(this.xml),
      library = v.library ?? this.library;
    const scope = (node: (typeof tree.nodes)[number]) => {
      let current = node;
      while (current.parentId !== null) {
        current = tree.nodes[current.parentId];
        if (current.tag === "Library") return current.attrs.Id ?? "";
      }
      return "";
    };
    const found = tree.nodes
      .filter((n) => n.tag === "Element" && n.attrs.Type === "Trigger" && scope(n) === library)
      .filter((n) => {
        const id = n.childIds.map((i) => tree.nodes[i]).find((c) => c.tag === "Identifier"),
          name = id ? decodeXmlValue(this.xml.slice(id.startTagEnd, id.endTagStart)) : n.attrs.Id;
        return (!v.id || v.id === n.attrs.Id) && (!v.name || v.name === name) && !!(v.id || v.name);
      });
    if (found.length !== 1) throw Error("GUI_TRIGGER_REFERENCE_UNRESOLVED_OR_AMBIGUOUS");
    return { id: found[0].attrs.Id, library };
  }

  private selectedPreset(
    v: Extract<GuiValue, { kind: "preset" | "presetBits" }>,
    want?: GuiType,
    p?: Parameter,
  ) {
    const ownerLibrary =
      v.library ??
      want?.typeElement?.library ??
      want?.typeLibrary ??
      p?.presetLibrary ??
      this.library;
    const ownerName = v.preset,
      ownerId = want?.typeElement?.id ?? want?.presetId ?? p?.selectorPresetId ?? p?.presetId;
    let owners = this.definitions.presets.filter(
      (d) =>
        (d.library ?? "") === ownerLibrary &&
        (ownerName
          ? d.id === ownerName || d.name === ownerName
          : ownerId
            ? d.id === ownerId
            : true),
    );
    const requested = v.kind === "presetBits" ? v.values : [v.id ?? v.name ?? ""];
    if (owners.length !== 1 && v.kind === "preset")
      owners = owners.filter((d) =>
        d.values.some((ref) =>
          this.definitions.presetValues.some(
            (pv) =>
              pv.id === ref.id &&
              pv.library === (ref.library ?? d.library) &&
              (pv.id === requested[0] || pv.name === requested[0]),
          ),
        ),
      );
    if (owners.length === 1) {
      const owner = owners[0],
        candidates = this.definitions.presetValues.filter((pv) =>
          owner.values.some(
            (ref) => ref.id === pv.id && (ref.library ?? owner.library) === pv.library,
          ),
        ),
        members = requested.map((name) => {
          const found = candidates.filter((pv) => pv.id === name || pv.name === name);
          if (found.length !== 1)
            throw new Error(
              "GUI_PRESET_MISMATCH: " +
                JSON.stringify(name) +
                " is not a unique member of " +
                (owner.library ? owner.library + "::" : "") +
                (owner.name ?? owner.id) +
                "; available=" +
                candidates
                  .slice(0, 12)
                  .map((pv) => pv.name ?? pv.id)
                  .join(", ") +
                (candidates.length > 12 ? ", ..." : ""),
            );
          return found[0];
        });
      if (v.kind === "presetBits" && !owner.asBits) throw new Error("GUI_PRESET_NOT_BITS");
      if (v.kind === "preset" && v.id && v.name && members[0].name !== v.name)
        throw new Error("GUI_PRESET_MISMATCH");
      return {
        type: {
          type: "preset",
          presetId: owner.id,
          typeLibrary: owner.library ?? "",
          typeElement: { type: "Preset" as const, id: owner.id, library: owner.library ?? "" },
        },
        members,
        baseType: owner.baseType,
      };
    }
    // Compatibility with the compact pre-AST NativeLib registry.
    if (v.kind === "preset" && p?.presets?.length) {
      const found = p.presets.filter((x) =>
        v.id ? x.id === v.id || x.name === v.id : x.name === v.name,
      );
      if (found.length !== 1 || (v.id && v.name && found[0].name !== v.name))
        throw new Error("GUI_PRESET_MISMATCH");
      return {
        type: { type: "preset", presetId: p.presetId, typeLibrary: p.presetLibrary ?? "Ntve" },
        members: found.map((m) => ({ ...m, library: p.presetLibrary ?? "Ntve" })),
        baseType: undefined,
      };
    }
    throw new Error("GUI_PRESET_MISMATCH");
  }
  private access(v: Extract<GuiValue, { kind: "variable" | "parameter" }>, context: RenderContext) {
    const root =
      v.kind === "variable"
        ? variable(v, this.xml, this.library, context, this.variables)
        : this.parameter(v, context);
    let type: GuiType = {
        type: root.type,
        gameType: root.gameType,
        typeElement: root.typeElement,
        presetId: root.presetId,
        typeLibrary: root.library ?? this.library,
      },
      constant = "constant" in root && root.constant;
    const sizes = "arraySizes" in root ? root.arraySizes : [];
    const consume = (indices: GuiValue[] | undefined, dimensions: any[]) => {
      if ((indices?.length ?? 0) > dimensions.length) throw new Error("GUI_ARRAY_INDEX_COUNT");
      for (const [i, index] of (indices ?? []).entries()) {
        if (this.infer(index, context).type !== "int") throw new Error("GUI_ARRAY_INDEX_TYPE");
        if (index.kind === "literal") {
          const n = Number(index.value),
            dimension = dimensions[i],
            boundId = dimension?.variableId ?? dimension?.variable?.id,
            boundLibrary = dimension?.library ?? dimension?.variable?.library ?? this.library,
            bound = Number(
              dimension?.value ??
                this.variables.find((v) => v.id === boundId && v.library === boundLibrary)
                  ?.initialScalar,
            );
          if (!Number.isInteger(n) || n < 0 || (Number.isFinite(bound) && n > bound))
            throw new Error("GUI_ARRAY_INDEX_BOUNDS");
        }
      }
      return dimensions.length - (indices?.length ?? 0);
    };
    type = { ...type, arrayRank: consume(v.indices, sizes as any[]) };
    const fields: Array<{ id: string; library: string; indices?: GuiValue[] }> = [];
    for (const member of v.members ?? []) {
      if (type.arrayRank) throw new Error("GUI_ARRAY_INDEX_COUNT");
      if (type.type !== "struct" || !type.typeElement) throw new Error("GUI_MEMBER_NOT_STRUCTURE");
      const structure = this.definitions.structures.find(
        (d) =>
          d.id === type.typeElement?.id &&
          d.library === (type.typeElement?.library ?? this.library),
      );
      const matches = this.definitions.variables.filter(
        (field) =>
          structure?.variables.some(
            (ref) => ref.id === field.id && (ref.library ?? structure.library) === field.library,
          ) &&
          (field.id === member.field || field.name === member.field),
      );
      if (matches.length !== 1) throw new Error("GUI_MEMBER_UNRESOLVED: " + member.field);
      const field = matches[0],
        ft = field.variableType!;
      type = {
        type: ft.type,
        gameType: ft.gameType,
        typeElement: ft.typeElement as GuiTypeRef,
        arrayRank: consume(member.indices, field.arraySizes ?? []),
      };
      constant = constant || field.isConstant;
      fields.push({
        id: field.id,
        library: field.library ?? this.library,
        indices: member.indices,
      });
    }
    return { root, type, constant, fields };
  }
  private accessBody(
    v: Extract<GuiValue, { kind: "variable" | "parameter" }>,
    context: RenderContext,
    depth: number,
  ) {
    const access = this.access(v, context),
      indices = (values: GuiValue[] | undefined) => {
        return (values ?? [])
          .map((value) => {
            const id = this.allocate();
            this.elements.push(
              `<Element Type="Param" Id="${id}">${this.value(value, { type: "int" }, id, context, depth + 1)}</Element>`,
            );
            return `<Array Type="Param"${localRef(this.library)} Id="${id}"/>`;
          })
          .join("");
      };
    const field = (i: number): string => {
      const f = access.fields[i];
      if (!f) return "";
      const id = this.allocate();
      const body =
        `<Variable Type="Variable"${localRef(f.library, this.library)} Id="${f.id}"/>` +
        indices(f.indices) +
        field(i + 1);
      this.elements.push(`<Element Type="Param" Id="${id}">${body}</Element>`);
      return `<StructMember Type="Param"${localRef(this.library)} Id="${id}"/>`;
    };
    return (
      `<${v.kind === "variable" ? "Variable" : "Parameter"} Type="${v.kind === "variable" ? "Variable" : "ParamDef"}"${localRef(access.root.library ?? this.library, this.library)} Id="${access.root.id}"/>` +
      indices(v.indices) +
      field(0)
    );
  }
  private normalize(f: FunctionDef, args: Record<string, GuiValue | GuiValue[]>) {
    const normalized = new Map<string, GuiValue | GuiValue[]>();
    for (const [key, value] of Object.entries(args)) {
      const params = f.parameters.filter((p) => p.id === key);
      const matches = params.length ? params : f.parameters.filter((p) => p.name === key);
      if (matches.length !== 1)
        throw new Error(
          matches.length ? "GUI_ARGUMENT_AMBIGUOUS: " + key : "GUI_ARGUMENT_UNKNOWN: " + key,
        );
      if (normalized.has(matches[0].id)) throw new Error("GUI_ARGUMENT_DUPLICATE_ALIAS: " + key);
      normalized.set(matches[0].id, value);
    }
    for (const p of f.parameters)
      if (!normalized.has(p.id)) {
        if (p.defaultValue) normalized.set(p.id, p.defaultValue);
        else if (!p.defaultXml && !p.flags.includes("ParamFlagMultiple"))
          throw new Error("GUI_ARGUMENT_MISSING: " + p.id);
        else if (p.flags.includes("ParamFlagMultiple")) normalized.set(p.id, []);
      }
    return normalized;
  }
  private parameters(
    f: FunctionDef,
    args: Record<string, GuiValue | GuiValue[]>,
    context: RenderContext,
    depth: number,
  ) {
    const values = this.normalize(f, args),
      types = new Map<string, GuiType>(),
      resolving = new Set<string>();
    const expected = (p: Parameter): GuiType => {
      if (p.type === "sameasparent") {
        if (!context.returnType) throw new Error("GUI_PARENT_TYPE_UNAVAILABLE");
        return context.returnType;
      }
      if (p.type === "return") {
        if (!context.returnType) throw new Error("GUI_RETURN_OUTSIDE_VALUE_FUNCTION");
        return context.returnType;
      }
      if (p.type !== "sameas")
        return {
          ...p,
          type: p.type,
          gameType: p.gameType,
          presetId: p.type === "preset" ? p.presetId : undefined,
          typeLibrary:
            p.presetLibrary ?? p.typeElement?.library ?? (p.type === "preset" ? "Ntve" : undefined),
        };
      if (types.has(p.presetId!)) return types.get(p.presetId!)!;
      if (resolving.has(p.id)) throw new Error("GUI_POLYMORPHIC_TYPE_CYCLE");
      resolving.add(p.id);
      const source = f.parameters.find((x) => x.id === p.presetId);
      if (!source) throw new Error("GUI_POLYMORPHIC_TYPE_SOURCE");
      const sourceType = expected(source),
        raw = values.get(source.id)!,
        value = Array.isArray(raw) ? raw[0] : raw;
      if (!value) throw new Error("GUI_POLYMORPHIC_TYPE_SOURCE");
      const actual =
        sourceType.type === "preset"
          ? sourceType
          : this.infer(value, context, sourceType.type === "anyvariable" ? undefined : sourceType);
      types.set(source.id, actual);
      resolving.delete(p.id);
      return actual;
    };
    const refs: string[] = [];
    for (const p of f.parameters) {
      const raw = values.get(p.id),
        want = expected(p);
      if (Array.isArray(raw) && !p.flags.includes("ParamFlagMultiple"))
        throw new Error("GUI_MULTIPLE_ARGUMENT_NOT_ALLOWED");
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!list.length && p.flags.includes("ParamFlagMultiple") && f.flags.includes("FlagOperator"))
        throw new Error("GUI_MULTIPLE_ARGUMENT_EMPTY");
      if (!list.length && p.defaultXml) {
        const id = this.allocate();
        this.elements.push(
          `<Element Type="Param" Id="${id}"><ParameterDef Type="ParamDef"${localRef(p.library ?? f.library, this.library)} Id="${p.id}"/>${p.defaultXml}</Element>`,
        );
        refs.push(`<Parameter Type="Param"${localRef(this.library)} Id="${id}"/>`);
        continue;
      }
      for (const v of list) {
        const id = this.allocate(),
          body = this.value(
            v,
            want,
            id,
            { ...context, globalOnly: context.globalOnly || f.flags.includes("FlagEvent") },
            depth + 1,
            p,
          );
        const actual =
          v.kind === "preset" || v.kind === "presetBits"
            ? this.selectedPreset(v, want, p).type
            : this.infer(v, context, want.type === "anyvariable" ? undefined : want);
        types.set(p.id, actual);
        if (p.type === "anyvariable" && p.variableType && actual.type !== p.variableType)
          throw new Error("GUI_VARIABLE_TYPE_CONSTRAINT");
        if (p.type === "anyvariable" && f.name === "ForEachInteger" && actual.type !== "int")
          throw new Error("GUI_LOOP_VARIABLE_MUST_BE_INT");
        this.elements.push(
          `<Element Type="Param" Id="${id}"><ParameterDef Type="ParamDef"${localRef(p.library ?? f.library, this.library)} Id="${p.id}"/>${body}</Element>`,
        );
        refs.push(`<Parameter Type="Param"${localRef(this.library)} Id="${id}"/>`);
      }
    }
    if (f.library === "Ntve" && f.origin !== "map" && f.name === "Comparison") {
      const operator = f.parameters.find((p) => p.name === "op")!,
        choice = values.get(operator.id)!;
      if (Array.isArray(choice)) throw new Error("GUI_COMPARISON_OPERATOR");
      if (choice.kind !== "preset") throw new Error("GUI_COMPARISON_OPERATOR");
      const op = this.preset(choice, operator).name,
        type = types.get(f.parameters.find((p) => p.name === "val1")!.id)!.type;
      if (!["eq", "ne"].includes(op) && !["int", "fixed"].includes(type))
        throw new Error("GUI_ORDERED_COMPARISON_REQUIRES_NUMBER");
    }
    return refs.join("");
  }
  private preset(v: Extract<GuiValue, { kind: "preset" }>, p: Parameter) {
    const found = (p.presets ?? []).filter((x) =>
      v.id ? x.id === v.id || x.name === v.id : x.name === v.name,
    );
    if (found.length !== 1 || (v.id && v.name && found[0].name !== v.name))
      throw new Error("GUI_PRESET_MISMATCH");
    return found[0];
  }
  value(
    v: GuiValue,
    want: GuiType,
    paramId: string,
    context: RenderContext,
    depth: number,
    p?: Parameter,
  ): string {
    if (depth > 16) throw new Error("GUI_EXPRESSION_DEPTH_LIMIT");
    if (
      (p?.flags?.includes("ParamFlagVariableOnly") &&
        !["variable", "parameter"].includes(v.kind)) ||
      (want.type === "anyvariable" && !["variable", "parameter"].includes(v.kind))
    )
      throw new Error("GUI_VARIABLE_ARGUMENT_REQUIRED");
    if (v.kind === "preset" || v.kind === "presetBits") {
      const selected = this.selectedPreset(v, want, p);
      // Scalar variable/field initializers have no ParamDef selector. Their preset
      // owner must instead declare the exact GUI base type of the owned variable.
      const initializerPreset =
        depth === 0 &&
        !p &&
        !!context.initializing &&
        selected.baseType === want.type &&
        this.variables.some(
          (variable) =>
            variable.id === context.initializing &&
            variable.library === this.library &&
            sameGuiType(variable, want),
        );
      if (
        (want.type === "preset" && !sameGuiType(want, selected.type)) ||
        (!["preset", "anypreset", "anycompare", "anytype"].includes(want.type) &&
          !p?.selectorPresetId &&
          !initializerPreset)
      )
        throw new Error("GUI_PRESET_MISMATCH");
      return selected.members
        .map(
          (member) =>
            `<${v.kind === "presetBits" ? "ValuePreset" : "Preset"} Type="PresetValue"${localRef(member.library ?? "Ntve", this.library)} Id="${member.id}"/>`,
        )
        .join("");
    }
    const actual = this.infer(v, context, want.type === "anyvariable" ? undefined : want);
    if (!compatible(want, actual))
      throw new Error(
        "GUI_TYPE_MISMATCH: " +
          (p?.id ?? paramId) +
          " expected " +
          want.type +
          ", received " +
          actual.type,
      );
    if (v.kind === "literal") {
      const value = String(v.value);
      if (value.includes("\0") || value.length > 16384) throw new Error("GUI_LITERAL_INVALID");
      if (
        (v.type === "byte" && (!/^\d+$/.test(value) || Number(value) > 255)) ||
        (v.type === "int" &&
          (!/^-?\d+$/.test(value) ||
            !Number.isSafeInteger(Number(value)) ||
            Number(value) < -2147483648 ||
            Number(value) > 2147483647)) ||
        (v.type === "fixed" &&
          (!/^-?\d+(\.\d+)?$/.test(value) ||
            !Number.isFinite(Number(value)) ||
            Number(value) < -524288 ||
            Number(value) >= 524288)) ||
        (v.type === "bool" && typeof v.value !== "boolean") ||
        (v.type === "string" && typeof v.value !== "string")
      )
        throw new Error("GUI_LITERAL_INVALID");
      if (p?.limits && ["int", "byte", "fixed"].includes(v.type)) {
        const [min, max] = p.limits.split(",");
        if (
          (min !== "" && Number.isFinite(Number(min)) && Number(value) < Number(min)) ||
          (max !== "" && Number.isFinite(Number(max)) && Number(value) > Number(max))
        )
          throw new Error("GUI_LIMIT_VIOLATION");
      }
      if (
        [
          "filepath",
          "modelanim",
          "modelcamera",
          "actormsg",
          "attributegame",
          "attributeplayer",
          "attributevalue",
          "userfield",
          "userinstance",
          "fontstyle",
          "reference",
          "catalogscope",
          "catalogfieldname",
          "catalogfieldpath",
          "catalogentry",
          "layoutframe",
          "layoutframerel",
          "charge",
          "cooldown",
          "conversationtag",
          "gameoption",
          "gameoptionvalue",
          "soundlink",
        ].includes(v.type) &&
        typeof v.value !== "string"
      )
        throw new Error("GUI_LITERAL_INVALID");
      if (
        !["int", "byte", "fixed", "bool", "string"].includes(v.type) &&
        v.value !== null &&
        ![
          "filepath",
          "modelanim",
          "modelcamera",
          "actormsg",
          "attributegame",
          "attributeplayer",
          "attributevalue",
          "userfield",
          "userinstance",
          "fontstyle",
          "reference",
          "catalogscope",
          "catalogfieldname",
          "catalogfieldpath",
          "catalogentry",
          "layoutframe",
          "layoutframerel",
          "charge",
          "cooldown",
          "conversationtag",
          "gameoption",
          "gameoptionvalue",
          "soundlink",
        ].includes(v.type)
      )
        throw new Error("GUI_COMPLEX_LITERAL_USE_CALL_OR_REFERENCE");
      return `<ValueType Type="${v.type}"/><Value>${encode(v.value === null ? "null" : value)}</Value>`;
    }
    if (v.kind === "variable" || v.kind === "parameter") {
      const access = this.access(v, context);
      if (want.type === "anyvariable" && access.constant)
        throw new Error("GUI_VARIABLE_CONSTANT_WRITE");
      return this.accessBody(v, context, depth);
    }
    if (v.kind === "gamelink")
      return `<ValueType Type="gamelink" GameType="${encode(v.domain)}"/><Value>${encode(v.id)}</Value>`;
    if (v.kind === "unit") return `<ValueType Type="unit"/><ValueId Id="${v.objectId}"/>`;
    if (v.kind === "trigger") {
      const target = this.trigger(v);
      return `<ValueType Type="trigger"/><ValueElement Type="Trigger"${localRef(target.library, this.library)} Id="${encode(target.id)}"/>`;
    }
    if (v.kind === "text") {
      if (!context.onText) throw new Error("GUI_TEXT_CONTEXT_REQUIRED");
      context.onText({
        key: "Param/Value/" + (this.library ? "lib_" + this.library + "_" : "") + paramId,
        value: v.value,
        translations: v.translations,
      });
      return '<ValueType Type="text"/>';
    }
    if (v.kind === "call" || v.kind === "nativeCall") {
      const f = resolveFunction(v.function, this.r, "Expression", want);
      if (v.kind === "nativeCall" && (!f.flags.includes("FlagNative") || f.parameters.length))
        throw new Error("GUI_NATIVE_EXPRESSION_UNSUPPORTED: " + v.function);
      const args = v.kind === "call" ? v.args : {};
      const id = this.function(
        f,
        args,
        v.kind === "call" ? v.children : undefined,
        context,
        depth + 1,
      );
      return `<FunctionCall Type="FunctionCall"${localRef(this.library)} Id="${id}"/>`;
    }
    throw new Error("GUI_EXPRESSION_UNSUPPORTED: " + v.kind);
  }
  private function(
    f: FunctionDef,
    args: Record<string, GuiValue | GuiValue[]>,
    children: GuiChild[] | undefined,
    context: RenderContext,
    depth: number,
  ) {
    if (depth > 16) throw new Error("GUI_BLOCK_DEPTH_LIMIT");
    if (f.library === "Ntve" && f.name === "Return" && !context.returnType)
      throw new Error("GUI_RETURN_OUTSIDE_VALUE_FUNCTION");
    if (
      f.library === "Ntve" &&
      f.origin !== "map" &&
      ["Continue", "Break", "BreakLoop"].includes(f.name) &&
      !context.inLoop
    )
      throw new Error("GUI_LOOP_CONTROL_OUTSIDE_LOOP");
    if (children?.length && !f.flags.includes("FlagSubFunctions"))
      throw new Error("GUI_CHILDREN_UNSUPPORTED");
    if (
      f.subFunctions?.some((s) => s.kind === "Condition") &&
      !children?.some((c) =>
        f.subFunctions?.some(
          (s) => s.kind === "Condition" && (s.id === c.role || s.name === c.role),
        ),
      )
    )
      throw new Error("GUI_CONDITION_REQUIRED");
    if (f.library === "Ntve" && f.origin !== "map" && f.name === "Not" && children?.length !== 1)
      throw new Error("GUI_NOT_REQUIRES_ONE_CONDITION");
    const id = this.allocate(),
      refs = this.parameters(f, args, context, depth),
      childRefs: string[] = [];
    for (const child of children ?? []) {
      const role = f.subFunctions?.find((s) => s.id === child.role || s.name === child.role);
      if (!role || role.kind !== (child.call.kind === "Registration" ? "Action" : child.call.kind))
        throw new Error("GUI_SUBFUNCTION_ROLE_MISMATCH: " + child.role);
      const childId = this.call(
        child.call,
        { ...context, inLoop: context.inLoop || f.flags.includes("FlagAllowBreak") },
        depth + 1,
      );
      const i = this.elements.findIndex((e) =>
        e.startsWith(`<Element Type="FunctionCall" Id="${childId}">`),
      );
      this.elements[i] = this.elements[i].replace(
        /(<FunctionDef\b[^>]*\/>)/,
        `$1<SubFunctionType Type="SubFuncType"${localRef(f.library, this.library)} Id="${role.id}"/>`,
      );
      childRefs.push(
        `<FunctionCall Type="FunctionCall"${localRef(this.library)} Id="${childId}"/>`,
      );
    }
    this.elements.push(
      `<Element Type="FunctionCall" Id="${id}"><FunctionDef Type="FunctionDef"${localRef(f.library, this.library)} Id="${f.id}"/>${refs}${childRefs.join("")}</Element>`,
    );
    return id;
  }
  call(call: GuiCall, context = this.context, depth = 0) {
    if (call.kind !== "Registration") {
      const f = resolveFunction(call.function, this.r, call.kind);
      return this.function(f, call.args, call.children, context, depth);
    }
    const native = resolveFunction(call.function, this.r, "Event");
    checkRegistrationSignature(native);
    const id = this.allocate(),
      targetId = this.allocate(),
      parameterIds = new Map(native.parameters.map((p) => [p.id, this.allocate()]));
    const parameters: Parameter[] = [
      { id: targetId, name: "targetTrigger", type: "trigger", library: this.library, flags: [] },
      ...native.parameters.map((p) => ({
        ...p,
        id: parameterIds.get(p.id)!,
        library: this.library,
      })),
    ];
    const helper: FunctionDef = {
      id,
      name: native.name,
      library: this.library,
      origin: "map",
      flags: ["FlagNative", "FlagAction", "FlagHidden", "FlagNoScriptPrefix"],
      parameters,
    };
    for (const p of parameters) {
      const selector = p.selectorPresetId
        ? `<Preset Type="Preset"${localRef(p.presetLibrary ?? "Ntve")} Id="${encode(p.selectorPresetId)}"/>`
        : "";
      this.elements.push(
        `<Element Type="ParamDef" Id="${p.id}"><Identifier>${encode(p.name)}</Identifier><ParameterType>${typeElementFragment(p, this.xml, this.library, this.r)}</ParameterType>${p.flags.map((flag) => `<${flag}/>`).join("")}${selector}${p.limits ? `<Limits Value="${encode(p.limits)}"/>` : ""}</Element>`,
      );
      context.onText?.({
        key: "ParamDef/Name/" + (this.library ? "lib_" + this.library + "_" : "") + p.id,
        value: p.name,
      });
    }
    this.elements.push(
      `<Element Type="FunctionDef" Id="${id}"><Identifier>${encode(native.name)}</Identifier><FlagNative/><FlagAction/><FlagHidden/><FlagNoScriptPrefix/><ReturnType><Type Value="void"/></ReturnType>${parameters.map((p) => `<Parameter Type="ParamDef"${localRef(this.library)} Id="${p.id}"/>`).join("")}<Section>SC2MCPRuntimeRegistration</Section></Element>`,
    );
    context.onText?.({
      key: "FunctionDef/Name/" + (this.library ? "lib_" + this.library + "_" : "") + id,
      value: "Register event: " + native.name,
    });
    const args: Record<string, GuiValue | GuiValue[]> = { [targetId]: call.trigger };
    for (const [key, value] of this.normalize(native, call.args))
      args[parameterIds.get(key)!] = value;
    return this.function(helper, args, undefined, context, depth);
  }
}
export function renderCall(
  call: GuiCall,
  library: string,
  nextId: () => string,
  xml: string,
  r = registry(),
  depth = 0,
  context: RenderContext = {},
) {
  const renderer = new Renderer(library, nextId, xml, r, context),
    id = renderer.call(call, context, depth);
  return {
    id,
    elements: renderer.elements.join("\n"),
    kind: call.kind === "Registration" ? ("Action" as const) : call.kind,
  };
}
export function renderInitializer(
  value: GuiValue,
  type: GuiType,
  paramId: string,
  library: string,
  nextId: () => string,
  xml: string,
  r: Registry,
  context: RenderContext,
) {
  const renderer = new Renderer(library, nextId, xml, r, context),
    body = renderer.initializer(value, type, paramId, context);
  return { body, elements: renderer.elements.join("\n") };
}

/** Render a batch against one immutable symbol table; no XML re-scan per argument. */
export function renderCalls(
  calls: GuiCall[],
  library: string,
  nextId: () => string,
  xml: string,
  r: Registry,
  context: RenderContext = {},
) {
  const renderer = new Renderer(library, nextId, xml, r, context);
  const references = calls.map((call) => ({
    id: renderer.call(call),
    kind: call.kind === "Registration" ? ("Action" as const) : call.kind,
  }));
  return { references, elements: renderer.elements.join("\n") };
}
/** Only ordinary map-local GUI definitions with known types are callable. */
export function inspectGuiFunctions(xml: string, library = ""): FunctionDef[] {
  const p = scanXml(xml),
    container = p.nodes.find((n) =>
      library ? n.tag === "Library" && n.attrs.Id === library : n.tag === "TriggerData",
    );
  if (!container) return [];
  const elements = container.childIds.map((i) => p.nodes[i]).filter((n) => n.tag === "Element");
  const children = (n: (typeof p.nodes)[number]) => n.childIds.map((i) => p.nodes[i]);
  const identifier = (n: (typeof p.nodes)[number]) => {
    const id = children(n).find((c) => c.tag === "Identifier");
    return id ? decodeXmlValue(xml.slice(id.startTagEnd, id.endTagStart)) : n.attrs.Id;
  };
  const type = (n: (typeof p.nodes)[number] | undefined) => {
    const cs = n ? children(n) : [],
      te = cs.find((c) => c.tag === "TypeElement");
    return {
      type: cs.find((c) => c.tag === "Type")?.attrs.Value,
      gameType: cs.find((c) => c.tag === "GameType")?.attrs.Value,
      typeElement: te
        ? {
            id: te.attrs.Id,
            library: te.attrs.Library ?? library,
            type: te.attrs.Type as "Preset" | "Structure",
          }
        : undefined,
    };
  };
  return elements
    .filter(
      (n) =>
        n.attrs.Type === "FunctionDef" &&
        !children(n).some(
          (c) =>
            c.tag === "Section" &&
            ["SC2MCPEventRegistration", "SC2MCPRuntimeRegistration"].includes(
              xml.slice(c.startTagEnd, c.endTagStart),
            ),
        ),
    )
    .map((n) => {
      const cs = children(n),
        ret = type(cs.find((c) => c.tag === "ReturnType"));
      const parameters = cs
        .filter((c) => c.tag === "Parameter" && c.attrs.Type === "ParamDef")
        .map((ref) => {
          const definition = elements.find(
            (e) =>
              e.attrs.Type === "ParamDef" &&
              e.attrs.Id === ref.attrs.Id &&
              (ref.attrs.Library ?? library) === library,
          );
          if (!definition)
            return { id: ref.attrs.Id, name: ref.attrs.Id, type: "unresolved", flags: [] };
          const ds = children(definition),
            t = type(ds.find((c) => c.tag === "ParameterType"));
          return {
            id: definition.attrs.Id,
            name: identifier(definition),
            type: t.type ?? "unresolved",
            gameType: t.gameType,
            typeElement: t.typeElement,
            library,
            limits: ds.find((c) => c.tag === "Limits")?.attrs.Value,
            defaultXml: (() => {
              const ref = ds.find((c) => c.tag === "Default");
              const p = ref
                ? elements.find((e) => e.attrs.Type === "Param" && e.attrs.Id === ref.attrs.Id)
                : undefined;
              if (!p) return undefined;
              let body = xml.slice(p.startTagEnd, p.endTagStart);
              const references = scanXml(body).nodes.filter(
                (n) => n.attrs.Type && n.attrs.Id && n.attrs.Library === undefined,
              );
              for (const node of references.sort((a, b) => b.start - a.start)) {
                const pos = node.startTagEnd - (node.selfClosing ? 2 : 1);
                body = body.slice(0, pos) + ` Library="${encode(library)}"` + body.slice(pos);
              }
              return body;
            })(),
            flags: ds.filter((c) => c.tag.startsWith("ParamFlag")).map((c) => c.tag),
          };
        });
      return {
        id: n.attrs.Id,
        name: identifier(n),
        library,
        origin: "map" as const,
        flags: cs.filter((c) => c.tag.startsWith("Flag")).map((c) => c.tag),
        returnType: ret.type === "void" ? undefined : ret.type,
        returnGameType: ret.gameType,
        returnGuiType: ret.type
          ? { type: ret.type, gameType: ret.gameType, typeElement: ret.typeElement }
          : undefined,
        parameters,
        xml: xml.slice(n.start, n.end),
      };
    });
}
export function withGuiFunctions(r: Registry, xml: string, library = ""): Registry {
  const scopes = [
      ...new Set([
        "",
        ...scanXml(xml)
          .nodes.filter((n) => n.tag === "Library")
          .map((n) => n.attrs.Id),
      ]),
    ],
    owned = new Set(scopes);
  return {
    ...r,
    mapScope: library,
    definitions: [
      ...definitions(r).filter((f) => f.origin !== "map"),
      ...scopes.flatMap((scope) => inspectGuiFunctions(xml, scope)),
    ],
    externalVariables: [
      ...(r.externalVariables ?? []).filter((v) => !owned.has(v.library ?? "")),
      ...scopes.flatMap((scope) =>
        inspectGuiVariables(xml, scope).filter((v) => v.scope === "global"),
      ),
    ],
  };
}
