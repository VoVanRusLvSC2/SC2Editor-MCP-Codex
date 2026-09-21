import { promises as fs } from "node:fs";
import path from "node:path";
import { scanXml } from "../../core/xmlScanner.js";
import type { Workspace } from "../../core/workspace.js";
import type { BrowseWorkspace } from "../browse/workspace.js";
import { createHash } from "node:crypto";

export interface AiResolvedReference {
  kind: "unit" | "player" | "point" | "region" | "trigger" | "personality" | "wave";
  id: string;
  file: string;
  source: "workspace" | "dependency" | "custom-ai" | "trigger";
  nativeType?: string;
  provenance: string[];
  metrics?: { minerals?: number; vespene?: number; supply?: number };
}

export interface AiTriggerBinding {
  file: string;
  triggerId?: string;
  triggerName?: string;
  referenceKind: "aidef" | "aidefwave" | "custom-ai-function";
  value?: string;
  sourcePath: string;
  runtimeOverride: boolean;
}

const SKIP = new Set(["node_modules", "dist", "release", ".git", ".svn"]);

function provenance(file: string): string[] {
  const normalized = file.replaceAll("\\", "/");
  const layers = normalized.split("/").filter((entry) => /\.SC2(?:Mod|Map|Data)$/i.test(entry));
  return layers.length ? layers : ["workspace"];
}

export class AiReferenceResolver {
  private references?: AiResolvedReference[];
  private bindings?: AiTriggerBinding[];
  private warnings: string[] = [];
  private fingerprint?: string;

  constructor(readonly root: string, readonly extraRoots = (process.env.SC2_ASSET_ROOTS ?? "").split(path.delimiter).filter(Boolean), readonly workspace?: Workspace, readonly browse?: BrowseWorkspace) {}

  async refresh(): Promise<void> { this.references = undefined; this.bindings = undefined; this.warnings = []; await this.build(); }

  private async build(): Promise<void> {
    if (this.workspace?.trackingReads) await this.workspace.readRaw("Triggers");
    const fingerprint = await this.currentFingerprint();
    if (this.references && this.bindings && this.fingerprint === fingerprint && !this.workspace?.trackingReads) return;
    this.warnings = [];
    const references: AiResolvedReference[] = [];
    const bindings: AiTriggerBinding[] = [];
    for (const base of [...new Set([this.root, ...this.extraRoots].map((entry) => path.resolve(entry)))]) await this.visit(base, base, references, bindings);
    this.references = dedupe(references);
    this.bindings = bindings;
    this.fingerprint = fingerprint;
  }

  private async currentFingerprint(): Promise<string> {
    const values: string[] = [];
    const visit = async (directory: string) => {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { values.push(`missing:${directory}`); return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { if (!SKIP.has(entry.name)) await visit(full); continue; }
        if (!/(?:\.xml|CustomAI|Triggers|MapInfo|Objects|Regions)$/i.test(entry.name)) continue;
        const stat = await fs.stat(full);
        values.push(`${full}:${stat.size}:${stat.mtimeMs}`);
        const relative = path.relative(this.root, full).replaceAll("\\", "/");
        if (relative !== ".." && !relative.startsWith("../") && !path.posix.isAbsolute(relative) && this.workspace?.hasDraft(relative)) values.push(createHash("sha256").update((await this.workspace.readRaw(relative)).text).digest("hex"));
      }
    };
    for (const base of [...new Set([this.root, ...this.extraRoots].map((entry) => path.resolve(entry)))].sort()) await visit(base);
    if (this.workspace?.hasDraft("Triggers")) values.push(`staged-triggers:${createHash("sha256").update((await this.workspace.readRaw("Triggers")).text).digest("hex")}`);
    return createHash("sha256").update(values.join("\n")).digest("hex");
  }

  private async visit(base: string, directory: string, references: AiResolvedReference[], bindings: AiTriggerBinding[]): Promise<void> {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
      if (directory === base) this.warnings.push(`Reference root unavailable: ${base} (${String(error)})`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    if (path.resolve(directory) === path.resolve(this.root) && this.workspace?.hasDraft("Triggers") && !entries.some((entry) => entry.name === "Triggers")) {
      entries.push({ name: "Triggers", isDirectory: () => false } as typeof entries[number]);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await this.visit(base, full, references, bindings); continue; }
      if (!/(?:\.xml|CustomAI|Triggers|MapInfo|Objects|Regions)$/i.test(entry.name)) continue;
      try {
        const stat = await fs.stat(full).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" && path.resolve(base) === path.resolve(this.root) && this.workspace?.hasDraft(path.relative(base, full))) return { size: 0 };
          throw error;
        });
        if (stat.size > 64 * 1024 * 1024) { this.warnings.push(`Reference file over 64 MiB skipped: ${full}`); continue; }
        const relative = path.relative(base, full).replaceAll("\\", "/");
        const local = path.resolve(base) === path.resolve(this.root);
        const source = local && this.workspace ? (await this.workspace.readRaw(relative)).text : this.workspace ? await this.workspace.readDependency(full) : await fs.readFile(full, "utf8");
        const parsed = scanXml(source);
        const sourceKind = path.resolve(base) === path.resolve(this.root) ? "workspace" : "dependency";
        for (const node of parsed.nodes) {
          const id = node.attrs.id ?? node.attrs.Id;
          if (node.tag === "CUnit" && id) references.push({ kind: "unit", id, file: relative, source: sourceKind, nativeType: node.tag, provenance: provenance(full), metrics: unitMetrics(parsed.nodes, node.id) });
          if (/Point/i.test(node.tag) && id) references.push({ kind: "point", id, file: relative, source: sourceKind, nativeType: node.tag, provenance: provenance(full) });
          if (/Region/i.test(node.tag) && id) references.push({ kind: "region", id, file: relative, source: sourceKind, nativeType: node.tag, provenance: provenance(full) });
          if (node.tag === "Player" && id) references.push({ kind: "player", id, file: relative, source: sourceKind, nativeType: node.tag, provenance: provenance(full) });
          if (/trigger/i.test(entry.name) && node.attrs.Type === "Trigger" && id) references.push({ kind: "trigger", id, file: relative, source: "trigger", nativeType: node.tag, provenance: provenance(full) });
          const triggerType = [node.attrs.Type, node.attrs.type, node.attrs.ValueType, node.attrs.valueType].find((value) => value === "aidef" || value === "aidefwave");
          if (local && (triggerType === "aidef" || triggerType === "aidefwave")) {
            const value = node.attrs.Value ?? node.attrs.value ?? node.attrs.Id ?? node.attrs.id;
            bindings.push({ file: relative, referenceKind: triggerType, value, sourcePath: `${node.tag}[${node.id}]`, runtimeOverride: false });
          }
          if (/AIAttackWave|AI.*Personalit|Attack Wave/i.test(source.slice(node.start, Math.min(node.end > 0 ? node.end : node.startTagEnd, node.start + 4000)))) {
            if (local && (node.attrs.Type === "FunctionCall" || node.attrs.Type === "Trigger")) bindings.push({ file: relative, triggerId: id, referenceKind: "custom-ai-function", sourcePath: `${node.tag}[${node.id}]`, runtimeOverride: true });
          }
        }
      } catch (error) { if (error instanceof Error && error.message.startsWith("STALE_")) throw error; this.warnings.push(`Skipped ${full}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }

  async resolve(kind: AiResolvedReference["kind"], id: string): Promise<AiResolvedReference[]> {
    if (kind === "unit" && this.browse) {
      const hits = await this.browse.search({ ids: [id], catalogType: "Unit", limit: 200 });
      return hits.results.filter((entry) => entry.id.toLowerCase() === id.toLowerCase() && ["MAP_LOCAL", "AVAILABLE_THROUGH_DEPENDENCY"].includes(entry.availability)).map((entry) => ({ kind: "unit", id: entry.id, file: entry.source, source: entry.sourceLayer === "workspace" ? "workspace" : "dependency", nativeType: entry.ctype, provenance: [entry.dependency, entry.source] }));
    }
    await this.build();
    return this.references!.filter((entry) => entry.kind === kind && entry.id.toLowerCase() === id.toLowerCase());
  }

  async search(query: string, kinds?: AiResolvedReference["kind"][], limit = 50): Promise<AiResolvedReference[]> {
    await this.build();
    const needle = query.toLowerCase();
    const allowed = new Set(kinds ?? []);
    return this.references!.filter((entry) => (!allowed.size || allowed.has(entry.kind)) && (!needle || entry.id.toLowerCase().includes(needle) || entry.file.toLowerCase().includes(needle))).slice(0, limit);
  }

  async triggerBindings(): Promise<AiTriggerBinding[]> { await this.build(); return this.bindings!; }

  async status() {
    await this.build();
    return {
      roots: [this.root, ...this.extraRoots], references: this.references!.length, triggerBindings: this.bindings!.length,
      kinds: Object.fromEntries([...new Set(this.references!.map((entry) => entry.kind))].map((kind) => [kind, this.references!.filter((entry) => entry.kind === kind).length])),
      warnings: this.warnings,
      triggerRizer: "NOT_INCLUDED; aidef/aidefwave references are read-only; Trigger writes disabled",
      unitAvailability: this.browse ? "browse.* declared dependency policy" : "legacy catalog presence only; dependency declarations not validated without Browse",
    };
  }
}

function dedupe(entries: AiResolvedReference[]): AiResolvedReference[] {
  const seen = new Set<string>();
  return entries.filter((entry) => { const key = `${entry.kind}\0${entry.id}\0${entry.file}`.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function unitMetrics(nodes: ReturnType<typeof scanXml>["nodes"], unitId: number): AiResolvedReference["metrics"] {
  const values: Array<{ tag: string; index?: string; value: number }> = [];
  const visit = (id: number) => {
    for (const childId of nodes[id].childIds) {
      const child = nodes[childId];
      const value = Number(child.attrs.value ?? child.attrs.Value);
      if (Number.isFinite(value)) values.push({ tag: child.tag, index: child.attrs.index ?? child.attrs.Index, value });
      visit(childId);
    }
  };
  visit(unitId);
  const find = (patterns: RegExp[]) => values.find((entry) => patterns.some((pattern) => pattern.test(`${entry.tag}:${entry.index ?? ""}`)))?.value;
  const metrics = {
    minerals: find([/CostResource:Minerals/i, /Mineral/i]),
    vespene: find([/CostResource:(?:Vespene|Gas)/i, /Vespene|GasCost/i]),
    supply: find([/Food|Supply/i]),
  };
  return Object.values(metrics).some((entry) => entry !== undefined) ? metrics : undefined;
}
