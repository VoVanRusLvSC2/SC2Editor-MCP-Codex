import path from "node:path";
import { promises as fs } from "node:fs";
import { Workspace } from "../../core/workspace.js";
import { scanXml } from "../../core/xmlScanner.js";
import { sc2BuiltinDependencies } from "../../core/sc2BuiltinDependencies.js";
import { internalWorkspaceDirectory } from "../../core/discoveryPaths.js";
import { DataDocument, referenceSchema } from "./document.js";
import { catalogActivation } from "./activation.js";
import type { CatalogRecords, CatalogCoverageIssue } from "./catalogTypes.js";
import {
  normalizeCatalogPath as normalize,
  catalogProvenance as provenance,
  CATALOG_SKIP as SKIP,
} from "./catalogSupport.js";

/** Catalog discovery, active layers and bounded parse caches; all reads remain tracked. */
export class DataCatalogRepository {
  readonly extraRoots: string[];
  private parsedCatalogs = new Map<string, DataDocument>();
  private parsedBytes = 0;
  private validationCache = new Map<
    string,
    { source: string; invalid: boolean; catalog: boolean }
  >();
  private cachedDocument(absolute: string, source: string, file: string) {
    const existing = this.parsedCatalogs.get(absolute);
    if (existing?.source === source) return existing;
    if (existing) this.parsedBytes -= Buffer.byteLength(existing.source);
    const doc = new DataDocument(source, file);
    this.parsedCatalogs.delete(absolute);
    this.parsedCatalogs.set(absolute, doc);
    this.parsedBytes += Buffer.byteLength(source);
    while (this.parsedCatalogs.size > 1024 || this.parsedBytes > 64 * 1024 * 1024) {
      const key = this.parsedCatalogs.keys().next().value!;
      this.parsedBytes -= Buffer.byteLength(this.parsedCatalogs.get(key)!.source);
      this.parsedCatalogs.delete(key);
    }
    return doc;
  }
  cacheStats() {
    return {
      entries: this.parsedCatalogs.size,
      sourceBytes: this.parsedBytes,
      maxEntries: 1024,
      maxSourceBytes: 64 * 1024 * 1024,
    };
  }
  private readonly nativePackageProfiles = new Map<string, string>();
  private readonly dependencyPreparationKeys = new Map<string, object>();
  nativeCatalogFiles: ReadonlySet<string> = new Set();
  nativePackageProfile(root: string) {
    return this.nativePackageProfiles.get(path.resolve(root));
  }
  removeDependencyRoot(root: string) {
    const absolute = path.resolve(root);
    this.nativePackageProfiles.delete(absolute);
    const index = this.extraRoots.indexOf(absolute);
    if (index >= 0) this.extraRoots.splice(index, 1);
  }
  addDependencyRoot(root: string, builtinPackage?: string) {
    const absolute = path.resolve(root);
    if (builtinPackage && Object.hasOwn(sc2BuiltinDependencies, builtinPackage.toLowerCase()))
      this.nativePackageProfiles.set(absolute, builtinPackage.toLowerCase());
    if (!this.extraRoots.includes(absolute)) this.extraRoots.push(absolute);
  }
  private async discoverRoot(
    base: string,
    layer: "workspace" | "dependency",
    overrides?: ReadonlyMap<string, string>,
  ): Promise<CatalogRecords> {
    const files: CatalogRecords = Object.assign([], { issues: [] as CatalogCoverageIssue[] });
    const candidates = new Set<string>();
    const isCandidate = (file: string) =>
      /(?:^|\/)GameData\/.*\.xml$/i.test(file) || /Data\.xml$/i.test(path.basename(file));
    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await this.workspace.readDirectory(directory, "data-catalog", (entry) =>
          entry.isDirectory()
            ? !(SKIP.has(entry.name) || internalWorkspaceDirectory(entry.name))
            : isCandidate(normalize(path.relative(base, path.join(directory, entry.name)))),
        );
      } catch (error) {
        files.issues.push({
          file: directory,
          code: "CATALOG_DIRECTORY_UNREADABLE",
          reason: String(error),
        });
        return;
      }
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          (SKIP.has(entry.name) ||
            internalWorkspaceDirectory(entry.name) ||
            (layer === "dependency" && /\.sc2(?:map|mod|campaign)$/i.test(entry.name)))
        )
          continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && isCandidate(normalize(path.relative(base, absolute))))
          candidates.add(absolute);
      }
    };
    await visit(base);
    if (layer === "workspace")
      for (const file of [
        ...this.workspace.draftFiles(),
        ...this.workspace.binary.draftFiles(),
        ...(overrides?.keys() ?? []),
      ]) {
        const absolute = this.workspace.resolveUserPath(file),
          relative = normalize(path.relative(base, absolute));
        if (!relative.startsWith("../") && !path.isAbsolute(relative) && isCandidate(relative))
          candidates.add(absolute);
      }
    for (const absolute of [...candidates].sort()) {
      const relative = normalize(path.relative(base, absolute));
      const workspaceRelative =
        layer === "workspace" ? normalize(path.relative(this.workspace.root, absolute)) : relative;
      try {
        const stat = await fs.stat(absolute).catch(() => undefined);
        if (stat && stat.size > 64 * 1024 * 1024) {
          files.issues.push({
            file: absolute,
            code: "CATALOG_BYTE_LIMIT",
            reason: "Catalog exceeds 64 MiB",
          });
          continue;
        }
        const source =
          layer === "workspace" && overrides?.has(workspaceRelative)
            ? overrides.get(workspaceRelative)!
            : layer === "workspace"
              ? (await this.workspace.readRaw(workspaceRelative)).text
              : await this.workspace.readDependency(absolute);
        if (Buffer.byteLength(source) > 64 * 1024 * 1024) {
          files.issues.push({
            file: absolute,
            code: "CATALOG_BYTE_LIMIT",
            reason: "Staged catalog exceeds 64 MiB",
          });
          continue;
        }
        const document = this.cachedDocument(absolute, source, workspaceRelative);
        let validation = this.validationCache.get(absolute);
        if (validation?.source !== source) {
          validation = {
            source,
            invalid: document.diagnostics.some((d) => d.severity === "error"),
            catalog: document.nodes.some(
              (node) => node.parentId === null && node.tag === "Catalog",
            ),
          };
          this.validationCache.set(absolute, validation);
          while (this.validationCache.size > 1024)
            this.validationCache.delete(this.validationCache.keys().next().value!);
        }
        if (validation.invalid)
          files.issues.push({
            file: absolute,
            code: "CATALOG_XML_INVALID",
            reason: "XML references cannot be completely indexed",
          });
        if (validation.catalog)
          files.push({
            file: workspaceRelative,
            absolute,
            layer,
            provenance:
              layer === "workspace"
                ? provenance(absolute)
                : [path.basename(base), ...provenance(absolute)],
            document,
          });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("STALE_")) throw error;
        files.issues.push({ file: absolute, code: "CATALOG_READ_FAILED", reason: String(error) });
      }
    }
    const lookup = new Map(
      files.map((r) => [normalize(path.relative(base, r.absolute)).toLowerCase(), r.absolute]),
    );
    const activationSources = new Map<string, { absolute: string; source: string }>();
    const activation = await catalogActivation(async (file) => {
      const absolute = lookup.get(file.toLowerCase()) ?? path.join(base, file);
      if (layer === "workspace") {
        const key = normalize(path.relative(this.workspace.root, absolute));
        if (overrides?.has(key)) {
          const source = overrides.get(key)!;
          activationSources.set(file.toLowerCase(), { absolute, source });
          return source;
        }
        const raw = await this.workspace.readRaw(key);
        if (
          raw.exists ||
          (raw.staged && (raw.text.length > 0 || this.workspace.draftFiles().includes(key)))
        ) {
          activationSources.set(file.toLowerCase(), { absolute, source: raw.text });
          return raw.text;
        }
        return undefined;
      }
      const text = await this.workspace.readDependency(absolute, true);
      if (text) activationSources.set(file.toLowerCase(), { absolute, source: text });
      return text || undefined;
    });
    for (const key of activation.files) {
      const loaded = activationSources.get(key);
      if (!loaded || files.some((r) => r.absolute === loaded.absolute)) continue;
      const file = normalize(
        path.relative(layer === "workspace" ? this.workspace.root : base, loaded.absolute),
      );
      files.push({
        file,
        absolute: loaded.absolute,
        layer,
        provenance:
          layer === "workspace"
            ? provenance(loaded.absolute)
            : [path.basename(base), ...provenance(loaded.absolute)],
        document: this.cachedDocument(loaded.absolute, loaded.source, file),
      });
    }
    for (const record of files) {
      const relative = normalize(path.relative(base, record.absolute)).toLowerCase(),
        native =
          layer === "dependency" &&
          this.nativePackageProfiles.has(base) &&
          /^base\.sc2data\/gamedata\/[^/]+$/.test(relative) &&
          this.nativeCatalogFiles.has(path.posix.basename(relative));
      record.activationWarnings = activation.warnings;
      record.activationMode = activation.mode;
      record.engineActive =
        native ||
        (activation.mode === "EXPLICIT_INCLUDES" ? activation.files.has(relative) : undefined);
    }
    return files;
  }
  private async discoverDependency(root: string): Promise<CatalogRecords> {
    if (!this.workspace.trackingReads) return this.discoverRoot(root, "dependency");
    const signature = JSON.stringify([
      root,
      this.nativePackageProfiles.get(root),
      [...this.nativeCatalogFiles].sort(),
    ]);
    let key = this.dependencyPreparationKeys.get(signature);
    if (!key) {
      this.dependencyPreparationKeys.set(signature, (key = {}));
      if (this.dependencyPreparationKeys.size > 256)
        this.dependencyPreparationKeys.delete(this.dependencyPreparationKeys.keys().next().value!);
    }
    const prepared = await this.workspace.prepareReadScope(key, async () => {
      const captured = await this.workspace.memoizeReads(() =>
        this.discoverRoot(root, "dependency"),
      );
      return { ...captured, used: false, sources: captured.value.map((r) => r.document.source) };
    });
    if (prepared.used && !(await this.workspace.reuseReads(prepared.memo)))
      throw new Error("STALE_DATA_DEPENDENCY_CATALOG");
    if (prepared.value.some((r, i) => r.document.source !== prepared.sources[i]))
      throw new Error("STALE_DATA_DEPENDENCY_CATALOG");
    prepared.used = true;
    // Failed discovery must remain retryable inside the same operation.
    if (prepared.value.issues.length) this.dependencyPreparationKeys.delete(signature);
    // Activation/order metadata is assigned by catalog(), not by this snapshot.
    return Object.assign(
      prepared.value.map((r) => ({
        ...r,
        provenance: [...r.provenance],
        ...(r.activationWarnings ? { activationWarnings: [...r.activationWarnings] } : {}),
      })),
      { issues: prepared.value.issues.map((issue) => ({ ...issue })) },
    );
  }

  async catalog(overrides?: ReadonlyMap<string, string>): Promise<CatalogRecords> {
    referenceSchema.refresh();
    const records = await this.discoverRoot(this.workspace.root, "workspace", overrides);
    const source = (await this.workspace.readRaw("DocumentInfo")).text;
    const declared = source.length > 0,
      ordered: string[] = [],
      visiting = new Set<string>(),
      visited = new Set<string>();
    const dependencyName = (root: string) =>
      normalize(root)
        .split("/")
        .filter((n) => /\.SC2(?:Mod|Map)$/i.test(n))
        .at(-1)
        ?.toLowerCase() ?? path.basename(root).toLowerCase();
    const visit = async (root: string, text: string) => {
      if (visiting.has(root)) {
        records.issues.push({
          file: root,
          code: "DEPENDENCY_CYCLE",
          reason: "Declared dependency graph contains a cycle",
        });
        return;
      }
      if (visited.has(root)) return;
      visiting.add(root);
      const profile = this.nativePackageProfiles.get(root);
      if (!text.trim() && profile) {
        text =
          "<DocInfo><Dependencies>" +
          sc2BuiltinDependencies[profile]
            .map((file) => "<Value>file:" + file + "</Value>")
            .join("") +
          "</Dependencies></DocInfo>";
      }
      const parsed = scanXml(text);
      if (parsed.diagnostics.some((d) => d.severity === "error"))
        records.issues.push({
          file: root,
          code: "DEPENDENCY_DOCUMENT_INVALID",
          reason: "Cannot establish declared dependency graph",
        });
      for (const node of parsed.nodes.filter((n) => n.tag === "Dependencies"))
        for (const childId of node.childIds) {
          const child = parsed.nodes[childId],
            content = text.slice(child.startTagEnd, child.endTagStart).trim();
          const file = content.match(/(?:^|,)file:([^,]+)/i)?.[1];
          if (!file) {
            if (content)
              records.issues.push({
                file: root,
                code: "DEPENDENCY_REMOTE_UNRESOLVED",
                reason: content,
              });
            continue;
          }
          const name = normalize(file).split("/").at(-1)!.toLowerCase(),
            matches = this.extraRoots.filter((r) => dependencyName(r) === name);
          if (matches.length !== 1) {
            records.issues.push({
              file,
              code: matches.length ? "DEPENDENCY_AMBIGUOUS" : "DEPENDENCY_MISSING",
              reason: "Declared dependency cannot be uniquely loaded",
            });
            continue;
          }
          const target = matches[0];
          await visit(
            target,
            await this.workspace.readDependency(path.join(target, "DocumentInfo"), true),
          );
        }
      visiting.delete(root);
      visited.add(root);
      if (root !== this.workspace.root) ordered.push(root);
    };
    if (declared) await visit(this.workspace.root, source);
    for (const record of records) {
      record.dependencyAvailability = "WORKSPACE";
      record.declarationOrder = ordered.length;
    }
    for (const root of [...ordered, ...this.extraRoots.filter((r) => !ordered.includes(r))]) {
      const dependency = await this.discoverDependency(root);
      const active = ordered.includes(root);
      for (const record of dependency) {
        record.dependencyAvailability = active
          ? "DECLARED_AVAILABLE"
          : declared
            ? "INSTALLED_NOT_DECLARED"
            : "DECLARATIONS_UNVERIFIED";
        record.declarationOrder = active ? ordered.indexOf(root) : undefined;
        if (declared && !active) record.engineActive = false;
      }
      records.push(...dependency);
      records.issues.push(...dependency.issues);
    }
    return records;
  }
  constructor(
    readonly workspace: Workspace,
    extraRoots: string[],
  ) {
    this.extraRoots = extraRoots.map((entry) => path.resolve(entry));
  }
}
