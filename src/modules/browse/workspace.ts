import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { internalWorkspaceDirectory } from "../../core/discoveryPaths.js";
import { scanXml } from "../../core/xmlScanner.js";
import { DataWorkspace } from "../data/workspace.js";
import { DataDocument } from "../data/document.js";
import type { DataField, DataObject } from "../data/types.js";
import { StringTableDocument } from "../text/stringTable.js";
import type {
  BrowseAvailability,
  BrowseEntry,
  BrowseIndexSnapshot,
  BrowseReference,
  BrowseSearchQuery,
  BrowseSearchResult,
  FlattenedDataField,
  PhysicalAssetEntry,
} from "./types.js";

const SKIP = new Set(["node_modules", "dist", "release", ".git", ".svn"]);
const INDEXABLE = /(?:^DocumentInfo$|\.xml$|Strings\.txt$|Assets\.txt$|\.(?:m3|m3a|dds|tga|png|jpg|jpeg|ogg|wav|mp3|flac|mp4|ogv|webm)$)/i;
const PHYSICAL_ASSET = /\.(?:m3|m3a|dds|tga|png|jpg|jpeg|ogg|wav|mp3|flac|mp4|ogv|webm)$/i;
const ASSET_VALUE = /(?:^|[\\/])[^\r\n<>"']+\.(?:m3|m3a|dds|tga|png|jpg|jpeg|ogg|wav|mp3|flac|mp4|ogv|webm)$/i;

interface RootSpec {
  path: string;
  sourceLayer: BrowseEntry["sourceLayer"];
  dependency: string;
  availability: BrowseAvailability;
}

interface IndexedText {
  locale: string;
  key: string;
  value: string;
  file: string;
  root: RootSpec;
}

function normalized(value: string): string { return value.replaceAll("\\", "/"); }
function tokenize(value: string): string[] { return normalized(value).toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function flatten(fields: DataField[]): FlattenedDataField[] {
  const output: FlattenedDataField[] = [];
  for (const field of fields) {
    const fieldPath = field.path;
    output.push({ field, path: fieldPath, value: field.value, link: field.link });
    output.push(...flatten(field.children));
  }
  return output;
}

function assetKind(value: string): PhysicalAssetEntry["kind"] {
  if (/\.(?:m3|m3a)$/i.test(value)) return "Model";
  if (/\.(?:dds|tga|png|jpg|jpeg)$/i.test(value)) return /icon/i.test(value) ? "Icon" : "Texture";
  if (/\.(?:ogg|wav|mp3|flac)$/i.test(value)) return "Sound";
  if (/\.(?:mp4|ogv|webm)$/i.test(value)) return "Animation";
  return "Asset";
}

function catalogForField(field: string): string | undefined {
  const name = field.replace(/\[[^\]]+\]/g, "").split(".").at(-1)?.toLowerCase() ?? "";
  if (/^(?:model|modelbuild|modeldeath|modelswap|portraitmodel|modelmaterial)$/.test(name)) return "Model";
  if (/^(?:unit|unitname|unitlink|spawnunit)$/.test(name)) return "Unit";
  if (/actor/.test(name)) return "Actor";
  if (/texture/.test(name)) return "Texture";
  if (/sound/.test(name)) return "Sound";
  if (/button/.test(name)) return "Button";
  if (/weapon/.test(name)) return "Weapon";
  if (/effect/.test(name)) return "Effect";
  if (/behavio[u]?r/.test(name)) return "Behavior";
  if (/validator/.test(name)) return "Validator";
  return undefined;
}

function placeableFor(object: DataObject) {
  if (object.ctype === "CUnit") return {
    kind: "Unit" as const,
    objectElement: "ObjectUnit" as const,
    idAttribute: "UnitType" as const,
    id: object.id!,
    evidence: "INFERRED" as const,
  };
  if (object.ctype === "CActorDoodad") return {
    kind: "Doodad" as const,
    objectElement: "ObjectDoodad" as const,
    idAttribute: "Type" as const,
    id: object.id!,
    evidence: "INFERRED" as const,
  };
  return undefined;
}

function localeFrom(file: string): string {
  const match = normalized(file).match(/(?:^|\/)([a-z]{2})([a-z]{2})\.sc2data\/LocalizedData\//i);
  return match ? `${match[1]!.toLowerCase()}${match[2]!.toUpperCase()}` : "und";
}

function dependencyFromPath(root: string): string {
  const segments = normalized(root).split("/").filter(Boolean);
  return segments.reverse().find((segment) => /\.SC2(?:Mod|Map|Campaign|Data)$/i.test(segment)) ?? path.basename(root);
}

function objectCatalogType(object: DataObject): string {
  if (object.domain) return object.domain;
  return object.ctype.replace(/^C/, "").replace(/(?:Legacy|Unit|Model)$/, (value) => value === "Unit" || value === "Model" ? value : "");
}

function nameKeys(object: DataObject): string[] {
  if (!object.id) return [];
  const catalog = objectCatalogType(object);
  return unique([
    `${catalog}/Name/${object.id}`,
    `${object.ctype.replace(/^C/, "")}/Name/${object.id}`,
    `Unit/Name/${object.id}`,
    `Actor/Name/${object.id}`,
    `Model/Name/${object.id}`,
  ]);
}

function rootForObject(object: { layer: string; provenance: string[] }, roots: RootSpec[]): RootSpec {
  if (object.layer === "workspace") return roots[0]!;
  const hint = object.provenance[0]?.toLowerCase();
  return roots.find((root) => root.sourceLayer !== "workspace" && (root.dependency.toLowerCase() === hint || path.basename(root.path).toLowerCase() === hint))
    ?? roots.find((root) => root.sourceLayer === "dependency")
    ?? roots.find((root) => root.sourceLayer === "installed")
    ?? roots[0]!;
}

export class BrowseWorkspace {
  private snapshot?: BrowseIndexSnapshot;
  private readonly roots: RootSpec[];
  private readonly indexedData: DataWorkspace;
  private missingDependencies: string[] = [];

  constructor(readonly workspace: Workspace, readonly data: DataWorkspace, installedRoots = (process.env.SC2_BROWSE_INSTALLED_ROOTS ?? "").split(path.delimiter).filter(Boolean)) {
    const workspaceRoot: RootSpec = { path: workspace.root, sourceLayer: "workspace", dependency: "current-map", availability: "MAP_LOCAL" };
    const dependencyRoots = data.extraRoots.map((entry): RootSpec => ({ path: entry, sourceLayer: "dependency", dependency: dependencyFromPath(entry), availability: "INSTALLED_BUT_NOT_DECLARED" }));
    const installed = installedRoots.map((entry): RootSpec => ({ path: path.resolve(entry), sourceLayer: "installed", dependency: dependencyFromPath(entry), availability: "INSTALLED_BUT_NOT_DECLARED" }));
    this.roots = [workspaceRoot, ...dependencyRoots, ...installed].filter((entry, index, all) => all.findIndex((candidate) => candidate.path === entry.path) === index);
    this.indexedData = new DataWorkspace(workspace, data.schema, [...dependencyRoots, ...installed].map((entry) => entry.path));
  }

  private async files(): Promise<BrowseIndexSnapshot["files"]> {
    const output: BrowseIndexSnapshot["files"] = [];
    const visit = async (root: RootSpec, directory: string): Promise<void> => {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.isDirectory() && (SKIP.has(entry.name) || internalWorkspaceDirectory(entry.name))) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) { await visit(root, absolute); continue; }
        if (!INDEXABLE.test(entry.name)) continue;
        const stat = await fs.stat(absolute);
        if (stat.size > 64 * 1024 * 1024) continue;
        output.push({ path: absolute, size: stat.size, mtimeMs: stat.mtimeMs, sourceLayer: root.sourceLayer, dependency: root.dependency });
      }
    };
    for (const root of this.roots) await visit(root, root.path);
    return output.sort((a, b) => a.path.localeCompare(b.path));
  }

  private fingerprint(files: BrowseIndexSnapshot["files"]): string {
    return createHash("sha256").update(files.map((file) => `${file.path}\0${file.size}\0${file.mtimeMs}`).join("\n")).digest("hex");
  }

  private async resolveDependencyDeclarations(): Promise<string[]> {
    const warnings: string[] = []; this.missingDependencies = [];
    for (const root of this.roots.slice(1)) root.availability = "INSTALLED_BUT_NOT_DECLARED";
    const queue = [this.roots[0]!]; const visited = new Set<string>();
    while (queue.length) {
      const root = queue.shift()!; if (visited.has(root.path)) continue; visited.add(root.path);
      const source = root.sourceLayer === "workspace" ? (await this.workspace.readRaw("DocumentInfo")).text : await this.workspace.readDependency(path.join(root.path, "DocumentInfo"), true);
      const parsed = scanXml(source);
      if (parsed.diagnostics.some((issue) => issue.severity === "error")) { warnings.push(`Malformed DocumentInfo: ${root.path}`); continue; }
      for (const node of parsed.nodes.filter((entry) => entry.tag === "Dependencies")) for (const childId of node.childIds) {
        const value = parsed.nodes[childId]!;
        const content = source.slice(value.startTagEnd, value.endTagStart).trim();
        const file = content.match(/(?:^|,)file:([^,]+)/i)?.[1];
        if (!file) { if (content) warnings.push(`Unresolved remote dependency: ${content}`); continue; }
        const name = normalized(file).split("/").at(-1)!.toLowerCase();
        const matches = this.roots.slice(1).filter((candidate) => candidate.dependency.toLowerCase() === name);
        if (matches.length === 1) { matches[0]!.availability = "AVAILABLE_THROUGH_DEPENDENCY"; queue.push(matches[0]!); }
        else { this.missingDependencies.push(file); warnings.push(`${matches.length ? "Ambiguous" : "Missing"} dependency: ${file}`); }
      }
    }
    return warnings;
  }

  private async textIndex(files: BrowseIndexSnapshot["files"]): Promise<IndexedText[]> {
    const output: IndexedText[] = [];
    for (const file of files.filter((entry) => /Strings\.txt$/i.test(entry.path))) {
      const root = this.roots.find((entry) => file.path === entry.path || file.path.startsWith(`${entry.path}${path.sep}`)) ?? this.roots[0]!;
      const source = root.sourceLayer === "workspace" ? (await this.workspace.readRaw(normalized(path.relative(this.workspace.root, file.path)))).text : await this.workspace.readDependency(file.path);
      const document = new StringTableDocument(source);
      for (const entry of document.list(undefined, Number.MAX_SAFE_INTEGER)) output.push({ locale: localeFrom(file.path), key: entry.key, value: entry.value, file: file.path, root });
    }
    return output;
  }

  async index(force = false): Promise<BrowseIndexSnapshot> {
    force ||= this.workspace.trackingReads;
    const files = await this.files();
    const draftHashes = await Promise.all(files.filter((file) => file.sourceLayer === "workspace" && this.workspace.hasDraft(normalized(path.relative(this.workspace.root, file.path)))).map(async (file) => (await this.workspace.diff(normalized(path.relative(this.workspace.root, file.path)))).afterSha256));
    const fingerprint = createHash("sha256").update(this.fingerprint(files) + draftHashes.join(":" )).digest("hex");
    if (!force && this.snapshot?.fingerprint === fingerprint) return this.snapshot;
    const warnings = await this.resolveDependencyDeclarations();
    const text = await this.textIndex(files);
    const textByKey = new Map<string, IndexedText[]>();
    for (const label of text) textByKey.set(label.key, [...(textByKey.get(label.key) ?? []), label]);
    const context = await this.indexedData.context({ includeRaw: false, includeInherited: true, includeDependencies: true, includeReferences: true, limit: 500_000 });
    type ContextObject = (typeof context.objects)[number];
    const entries: BrowseEntry[] = context.objects.flatMap((object: ContextObject): BrowseEntry[] => {
      if (!object.id) return [];
      const root = rootForObject(object, this.roots);
      const catalogType = objectCatalogType(object);
      const candidates = nameKeys(object);
      const labels = candidates.flatMap((key) => textByKey.get(key) ?? []).sort((a, b) => Number(a.root.path === root.path) - Number(b.root.path === root.path));
      const localizedNames = Object.fromEntries(labels.map((entry) => [entry.locale, entry.value]));
      const fields = flatten(object.fields);
      const effectiveFields = object.effective?.fields ? Object.values(object.effective.fields) : [];
      const assetPaths = unique([...fields, ...effectiveFields].flatMap((field) => {
        const attributes = "field" in field ? field.field.attrs : field.attrs;
        const values = [field.value, field.link, ...Object.values(attributes ?? {})].filter((value): value is string => typeof value === "string");
        return values.filter((value) => ASSET_VALUE.test(value)).map(normalized);
      }));
      const outgoing: BrowseReference[] = [];
      if (object.attrs.unitName) outgoing.push({ direction: "outgoing", field: "@unitName", catalogType: "Unit", id: object.attrs.unitName, source: "typed-field", evidence: "OBSERVED_CATALOG_XML" });
      if (object.parent) outgoing.push({ direction: "outgoing", field: "@parent", catalogType, id: object.parent, source: "parent", evidence: "OBSERVED_CATALOG_XML" });
      for (const field of fields) {
        const id = field.link ?? field.value;
        if (!id || ASSET_VALUE.test(id)) continue;
        const target = catalogForField(field.path);
        if (field.link || target) outgoing.push({ direction: "outgoing", field: field.path, catalogType: target, id, source: field.link ? "Link" : "typed-field", evidence: field.link ? "OBSERVED_CATALOG_XML" : "INFERRED" });
      }
      for (const field of effectiveFields) {
        const id = field.link ?? field.value; const target = catalogForField(field.path);
        if (id && !ASSET_VALUE.test(id) && (field.link || target) && !outgoing.some((ref) => ref.field === field.path && ref.id === id)) outgoing.push({ direction: "outgoing", field: field.path, catalogType: target, id, source: field.link ? "Link" : "typed-field", evidence: "INFERRED" });
      }
      const placeableRepresentation = placeableFor(object);
      return [{
        key: `${catalogType}:${object.id}:${root.sourceLayer}:${root.dependency}:${object.file}`,
        id: object.id,
        ctype: object.ctype,
        catalogType,
        objectKind: /doodad/i.test(object.ctype) ? "Doodad" : catalogType,
        displayName: localizedNames.enUS ?? Object.values(localizedNames)[0] ?? object.id,
        localizedNames,
        textKeys: labels.map((entry) => entry.key),
        file: object.file,
        sourceLayer: root.sourceLayer,
        dependency: root.dependency,
        availability: root.availability,engineActive:object.engineActive,activationMode:object.activationMode,
        ...(object.parent ? { parent: object.parent } : {}),
        assetPaths,
        outgoing,
        incoming: [],
        placeable: Boolean(placeableRepresentation),
        ...(placeableRepresentation ? { placeableRepresentation } : {}),
        evidence: unique(["OBSERVED_CATALOG_XML" as const, ...(labels.length ? ["OBSERVED_STRING_TABLE" as const] : []), ...(assetPaths.length ? ["OBSERVED_ASSET_PATH" as const] : []), ...(placeableRepresentation ? ["INFERRED" as const] : [])]),
        warnings: root.availability === "INSTALLED_BUT_NOT_DECLARED" ? [`Dependency '${root.dependency}' is installed but not declared by the current map.`] : [],
        definition: object,
        ...(object.effective ? { effective: object.effective } : {}),
      }];
    });

    const byId = new Map<string, BrowseEntry[]>();
    for (const entry of entries) byId.set(entry.id.toLowerCase(), [...(byId.get(entry.id.toLowerCase()) ?? []), entry]);
    for (const source of entries) for (const reference of source.outgoing) {
      const targets = (byId.get(reference.id.toLowerCase()) ?? []).filter((candidate) => !reference.catalogType || candidate.catalogType.toLowerCase() === reference.catalogType.toLowerCase());
      for (const target of targets) target.incoming.push({ ...reference, direction: "incoming", id: source.id, catalogType: source.catalogType });
    }
    // Two bounded joins expose Model assets on their Actor and Unit, without
    // traversing arbitrary Effect graphs or confusing references with physical files.
    for (const actor of entries.filter((entry) => entry.catalogType === "Actor")) {
      const models = actor.outgoing.filter((ref) => ref.catalogType === "Model").flatMap((ref) => byId.get(ref.id.toLowerCase()) ?? []).filter((entry) => entry.catalogType === "Model");
      actor.assetPaths = unique([...actor.assetPaths, ...models.flatMap((model) => model.assetPaths)]);
    }
    for (const unit of entries.filter((entry) => entry.catalogType === "Unit")) {
      const actors = unit.incoming.filter((ref) => ref.catalogType === "Actor").flatMap((ref) => byId.get(ref.id.toLowerCase()) ?? []).filter((entry) => entry.catalogType === "Actor");
      unit.assetPaths = unique([...unit.assetPaths, ...actors.flatMap((actor) => actor.assetPaths)]);
    }

    const physical = files.filter((file) => PHYSICAL_ASSET.test(file.path)).map((file): PhysicalAssetEntry => {
      const root = this.roots.find((entry) => file.path === entry.path || file.path.startsWith(`${entry.path}${path.sep}`)) ?? this.roots[0]!;
      const relative = normalized(path.relative(root.path, file.path));
      return { path: relative, file: relative, kind: assetKind(relative), sourceLayer: root.sourceLayer, dependency: root.dependency, availability: root.availability, referencedBy: [], evidence: ["OBSERVED_ASSET_PATH"] };
    });
    const referenced = entries.flatMap((entry) => entry.assetPaths.map((assetPath): PhysicalAssetEntry => ({
      path: assetPath, file: entry.file, kind: assetKind(assetPath), sourceLayer: entry.sourceLayer, dependency: entry.dependency, availability: entry.availability,
      referencedBy: [{ catalogType: entry.catalogType, id: entry.id, field: flatten(entry.definition.fields).find((field) => [field.value, field.link].includes(assetPath))?.path ?? "resolved-field" }],
      evidence: ["OBSERVED_CATALOG_XML", "OBSERVED_ASSET_PATH"],
    })));
    const assets = new Map<string, PhysicalAssetEntry>();
    for (const asset of [...physical, ...referenced]) {
      const key = `${asset.sourceLayer}:${asset.dependency}:${asset.path}`.toLowerCase();
      const prior = assets.get(key);
      assets.set(key, prior ? { ...prior, referencedBy: unique([...prior.referencedBy, ...asset.referencedBy].map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry) as PhysicalAssetEntry["referencedBy"][number]), evidence: unique([...prior.evidence, ...asset.evidence]) } : asset);
    }
    this.snapshot = { fingerprint, builtAt: new Date().toISOString(), entries, assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path)), files, warnings };
    return this.snapshot;
  }

  async refresh() { this.snapshot = undefined; return this.status(await this.index(true)); }

  async status(snapshot?: BrowseIndexSnapshot) {
    const index = snapshot ?? await this.index();
    return {
      fingerprint: index.fingerprint,
      builtAt: index.builtAt,
      roots: this.roots,
      files: index.files.length,
      catalogObjects: index.entries.length,
      physicalAndReferencedAssets: index.assets.length,
      placeable: index.entries.filter((entry) => entry.placeable).length,
      catalogTypes: unique(index.entries.map((entry) => entry.catalogType)).sort(),
      cached: index === this.snapshot,
      warnings: index.warnings,
    };
  }

  async search(query: BrowseSearchQuery): Promise<{ total: number; offset: number; limit: number; results: BrowseSearchResult[] }> {
    const index = await this.index();
    const needle = query.query?.trim().toLowerCase() ?? "";
    const terms = tokenize(needle);
    const ids = new Set((query.ids ?? []).map((value) => value.toLowerCase()));
    const scored = index.entries.flatMap((entry): BrowseSearchResult[] => {
      if (ids.size && !ids.has(entry.id.toLowerCase())) return [];
      if (query.catalogType && entry.catalogType.toLowerCase() !== query.catalogType.toLowerCase() && entry.ctype.toLowerCase() !== query.catalogType.toLowerCase()) return [];
      if (query.objectKind && entry.objectKind.toLowerCase() !== query.objectKind.toLowerCase()) return [];
      if (query.dependency && !entry.dependency.toLowerCase().includes(query.dependency.toLowerCase())) return [];
      if (query.sourceLayer && entry.sourceLayer !== query.sourceLayer) return [];
      if (query.availability && entry.availability !== query.availability) return [];
      if (query.placeable !== undefined && entry.placeable !== query.placeable) return [];
      if (query.hasModel !== undefined && entry.assetPaths.some((value) => /\.(?:m3|m3a)$/i.test(value)) !== query.hasModel) return [];
      if (query.hasTexture !== undefined && entry.assetPaths.some((value) => /\.(?:dds|tga|png|jpg|jpeg)$/i.test(value)) !== query.hasTexture) return [];
      const localeNames = query.locale ? Object.entries(entry.localizedNames).filter(([locale]) => locale.toLowerCase() === query.locale!.toLowerCase()).map(([, value]) => value) : Object.values(entry.localizedNames);
      const haystacks = [entry.id, entry.ctype, entry.catalogType, entry.displayName, entry.file, ...entry.textKeys, ...localeNames, ...entry.assetPaths, ...entry.outgoing.map((reference) => reference.id)];
      let score = ids.has(entry.id.toLowerCase()) ? 1200 : 0;
      const matchedBy: string[] = ids.has(entry.id.toLowerCase()) ? ["requested-id"] : [];
      if (needle) {
        for (const [indexValue, value] of haystacks.entries()) {
          const lower = value.toLowerCase();
          if (lower === needle) { score = Math.max(score, indexValue === 0 ? 1000 : 900); matchedBy.push(indexValue === 0 ? "exact-id" : "exact-field"); }
          else if (lower.includes(needle)) { score = Math.max(score, indexValue === 0 ? 780 : 620); matchedBy.push("substring"); }
          const valueTokens = tokenize(lower);
          const hits = terms.filter((term) => valueTokens.some((token) => token === term || token.includes(term))).length;
          if (hits) { score += hits * 55; matchedBy.push("tokens"); }
        }
      } else score = Math.max(score, 1);
      if (needle && score === 0) return [];
      if (entry.placeable) score += 10;
      const confidence = Math.min(1, 0.45 + (entry.evidence.includes("OBSERVED_CATALOG_XML") ? 0.25 : 0) + (entry.evidence.includes("OBSERVED_STRING_TABLE") ? 0.15 : 0) + (entry.placeable ? 0.15 : 0));
      return [{ key: entry.key, id: entry.id, ctype: entry.ctype, catalogType: entry.catalogType, objectKind: entry.objectKind, displayName: entry.displayName, source: entry.file, sourceLayer: entry.sourceLayer, dependency: entry.dependency, availability: entry.availability, assetPaths: entry.assetPaths, related: entry.outgoing.slice(0, query.compact === false ? 50 : 8).map((reference) => ({ catalogType: reference.catalogType, id: reference.id })), placeable: entry.placeable, ...(entry.placeableRepresentation ? { placeableRepresentation: entry.placeableRepresentation } : {}), score, confidence, matchedBy: unique(matchedBy), evidence: entry.evidence, warnings: entry.warnings }];
    }).sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.id.localeCompare(b.id) || a.key.localeCompare(b.key));
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(1, Math.min(query.limit ?? 25, 200));
    return { total: scored.length, offset, limit, results: scored.slice(offset, offset + limit) };
  }

  async get(selector: { key?: string; id?: string; catalogType?: string; dependency?: string; includeRaw?: boolean }) {
    const index = await this.index();
    const entries = index.entries.filter((entry) =>
      (!selector.key || entry.key === selector.key) &&
      (!selector.id || entry.id.toLowerCase() === selector.id.toLowerCase()) &&
      (!selector.catalogType || entry.catalogType.toLowerCase() === selector.catalogType.toLowerCase() || entry.ctype.toLowerCase() === selector.catalogType.toLowerCase()) &&
      (!selector.dependency || entry.dependency.toLowerCase() === selector.dependency.toLowerCase()));
    if (!entries.length) throw new Error(`Browse object not found: ${selector.key ?? `${selector.catalogType ?? "*"}:${selector.id ?? "*"}`}`);
    const definitions = await Promise.all(entries.map(async (entry) => {
      let rawDefinition: string | undefined;
      if (selector.includeRaw) {
        const root = this.roots.find((candidate) => candidate.dependency === entry.dependency && candidate.sourceLayer === entry.sourceLayer)!;
        const source = entry.sourceLayer === "workspace" ? (await this.workspace.readRaw(entry.file)).text : await this.workspace.readDependency(path.join(root.path, entry.file));
        rawDefinition = new DataDocument(source, entry.file).objects(true).find((object) => object.id === entry.id && object.ctype === entry.ctype)?.rawSource;
      }
      const own = new Set(flatten(entry.definition.fields).map((field) => field.path));
      const ancestorPaths = new Set((entry.effective?.templateChain ?? []).slice(0, -1).flatMap((ancestor) => index.entries.filter((candidate) => candidate.id === ancestor.id && candidate.ctype === ancestor.ctype && candidate.file === ancestor.file).flatMap((candidate) => flatten(candidate.definition.fields).map((field) => field.path))));
      return { ...entry, ...(rawDefinition ? { rawDefinition } : {}),
        sourceLayers: index.entries.filter((candidate) => candidate.id === entry.id && candidate.catalogType === entry.catalogType).map((candidate) => ({ key: candidate.key, layer: candidate.sourceLayer, dependency: candidate.dependency, file: candidate.file })),
        fieldProvenance: Object.values(entry.effective?.fields ?? {}).map((field) => ({ path: field.path, declaredBy: field.declaredBy, file: field.file, inherited: !own.has(field.path), overridden: own.has(field.path) && ancestorPaths.has(field.path) })),
        resolutionLimitations: ["Effective fields use the current Data MCP parent-chain resolver; engine defaults, ambiguous inherited sources and duplicate-ID layer merges are not reconstructed."],
      };
    }));
    return { ambiguous: entries.length > 1, definitions };
  }

  async resolve(selector: { key?: string; id?: string; catalogType?: string; query?: string; dependency?: string }) {
    if (!selector.key && !selector.id && !selector.query) throw new Error("browse.resolve requires key, id or query");
    if (!selector.key && !selector.id && selector.query) {
      const searched = await this.search({ query: selector.query, catalogType: selector.catalogType, dependency: selector.dependency, limit: 10 });
      const exact = searched.results.filter((entry) => entry.id.toLowerCase() === selector.query!.toLowerCase());
      const choices = exact.length ? exact : searched.results;
      if (choices.length !== 1) return { resolved: false, reason: choices.length ? "AMBIGUOUS_QUERY" : "NO_MATCH", candidates: searched.results };
      selector = { key: choices[0]!.key };
    }
    const result = await this.get(selector);
    if (result.definitions.length !== 1) return { resolved: false, reason: "AMBIGUOUS_ID_ACROSS_LAYERS", candidates: result.definitions.map((entry) => ({ key: entry.key, id: entry.id, catalogType: entry.catalogType, dependency: entry.dependency, sourceLayer: entry.sourceLayer })) };
    const entry = result.definitions[0]!;
    return { resolved: true, object: entry, placeableRepresentation: entry.placeableRepresentation, dependencyReady: entry.engineActive!==false && (entry.availability === "MAP_LOCAL" || entry.availability === "AVAILABLE_THROUGH_DEPENDENCY"), engineActivityVerified:entry.engineActive===true, warnings: entry.warnings };
  }

  async related(selector: { key?: string; id?: string; catalogType?: string; direction?: "incoming" | "outgoing" | "both"; depth?: number; limit?: number }) {
    const startResult = await this.get(selector);
    const index = await this.index();
    const depth = Math.max(1, Math.min(selector.depth ?? 3, 8));
    const limit = Math.max(1, Math.min(selector.limit ?? 100, 500));
    const direction = selector.direction ?? "both";
    const queue: Array<{ entry: BrowseEntry; depth: number }> = startResult.definitions.slice(0, limit).map((entry) => ({ entry, depth: 0 }));
    const visited = new Set(queue.map((item) => item.entry.key));
    const nodes = queue.map((item) => item.entry);
    const edges: Array<{ from: string; to: string; field: string; evidence: string }> = [];
    while (queue.length && nodes.length < limit) {
      const current = queue.shift()!;
      if (current.depth >= depth) continue;
      const refs = [...(direction !== "incoming" ? current.entry.outgoing : []), ...(direction !== "outgoing" ? current.entry.incoming : [])];
      for (const ref of refs) {
        const targets = index.entries.filter((entry) => entry.id.toLowerCase() === ref.id.toLowerCase() && (!ref.catalogType || entry.catalogType.toLowerCase() === ref.catalogType.toLowerCase()));
        for (const target of targets) {
          if (edges.length < limit * 8) edges.push({ from: ref.direction === "incoming" ? target.key : current.entry.key, to: ref.direction === "incoming" ? current.entry.key : target.key, field: ref.field, evidence: ref.evidence });
          if (nodes.length >= limit) break;
          if (!visited.has(target.key)) { visited.add(target.key); nodes.push(target); queue.push({ entry: target, depth: current.depth + 1 }); }
        }
      }
    }
    return { roots: startResult.definitions.map((entry) => entry.key), nodes: nodes.map((entry) => ({ key: entry.key, id: entry.id, catalogType: entry.catalogType, ctype: entry.ctype, displayName: entry.displayName, assets: entry.assetPaths, placeable: entry.placeable })), edges, truncated: nodes.length >= limit };
  }

  async dependencies() {
    const index = await this.index();
    return { missing: this.missingDependencies.map((dependency) => ({ dependency, availability: "MISSING_DEPENDENCY" })), warnings: index.warnings, roots: this.roots.map((root) => ({ ...root, indexedFiles: index.files.filter((file) => file.sourceLayer === root.sourceLayer && file.dependency === root.dependency).length, catalogObjects: index.entries.filter((entry) => entry.sourceLayer === root.sourceLayer && entry.dependency === root.dependency).length })) };
  }

  async catalogs() {
    const entries = (await this.index()).entries;
    return { catalogs: unique(entries.map((entry) => entry.catalogType)).sort().map((catalogType) => ({ catalogType, count: entries.filter((entry) => entry.catalogType === catalogType).length, placeable: entries.filter((entry) => entry.catalogType === catalogType && entry.placeable).length })) };
  }

  async assets(args: { query?: string; kind?: PhysicalAssetEntry["kind"]; dependency?: string; limit?: number; offset?: number } = {}) {
    const needle = args.query?.toLowerCase();
    const all = (await this.index()).assets.filter((asset) => (!needle || asset.path.toLowerCase().includes(needle)) && (!args.kind || asset.kind === args.kind) && (!args.dependency || asset.dependency.toLowerCase().includes(args.dependency.toLowerCase())));
    const offset = Math.max(0, args.offset ?? 0); const limit = Math.max(1, Math.min(args.limit ?? 25, 200));
    return { total: all.length, offset, limit, assets: all.slice(offset, offset + limit) };
  }

  async usage(selector: { key?: string; id?: string; catalogType?: string }) {
    const definitions = (await this.get(selector)).definitions;
    const index = await this.index();
    return { definitions: definitions.map((entry) => ({ key: entry.key, id: entry.id, catalogType: entry.catalogType, incoming: entry.incoming, files: unique(index.entries.filter((source) => source.outgoing.some((ref) => ref.id === entry.id && (!ref.catalogType || ref.catalogType === entry.catalogType))).map((source) => source.file)), scope: "indexed definitions only; packed maps and Galaxy usage are not scanned" })) };
  }

  async validate() {
    const index = await this.index();
    const duplicateKeys = new Map<string, BrowseEntry[]>();
    for (const entry of index.entries) {
      const key = `${entry.catalogType}:${entry.id}`.toLowerCase();
      duplicateKeys.set(key, [...(duplicateKeys.get(key) ?? []), entry]);
    }
    const unresolved = index.entries.flatMap((entry) => entry.outgoing.flatMap((reference) => index.entries.some((candidate) => candidate.id.toLowerCase() === reference.id.toLowerCase() && (!reference.catalogType || candidate.catalogType.toLowerCase() === reference.catalogType.toLowerCase())) ? [] : [{ source: entry.key, field: reference.field, target: `${reference.catalogType ?? "?"}:${reference.id}`, evidence: reference.evidence }]));
    return {
      valid: true,
      indexFingerprint: index.fingerprint,
      entries: index.entries.length,
      duplicatesAcrossLayers: [...duplicateKeys.entries()].filter(([, entries]) => entries.length > 1).map(([key, entries]) => ({ key, definitions: entries.map((entry) => ({ sourceLayer: entry.sourceLayer, dependency: entry.dependency, file: entry.file })) })),
      unresolvedReferences: unresolved.slice(0, 500),
      unresolvedCount: unresolved.length,
      warnings: index.warnings,
      limitation: "Unresolved typed-field references may include scalar tokens. Runtime availability is not claimed without an editor/game probe.",
    };
  }
}
