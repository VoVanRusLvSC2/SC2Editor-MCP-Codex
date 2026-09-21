import { readFileSync } from "node:fs";
import path from "node:path";
import { projectPath } from "../../app/paths.js";

export interface DataXsdField {
  kind: "element" | "attribute";
  name?: string;
  ref?: string;
  type?: string;
  minOccurs?: string;
  maxOccurs?: string;
  use?: string;
  default?: string;
  fixed?: string;
}

export interface DataXsdType {
  name: string;
  kind: "complex" | "simple";
  base?: string;
  abstract?: boolean;
  mixed?: boolean;
  fields: DataXsdField[];
  enumValues: string[];
  facets: Array<{ kind: string; value: string }>;
}

export interface DataXsdManifest {
  schemaVersion: "1";
  source: { file: string; bytes: number; sha256: string };
  statistics: { complexTypes: number; simpleTypes: number; fields: number; enumValues: number };
  types: Array<{ name: string; kind: "complex" | "simple"; base?: string; fields: number; enumValues: number; shard: string }>;
}

/** Small manifest plus one-file-per-type access to the large declared SC2 Data XSD. */
export class DataXsdRegistry {
  private manifestValue?: DataXsdManifest | null;
  private readonly typeCache = new Map<string, DataXsdType | undefined>();

  constructor(private readonly manifestFile = projectPath("generated/data-xsd-index/manifest.json")) {}

  manifest(): DataXsdManifest | undefined {
    if (this.manifestValue !== undefined) return this.manifestValue ?? undefined;
    try { this.manifestValue = JSON.parse(readFileSync(this.manifestFile, "utf8")) as DataXsdManifest; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") this.manifestValue = null;
      else throw error;
    }
    return this.manifestValue ?? undefined;
  }

  describe(name: string): DataXsdType | undefined {
    const key = name.toLowerCase();
    if (this.typeCache.has(key)) return this.typeCache.get(key);
    const descriptor = this.manifest()?.types.find((entry) => entry.name.toLowerCase() === key);
    if (!descriptor) { this.typeCache.set(key, undefined); return undefined; }
    const file = path.resolve(path.dirname(this.manifestFile), descriptor.shard);
    const value = JSON.parse(readFileSync(file, "utf8")) as DataXsdType;
    this.typeCache.set(key, value);
    return value;
  }

  search(query: string, limit = 50) {
    const needle = query.toLowerCase();
    return (this.manifest()?.types ?? []).filter((entry) => entry.name.toLowerCase().includes(needle)).slice(0, limit);
  }
}
