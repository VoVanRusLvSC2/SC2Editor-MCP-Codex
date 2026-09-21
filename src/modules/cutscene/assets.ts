import { promises as fs } from "node:fs";
import path from "node:path";
import { scanXml } from "../../core/xmlScanner.js";
import { internalWorkspaceDirectory } from "../../core/discoveryPaths.js";

export type CinematicAssetSource = "catalog" | "cutscene-observed" | "workspace-file" | "asset-manifest";

export interface CinematicAssetReference {
  catalog: string;
  id?: string;
  path?: string;
  property?: string;
}

export interface CinematicAssetEntry {
  catalog: string;
  nativeClass?: string;
  id: string;
  file: string;
  parent?: string;
  path?: string;
  dependencies: string[];
  fields?: Record<string, string[]>;
  references?: CinematicAssetReference[];
  animations?: string[];
  attachmentPoints?: string[];
  source: CinematicAssetSource;
  confidence: "catalog-exact" | "binary-exact" | "cutscene-observed" | "path-observed";
  cutsceneUse?: { nativeType: string; property: string; value: string };
  score?: number;
}

export interface AnimationInventory {
  animations: string[];
  attachmentPoints: string[];
  complete: boolean;
  sources: Array<{ file: string; source: CinematicAssetSource; complete: boolean }>;
  resolvedAssets: Array<{ catalog: string; id: string; path?: string }>;
  note?: string;
}

export interface AssetResolution {
  requested: { catalog: string; id: string };
  definitions: CinematicAssetEntry[];
  edges: Array<{ from: string; property?: string; to: string }>;
  unresolved: Array<{ catalog: string; id: string }>;
  placementCandidates: Array<{ catalog: string; id: string; cutsceneUse: NonNullable<CinematicAssetEntry["cutsceneUse"]> }>;
}

const XML_EXTENSIONS = /\.(?:xml|SC2Data)$/i;
const CUTSCENE_EXTENSIONS = /\.(?:SC2Cutscene|StormCutscene)$/i;
const MODEL_EXTENSIONS = /\.(?:m3|m3a)$/i;
const LOOSE_ASSET_EXTENSIONS = /\.(?:dds|tga|png|jpg|jpeg|ogg|wav|mp3|flac|mp4|ogv|webm)$/i;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "release", ".git", ".svn"]);

export class CutsceneAssetIndex {
  readonly roots: string[];
  private entries?: CinematicAssetEntry[];
  private scannedFiles = 0;
  private warnings: string[] = [];

  constructor(root: string | string[], extraRoots: string[] = assetRootsFromEnvironment()) {
    const roots = Array.isArray(root) ? root : [root];
    this.roots = [...new Set([...roots, ...extraRoots].filter(Boolean).map((entry) => path.resolve(entry)))];
  }

  async refresh(): Promise<Record<string, unknown>> {
    this.entries = undefined;
    this.scannedFiles = 0;
    this.warnings = [];
    const entries = await this.build();
    return this.status(entries);
  }

  async status(prebuilt?: CinematicAssetEntry[]): Promise<Record<string, unknown>> {
    const entries = prebuilt ?? await this.build();
    const catalogs = [...new Set(entries.map((entry) => entry.catalog))].sort();
    return {
      roots: this.roots,
      scannedFiles: this.scannedFiles,
      assets: entries.length,
      catalogs,
      sourceCounts: Object.fromEntries([...new Set(entries.map((entry) => entry.source))].map((source) => [source, entries.filter((entry) => entry.source === source).length])),
      modelsWithExactAnimationMetadata: entries.filter((entry) => entry.confidence === "binary-exact" && entry.animations !== undefined).length,
      warnings: this.warnings,
      configuration: "Workspace root is always indexed. Add extracted SC2/Core/campaign/mod directories with SC2_ASSET_ROOTS (OS path separator delimited).",
    };
  }

  private async build(): Promise<CinematicAssetEntry[]> {
    if (this.entries) return this.entries;
    const output: CinematicAssetEntry[] = [];
    for (const root of this.roots) await this.visit(root, root, output);
    this.entries = mergeEntries(output);
    return this.entries;
  }

  private async visit(root: string, directory: string, output: CinematicAssetEntry[]): Promise<void> {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
      if (directory === root) this.warnings.push(`Asset root unavailable: ${root} (${String(error)})`);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && (SKIPPED_DIRECTORIES.has(entry.name) || internalWorkspaceDirectory(entry.name))) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.visit(root, full, output);
        continue;
      }
      this.scannedFiles++;
      const relative = path.relative(root, full).replaceAll("\\", "/");
      try {
        if (XML_EXTENSIONS.test(entry.name)) await this.indexCatalogXml(root, full, relative, output);
        else if (CUTSCENE_EXTENSIONS.test(entry.name)) await this.indexCutscene(full, relative, output);
        else if (MODEL_EXTENSIONS.test(entry.name)) await this.indexModel(root, full, relative, output);
        else if (LOOSE_ASSET_EXTENSIONS.test(entry.name)) output.push(fileAsset(relative, full));
        else if (/^(?:assets|files|filelist)\.txt$/i.test(entry.name)) await this.indexAssetManifest(full, relative, output);
      } catch (error) {
        this.warnings.push(`Skipped ${relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async indexCatalogXml(root: string, full: string, relative: string, output: CinematicAssetEntry[]): Promise<void> {
    const stat = await fs.stat(full);
    if (stat.size > 64 * 1024 * 1024) {
      this.warnings.push(`Catalog XML over 64 MiB skipped: ${relative}`);
      return;
    }
    const source = await fs.readFile(full, "utf8");
    if (!/<C[A-Za-z0-9_:-]+\b[^>]*\bid=/.test(source)) return;
    const parsed = scanXml(source);
    for (const node of parsed.nodes) {
      if (!/^C[A-Za-z0-9_:-]+$/.test(node.tag) || /^CCutscene/.test(node.tag) || !node.attrs.id) continue;
      const catalog = catalogForNativeClass(node.tag);
      const fields: Record<string, string[]> = {};
      const references: CinematicAssetReference[] = [];
      for (const childId of node.childIds) {
        const child = parsed.nodes[childId];
        const values = [child.attrs.value, child.attrs.link, child.attrs.Link, child.attrs.path, child.attrs.file].filter((value): value is string => Boolean(value));
        if (!values.length) continue;
        const fieldName = child.attrs.index ? `${child.tag}[${child.attrs.index}]` : child.tag;
        fields[fieldName] = [...new Set([...(fields[fieldName] ?? []), ...values])];
        const referenceCatalog = catalogForField(child.tag);
        if (referenceCatalog) for (const value of values) references.push({ catalog: referenceCatalog, id: value, property: fieldName });
      }
      const assetPath = node.attrs.path ?? node.attrs.file ?? firstPath(fields);
      output.push({
        catalog,
        nativeClass: node.tag,
        id: node.attrs.id,
        file: relative,
        parent: node.attrs.parent,
        path: assetPath,
        dependencies: dependencyHints(full),
        fields: Object.keys(fields).length ? fields : undefined,
        references: references.length ? dedupeReferences(references) : undefined,
        source: "catalog",
        confidence: "catalog-exact",
        // A catalog-backed CModel is referenced by its catalog link even when
        // its definition also exposes the underlying .m3 path.
        cutsceneUse: cutsceneUse(catalog, node.attrs.id),
      });

      if (assetPath && MODEL_EXTENSIONS.test(assetPath)) {
        const resolved = resolveAssetCandidate(root, assetPath);
        if (resolved) {
          try { await this.indexModel(root, resolved, path.relative(root, resolved).replaceAll("\\", "/"), output, node.attrs.id); } catch { /* catalog entry remains useful */ }
        }
      }
    }
  }

  private async indexCutscene(full: string, relative: string, output: CinematicAssetEntry[]): Promise<void> {
    const source = await fs.readFile(full, "utf8");
    const parsed = scanXml(source);
    for (const node of parsed.nodes) {
      const observed = cutsceneAssetAttributes(node.attrs);
      for (const asset of observed) {
        const animations = asset.catalog === "Model" ? collectDescendantValues(parsed.nodes, node.id, "anim") : [];
        output.push({
          catalog: asset.catalog,
          id: asset.id ?? path.basename(asset.path ?? "unknown"),
          path: asset.path,
          file: relative,
          dependencies: dependencyHints(full),
          animations: animations.length ? animations : undefined,
          source: "cutscene-observed",
          confidence: "cutscene-observed",
          cutsceneUse: { nativeType: node.tag, property: asset.property ?? "", value: asset.id ?? asset.path ?? "" },
        });
      }
    }
  }

  private async indexModel(root: string, full: string, relative: string, output: CinematicAssetEntry[], catalogId?: string): Promise<void> {
    const buffer = await fs.readFile(full);
    const metadata = readM3Metadata(buffer);
    const id = catalogId ?? path.basename(relative).replace(/\.(?:m3|m3a)$/i, "");
    output.push({
      catalog: "Model",
      id,
      path: relative,
      file: relative,
      dependencies: dependencyHints(full),
      animations: metadata.animations,
      attachmentPoints: metadata.attachmentPoints,
      source: "workspace-file",
      confidence: metadata.valid ? "binary-exact" : "path-observed",
      cutsceneUse: { nativeType: "CCutsceneNodeActor", property: "modelPath", value: relative.replaceAll("/", "\\") },
    });
    if (!metadata.valid) this.warnings.push(`M3 metadata unavailable for ${path.relative(root, full).replaceAll("\\", "/")}: ${metadata.error ?? "invalid header/index"}`);
  }

  private async indexAssetManifest(full: string, relative: string, output: CinematicAssetEntry[]): Promise<void> {
    const source = await fs.readFile(full, "utf8");
    for (const raw of source.split(/\r?\n/)) {
      const value = raw.trim().replace(/^['"]|['"]$/g, "");
      if (!value || value.startsWith("#") || value.startsWith("//") || !/\.[A-Za-z0-9]{2,8}$/.test(value)) continue;
      const catalog = catalogForExtension(value);
      if (!catalog) continue;
      const id = path.basename(value).replace(/\.[^.]+$/, "");
      output.push({ catalog, id, path: value.replaceAll("\\", "/"), file: relative, dependencies: dependencyHints(full), source: "asset-manifest", confidence: "path-observed", cutsceneUse: cutsceneUse(catalog, id, value) });
    }
  }

  async search(query: string, types?: string[], limit = 25): Promise<CinematicAssetEntry[]> {
    const terms = tokenize(query);
    const requestedTypes = new Set((types ?? []).map((type) => type.toLowerCase()));
    const entries = await this.build();
    return entries
      .filter((entry) => !requestedTypes.size || requestedTypes.has(entry.catalog.toLowerCase()) || requestedTypes.has(entry.nativeClass?.toLowerCase() ?? ""))
      .map((entry) => ({ ...entry, score: assetScore(entry, query, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async inspect(catalog: string, id: string): Promise<CinematicAssetEntry[]> {
    return (await this.build()).filter((entry) => entry.catalog.toLowerCase() === catalog.toLowerCase() && entry.id.toLowerCase() === id.toLowerCase());
  }

  async resolve(catalog: string, id: string, maxDepth = 8): Promise<AssetResolution> {
    const entries = await this.build();
    const resolved = resolveAssetGraph(entries, catalog, id, maxDepth);
    return {
      requested: { catalog, id },
      definitions: resolved.definitions,
      edges: resolved.edges,
      unresolved: resolved.unresolved,
      placementCandidates: resolved.definitions
        .filter((entry): entry is CinematicAssetEntry & { cutsceneUse: NonNullable<CinematicAssetEntry["cutsceneUse"]> } => Boolean(entry.cutsceneUse))
        .map((entry) => ({ catalog: entry.catalog, id: entry.id, cutsceneUse: entry.cutsceneUse })),
    };
  }

  async animations(asset: { catalog?: string; id?: string; path?: string }): Promise<AnimationInventory> {
    const entries = await this.build();
    const initial = entries.filter((entry) => assetMatches(entry, asset));
    const resolved = [...initial];
    for (const entry of initial) {
      if (!entry.id) continue;
      resolved.push(...resolveAssetGraph(entries, entry.catalog, entry.id, 8).definitions);
    }
    const unique = [...new Map(resolved.map((entry) => [`${entry.catalog}\0${entry.id}\0${entry.path ?? ""}\0${entry.file}`, entry])).values()];
    const exact = unique.filter((entry) => entry.confidence === "binary-exact");
    return {
      animations: [...new Set(unique.flatMap((entry) => entry.animations ?? []))].sort(),
      attachmentPoints: [...new Set(unique.flatMap((entry) => entry.attachmentPoints ?? []))].sort(),
      complete: exact.length > 0,
      sources: unique.map((entry) => ({ file: entry.file, source: entry.source, complete: entry.confidence === "binary-exact" })),
      resolvedAssets: unique.map((entry) => ({ catalog: entry.catalog, id: entry.id, path: entry.path })),
      note: exact.length ? undefined : "Only catalog/cutscene observations were available. Mount extracted .m3/.m3a files through SC2_ASSET_ROOTS for a complete native SEQS list.",
    };
  }
}

function assetRootsFromEnvironment(): string[] {
  return (process.env.SC2_ASSET_ROOTS ?? "").split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function fileAsset(relative: string, full: string): CinematicAssetEntry {
  const catalog = catalogForExtension(relative) ?? "File";
  const id = path.basename(relative).replace(/\.[^.]+$/, "");
  return { catalog, id, path: relative, file: relative, dependencies: dependencyHints(full), source: "workspace-file", confidence: "path-observed", cutsceneUse: cutsceneUse(catalog, id, relative) };
}

function catalogForNativeClass(nativeClass: string): string {
  const match = nativeClass.match(/^C(Actor|Model|Sound|Conversation|Portrait|Unit|Light|Texture|Terrain|Doodad|Camera|Movie|Footprint|Physics|Validator|Behavior|Effect|Weapon|Abil|Button|Race)/);
  return match?.[1] ?? nativeClass.replace(/^C/, "");
}

function catalogForField(field: string): string | undefined {
  return ["Actor", "Model", "Sound", "Conversation", "Portrait", "Unit", "Light", "Texture", "Terrain", "Doodad", "Camera", "Movie"].find((name) => field.toLowerCase().includes(name.toLowerCase()));
}

function catalogForExtension(file: string): string | undefined {
  const extension = path.extname(file).toLowerCase();
  if ([".m3", ".m3a"].includes(extension)) return "Model";
  if ([".dds", ".tga", ".png", ".jpg", ".jpeg"].includes(extension)) return "Texture";
  if ([".ogg", ".wav", ".mp3", ".flac"].includes(extension)) return "Sound";
  if ([".mp4", ".ogv", ".webm"].includes(extension)) return "Movie";
  return undefined;
}

function cutsceneUse(catalog: string, id: string, assetPath?: string): CinematicAssetEntry["cutsceneUse"] {
  if (catalog === "Model") return assetPath && MODEL_EXTENSIONS.test(assetPath)
    ? { nativeType: "CCutsceneNodeActor", property: "modelPath", value: assetPath.replaceAll("/", "\\") }
    : { nativeType: "CCutsceneNodeActor", property: "modelLink", value: id };
  if (catalog === "Sound") return { nativeType: "CCutsceneNodeSound", property: "soundLink", value: id };
  if (catalog === "Light") return { nativeType: "CCutsceneElementActiveLight", property: "lightID", value: id };
  return undefined;
}

function firstPath(fields: Record<string, string[]>): string | undefined {
  for (const [name, values] of Object.entries(fields)) {
    if (/model|file|path|texture|asset/i.test(name)) {
      const found = values.find((value) => /[\\/.]/.test(value));
      if (found) return found;
    }
  }
  return undefined;
}

function cutsceneAssetAttributes(attrs: Record<string, string>): CinematicAssetReference[] {
  const mappings: Array<[RegExp, string, "id" | "path"]> = [
    [/modelLink$/i, "Model", "id"], [/modelPath$/i, "Model", "path"], [/soundLink$/i, "Sound", "id"],
    [/lightID$/i, "Light", "id"], [/conversation/i, "Conversation", "id"], [/texture/i, "Texture", "id"],
  ];
  const output: CinematicAssetReference[] = [];
  for (const [property, value] of Object.entries(attrs)) {
    const mapping = mappings.find(([pattern]) => pattern.test(property));
    if (!mapping || !value) continue;
    output.push({ catalog: mapping[1], property, ...(mapping[2] === "id" ? { id: value } : { path: value }) });
  }
  return output;
}

function collectDescendantValues(nodes: ReturnType<typeof scanXml>["nodes"], nodeId: number, attribute: string): string[] {
  const output = new Set<string>();
  const visit = (id: number): void => {
    for (const childId of nodes[id].childIds) {
      const child = nodes[childId];
      if (child.attrs[attribute]) output.add(child.attrs[attribute]);
      visit(childId);
    }
  };
  visit(nodeId);
  return [...output];
}

function dedupeReferences(references: CinematicAssetReference[]): CinematicAssetReference[] {
  return [...new Map(references.map((entry) => [`${entry.catalog}\0${entry.id ?? ""}\0${entry.path ?? ""}\0${entry.property ?? ""}`, entry])).values()];
}

function mergeEntries(entries: CinematicAssetEntry[]): CinematicAssetEntry[] {
  const merged = new Map<string, CinematicAssetEntry>();
  for (const entry of entries) {
    const key = `${entry.catalog}\0${entry.id.toLowerCase()}\0${(entry.path ?? "").toLowerCase()}\0${entry.file.toLowerCase()}\0${entry.source}`;
    const prior = merged.get(key);
    if (!prior) merged.set(key, entry);
    else merged.set(key, { ...prior, ...entry, dependencies: [...new Set([...prior.dependencies, ...entry.dependencies])], animations: [...new Set([...(prior.animations ?? []), ...(entry.animations ?? [])])], attachmentPoints: [...new Set([...(prior.attachmentPoints ?? []), ...(entry.attachmentPoints ?? [])])], references: dedupeReferences([...(prior.references ?? []), ...(entry.references ?? [])]) });
  }
  return [...merged.values()];
}

function resolveAssetGraph(entries: CinematicAssetEntry[], catalog: string, id: string, maxDepth: number): {
  definitions: CinematicAssetEntry[];
  edges: Array<{ from: string; property?: string; to: string }>;
  unresolved: Array<{ catalog: string; id: string }>;
} {
  const definitions: CinematicAssetEntry[] = [];
  const edges: Array<{ from: string; property?: string; to: string }> = [];
  const unresolved: Array<{ catalog: string; id: string }> = [];
  const queue: Array<{ catalog: string; id: string; depth: number }> = [{ catalog, id, depth: 0 }];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.catalog.toLowerCase()}\0${current.id.toLowerCase()}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const matches = entries.filter((entry) => entry.catalog.toLowerCase() === current.catalog.toLowerCase() && entry.id.toLowerCase() === current.id.toLowerCase());
    if (!matches.length) {
      unresolved.push({ catalog: current.catalog, id: current.id });
      continue;
    }
    definitions.push(...matches);
    if (current.depth >= maxDepth) continue;
    for (const entry of matches) {
      const next = [...(entry.references ?? []).filter((reference): reference is CinematicAssetReference & { id: string } => Boolean(reference.id))];
      if (entry.parent) next.push({ catalog: entry.catalog, id: entry.parent, property: "@parent" });
      for (const reference of next) {
        edges.push({ from: `${entry.catalog}:${entry.id}`, property: reference.property, to: `${reference.catalog}:${reference.id}` });
        queue.push({ catalog: reference.catalog, id: reference.id, depth: current.depth + 1 });
      }
    }
  }
  return {
    definitions: [...new Map(definitions.map((entry) => [`${entry.catalog}\0${entry.id}\0${entry.path ?? ""}\0${entry.file}\0${entry.source}`, entry])).values()],
    edges: [...new Map(edges.map((entry) => [`${entry.from}\0${entry.property ?? ""}\0${entry.to}`, entry])).values()],
    unresolved: [...new Map(unresolved.map((entry) => [`${entry.catalog}\0${entry.id}`, entry])).values()],
  };
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_]+/i).filter(Boolean);
}

function assetScore(entry: CinematicAssetEntry, query: string, terms: string[]): number {
  const normalized = query.trim().toLowerCase();
  const fields = Object.entries(entry.fields ?? {}).flatMap(([name, values]) => [name, ...values]).join(" ");
  const haystack = `${entry.catalog} ${entry.nativeClass ?? ""} ${entry.id} ${entry.parent ?? ""} ${entry.path ?? ""} ${entry.file} ${fields} ${(entry.animations ?? []).join(" ")}`.toLowerCase();
  if (terms.some((term) => !haystack.includes(term))) return 0;
  let score = 10;
  if (entry.id.toLowerCase() === normalized) score += 100;
  else if (entry.id.toLowerCase().startsWith(normalized)) score += 70;
  else if (entry.id.toLowerCase().includes(normalized)) score += 50;
  if ((entry.path ?? "").toLowerCase().includes(normalized)) score += 25;
  if (entry.confidence === "binary-exact" || entry.confidence === "catalog-exact") score += 10;
  if (entry.source === "workspace-file") score += 3;
  return score;
}

function assetMatches(entry: CinematicAssetEntry, asset: { catalog?: string; id?: string; path?: string }): boolean {
  if (asset.catalog && entry.catalog.toLowerCase() !== asset.catalog.toLowerCase()) return false;
  if (asset.id && entry.id.toLowerCase() !== asset.id.toLowerCase()) return false;
  if (asset.path && normalizeAssetPath(entry.path ?? "") !== normalizeAssetPath(asset.path)) return false;
  return Boolean(asset.catalog || asset.id || asset.path);
}

function normalizeAssetPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "").toLowerCase();
}

function resolveAssetCandidate(root: string, assetPath: string): string | undefined {
  const normalized = assetPath.replaceAll("\\", path.sep).replace(/^[/\\]+/, "");
  const exact = path.resolve(root, normalized);
  const relative = path.relative(root, exact);
  return relative.startsWith("..") || path.isAbsolute(relative) ? undefined : exact;
}

function dependencyHints(file: string): string[] {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  const hints = [
    ["core.sc2mod", "Core"], ["liberty.sc2mod", "Liberty"], ["swarm.sc2mod", "Swarm"],
    ["void.sc2mod", "Void"], ["heroesdata.stormmod", "Heroes"], ["campaign", "Campaign"],
  ] as const;
  return hints.filter(([needle]) => normalized.includes(needle)).map(([, value]) => value);
}

export function readM3Metadata(buffer: Buffer): { valid: boolean; animations: string[]; attachmentPoints: string[]; error?: string } {
  if (buffer.length < 24) return { valid: false, animations: [], attachmentPoints: [], error: "file is shorter than an M3 header" };
  const magic = decodeM3Tag(buffer, 0);
  if (magic !== "MD34" && magic !== "MD33") return { valid: false, animations: [], attachmentPoints: [], error: `unsupported magic '${magic}'` };
  const indexOffset = buffer.readUInt32LE(4);
  const indexCount = buffer.readUInt32LE(8);
  if (indexCount > 1_000_000 || indexOffset + indexCount * 16 > buffer.length) return { valid: false, animations: [], attachmentPoints: [], error: "invalid section index bounds" };
  const sections: Array<{ tag: string; offset: number; repetitions: number; version: number }> = [];
  for (let index = 0; index < indexCount; index++) {
    const offset = indexOffset + index * 16;
    sections.push({ tag: decodeM3Tag(buffer, offset), offset: buffer.readUInt32LE(offset + 4), repetitions: buffer.readUInt32LE(offset + 8), version: buffer.readUInt32LE(offset + 12) });
  }
  const readReferenceString = (offset: number): string | undefined => {
    if (offset < 0 || offset + 8 > buffer.length) return undefined;
    const entries = buffer.readUInt32LE(offset);
    const index = buffer.readUInt32LE(offset + 4);
    const section = sections[index];
    if (!section || section.tag !== "CHAR" || section.offset >= buffer.length) return undefined;
    const length = Math.min(entries || section.repetitions, section.repetitions, buffer.length - section.offset);
    return buffer.subarray(section.offset, section.offset + length).toString("utf8").replace(/\0.*$/s, "");
  };
  const animations = new Set<string>();
  const attachmentPoints = new Set<string>();
  for (const section of sections) {
    if (section.offset >= buffer.length) continue;
    if (section.tag === "SEQS") {
      const size = section.version === 1 ? 96 : section.version === 2 ? 92 : 0;
      if (!size || section.offset + size * section.repetitions > buffer.length) continue;
      for (let index = 0; index < section.repetitions; index++) {
        const name = readReferenceString(section.offset + index * size + 8);
        if (name) animations.add(name);
      }
    } else if (section.tag === "ATT_") {
      const size = magic === "MD33" ? 16 : 20;
      if (section.offset + size * section.repetitions > buffer.length) continue;
      for (let index = 0; index < section.repetitions; index++) {
        const name = readReferenceString(section.offset + index * size + 4);
        if (name) attachmentPoints.add(name);
      }
    }
  }
  return { valid: true, animations: [...animations].sort(), attachmentPoints: [...attachmentPoints].sort() };
}

function decodeM3Tag(buffer: Buffer, offset: number): string {
  if (offset < 0 || offset + 4 > buffer.length) return "";
  const direct = buffer.subarray(offset, offset + 4).toString("ascii").replace(/\0/g, "");
  const reversed = [...direct].reverse().join("");
  if (/^(?:MD3[34]|SEQS|ATT_|CHAR)$/.test(direct)) return direct;
  return reversed;
}
