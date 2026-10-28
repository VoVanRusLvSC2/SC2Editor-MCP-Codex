import { createHash } from "node:crypto";
import path from "node:path";
import { Workspace } from "../../core/workspace.js";
import { referenceSchema } from "./document.js";
import { dataDomainFromType } from "./domains.js";
import {
  galaxyReferences,
  guiReferences,
  objectReferences,
  type CrossReference,
  type CrossIssue,
} from "./crossReferences.js";
import type { DataObject, DataReference } from "./types.js";
import type { CatalogRecord } from "./catalogTypes.js";
import { normalizeCatalogPath as normalize, CATALOG_SKIP as SKIP } from "./catalogSupport.js";
export class DataReferenceGraph {
  constructor(private readonly workspace: Workspace) {}
  referenceTokenResolver(objects: DataObject[]) {
    const types = new Map<string, DataObject[]>(),
      domains = new Map<string, DataObject[]>(),
      defaults = new Map<string, DataObject[]>(),
      cache = new Map<string, Record<string, string>>();
    const add = (map: Map<string, DataObject[]>, key: string, o: DataObject) => {
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    };
    for (const o of objects) {
      add(types, o.ctype + "\0" + o.id, o);
      add(domains, o.domain + "\0" + o.id, o);
      if (o.isDefault && !o.id) add(defaults, o.ctype, o);
    }
    return (ctype: string, id?: string): Record<string, string> => {
      const key = ctype + "\0" + id,
        prior = cache.get(key);
      if (prior) return prior;
      const domain = dataDomainFromType(ctype),
        chain: DataObject[] = [],
        seen = new Set<string>();
      let candidates = types.get(key) ?? [];
      while (candidates.length === 1) {
        const object = candidates[0];
        if (seen.has(object.id ?? "")) break;
        seen.add(object.id ?? "");
        chain.unshift(object);
        if (!object.parent) break;
        candidates = domains.get(domain + "\0" + object.parent) ?? [];
      }
      const ownDefaults = defaults.get(ctype) ?? [];
      if (ownDefaults.length === 1) chain.unshift(ownDefaults[0]);
      const tokens: Record<string, string> = {};
      for (const object of chain) {
        Object.assign(tokens, object.tokens ?? {});
        for (const id of Object.keys(tokens))
          if (object.attrs[id] !== undefined) tokens[id] = object.attrs[id];
      }
      cache.set(key, tokens);
      return tokens;
    };
  }
  actorIssues(records: CatalogRecord[]) {
    return referenceSchema.withPinnedReads(() => {
      const resolve = this.referenceTokenResolver(records.flatMap((r) => r.document.objects()));
      return records.flatMap((r) =>
        r.document.actorCoverageIssues((entry) => resolve(entry.tag, entry.attrs.id)),
      );
    });
  }
  references(records: CatalogRecord[], scope: "all" | "workspace" = "all"): DataReference[] {
    return referenceSchema.withPinnedReads(() => {
      const objects = records.flatMap((record) =>
        record.document
          .objects()
          .map((object) => ({ ...object, file: record.file, layer: record.layer })),
      );
      const byId = new Map<string, typeof objects>();
      for (const object of objects)
        if (object.id) byId.set(object.id, [...(byId.get(object.id) ?? []), object]);
      const resolve = this.referenceTokenResolver(objects),
        byDomain = new Map<string, typeof objects>();
      for (const o of objects) {
        const key = o.domain + "\0" + o.id,
          list = byDomain.get(key);
        if (list) list.push(o);
        else byDomain.set(key, [o]);
      }
      const ownByRecord = records.map((record) => ({
        record,
        refs: record.document
          .references((entry) => resolve(entry.tag, entry.attrs.id))
          .map((reference) => {
            const targets = (byId.get(reference.value) ?? []).filter(
              (o) => !reference.targetDomain || o.domain === reference.targetDomain,
            );
            const target = targets.length === 1 ? targets[0] : undefined;
            return {
              file: record.file,
              ...reference,
              targetDomain: reference.targetDomain ?? target?.domain,
              targetType: target?.ctype,
              evidence: reference.evidence,
            };
          }),
      }));
      const allOwn: DataReference[] = ownByRecord.flatMap((row) => row.refs);
      const own =
        scope === "all"
          ? allOwn
          : ownByRecord
              .filter((row) => row.record.layer === "workspace")
              .flatMap((row) => row.refs);
      const byOwner = new Map<string, DataReference[]>();
      for (const r of allOwn) {
        const key = r.file + "\0" + r.object,
          list = byOwner.get(key);
        if (list) list.push(r);
        else byOwner.set(key, [r]);
      }
      const inherited: DataReference[] = [];
      for (const child of objects.filter(
        (o) => o.id && o.parent && (scope === "all" || o.layer === "workspace"),
      )) {
        const tokens = resolve(child.ctype, child.id),
          seen = new Set<string>();
        let parent = child.parent;
        const childKey = child.ctype + ":" + child.id,
          ownPaths = new Set(
            (byOwner.get(child.file + "\0" + childKey) ?? []).map((r) =>
              r.path.slice(childKey.length),
            ),
          );
        while (parent && !seen.has(parent)) {
          seen.add(parent);
          const matches = byDomain.get(child.domain + "\0" + parent) ?? [];
          if (matches.length !== 1) break;
          const ancestor = matches[0],
            ancestorKey = ancestor.ctype + ":" + ancestor.id;
          for (const reference of (byOwner.get(ancestor.file + "\0" + ancestorKey) ?? []).filter(
            (r) =>
              r.rawExpression?.includes("##") &&
              r.carrier !== "parent" &&
              !ownPaths.has(r.path.slice(ancestorKey.length)),
          )) {
            let value = reference.rawExpression!;
            for (let i = 0; i < 16 && value.includes("##"); i++) {
              const next = value.replace(
                /##([^#]+)##/g,
                (whole, id: string) => tokens[id] ?? whole,
              );
              if (next === value) break;
              value = next;
            }
            reference.rewritePolicy = "readOnly";
            inherited.push({
              ...reference,
              object: childKey,
              path: childKey + reference.path.slice(ancestorKey.length),
              value,
              resolution: value.includes("##") ? "unknown" : "resolved",
              rewritePolicy: "readOnly",
              inheritedFrom: { object: ancestorKey, file: ancestor.file },
            });
          }
          parent = ancestor.parent;
        }
      }
      return [...own, ...inherited];
    });
  }
  async crossReferences() {
    const references: CrossReference[] = [],
      issues: CrossIssue[] = [],
      consumerFiles: Array<{ file: string; sha256: string }> = [];
    let bytes = 0,
      files = 0;
    const walk = async (dir: string) => {
      for (const e of await this.workspace.readDirectory(dir, "data-consumers", (entry) =>
        entry.isDirectory()
          ? !(SKIP.has(entry.name) || entry.name.startsWith(".") || entry.name === "dist-runtime")
          : /\.galaxy$/i.test(entry.name) || ["Triggers", "Objects"].includes(entry.name),
      )) {
        if (SKIP.has(e.name) || e.name.startsWith(".") || e.name === "dist-runtime") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (
          e.isFile() &&
          (/\.galaxy$/i.test(e.name) || ["Triggers", "Objects"].includes(e.name))
        ) {
          if (++files > 4096) throw new Error("REFERENCE_FILE_LIMIT");
          const file = normalize(path.relative(this.workspace.root, full)),
            source = (await this.workspace.readRaw(file)).text;
          if ((bytes += Buffer.byteLength(source)) > 64 * 1024 * 1024)
            throw new Error("REFERENCE_BYTE_LIMIT");
          consumerFiles.push({ file, sha256: createHash("sha256").update(source).digest("hex") });
          const result =
            e.name === "Triggers"
              ? guiReferences(file, source)
              : e.name === "Objects"
                ? objectReferences(file, source)
                : galaxyReferences(file, source);
          references.push(...result.references);
          issues.push(...result.issues);
        }
      }
    };
    await walk(this.workspace.root);
    for (const file of ["Triggers", "Objects"]) {
      const raw = await this.workspace.readRaw(file);
      if (!raw.exists && !raw.staged) continue;
      if (references.some((r) => r.file === file) || issues.some((r) => r.file === file)) continue;
      consumerFiles.push({ file, sha256: createHash("sha256").update(raw.text).digest("hex") });
      const result =
        file === "Triggers" ? guiReferences(file, raw.text) : objectReferences(file, raw.text);
      references.push(...result.references);
      issues.push(...result.issues);
    }
    for (const file of this.workspace
      .draftFiles()
      .filter((file) => /\.galaxy$/i.test(file) || ["Triggers", "Objects"].includes(file))) {
      if (
        references.some((ref) => ref.file === file) ||
        issues.some((issue) => issue.file === file)
      )
        continue;
      const source = (await this.workspace.readRaw(file)).text;
      consumerFiles.push({ file, sha256: createHash("sha256").update(source).digest("hex") });
      const result =
        file === "Triggers"
          ? guiReferences(file, source)
          : file === "Objects"
            ? objectReferences(file, source)
            : galaxyReferences(file, source);
      references.push(...result.references);
      issues.push(...result.issues);
    }
    return {
      references,
      issues,
      files: [...new Map(consumerFiles.map((x) => [x.file, x])).values()].sort((a, b) =>
        a.file.localeCompare(b.file),
      ),
    };
  }
}
