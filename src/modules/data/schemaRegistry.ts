import type { DataObject } from "./types.js";
import { promises as fs, readFileSync } from "node:fs";
import {projectPath} from "../../app/paths.js";
import { DataXsdRegistry } from "./xsdRegistry.js";

export interface DataEditorEvidence {
  schemaVersion: string;
  editor: { fileVersion?: string; sha256: string; pdbPath?: string; readOnlyAnalysis: true };
  catalogClassCandidates: Array<{ name: string; domain?: string; status: string }>;
  qualifiedFieldCandidates: Array<{ name: string; owner: string; domain?: string; internalPath: string; xmlPathCandidate: string; status: string }>;
  linkTypes: Array<{ name: string; targetDomainCandidate: string; status: string }>;
  fieldTypes: Array<{ name: string; status: string }>;
  runtimeApi: Array<{ name: string; status: string }>;
  editorSettings: Array<{ name: string; status: string }>;
  localizationKeys: Array<{ name: string; status: string }>;
  limitations: string[];
}

export interface DataObservedSchema {
  schemaVersion: string;
  evidence: "OBSERVED_REAL_XML";
  corpus: { files: number; catalogs: number; objects: number; objectTypes: number; fieldInstances: number; fieldPaths: number; parseDiagnostics: number; parseFailures: number; roundTripFailures: number };
  repeatableUnindexedFields: string[];
  types: Array<{
    ctype: string;
    domain?: string;
    objects: number;
    defaults: number;
    parents: string[];
    attributes: Array<{ name: string; occurrences: number; examples: string[] }>;
    fields: Array<ObservedField & { repeatableUnindexed: boolean }>;
  }>;
}

export interface ObservedField {
  path: string;
  name: string;
  occurrences: number;
  carriers: string[];
  indexes: string[];
  examples: string[];
  nested: boolean;
  canonicalPath?: string;
  observedPresence?: "ALL_OBJECTS" | "SOME_OBJECTS";
  objectsWithField?: number;
  valueType?: "CATALOG_LINK" | "CATALOG_REFERENCE_CANDIDATE" | "TOKEN_PATH_OR_EXPRESSION_OBSERVED" | "BOOLEAN_OBSERVED" | "INTEGER_OBSERVED" | "NUMBER_OBSERVED" | "ENUM_CANDIDATE_OBSERVED" | "STRING_OR_STRUCT_OBSERVED";
  enumCandidates?: string[];
  observedRange?: { min?: number; max?: number };
  observedDefaultCandidates?: string[];
  valuesTruncated?: boolean;
  referenceDomainCandidates?: string[];
  catalogReferenceConfidence?: number;
}

export class DataSchemaRegistry {
  private _editorEvidence?: DataEditorEvidence;
  private _observedSchema?: DataObservedSchema;
  private _repeatableFields: ReadonlySet<string> = new Set();
  private readonly observedTypes = new Map<string, DataObservedSchema["types"][number]>();
  private lazyFiles?: { editor: string; observed: string };
  private loaded = true;
  private readonly declaredXsd = new DataXsdRegistry();

  constructor(editorEvidence?: DataEditorEvidence, observedSchema?: DataObservedSchema) {
    this.hydrate(editorEvidence, observedSchema);
  }

  private hydrate(editorEvidence?: DataEditorEvidence, observedSchema?: DataObservedSchema): void {
    this._editorEvidence = editorEvidence;
    this._observedSchema = observedSchema;
    this._repeatableFields = new Set(observedSchema?.repeatableUnindexedFields ?? []);
    this.observedTypes.clear();
    for (const type of observedSchema?.types ?? []) this.observedTypes.set(type.ctype.toLowerCase(), type);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const files = this.lazyFiles;
    this.lazyFiles = undefined;
    if (!files) return;
    const parse = <T>(file: string): T | undefined => {
      try { return JSON.parse(readFileSync(file, "utf8")) as T; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    };
    this.hydrate(parse<DataEditorEvidence>(files.editor), parse<DataObservedSchema>(files.observed));
  }

  get editorEvidence(): DataEditorEvidence | undefined { this.ensureLoaded(); return this._editorEvidence; }
  get observedSchema(): DataObservedSchema | undefined { this.ensureLoaded(); return this._observedSchema; }
  get repeatableFields(): ReadonlySet<string> { this.ensureLoaded(); return this._repeatableFields; }

  loadState() { return { loaded: this.loaded, lazy: Boolean(this.lazyFiles) }; }

  hasObservedType(ctype: string): boolean { this.ensureLoaded(); return this.observedTypes.has(ctype.toLowerCase()); }

  fieldSpec(ctype: string, fieldPath: string): (ObservedField & { repeatableUnindexed: boolean }) | undefined {
    this.ensureLoaded();
    const type = this.observedTypes.get(ctype.toLowerCase());
    if (!type) return undefined;
    const exact = type.fields.find((field) => field.path === fieldPath);
    if (exact) return exact;
    const canonical = fieldPath.replace(/\[[^\]]*\]/g, "[]");
    const candidates = type.fields.filter((field) => field.canonicalPath === canonical);
    if (!candidates.length) return undefined;
    return candidates.reduce((best, field) => field.occurrences > best.occurrences ? field : best);
  }

  static async load(file = projectPath("generated/data-editor-schema.json"), observedFile = projectPath("generated/data-observed-schema.json")): Promise<DataSchemaRegistry> {
    const [editorEvidence, observedSchema] = await Promise.all([
      fs.readFile(file, "utf8").then((source) => JSON.parse(source) as DataEditorEvidence).catch(() => undefined),
      fs.readFile(observedFile, "utf8").then((source) => JSON.parse(source) as DataObservedSchema).catch(() => undefined),
    ]);
    return new DataSchemaRegistry(editorEvidence, observedSchema);
  }

  /** Defer the two large JSON reads/parses until a Data schema operation actually needs them. */
  static lazy(file = projectPath("generated/data-editor-schema.json"), observedFile = projectPath("generated/data-observed-schema.json")): DataSchemaRegistry {
    const registry = new DataSchemaRegistry();
    registry.loaded = false;
    registry.lazyFiles = { editor: file, observed: observedFile };
    return registry;
  }

  describe(ctype: string | undefined, objects: Array<DataObject & { layer?: string; provenance?: string[] }>) {
    this.ensureLoaded();
    const selected = ctype ? objects.filter((entry) => entry.ctype.toLowerCase() === ctype.toLowerCase()) : objects;
    const byType = new Map<string, { count: number; corpusCount: number; domains: Set<string>; parents: Set<string>; attributes: Map<string, { name: string; occurrences: number; examples: string[] }>; fields: Map<string, ObservedField & { repeatableUnindexed?: boolean }> }>();
    for (const observedType of this.observedSchema?.types ?? []) {
      if (ctype && observedType.ctype.toLowerCase() !== ctype.toLowerCase()) continue;
      byType.set(observedType.ctype, {
        count: 0,
        corpusCount: observedType.objects,
        domains: new Set(observedType.domain ? [observedType.domain] : []),
        parents: new Set(observedType.parents),
        attributes: new Map(observedType.attributes.map((attribute) => [attribute.name, attribute])),
        fields: new Map(observedType.fields.map((field) => [field.path, { ...field }])),
      });
    }
    for (const object of selected) {
      let record = byType.get(object.ctype);
      if (!record) {
        record = { count: 0, corpusCount: 0, domains: new Set(), parents: new Set(), attributes: new Map(), fields: new Map() };
        byType.set(object.ctype, record);
      }
      record.count++;
      if (object.domain) record.domains.add(object.domain);
      if (object.parent) record.parents.add(object.parent);
      for (const [name, value] of Object.entries(object.attrs)) {
        const attribute = record.attributes.get(name) ?? { name, occurrences: 0, examples: [] };
        attribute.occurrences++;
        if (!attribute.examples.includes(value) && attribute.examples.length < 8) attribute.examples.push(value);
        record.attributes.set(name, attribute);
      }
      const visit = (fields: DataObject["fields"]) => {
        for (const field of fields) {
          let observed = record!.fields.get(field.path);
          if (!observed) {
            observed = { path: field.path, name: field.name, occurrences: 0, carriers: [], indexes: [], examples: [], nested: false };
            record!.fields.set(field.path, observed);
          }
          observed.occurrences = Math.max(observed.occurrences, 0) + 1;
          observed.nested ||= field.children.length > 0;
          for (const carrier of Object.keys(field.attrs)) if (!observed.carriers.includes(carrier)) observed.carriers.push(carrier);
          if (field.index !== undefined && !observed.indexes.includes(field.index) && observed.indexes.length < 20) observed.indexes.push(field.index);
          for (const value of [field.value, field.link]) if (value !== undefined && !observed.examples.includes(value) && observed.examples.length < 5) observed.examples.push(value);
          visit(field.children);
        }
      };
      visit(object.fields);
    }
    return {
      requestedType: ctype,
      types: [...byType].sort(([left], [right]) => left.localeCompare(right)).map(([type, value]) => ({
        ctype: type, domains: [...value.domains], activeObjects: value.count, corpusObjects: value.corpusCount, observedObjects: Math.max(value.count, value.corpusCount), observedParents: [...value.parents].slice(0, 256),
        objectAttributes: [...value.attributes.values()].sort((left, right) => left.name.localeCompare(right.name)),
        properties: [...value.fields.values()].sort((left, right) => left.path.localeCompare(right.path)),
      })),
      universalRepresentation: {
        object: { element: "C*", identity: "id", inheritance: "parent", defaultTemplate: "default=1" },
        field: { scalar: "value", reference: "Link", arrayKey: "index", nesting: "child elements", extensions: "all unknown attributes/elements preserved" },
      },
      coverage: {
        structuralReadWrite: "100% of parsed C* entries and nested fields through generic operations",
        corpusSchema: this.observedSchema ? "100% of observed C-types, object attributes, field paths and carriers bundled" : "UNAVAILABLE",
        semanticTypes: "OBSERVED_BUNDLED_PLUS_DYNAMIC_SCHEMA",
        unknownFields: "SUPPORTED_PRESERVE_ONLY unless explicitly addressed",
        defaultsAndEnums: "UNKNOWN_NEEDS_RESEARCH when absent from observed corpus/Editor evidence",
      },
      evidence: ["local/dependency GameData XML", "native Catalog/value/Link/index representation", "public SC2GameData corpus"],
      editorEvidence: this.editorEvidence ? {
        build: this.editorEvidence.editor.fileVersion,
        sha256: this.editorEvidence.editor.sha256,
        matchingClassCandidates: ctype ? this.editorEvidence.catalogClassCandidates.filter((entry) => entry.name === ctype) : this.editorEvidence.catalogClassCandidates,
        qualifiedFieldCandidates: ctype ? this.editorEvidence.qualifiedFieldCandidates.filter((entry) => entry.owner === ctype) : this.editorEvidence.qualifiedFieldCandidates,
        linkTypes: this.editorEvidence.linkTypes,
        fieldTypes: this.editorEvidence.fieldTypes,
        runtimeApi: this.editorEvidence.runtimeApi,
        settingsCount: this.editorEvidence.editorSettings.length,
        localizationKeyCount: this.editorEvidence.localizationKeys.length,
        limitations: this.editorEvidence.limitations,
      } : { status: "UNAVAILABLE" },
      observedSchema: this.observedSchema ? { ...this.observedSchema.corpus, repeatableUnindexedFields: this.repeatableFields.size } : { status: "UNAVAILABLE" },
      declaredXsd: ctype
        ? this.declaredXsd.describe(ctype) ?? { status: "TYPE_NOT_DECLARED" }
        : this.declaredXsd.manifest()
          ? { source: this.declaredXsd.manifest()!.source, statistics: this.declaredXsd.manifest()!.statistics }
          : { status: "UNAVAILABLE_RUN_DATA_XSD_INDEX" },
    };
  }

  coverage() {
    this.ensureLoaded();
    const corpus = this.observedSchema?.corpus;
    const editor = this.editorEvidence;
    const corpusLossless = Boolean(corpus && corpus.parseDiagnostics === 0 && corpus.parseFailures === 0 && corpus.roundTripFailures === 0);
    const schemaComplete = Boolean(corpus && this.observedSchema && corpus.objectTypes === this.observedSchema.types.length && corpus.fieldPaths === this.observedSchema.types.reduce((sum, type) => sum + type.fields.length, 0));
    return {
      status: corpusLossless && schemaComplete && editor ? "PRE_L5_STATIC_EVIDENCE_COMPLETE" : "INCOMPLETE",
      preL5: {
        corpusLosslessCoveragePercent: corpusLossless ? 100 : 0,
        observedTypeRegistryCoveragePercent: schemaComplete ? 100 : 0,
        observedFieldRegistryCoveragePercent: schemaComplete ? 100 : 0,
        genericStructuralReadWrite: "ALL_PARSED_C_TYPES_FIELDS_ATTRIBUTES",
        corpus,
        repeatableUnindexedFields: this.repeatableFields.size,
        editorClassCandidates: editor?.catalogClassCandidates.length ?? 0,
        editorQualifiedFieldDescriptors: editor?.qualifiedFieldCandidates.length ?? 0,
        declaredXsd: this.declaredXsd.manifest()?.statistics ?? "UNAVAILABLE_RUN_DATA_XSD_INDEX",
      },
      gates: {
        L1Syntax: corpusLossless ? "PASS" : "FAIL",
        L2StructuralSchema: schemaComplete ? "PASS" : "FAIL",
        L3References: "EXACT_PARENT_LINK_PLUS_HIGH_CONFIDENCE_OBSERVED_VALUE_REFERENCE_DIAGNOSTICS; ACTIVE_DEPENDENCIES_REQUIRED",
        L4Semantic: "OBSERVED_TYPES_ENUM_CANDIDATES_RANGES_AND_DEFAULT_CANDIDATES_BUNDLED; HIDDEN_EDITOR_RULES_UNTESTED",
        L5SC2Editor: "UNTESTED",
        L6Runtime: "UNTESTED",
      },
      notClaimed: ["complete hidden Editor enums/defaults/illegal combinations", "SC2Editor acceptance", "game runtime behavior"],
    };
  }
}
