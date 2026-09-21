import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AiSchemaData, AiSchemaProperty } from "./types.js";

function projectPath(relative: string): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../", relative);
}

export class AiSchemaRegistry {
  private readonly properties = new Map<string, AiSchemaProperty>();

  private constructor(readonly data: AiSchemaData) {
    for (const property of data.properties) this.properties.set(property.nativeName.toLowerCase(), property);
  }

  static async load(file = projectPath("generated/ai-module-schema.json")): Promise<AiSchemaRegistry> {
    return new AiSchemaRegistry(JSON.parse(await fs.readFile(file, "utf8")) as AiSchemaData);
  }

  property(name: string): AiSchemaProperty | undefined {
    return this.properties.get(name.toLowerCase());
  }

  node(name: string) {
    return this.data.nodes.find((entry) => entry.nativeName.toLowerCase() === name.toLowerCase());
  }

  describe(name?: string) {
    const needle = name?.toLowerCase();
    return {
      schemaVersion: this.data.schemaVersion,
      editorBuild: this.data.editorBuild,
      editorSha256: this.data.editorSha256,
      nodes: this.data.nodes.filter((entry) => !needle || entry.nativeName.toLowerCase().includes(needle)),
      properties: this.data.properties.filter((entry) => !needle || entry.nativeName.toLowerCase().includes(needle) || entry.owners.some((owner) => owner.toLowerCase().includes(needle))),
      triggerTypes: this.data.triggerTypes,
      runtimeFunctions: this.data.runtimeFunctions,
      sources: this.data.sources,
      policy: "Unconfirmed nesting is readable/preserved. Creation requires allowUnconfirmedStructure=true.",
    };
  }
}
