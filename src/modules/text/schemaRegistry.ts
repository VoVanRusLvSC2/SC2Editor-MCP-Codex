import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FontStylePropertySchema, TextSchemaData } from "./types.js";

interface BundledStyle {
  name: string;
  template?: string;
  attrs: Record<string, string>;
  sourceFile: string;
}

interface BundledCorpus {
  styles: BundledStyle[];
  constants: Array<{ name: string; value: string; sourceFile: string }>;
  fontGroups: Array<{ name: string; fonts: string[]; sourceFile: string }>;
  fontPaths?: string[];
  statistics: Record<string, number>;
}

function projectPath(relative: string): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../", relative);
}

export class TextSchemaRegistry {
  readonly properties = new Map<string, FontStylePropertySchema>();
  readonly styles = new Map<string, BundledStyle>();
  readonly constants = new Map<string, { name: string; value: string; sourceFile: string }>();
  readonly fontGroups = new Map<string, { name: string; fonts: string[]; sourceFile: string }>();

  private constructor(readonly data: TextSchemaData, readonly corpus: BundledCorpus) {
    for (const property of data.properties) this.properties.set(property.nativeName.toLowerCase(), property);
    for (const style of corpus.styles) this.styles.set(style.name, style);
    for (const constant of corpus.constants) this.constants.set(constant.name, constant);
    for (const group of corpus.fontGroups) this.fontGroups.set(group.name, group);
  }

  static async load(): Promise<TextSchemaRegistry> {
    const [schemaText, corpusText] = await Promise.all([
      fs.readFile(projectPath("generated/text-font-style-schema.json"), "utf8"),
      fs.readFile(projectPath("generated/font-style-corpus.json"), "utf8"),
    ]);
    return new TextSchemaRegistry(JSON.parse(schemaText) as TextSchemaData, JSON.parse(corpusText) as BundledCorpus);
  }

  getProperty(name: string): FontStylePropertySchema | undefined {
    return this.properties.get(name.toLowerCase());
  }

  validateProperty(name: string, rawValue: string): string | undefined {
    const property = this.getProperty(name);
    if (!property) return `Unknown Font Style property '${name}'`;
    if (rawValue.startsWith("#")) return undefined;
    if (property.valueType === "integer") {
      const value = Number(rawValue);
      if (!Number.isInteger(value)) return `${name} must be an integer or #Constant reference`;
      if (property.minimum !== undefined && value < property.minimum) return `${name} must be >= ${property.minimum}`;
      if (property.maximum !== undefined && value > property.maximum) return `${name} must be <= ${property.maximum}`;
    }
    if (property.valueType === "decimal") {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return `${name} must be a decimal or #Constant reference`;
      if (property.minimum !== undefined && value < property.minimum) return `${name} must be >= ${property.minimum}`;
      if (property.maximum !== undefined && value > property.maximum) return `${name} must be <= ${property.maximum}`;
    }
    if (property.valueType === "enum" && property.enumValues?.length && !property.enumValues.some((entry) => entry.toLowerCase() === rawValue.toLowerCase())) {
      return `${name} must be one of: ${property.enumValues.join(", ")}`;
    }
    if (property.valueType === "flags") {
      const known = property.nativeName === "styleflags" ? this.data.styleFlags : this.data.fontFlags;
      const unknown = rawValue.split("|").map((entry) => entry.trim().replace(/^!/, "")).filter(Boolean)
        .filter((entry) => !known.some((candidate) => candidate.toLowerCase() === entry.toLowerCase()));
      if (unknown.length) return `${name} contains unclassified native flag(s): ${unknown.join(", ")}`;
    }
    if (property.valueType === "color" && !/^(?:[0-9a-f]{6}|[0-9a-f]{8}|\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*\d{1,3})?)$/i.test(rawValue)) {
      return `${name} must be native 6/8-digit hex, RGB(A), or a #Constant reference`;
    }
    return undefined;
  }

  inspect(query: { property?: string; search?: string; limit?: number } = {}) {
    const needle = (query.property ?? query.search)?.toLowerCase();
    const properties = this.data.properties.filter((entry) => !needle || entry.nativeName.toLowerCase().includes(needle) || entry.description?.toLowerCase().includes(needle)).slice(0, query.limit ?? 200);
    return {
      schemaVersion: this.data.schemaVersion,
      editorBuild: this.data.editorBuild,
      editorSha256: this.data.editorSha256,
      properties,
      enums: {
        styleFlags: this.data.styleFlags,
        fontFlags: this.data.fontFlags,
        horizontalJustify: this.data.horizontalJustify,
        verticalJustify: this.data.verticalJustify,
        glowModes: this.data.glowModes,
      },
      evidence: this.data.sources,
    };
  }

  searchStyles(search: string | undefined, limit = 20): BundledStyle[] {
    const needle = search?.toLowerCase();
    return [...this.styles.values()]
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.template?.toLowerCase().includes(needle))
      .slice(0, limit);
  }

  resolveBundledStyle(name: string): { declared?: BundledStyle; effective: Record<string, string>; trace: string[]; diagnostics: string[] } {
    const declared = this.styles.get(name);
    const effective: Record<string, string> = {};
    const trace: string[] = [];
    const diagnostics: string[] = [];
    const visiting = new Set<string>();
    const resolve = (id: string) => {
      if (visiting.has(id)) { diagnostics.push(`Template cycle at ${id}`); return; }
      const style = this.styles.get(id);
      if (!style) { diagnostics.push(`Missing bundled template ${id}`); return; }
      visiting.add(id);
      if (style.template) resolve(style.template);
      for (const [key, value] of Object.entries(style.attrs)) if (key !== "name" && key !== "template") effective[key] = value;
      trace.push(id);
      visiting.delete(id);
    };
    if (declared) resolve(name);
    return { declared, effective, trace, diagnostics };
  }

  coverage() {
    return {
      stylePropertiesDiscovered: this.data.properties.length,
      stylePropertiesEditable: this.data.properties.filter((entry) => entry.coverage === "SUPPORTED").length,
      stylesIndexed: this.styles.size,
      constantsIndexed: this.constants.size,
      fontGroupsIndexed: this.fontGroups.size,
      editorBuild: this.data.editorBuild,
      runtime: "UNTESTED",
    };
  }
}
