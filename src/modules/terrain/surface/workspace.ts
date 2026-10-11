import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Workspace } from "../../../core/workspace.js";
import { SurfaceSnapshot, safeComponentPath, componentKind, surfaceKinds } from "./core/index.js";
import { MAX_INPUT_BYTES } from "./format/guards.js";
import { inspectSurfaceCatalog, catalogRecordKind, catalogTokenDeclarations,
  inspectCatalogReferences, previewCatalogTemplate, inspectCliffDoodadHeightCodes,
  inspectAuthoredCliffHeights } from "./core/index.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const isComponent = (name: string) => surfaceKinds.has(componentKind(name)) ||
  componentKind(name).startsWith("cell-attribute:") || /^t3[^/]*$/i.test(name);

/** Reads one unpacked map, with the same drafts and path guard as existing Terrain tools. */
export class TerrainSurfaceWorkspace {
  constructor(readonly workspace: Workspace) {}

  private scope(directory: string) {
    const relative = directory ? safeComponentPath(directory) : "";
    return { relative, absolute: this.workspace.resolveUserPath(relative) };
  }

  private async names(directory: string): Promise<string[]> {
    const { relative, absolute } = this.scope(directory);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    if (entries.length > 8192) throw new Error("SURFACE_DIRECTORY_ENTRY_BUDGET");
    const names = new Set(entries.filter(entry => isComponent(entry.name)).map(entry => entry.name));
    for (const file of [...this.workspace.binary.draftFiles(), ...this.workspace.draftFiles()]) {
      if (path.posix.dirname(file) === (relative || ".") && isComponent(path.posix.basename(file)))
        names.add(path.posix.basename(file));
    }
    if (names.size > 2048) throw new Error("SURFACE_FILE_COUNT_BUDGET");
    return [...names].sort();
  }

  private async read(file: string, limit = MAX_INPUT_BYTES) {
    const absolute = this.workspace.resolveUserPath(safeComponentPath(file));
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) throw new Error("SURFACE_COMPONENT_NOT_FILE");
      if (stat.size > limit) throw new Error("SURFACE_INPUT_BYTE_BUDGET");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const raw = await this.workspace.binary.read(file, true);
    if (raw.bytes.length > limit) throw new Error("SURFACE_INPUT_BYTE_BUDGET");
    return raw;
  }

  async load(directory = "") {
    const { relative } = this.scope(directory), names = await this.names(relative);
    const files = new Map<string, Uint8Array>();
    const observed = new Map<string, { exists: boolean; staged: boolean; sha256: string }>();
    let total = 0;
    for (const name of names) {
      const file = relative ? `${relative}/${name}` : name, raw = await this.read(file);
      total += raw.bytes.length;
      if (total > 256 * 1024 * 1024) throw new Error("SURFACE_SNAPSHOT_BYTE_BUDGET");
      observed.set(file, { exists: raw.exists, staged: raw.staged, sha256: hash(raw.bytes) });
      if (raw.exists || raw.staged) files.set(name, raw.bytes);
    }
    for (const [file, before] of observed) {
      const raw = await this.read(file);
      if (raw.exists !== before.exists || raw.staged !== before.staged || hash(raw.bytes) !== before.sha256)
        throw new Error("SURFACE_CHANGED_DURING_READ");
    }
    if (JSON.stringify(names) !== JSON.stringify(await this.names(relative)))
      throw new Error("SURFACE_CHANGED_DURING_READ");
    const snapshot = new SurfaceSnapshot(files), revision = createHash("sha256");
    revision.update(relative + "\0");
    for (const name of snapshot.names()) {
      const bytes = files.get(name)!;
      revision.update(name + "\0" + bytes.length + "\0");
      revision.update(bytes);
    }
    return { snapshot, revision: revision.digest("hex"), directory: relative,
      stagedFiles: [...observed].filter(([, raw]) => raw.staged).map(([file]) => file) };
  }

  async catalog(file: string, options: { id?: string; type?: string; offset: number; limit: number; bindings: Record<string, string> }) {
    const safe = safeComponentPath(file);
    if (!/(?:^|\/)(?:Terrain|TerrainTex|TerrainObject|Cliff|CliffMesh|Tile|Water|Texture|TextureSheet|PhysicsMaterial|Model|Actor|Light)Data\.xml$/i.test(safe))
      throw new Error("SURFACE_CATALOG_FILE_REQUIRED");
    const raw = await this.read(safe, 8 * 1024 * 1024);
    if (!raw.exists && !raw.staged) throw new Error("SURFACE_CATALOG_NOT_FOUND");
    const sha256 = hash(raw.bytes), parsed = inspectSurfaceCatalog(new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes));
    const entries = parsed.entries.filter(entry => (options.id === undefined || entry.id === options.id) &&
      (options.type === undefined || entry.type === options.type));
    const items = entries.slice(options.offset, options.offset + options.limit).map(entry => ({
      ...entry, recordKind: catalogRecordKind(entry), tokens: catalogTokenDeclarations(entry),
      references: inspectCatalogReferences(entry).map(reference => ({ ...reference,
        ...(reference.template ? { preview: previewCatalogTemplate(reference.raw, options.bindings) } : {}) })),
      ...(entry.type === "CCliffDoodad" && entry.fields.some(field => field.name === "HeightCodes") ? { heightCodes: inspectCliffDoodadHeightCodes(entry) } : {}),
      ...(entry.type === "CCliffMesh" ? { cliffHeights: inspectAuthoredCliffHeights(entry) } : {}),
    }));
    const after = await this.read(safe, 8 * 1024 * 1024);
    if (after.exists !== raw.exists || after.staged !== raw.staged || hash(after.bytes) !== sha256)
      throw new Error("SURFACE_CHANGED_DURING_READ");
    return { file: safe, sha256, staged: raw.staged, semantics: parsed.semantics,
      dependencyOrderResolved: false, inheritanceResolved: false, assetExistenceChecked: false,
      total: entries.length, items, nextOffset: options.offset + options.limit < entries.length ? options.offset + options.limit : null };
  }
}
