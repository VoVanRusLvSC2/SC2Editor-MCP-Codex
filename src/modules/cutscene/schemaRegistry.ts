import { promises as fs } from "node:fs";
import {projectPath} from "../../app/paths.js";
import { createHash } from "node:crypto";
import type { CutsceneSchemaData, CutsceneSchemaNode, CutsceneSchemaProperty, CutsceneValueKind } from "./types.js";

const verifiedSource = "Blizzard Core.SC2Mod MainMenuDefault.SC2Cutscene (SC2GameData mirror)";

function property(objectType: string, xmlName: string, valueType: CutsceneValueKind, description: string, required = false): CutsceneSchemaProperty {
  return {
    objectType,
    property: xmlName,
    xmlName,
    valueType,
    description,
    required,
    keyframeable: false,
    observedInCorpus: 1,
    discoveredFrom: [verifiedSource],
    confidence: "confirmed",
    coverage: "SUPPORTED",
  };
}

const baselineNodes: CutsceneSchemaNode[] = [
  ["CutsceneState", "scene"],
  ["CCutsceneNodeDirector", "director"],
  ["CCutsceneNodeActiveCamera", "director-camera-track"],
  ["CCutsceneElementActiveCamera", "director-shot"],
  ["CCutsceneNodeActiveLight", "director-light-track"],
  ["CCutsceneElementActiveLight", "director-light-event"],
  ["CCutsceneNodeBookmark", "bookmark-track"],
  ["CCutsceneElementBookmark", "bookmark"],
  ["CCutsceneNodeActor", "actor"],
  ["CCutsceneNodeAnimLayer", "animation-layer"],
].map(([nativeType, category]) => ({
  nativeType,
  category,
  parentTypes: [],
  childTypes: [],
  observedInCorpus: 1,
  discoveredFrom: [verifiedSource],
  confidence: "confirmed",
  coverage: "SUPPORTED",
}));

const baselineProperties: CutsceneSchemaProperty[] = [
  property("CutsceneState", "cutsceneVersion", "Decimal", "Native SC2 Cutscene Editor document format version.", true),
  property("*", "guid", "String", "Unsigned native object identity. Kept as text to avoid JavaScript precision loss."),
  property("*", "name", "String", "Editor display name."),
  property("*", "sortIndex", "Int", "Native sibling ordering key."),
  property("CCutsceneNodeDirector", "interactive", "Bool", "Director interactive flag."),
  property("CCutsceneElementActiveCamera", "cameraIndex", "Int", "Camera index selected by this Director element."),
  property("CCutsceneElementActiveCamera", "objectGuid", "ObjectRef", "GUID of the selected camera/actor object."),
  property("CCutsceneElementActiveLight", "lightGUID", "ObjectRef", "GUID of the selected lighting object."),
  property("CCutsceneElementActiveLight", "lightID", "AssetRef", "Lighting catalog/native ID."),
  property("CCutsceneElementActiveLight", "lightIndex", "Int", "Lighting variation/index."),
  property("CCutsceneElementActiveLight", "blendTime", "Time", "Native blend duration."),
  property("CCutsceneElementBookmark", "start", "Time", "Native bookmark time. Omitted for time zero."),
  property("CCutsceneElementBookmark", "bookmarkName", "String", "Bookmark runtime name.", true),
  property("CCutsceneElementBookmark", "jumpToBookmarkWhenHit", "String", "Bookmark loop/jump target."),
  property("CCutsceneNodeActor", "modelLink", "AssetRef", "Model catalog link used by the Cutscene actor."),
  property("CCutsceneNodeActor", "shadowBox", "Bool", "Actor shadow-box flag."),
  property("CCutsceneNodeActor", "teamColorDiffuse", "Color", "Native RGBA team-color value."),
];

function emptyData(): CutsceneSchemaData {
  return {
    schemaVersion: "0.1.0-discovery",
    generatedAt: new Date(0).toISOString(),
    sources: [
      { kind: "verified-blizzard-file", location: "Mods/Core.SC2Mod/base.SC2Data/Cutscenes/MainMenuDefault.SC2Cutscene", available: false, note: "Format manually verified; local blob is not present in this environment." },
      { kind: "local-editor", location: "C:\\Program Files (x86)\\StarCraft II\\Support64\\SC2Editor_x64.exe", available: false, note: "Windows path is not mounted in this Linux workspace." },
      { kind: "local-decompilation", location: "E:\\SK2\\Decompilator Blizzards\\SC_editior_ksp.rep", available: false, note: "Windows path is not mounted in this Linux workspace." },
    ],
    nodes: baselineNodes,
    properties: baselineProperties,
    enums: [],
    runtime: { functions: [], constants: [] },
    corpus: { discoveredPaths: 0, parsedFiles: 0, failedFiles: 0, files: [] },
  };
}

function mergeSchema(base: CutsceneSchemaData, extra: CutsceneSchemaData): CutsceneSchemaData {
  const nodes = new Map(base.nodes.map((entry) => [entry.nativeType, entry]));
  for (const entry of extra.nodes) {
    const prior = nodes.get(entry.nativeType);
    nodes.set(entry.nativeType, prior ? {
      ...prior,
      ...entry,
      parentTypes: [...new Set([...prior.parentTypes, ...entry.parentTypes])],
      childTypes: [...new Set([...prior.childTypes, ...entry.childTypes])],
      discoveredFrom: [...new Set([...prior.discoveredFrom, ...entry.discoveredFrom])],
      observedInCorpus: Math.max(prior.observedInCorpus, entry.observedInCorpus),
    } : entry);
  }
  const properties = new Map(base.properties.map((entry) => [`${entry.objectType}\u0000${entry.xmlName}`, entry]));
  for (const entry of extra.properties) {
    const key = `${entry.objectType}\u0000${entry.xmlName}`;
    const prior = properties.get(key);
    properties.set(key, prior ? {
      ...prior,
      ...entry,
      discoveredFrom: [...new Set([...prior.discoveredFrom, ...entry.discoveredFrom])],
      observedInCorpus: Math.max(prior.observedInCorpus, entry.observedInCorpus),
    } : entry);
  }
  return {
    ...base,
    ...extra,
    sources: [...base.sources, ...extra.sources.filter((candidate) => !base.sources.some((existing) => existing.location === candidate.location))],
    nodes: [...nodes.values()].sort((a, b) => a.nativeType.localeCompare(b.nativeType)),
    properties: [...properties.values()].sort((a, b) => `${a.objectType}.${a.xmlName}`.localeCompare(`${b.objectType}.${b.xmlName}`)),
  };
}

export class CutsceneSchemaRegistry {
  readonly data: CutsceneSchemaData;
  private readonly nodes: Map<string, CutsceneSchemaNode>;
  private readonly properties: Map<string, CutsceneSchemaProperty[]>;

  private constructor(data: CutsceneSchemaData) {
    this.data = data;
    this.nodes = new Map(data.nodes.map((entry) => [entry.nativeType, entry]));
    this.properties = new Map();
    for (const entry of data.properties) {
      const list = this.properties.get(entry.objectType) ?? [];
      list.push(entry);
      this.properties.set(entry.objectType, list);
    }
  }

  static async load(file = projectPath("generated/cutscene-schema.json")): Promise<CutsceneSchemaRegistry> {
    let data = emptyData();
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as CutsceneSchemaData;
      data = mergeSchema(data, parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const cameraRuntimeProperties = data.runtime.constants
      .filter((entry) => /^c_cameraValue[A-Z]/.test(entry.name))
      .map<CutsceneSchemaProperty>((entry) => ({
        objectType: "Camera",
        property: entry.name.slice("c_cameraValue".length),
        xmlName: entry.name,
        valueType: /DepthOfField/.test(entry.name) ? "Bool" : /Pitch|Yaw|Roll/.test(entry.name) ? "Angle" : "Fixed",
        keyframeable: false,
        required: false,
        description: `Galaxy runtime camera value ${entry.name}; a Cutscene XML mapping has not yet been proven.`,
        observedInCorpus: 0,
        discoveredFrom: [entry.source],
        confidence: "confirmed",
        coverage: "RUNTIME_ONLY",
      }));
    const existingProperties = new Set(data.properties.map((entry) => `${entry.objectType}\u0000${entry.property}`));
    data.properties.push(...cameraRuntimeProperties.filter((entry) => !existingProperties.has(`${entry.objectType}\u0000${entry.property}`)));
    const positionValues = data.runtime.constants.filter((entry) => /^c_cameraPosition[A-Z]/.test(entry.name)).map((entry) => entry.name.slice("c_cameraPosition".length));
    if (positionValues.length && !data.enums.some((entry) => entry.name === "CameraPositionMode")) {
      data.enums.push({ name: "CameraPositionMode", values: positionValues, discoveredFrom: data.runtime.constants.filter((entry) => /^c_cameraPosition[A-Z]/.test(entry.name)).map((entry) => entry.source) });
    }
    data.schemaHash = createHash("sha256").update(JSON.stringify({ nodes: data.nodes, properties: data.properties, enums: data.enums })).digest("hex");
    return new CutsceneSchemaRegistry(data);
  }

  getNode(nativeType: string): CutsceneSchemaNode | undefined {
    return this.nodes.get(nativeType);
  }

  describe(nativeType: string): { node?: CutsceneSchemaNode; properties: CutsceneSchemaProperty[] } {
    const category = this.category(nativeType);
    const inheritedCategories = [
      "@Category:Commandable",
      "@Category:Node",
      ...(category === "camera" ? ["@Category:Object", "@Category:Camera"] : []),
      ...(category === "actor" ? ["@Category:Object", "@Category:TeamColor"] : []),
      ...(category === "model" || category === "lighting" ? ["@Category:Object"] : []),
      ...(category === "timeline-element" ? ["@Category:Element"] : []),
      ...(category === "bookmark" ? ["@Category:Bookmark"] : []),
      ...(category === "director-shot" ? ["@Category:ActiveCamera", "@Category:ActiveShot", "@Category:Element"] : []),
      ...(category === "attachment" ? ["@Category:Attachment"] : []),
      ...(/ActiveLight/.test(nativeType) ? ["@Category:ActiveLight"] : []),
      ...(/ActiveShot/.test(nativeType) ? ["@Category:ActiveShot"] : []),
      ...(/LookAt/.test(nativeType) ? ["@Category:LookAt"] : []),
      ...(/PathElement/.test(nativeType) ? ["@Category:PathElement"] : []),
      ...(/Property(?:Curve|Value)/.test(nativeType) ? ["@Category:PropertyValue"] : []),
    ];
    const entries = [
      ...(this.properties.get("*") ?? []),
      ...inheritedCategories.flatMap((entry) => this.properties.get(entry) ?? []),
      ...(this.properties.get(nativeType) ?? []),
    ];
    const unique = new Map<string, CutsceneSchemaProperty>();
    for (const entry of entries) {
      const prior = unique.get(entry.xmlName);
      unique.set(entry.xmlName, prior ? {
        ...prior,
        ...entry,
        enumValues: entry.enumValues?.length ? entry.enumValues : prior.enumValues,
        description: entry.description ?? prior.description,
        discoveredFrom: [...new Set([...prior.discoveredFrom, ...entry.discoveredFrom])],
      } : entry);
    }
    return { node: this.getNode(nativeType), properties: [...unique.values()] };
  }

  getProperty(nativeType: string, xmlName: string): CutsceneSchemaProperty | undefined {
    return this.describe(nativeType).properties.find((entry) => entry.xmlName === xmlName);
  }

  isObservedTrackProperty(name: string): boolean {
    return this.data.properties.some((entry) => entry.objectType === "CCutsceneNodePropertyValue"
      && entry.xmlName === "propertyName"
      && entry.enumValues?.includes(name));
  }

  category(nativeType: string): string {
    return this.getNode(nativeType)?.category ?? classifyNativeType(nativeType);
  }

  inspect(query: { objectType?: string; search?: string; coverage?: string; limit?: number; includeCorpusFiles?: boolean }): unknown {
    if (query.objectType) return this.describe(query.objectType);
    const term = query.search?.toLowerCase();
    const limit = query.limit ?? 200;
    const allNodes = this.data.nodes.filter((entry) => (!term || `${entry.nativeType} ${entry.category}`.toLowerCase().includes(term)) && (!query.coverage || entry.coverage === query.coverage));
    const allProperties = this.data.properties.filter((entry) => (!term || `${entry.objectType} ${entry.property} ${entry.description ?? ""}`.toLowerCase().includes(term)) && (!query.coverage || entry.coverage === query.coverage));
    return {
      schemaVersion: this.data.schemaVersion,
      schemaHash: this.data.schemaHash,
      nodes: allNodes.slice(0, limit),
      properties: allProperties.slice(0, limit),
      truncated: allNodes.length > limit || allProperties.length > limit,
      totals: { nodes: allNodes.length, properties: allProperties.length },
      enums: this.data.enums,
      corpus: {
        discoveredPaths: this.data.corpus.discoveredPaths,
        parsedFiles: this.data.corpus.parsedFiles,
        failedFiles: this.data.corpus.failedFiles,
        statusCounts: Object.fromEntries(["PASS", "FAIL", "SKIPPED_NOT_AVAILABLE_LOCALLY"].map((status) => [status, this.data.corpus.files.filter((entry) => entry.status === status).length])),
        files: query.includeCorpusFiles ? this.data.corpus.files.slice(0, limit) : undefined,
      },
      sources: this.data.sources,
    };
  }

  coverage(): Record<string, unknown> {
    const status = (entries: Array<{ coverage: string }>) => Object.fromEntries([...new Set(entries.map((entry) => entry.coverage))].map((value) => [value, entries.filter((entry) => entry.coverage === value).length]));
    const cameraTypes = this.data.nodes.filter((entry) => entry.category === "camera").map((entry) => entry.nativeType);
    const effectiveCameraProperties = new Set(cameraTypes.flatMap((nativeType) => this.describe(nativeType).properties.map((entry) => entry.xmlName)));
    const editorProperties = this.data.properties.filter((entry) => entry.discoveredFrom.some((source) => source.startsWith("SC2Editor ")));
    return {
      editorBuild: this.data.editorBuild,
      objectTypesDiscovered: this.data.nodes.length,
      propertiesDiscovered: this.data.properties.length,
      editorEvidence: {
        objectTypes: this.data.editorEvidence?.identifiers.length ?? 0,
        propertiesMerged: editorProperties.length,
        propertiesEditorOnly: editorProperties.filter((entry) => entry.coverage === "EDITOR_ONLY").length,
      },
      cameraProperties: {
        effectiveUnique: effectiveCameraProperties.size,
        nativeTypes: cameraTypes,
      },
      enumsDiscovered: this.data.enums.length,
      parsedCorpusFiles: this.data.corpus.parsedFiles,
      objectTypeStatus: status(this.data.nodes),
      propertyStatus: status(this.data.properties),
      runtimeFunctions: this.data.runtime.functions.length,
      runtimeConstants: this.data.runtime.constants.length,
    };
  }
}

export function classifyNativeType(nativeType: string): string {
  const name = nativeType.toLowerCase();
  if (name === "cutscenestate") return "scene";
  if (name.includes("director")) return "director";
  if (name.includes("activecamera")) return name.includes("element") ? "director-shot" : "director-camera-track";
  if (name.includes("camera")) return "camera";
  if (name.includes("activelight")) return name.includes("element") ? "director-light-event" : "director-light-track";
  if (name.includes("bookmark")) return "bookmark";
  if (name.includes("filter")) return "filter";
  if (/anim(?:ation)?/.test(name)) return name.includes("layer") ? "animation-layer" : "animation";
  if (name.includes("actor")) return "actor";
  if (name.includes("model")) return "model";
  if (name.includes("sound")) return "sound";
  if (name.includes("conversation")) return "conversation";
  if (name.includes("light")) return "lighting";
  if (name.includes("fog")) return "fog";
  if (name.includes("rtt")) return "render-to-texture";
  if (name.includes("path")) return name.includes("marker") ? "path-marker" : "path";
  if (name.includes("text")) return "text";
  if (name.includes("attach")) return "attachment";
  if (name.includes("key") || name.includes("curve")) return "keyframe";
  if (name.includes("element") || name.includes("block")) return "timeline-element";
  if (name.includes("node") || name.includes("track")) return "timeline-node";
  return "unknown-native-type";
}
