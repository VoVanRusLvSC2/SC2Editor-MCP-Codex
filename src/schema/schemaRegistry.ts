import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanXml } from "../core/xmlScanner.js";
import type { ElementSpec, ParsedXml, ScalarValue, XmlNode } from "../core/types.js";

export interface SimpleTypeSchema {
  name: string;
  kind?: string;
  data?: string;
  internalType?: string;
  enumValues: string[];
  unions: string[];
  patterns: string[];
  nullable: boolean;
  /** True when another schema entry names the type but the upstream snapshot does not define it. */
  opaque?: boolean;
}

export interface AttributeSchema {
  name: string;
  type: string;
  required: boolean;
  default?: string;
}

export interface ElementSchema {
  name: string;
  type?: string;
  ref?: string;
  table?: boolean;
  alternatives: Array<{ test: string; type: string }>;
}

export interface ComplexTypeSchema {
  name: string;
  extends: string[];
  attributes: AttributeSchema[];
  elements: ElementSchema[];
  indeterminateAttributes: Array<{ key: string; value: string }>;
}

export interface FramePropertySchema {
  name: string;
  valueType?: string;
  elementType?: string;
  table: boolean;
  tableKey?: string;
  readonly: boolean;
  declaredBy?: string;
  observed?: number;
}

export interface PropertyDescription extends FramePropertySchema {
  scalarType?: SimpleTypeSchema;
  enumValues: string[];
  complexType?: ComplexTypeSchema;
  schemaDriven: boolean;
}

export interface FrameClassSchema {
  name: string;
  parent?: string;
  properties: FramePropertySchema[];
  /** Synthetic class for a frame observed in Core but absent from the community schema. */
  observedOnly?: boolean;
}

export interface HookupSchema {
  path: string;
  className: string;
  required: boolean;
}

export interface FrameTypeSchema {
  name: string;
  classType: string;
  descType?: string;
  blizzardOnly: boolean;
  hookups: HookupSchema[];
  observed?: number;
  source: Array<"community-schema" | "blizzard-corpus" | "workspace-corpus">;
}

export interface BlizzardTemplateSchema {
  reference: string;
  layout: string;
  name: string;
  frameType: string;
  template?: string;
  source: "blizzard-corpus";
}

export interface RestrictedFrameRoute {
  frameType: string;
  containerTemplate: string;
  containerFrameType: string;
  targetPath: string;
  targetTemplate?: string;
  providedChildPaths: string[];
}

export interface RestrictionPlan {
  type: string;
  restricted: boolean;
  observedInCore: number;
  requiredHookups: HookupSchema[];
  exactTemplates: BlizzardTemplateSchema[];
  compatibleBaseTemplates: BlizzardTemplateSchema[];
  containerRoutes: Array<RestrictedFrameRoute & { requiredHookupsCovered: boolean; missingHookups: string[] }>;
  runtimeExpectation: "expected-to-work" | "may-not-work";
  runtimeNotice: string;
  recommended:
    | { strategy: "unrestricted" }
    | { strategy: "direct-template"; template: string; reason: string }
    | { strategy: "container-template"; template: string; containerFrameType: string; targetPath: string; reason: string }
    | { strategy: "explicit-override"; reason: string };
}

export interface TemplateUsageAssessment {
  reference: string;
  targetType: string;
  templateFrameType?: string;
  templateObservedInCore: boolean;
  classCompatible?: boolean;
  targetRestricted: boolean;
  kind: "ordinary-template" | "locked-frame-template" | "incompatible-template";
  runtimeExpectation: "expected-to-work" | "may-not-work" | "unsupported";
  notice: string;
}

export interface SchemaCoverageReport {
  frameTypes: {
    total: number;
    described: number;
    communityDeclared: number;
    observedOnly: number;
    restricted: number;
    missingClassDefinitions: string[];
    inheritanceCycles: string[][];
  };
  properties: {
    declared: number;
    observedOnly: number;
    typedDeclared: number;
    structurallyEditableDeclared: number;
    unresolvedTypeReferences: Array<{ frameClass: string; property: string; type: string }>;
    opaqueScalarTypes: string[];
  };
  guarantees: {
    allKnownFrameTypesGenericReadWrite: boolean;
    allDeclaredPropertiesGenericReadWrite: boolean;
    unknownXmlPreservedByLosslessModel: true;
    declaredScalarValidationComplete: boolean;
    observedOnlyScalarValidationComplete: boolean;
  };
  limitations: string[];
}

interface CorpusObservation {
  files?: number;
  frameTypes?: Record<string, number>;
  propertiesByFrameType?: Record<string, Record<string, number>>;
  animationControllerTypes?: Record<string, number>;
  stateActionTypes?: Record<string, number>;
  stateConditionTypes?: Record<string, number>;
  styleAttributes?: Record<string, number>;
  templates?: Array<Omit<BlizzardTemplateSchema, "source">>;
  restrictedFrameRoutes?: RestrictedFrameRoute[];
}

export interface TypeDescription extends FrameTypeSchema {
  inheritance: string[];
  properties: FramePropertySchema[];
}

const SCHEMA_FILES = [
  "type.xml",
  "enum.xml",
  "ehotkey.xml",
  "field.xml",
  "struct.xml",
  "stategroup.xml",
  "animation.xml",
  "frame_class.xml",
  "frame_type.xml",
  "sc2layout.xml",
] as const;

const INTEGER_TYPES = /^(?:U?int(?:8|16|32|64))$/i;
const REAL_TYPES = /^(?:Real32|Number)$/i;
const BOOLEAN_TYPES = /^(?:Boolean|Bool)$/i;

function children(parsed: ParsedXml, node: XmlNode, tag?: string): XmlNode[] {
  return node.childIds.map((id) => parsed.nodes[id]).filter((child) => !tag || child.tag === tag);
}

function pushUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

function childBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function mergeCounts(target: Map<string, number>, source?: Record<string, number>): void {
  for (const [key, count] of Object.entries(source ?? {})) target.set(key, (target.get(key) ?? 0) + count);
}

class MapMap<K1, K2, V> {
  private readonly rows = new Map<K1, Map<K2, V>>();

  add(first: K1, second: K2, value: V): void {
    const row = this.rows.get(first) ?? new Map<K2, V>();
    const previous = row.get(second);
    row.set(second, typeof value === "number" && typeof previous === "number"
      ? ((previous + value) as V)
      : value);
    this.rows.set(first, row);
  }

  getRow(first: K1): Map<K2, V> {
    return this.rows.get(first) ?? new Map<K2, V>();
  }
}

export class SchemaRegistry {
  readonly simpleTypes = new Map<string, SimpleTypeSchema>();
  readonly complexTypes = new Map<string, ComplexTypeSchema>();
  readonly frameClasses = new Map<string, FrameClassSchema>();
  readonly frameTypes = new Map<string, FrameTypeSchema>();
  readonly observedProperties = new MapMap<string, string, number>();
  readonly observedAnimationControllers = new Map<string, number>();
  readonly observedStateActions = new Map<string, number>();
  readonly observedStateConditions = new Map<string, number>();
  readonly styleAttributes = new Map<string, number>();
  readonly blizzardTemplates = new Map<string, BlizzardTemplateSchema>();
  readonly restrictedFrameRoutes = new Map<string, RestrictedFrameRoute[]>();
  corpusFiles = 0;

  static bundledDirectory(): string {
    return fileURLToPath(new URL("../../schema/upstream/", import.meta.url));
  }

  static async loadBundled(): Promise<SchemaRegistry> {
    const registry = await SchemaRegistry.loadDirectory(SchemaRegistry.bundledDirectory());
    const observations = path.resolve(SchemaRegistry.bundledDirectory(), "..", "core-observations.json");
    try {
      registry.mergeCorpus(JSON.parse(await fs.readFile(observations, "utf8")) as CorpusObservation, "blizzard-corpus");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return registry;
  }

  static async loadDirectory(directory: string): Promise<SchemaRegistry> {
    const registry = new SchemaRegistry();
    for (const file of SCHEMA_FILES) {
      const source = await fs.readFile(path.join(directory, file), "utf8");
      registry.consumeSchema(source);
    }
    registry.completeOpaquePropertyTypes();
    return registry;
  }

  private completeOpaquePropertyTypes(): void {
    for (const frameClass of this.frameClasses.values()) {
      for (const property of frameClass.properties) {
        const name = property.valueType;
        if (!name || this.simpleTypes.has(name) || this.complexTypes.has(name)) continue;
        this.simpleTypes.set(name, {
          name,
          kind: "opaque",
          enumValues: [],
          unions: [],
          patterns: [],
          nullable: false,
          opaque: true,
        });
      }
    }
  }

  private consumeSchema(source: string): void {
    const parsed = scanXml(source);
    const errors = parsed.diagnostics.filter((item) => item.severity === "error");
    if (errors.length) throw new Error(`Invalid schema XML: ${errors.map((item) => item.message).join("; ")}`);

    for (const node of parsed.nodes) {
      if (node.tag === "simpleType") this.consumeSimpleType(parsed, node);
      else if (node.tag === "complexType") this.consumeComplexType(parsed, node);
      else if (node.tag === "frameClass") this.consumeFrameClass(parsed, node);
      else if (node.tag === "frameType") this.consumeFrameType(parsed, node);
    }
  }

  private consumeSimpleType(parsed: ParsedXml, node: XmlNode): void {
    const name = node.attrs.name;
    if (!name) return;
    const current = this.simpleTypes.get(name) ?? {
      name,
      enumValues: [],
      unions: [],
      patterns: [],
      nullable: false,
    };
    current.kind = node.attrs.kind ?? current.kind;
    current.data = node.attrs.data ?? current.data;
    current.internalType = node.attrs.internalType ?? current.internalType;
    for (const child of children(parsed, node)) {
      if (child.tag === "enumeration" && child.attrs.value !== undefined) pushUnique(current.enumValues, child.attrs.value);
      if (child.tag === "union" && child.attrs.value) pushUnique(current.unions, child.attrs.value);
      if (child.tag === "pattern" && child.attrs.value) pushUnique(current.patterns, child.attrs.value);
      if (child.tag === "flag" && child.attrs.name === "Nullable" && child.attrs.value === "true") current.nullable = true;
    }
    this.simpleTypes.set(name, current);
  }

  private consumeComplexType(parsed: ParsedXml, node: XmlNode): void {
    const name = node.attrs.name;
    if (!name) return;
    const type: ComplexTypeSchema = this.complexTypes.get(name) ?? {
      name,
      extends: [],
      attributes: [],
      elements: [],
      indeterminateAttributes: [],
    };
    for (const child of children(parsed, node)) {
      if (child.tag === "extend" && child.attrs.value) pushUnique(type.extends, child.attrs.value);
      if (child.tag === "attribute" && child.attrs.name && child.attrs.type) {
        const attr: AttributeSchema = {
          name: child.attrs.name,
          type: child.attrs.type,
          required: child.attrs.use === "required",
          default: child.attrs.default,
        };
        const at = type.attributes.findIndex((item) => item.name.toLowerCase() === attr.name.toLowerCase());
        if (at < 0) type.attributes.push(attr);
        else type.attributes[at] = attr;
      }
      if (child.tag === "indeterminateAttribute" && child.attrs.key && child.attrs.value) {
        type.indeterminateAttributes.push({ key: child.attrs.key, value: child.attrs.value });
      }
      if (child.tag === "element" || child.tag === "elementRef") {
        const element: ElementSchema = {
          name: child.attrs.name ?? child.attrs.ref ?? "",
          type: child.attrs.type,
          ref: child.attrs.ref,
          table: child.attrs.table === "true",
          alternatives: [],
        };
        for (const alternative of children(parsed, child, "alternative")) {
          for (const statement of children(parsed, alternative, "statement")) {
            if (statement.attrs.test && statement.attrs.type) {
              element.alternatives.push({ test: statement.attrs.test, type: statement.attrs.type });
            }
          }
        }
        if (element.name) type.elements.push(element);
      }
    }
    this.complexTypes.set(name, type);
  }

  private consumeFrameClass(parsed: ParsedXml, node: XmlNode): void {
    const name = node.attrs.name;
    if (!name) return;
    const frameClass: FrameClassSchema = this.frameClasses.get(name) ?? { name, properties: [] };
    frameClass.parent = node.attrs.parent ?? frameClass.parent;
    for (const child of children(parsed, node, "property")) {
      if (!child.attrs.name) continue;
      const property: FramePropertySchema = {
        name: child.attrs.name,
        valueType: child.attrs.valueType,
        elementType: child.attrs.elementType,
        table: child.attrs.table === "true",
        tableKey: child.attrs.tableKey,
        readonly: child.attrs.readonly === "true",
        declaredBy: name,
      };
      const at = frameClass.properties.findIndex((item) => item.name.toLowerCase() === property.name.toLowerCase());
      if (at < 0) frameClass.properties.push(property);
      else frameClass.properties[at] = property;
    }
    this.frameClasses.set(name, frameClass);
  }

  private consumeFrameType(parsed: ParsedXml, node: XmlNode): void {
    const name = node.attrs.name;
    const classType = node.attrs.classType;
    if (!name || !classType) return;
    const type: FrameTypeSchema = this.frameTypes.get(name.toLowerCase()) ?? {
      name,
      classType,
      blizzardOnly: false,
      hookups: [],
      source: ["community-schema"],
    };
    type.classType = classType;
    type.descType = node.attrs.descType ?? type.descType;
    type.blizzardOnly = childBoolean(node.attrs.blizzOnly);
    for (const child of children(parsed, node, "hookup")) {
      if (!child.attrs.path || !child.attrs.class) continue;
      const hookup = { path: child.attrs.path, className: child.attrs.class, required: child.attrs.required === "true" };
      const at = type.hookups.findIndex((item) => item.path.toLowerCase() === hookup.path.toLowerCase());
      if (at < 0) type.hookups.push(hookup);
      else type.hookups[at] = hookup;
    }
    this.frameTypes.set(name.toLowerCase(), type);
  }

  mergeCorpus(observation: CorpusObservation, source: "blizzard-corpus" | "workspace-corpus"): void {
    this.corpusFiles += observation.files ?? 0;
    for (const [name, count] of Object.entries(observation.frameTypes ?? {})) {
      const key = name.toLowerCase();
      const existing = this.frameTypes.get(key);
      if (existing) {
        existing.observed = (existing.observed ?? 0) + count;
        pushUnique(existing.source, source);
      } else {
        const classType = `Observed:${name}`;
        if (!this.frameClasses.has(classType)) {
          this.frameClasses.set(classType, { name: classType, properties: [], observedOnly: true });
        }
        this.frameTypes.set(key, {
          name,
          classType,
          blizzardOnly: false,
          hookups: [],
          observed: count,
          source: [source],
        });
      }
    }
    for (const [frameType, properties] of Object.entries(observation.propertiesByFrameType ?? {})) {
      for (const [property, count] of Object.entries(properties)) this.observedProperties.add(frameType, property, count);
    }
    mergeCounts(this.observedAnimationControllers, observation.animationControllerTypes);
    mergeCounts(this.observedStateActions, observation.stateActionTypes);
    mergeCounts(this.observedStateConditions, observation.stateConditionTypes);
    mergeCounts(this.styleAttributes, observation.styleAttributes);
    if (source === "blizzard-corpus") {
      for (const template of observation.templates ?? []) {
        this.blizzardTemplates.set(template.reference.toLowerCase(), { ...template, source });
      }
      for (const route of observation.restrictedFrameRoutes ?? []) {
        const key = route.frameType.toLowerCase();
        const routes = this.restrictedFrameRoutes.get(key) ?? [];
        if (!routes.some((item) => item.containerTemplate === route.containerTemplate && item.targetPath === route.targetPath)) {
          routes.push({ ...route, providedChildPaths: [...route.providedChildPaths] });
          this.restrictedFrameRoutes.set(key, routes);
        }
      }
    }
  }

  observeLayout(source: string): void {
    const parsed = scanXml(source);
    const observation: CorpusObservation = { files: 1, frameTypes: {}, propertiesByFrameType: {} };
    for (const node of parsed.nodes) {
      if (node.tag === "Frame" && node.attrs.type) {
        const type = node.attrs.type;
        observation.frameTypes![type] = (observation.frameTypes![type] ?? 0) + 1;
        const bag = observation.propertiesByFrameType![type] ??= {};
        for (const child of children(parsed, node)) {
          if (!["Frame", "Anchor", "StateGroup", "Animation"].includes(child.tag)) bag[child.tag] = (bag[child.tag] ?? 0) + 1;
        }
      }
    }
    this.mergeCorpus(observation, "workspace-corpus");
  }

  getFrameType(name: string): FrameTypeSchema | undefined {
    return this.frameTypes.get(name.toLowerCase());
  }

  getBlizzardTemplate(reference: string): BlizzardTemplateSchema | undefined {
    return this.blizzardTemplates.get(reference.replace(/^\$root\//i, "").toLowerCase());
  }

  queryBlizzardTemplates(options: { search?: string; frameType?: string; limit?: number } = {}): BlizzardTemplateSchema[] {
    const needle = options.search?.toLowerCase();
    const wantedType = options.frameType?.toLowerCase();
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 2000);
    return [...this.blizzardTemplates.values()]
      .filter((item) => !needle || item.reference.toLowerCase().includes(needle))
      .filter((item) => !wantedType || item.frameType.toLowerCase() === wantedType)
      .slice(0, limit);
  }

  compatibleTemplates(frameType: string, limit = 100): BlizzardTemplateSchema[] {
    const target = this.getFrameType(frameType);
    if (!target) return [];
    const preferredName = `standard${target.name.toLowerCase()}template`;
    const score = (template: BlizzardTemplateSchema): number => {
      const reference = template.reference.toLowerCase();
      const name = template.name.toLowerCase();
      return (template.frameType.toLowerCase() === target.name.toLowerCase() ? 1000 : 0)
        + (name === preferredName ? 1000 : 0)
        + (reference.startsWith("standardtemplates/") ? 500 : 0)
        + (reference.includes("standard") ? 50 : 0)
        - reference.length / 1000;
    };
    return [...this.blizzardTemplates.values()]
      .filter((template) => this.isTemplateCompatible(frameType, template.reference))
      .sort((a, b) => score(b) - score(a) || a.reference.localeCompare(b.reference))
      .slice(0, Math.min(Math.max(limit, 1), 2000));
  }

  recommendedTemplate(frameType: string): BlizzardTemplateSchema | undefined {
    return this.compatibleTemplates(frameType, 1)[0];
  }

  isTemplateCompatible(frameType: string, templateReference: string): boolean {
    const template = this.getBlizzardTemplate(templateReference);
    const child = this.getFrameType(frameType);
    const base = template && this.getFrameType(template.frameType);
    if (!template || !child || !base) return false;
    return this.classInheritance(child.classType).includes(base.classType);
  }

  assessTemplateUsage(frameType: string, templateReference: string): TemplateUsageAssessment {
    const target = this.getFrameType(frameType);
    const template = this.getBlizzardTemplate(templateReference);
    const compatible = template ? this.isTemplateCompatible(frameType, templateReference) : undefined;
    const targetRestricted = target?.blizzardOnly ?? false;
    if (template && compatible === false) {
      return {
        reference: template.reference,
        targetType: target?.name ?? frameType,
        templateFrameType: template.frameType,
        templateObservedInCore: true,
        classCompatible: false,
        targetRestricted,
        kind: "incompatible-template",
        runtimeExpectation: "unsupported",
        notice: `Template '${template.reference}' is not class-compatible with frame type '${frameType}'.`,
      };
    }
    if (targetRestricted) {
      return {
        reference: template?.reference ?? templateReference,
        targetType: target?.name ?? frameType,
        templateFrameType: template?.frameType,
        templateObservedInCore: Boolean(template),
        classCompatible: compatible,
        targetRestricted: true,
        kind: "locked-frame-template",
        runtimeExpectation: "may-not-work",
        notice: "This targets a Blizzard-only/locked frame and may not work at SC2 runtime. Schema compatibility and a Core-observed template are not a runtime bypass or guarantee.",
      };
    }
    return {
      reference: template?.reference ?? templateReference,
      targetType: target?.name ?? frameType,
      templateFrameType: template?.frameType,
      templateObservedInCore: Boolean(template),
      classCompatible: compatible,
      targetRestricted: false,
      kind: "ordinary-template",
      runtimeExpectation: "expected-to-work",
      notice: "Ordinary SC2 template inheritance is expected to work when the reference resolves and the target game version provides the template.",
    };
  }

  restrictionPlan(frameType: string): RestrictionPlan | undefined {
    const type = this.getFrameType(frameType);
    if (!type) return undefined;
    const requiredHookups = type.hookups.filter((hookup) => hookup.required);
    if (!type.blizzardOnly) {
      return {
        type: type.name,
        restricted: false,
        observedInCore: type.observed ?? 0,
        requiredHookups,
        exactTemplates: [],
        compatibleBaseTemplates: [],
        containerRoutes: [],
        runtimeExpectation: "expected-to-work",
        runtimeNotice: "This frame type is not marked Blizzard-only; ordinary compatible templates are expected to work when their references resolve.",
        recommended: { strategy: "unrestricted" },
      };
    }
    const exactTemplates = [...this.blizzardTemplates.values()]
      .filter((template) => template.frameType.toLowerCase() === type.name.toLowerCase())
      .slice(0, 50);
    const routeRows = this.restrictedFrameRoutes.get(type.name.toLowerCase()) ?? [];
    const containerRoutes = routeRows.map((route) => {
      const available = new Set(route.providedChildPaths.map((item) => item.toLowerCase()));
      const missingHookups = requiredHookups
        .filter((hookup) => !available.has(hookup.path.toLowerCase()))
        .map((hookup) => hookup.path);
      return { ...route, providedChildPaths: [...route.providedChildPaths], requiredHookupsCovered: missingHookups.length === 0, missingHookups };
    }).sort((a, b) =>
      Number(b.requiredHookupsCovered) - Number(a.requiredHookupsCovered) ||
      a.targetPath.split("/").length - b.targetPath.split("/").length);
    const actualTargetTemplates = new Set(routeRows.map((route) => route.targetTemplate?.toLowerCase()).filter(Boolean));
    const compatibleBaseTemplates = [...this.blizzardTemplates.values()]
      .filter((template) => template.frameType.toLowerCase() !== type.name.toLowerCase())
      .filter((template) => this.isTemplateCompatible(type.name, template.reference))
      .sort((a, b) => Number(actualTargetTemplates.has(b.reference.toLowerCase())) - Number(actualTargetTemplates.has(a.reference.toLowerCase())))
      .slice(0, 50);

    let recommended: RestrictionPlan["recommended"];
    if (exactTemplates.length) {
      recommended = {
        strategy: "direct-template",
        template: exactTemplates[0].reference,
        reason: "A top-level Core template of the same restricted frame type is available.",
      };
    } else {
      const completeContainer = containerRoutes.find((route) => route.requiredHookupsCovered);
      if (requiredHookups.length && completeContainer) {
        recommended = {
          strategy: "container-template",
          template: completeContainer.containerTemplate,
          containerFrameType: completeContainer.containerFrameType,
          targetPath: completeContainer.targetPath,
          reason: "The Core container supplies every required hookup for the restricted child.",
        };
      } else if (compatibleBaseTemplates.length) {
        recommended = {
          strategy: "direct-template",
          template: compatibleBaseTemplates[0].reference,
          reason: "The template base class is compatible and the type has no uncovered required hookups.",
        };
      } else if (completeContainer) {
        recommended = {
          strategy: "container-template",
          template: completeContainer.containerTemplate,
          containerFrameType: completeContainer.containerFrameType,
          targetPath: completeContainer.targetPath,
          reason: "The restricted frame is observed inside this Core template.",
        };
      } else {
        recommended = {
          strategy: "explicit-override",
          reason: "No verified complete Core template route was found; manual creation must be explicitly authorized.",
        };
      }
    }
    return {
      type: type.name,
      restricted: true,
      observedInCore: type.observed ?? 0,
      requiredHookups,
      exactTemplates,
      compatibleBaseTemplates,
      containerRoutes,
      runtimeExpectation: "may-not-work",
      runtimeNotice: "This is a Blizzard-only/locked frame route and may not work at SC2 runtime. Core evidence and hookup coverage do not bypass runtime restrictions.",
      recommended,
    };
  }

  auditCoverage(): SchemaCoverageReport {
    const types = [...this.frameTypes.values()];
    const classes = [...this.frameClasses.values()];
    const declaredProperties = classes.flatMap((frameClass) => frameClass.properties.map((property) => ({ frameClass, property })));
    const missingClassDefinitions = types
      .filter((type) => !this.frameClasses.has(type.classType))
      .map((type) => `${type.name} -> ${type.classType}`)
      .sort();
    const cycles: string[][] = [];
    for (const frameClass of classes) {
      const chain: string[] = [];
      const positions = new Map<string, number>();
      let current: string | undefined = frameClass.name;
      while (current) {
        const position = positions.get(current);
        if (position !== undefined) {
          const cycle = [...chain.slice(position), current];
          const signature = [...new Set(cycle)].sort().join("|");
          if (!cycles.some((item) => [...new Set(item)].sort().join("|") === signature)) cycles.push(cycle);
          break;
        }
        positions.set(current, chain.length);
        chain.push(current);
        current = this.frameClasses.get(current)?.parent;
      }
    }
    const unresolvedTypeReferences = declaredProperties.flatMap(({ frameClass, property }) => {
      const referenced = property.valueType ?? property.elementType;
      return referenced && !this.simpleTypes.has(referenced) && !this.complexTypes.has(referenced)
        ? [{ frameClass: frameClass.name, property: property.name, type: referenced }]
        : [];
    });
    let observedOnlyProperties = 0;
    for (const type of types) {
      observedOnlyProperties += this.describeType(type.name)?.properties.filter((property) => property.declaredBy === "ObservedCorpus").length ?? 0;
    }
    const opaqueScalarTypes = [...this.simpleTypes.values()].filter((type) => type.opaque).map((type) => type.name).sort();
    const described = types.filter((type) => this.describeType(type.name)).length;
    return {
      frameTypes: {
        total: types.length,
        described,
        communityDeclared: types.filter((type) => type.source.includes("community-schema")).length,
        observedOnly: types.filter((type) => !type.source.includes("community-schema")).length,
        restricted: types.filter((type) => type.blizzardOnly).length,
        missingClassDefinitions,
        inheritanceCycles: cycles,
      },
      properties: {
        declared: declaredProperties.length,
        observedOnly: observedOnlyProperties,
        typedDeclared: declaredProperties.filter(({ property }) => Boolean(property.valueType || property.elementType)).length,
        structurallyEditableDeclared: declaredProperties.length,
        unresolvedTypeReferences,
        opaqueScalarTypes,
      },
      guarantees: {
        allKnownFrameTypesGenericReadWrite: described === types.length && missingClassDefinitions.length === 0,
        allDeclaredPropertiesGenericReadWrite: declaredProperties.every(({ property }) => Boolean(property.name)),
        unknownXmlPreservedByLosslessModel: true,
        declaredScalarValidationComplete: unresolvedTypeReferences.length === 0 && opaqueScalarTypes.length === 0,
        observedOnlyScalarValidationComplete: observedOnlyProperties === 0,
      },
      limitations: [
        "Observed-only frame types and properties are structurally editable, but may lack authoritative engine type metadata.",
        ...(opaqueScalarTypes.length
          ? ["Opaque scalar types are accepted without enum/pattern validation because the upstream schema names but does not define them."]
          : []),
        "Unknown future XML remains editable only with explicit allowUnknown/allowUnknownType and is preserved losslessly.",
        "Only the SC2 runtime/editor can prove version-specific behavior, especially for Blizzard-only/locked frames.",
      ],
    };
  }

  describeType(name: string): TypeDescription | undefined {
    const type = this.getFrameType(name);
    if (!type) return undefined;
    const inheritance = this.classInheritance(type.classType);
    const propertyMap = new Map<string, FramePropertySchema>();
    for (const className of [...inheritance].reverse()) {
      const frameClass = this.frameClasses.get(className);
      for (const property of frameClass?.properties ?? []) propertyMap.set(property.name.toLowerCase(), { ...property });
    }
    const observed = this.observedProperties.getRow(type.name);
    for (const [property, count] of observed) {
      const key = property.toLowerCase();
      const existing = propertyMap.get(key);
      if (existing) existing.observed = count;
      else propertyMap.set(key, { name: property, table: false, readonly: false, observed: count, declaredBy: "ObservedCorpus" });
    }
    return { ...type, inheritance, properties: [...propertyMap.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  classInheritance(className: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = className;
    while (current && !seen.has(current)) {
      seen.add(current);
      out.push(current);
      current = this.frameClasses.get(current)?.parent;
    }
    return out;
  }

  getProperty(frameType: string, property: string): FramePropertySchema | undefined {
    return this.describeType(frameType)?.properties.find((item) => item.name.toLowerCase() === property.toLowerCase());
  }

  valueTypeOf(property: FramePropertySchema): string | undefined {
    if (property.valueType) return property.valueType;
    if (!property.elementType) return undefined;
    const seen = new Set<string>();
    const queue = [property.elementType];
    while (queue.length) {
      const name = queue.shift()!;
      if (seen.has(name)) continue;
      seen.add(name);
      const complex = this.complexTypes.get(name);
      const val = complex?.attributes.find((attr) => attr.name.toLowerCase() === "val");
      if (val) return val.type;
      queue.push(...(complex?.extends ?? []));
    }
    return undefined;
  }

  describeComplexType(name: string): ComplexTypeSchema | undefined {
    if (!this.complexTypes.has(name)) return undefined;
    const seen = new Set<string>();
    const attributes = new Map<string, AttributeSchema>();
    const elements = new Map<string, ElementSchema>();
    const indeterminateAttributes: Array<{ key: string; value: string }> = [];
    const inheritance: string[] = [];
    const visit = (current: string) => {
      if (seen.has(current)) return;
      seen.add(current);
      const type = this.complexTypes.get(current);
      if (!type) return;
      for (const parent of type.extends) visit(parent);
      inheritance.push(current);
      for (const attribute of type.attributes) attributes.set(attribute.name.toLowerCase(), { ...attribute });
      for (const element of type.elements) elements.set(element.name.toLowerCase(), {
        ...element,
        alternatives: element.alternatives.map((alternative) => ({ ...alternative })),
      });
      for (const entry of type.indeterminateAttributes) {
        if (!indeterminateAttributes.some((item) => item.key === entry.key && item.value === entry.value)) {
          indeterminateAttributes.push({ ...entry });
        }
      }
    };
    visit(name);
    return {
      name,
      extends: inheritance.filter((item) => item !== name),
      attributes: [...attributes.values()],
      elements: [...elements.values()],
      indeterminateAttributes,
    };
  }

  describeProperty(frameType: string, propertyName: string): PropertyDescription | undefined {
    const property = this.getProperty(frameType, propertyName);
    if (!property) return undefined;
    const valueType = this.valueTypeOf(property);
    return {
      ...property,
      valueType,
      scalarType: valueType ? this.simpleTypes.get(valueType) : undefined,
      enumValues: valueType ? this.enumValues(valueType) : [],
      complexType: property.elementType ? this.describeComplexType(property.elementType) : undefined,
      schemaDriven: Boolean(valueType || property.elementType),
    };
  }

  validatePropertySpec(property: FramePropertySchema, spec: ElementSpec): string[] {
    const issues: string[] = [];
    const complex = property.elementType ? this.describeComplexType(property.elementType) : undefined;
    const attrs = { ...(spec.attrs ?? {}) };
    if (spec.value !== undefined) attrs.val = spec.value;
    const scalarType = this.valueTypeOf(property);
    if (attrs.val !== undefined) {
      const problem = this.validateScalar(scalarType, attrs.val);
      if (problem) issues.push(problem);
    }
    if (!complex) return issues;

    const attrSchema = new Map(complex.attributes.map((attribute) => [attribute.name.toLowerCase(), attribute]));
    for (const [name, value] of Object.entries(attrs)) {
      const declared = attrSchema.get(name.toLowerCase());
      if (!declared) continue;
      const problem = this.validateScalar(declared.type, value);
      if (problem) issues.push(`${name}: ${problem}`);
    }
    for (const required of complex.attributes.filter((attribute) => attribute.required && attribute.default === undefined)) {
      if (!Object.keys(attrs).some((name) => name.toLowerCase() === required.name.toLowerCase())) {
        issues.push(`missing required attribute '${required.name}'`);
      }
    }

    const elementSchema = new Map(complex.elements.map((element) => [element.name.toLowerCase(), element]));
    for (const child of spec.children ?? []) {
      const declared = elementSchema.get(child.tag.toLowerCase());
      if (!declared) continue;
      let childType = declared.type;
      const discriminator = child.attrs?.type;
      if (discriminator !== undefined) {
        childType = declared.alternatives.find((alternative) => alternative.test.toLowerCase() === String(discriminator).toLowerCase())?.type ?? childType;
      }
      if (!childType) continue;
      const childComplex = this.describeComplexType(childType);
      const childValue = child.value ?? child.attrs?.val;
      if (childValue !== undefined) {
        const childScalar = childComplex?.attributes.find((attribute) => attribute.name.toLowerCase() === "val")?.type ?? childType;
        const problem = this.validateScalar(childScalar, childValue);
        if (problem) issues.push(`${child.tag}: ${problem}`);
      }
    }
    return issues;
  }

  enumValues(typeName: string): string[] {
    const seen = new Set<string>();
    const values: string[] = [];
    const visit = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      const type = this.simpleTypes.get(name);
      for (const value of type?.enumValues ?? []) pushUnique(values, value);
      for (const union of type?.unions ?? []) visit(union);
    };
    visit(typeName);
    return values;
  }

  validateScalar(typeName: string | undefined, value: ScalarValue): string | undefined {
    if (!typeName) return undefined;
    const text = String(value);
    const enumValues = this.enumValues(typeName);
    if (enumValues.length && !enumValues.some((item) => item.toLowerCase() === text.toLowerCase())) {
      return `Expected ${typeName}: ${enumValues.join(", ")}; got '${text}'`;
    }
    if (BOOLEAN_TYPES.test(typeName) && !/^(?:true|false|0|1)$/i.test(text)) return `Expected Boolean; got '${text}'`;
    if (INTEGER_TYPES.test(typeName) && !/^-?\d+$/.test(text)) return `Expected integer ${typeName}; got '${text}'`;
    if (REAL_TYPES.test(typeName) && !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return `Expected real ${typeName}; got '${text}'`;
    const simple = this.simpleTypes.get(typeName);
    if (simple?.patterns.length && !simple.patterns.some((pattern) => new RegExp(pattern).test(text))) {
      return `Value '${text}' does not match ${typeName}`;
    }
    return undefined;
  }

  animationControllerTypes(): string[] {
    return this.alternativeTests("CFrameAnimationDesc", "Controller", this.observedAnimationControllers);
  }

  stateActionTypes(): string[] {
    return this.alternativeTests("CStateDesc", "Action", this.observedStateActions);
  }

  stateConditionTypes(): string[] {
    return this.alternativeTests("CStateDesc", "When", this.observedStateConditions);
  }

  private alternativeTests(complexName: string, elementName: string, observed: Map<string, number>): string[] {
    const out = this.complexTypes.get(complexName)?.elements
      .find((item) => item.name === elementName)?.alternatives.map((item) => item.test) ?? [];
    for (const value of observed.keys()) pushUnique(out, value);
    return out.sort();
  }

  query(options: { kind?: "frameType" | "frameClass" | "simpleType" | "complexType" | "animation" | "state" | "style"; search?: string; includeBlizzard?: boolean; limit?: number } = {}): unknown {
    const needle = options.search?.toLowerCase();
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 2000);
    const match = (name: string) => !needle || name.toLowerCase().includes(needle);
    if (options.kind === "frameClass") return [...this.frameClasses.values()].filter((item) => match(item.name)).slice(0, limit);
    if (options.kind === "simpleType") return [...this.simpleTypes.values()].filter((item) => match(item.name)).slice(0, limit);
    if (options.kind === "complexType") return [...this.complexTypes.values()].filter((item) => match(item.name)).slice(0, limit);
    if (options.kind === "animation") return { controllerTypes: this.animationControllerTypes() };
    if (options.kind === "state") return { conditions: this.stateConditionTypes(), actions: this.stateActionTypes() };
    if (options.kind === "style") return { attributes: [...this.styleAttributes.keys()].sort() };
    const types = [...this.frameTypes.values()]
      .filter((item) => (options.includeBlizzard ?? true) || !item.blizzardOnly)
      .filter((item) => match(item.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
    if (options.kind === "frameType") return types;
    return {
      counts: {
        frameTypes: this.frameTypes.size,
        frameClasses: this.frameClasses.size,
        simpleTypes: this.simpleTypes.size,
        complexTypes: this.complexTypes.size,
        blizzardCorpusFiles: this.corpusFiles,
        blizzardTemplates: this.blizzardTemplates.size,
      },
      animationControllerTypes: this.animationControllerTypes(),
      stateActionTypes: this.stateActionTypes(),
      stateConditionTypes: this.stateConditionTypes(),
      frameTypes: types,
    };
  }
}
