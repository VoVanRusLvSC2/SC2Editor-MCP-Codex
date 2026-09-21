import path from "node:path";
import { LayoutDocument } from "./layoutDocument.js";
import { StyleDocument } from "./styleDocument.js";

export interface LayoutIndexEntry {
  file: string;
  descName: string;
  includes: string[];
  templates: Set<string>;
  templateFramePaths: Map<string, Set<string>>;
  handles: Set<string>;
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
}

function descriptorName(file: string): string {
  return path.basename(file).replace(/\.(?:SC2Layout|StormLayout)$/i, "");
}

export class CrossFileResolver {
  readonly layouts = new Map<string, LayoutIndexEntry>();
  readonly styles = new Set<string>();
  readonly handles = new Set<string>();

  static async build(
    layoutFiles: string[],
    styleFiles: string[],
    readText: (file: string) => Promise<string>,
  ): Promise<CrossFileResolver> {
    const resolver = new CrossFileResolver();
    for (const file of layoutFiles) {
      const doc = new LayoutDocument(await readText(file));
      const entry: LayoutIndexEntry = {
        file,
        descName: descriptorName(file),
        includes: doc.includes(),
        templates: new Set(doc.listFrames().filter((frame) => !frame.path.includes("/")).map((frame) => frame.name)),
        templateFramePaths: new Map(),
        handles: new Set(doc.listFrames().map((frame) => frame.handle).filter((value): value is string => Boolean(value))),
      };
      for (const template of doc.listFrames().filter((frame) => !frame.path.includes("/"))) {
        entry.templateFramePaths.set(template.name, new Set(
          doc.listFrames()
            .filter((frame) => frame.path.startsWith(`${template.path}/`))
            .map((frame) => frame.path.slice(template.path.length + 1)),
        ));
      }
      resolver.layouts.set(normalize(file), entry);
      for (const handle of entry.handles) resolver.handles.add(handle);
    }
    for (const file of styleFiles) {
      const doc = new StyleDocument(await readText(file));
      for (const style of doc.listStyles()) resolver.styles.add(style.name);
    }
    return resolver;
  }

  findLayoutByDescName(name: string): LayoutIndexEntry | undefined {
    const wanted = name.toLowerCase();
    return [...this.layouts.values()].find((entry) => entry.descName.toLowerCase() === wanted);
  }

  resolveInclude(includePath: string): LayoutIndexEntry | undefined {
    return this.layouts.get(normalize(includePath));
  }

  resolveTemplate(reference: string, currentFile: string): { found: boolean; file?: string; template?: string } {
    const clean = reference.replace(/^\$root\//i, "");
    const parts = clean.split("/").filter(Boolean);
    let entry: LayoutIndexEntry | undefined;
    let template: string;
    if (parts.length > 1) {
      entry = this.findLayoutByDescName(parts[0]);
      template = parts.slice(1).join("/");
    } else {
      entry = this.layouts.get(normalize(currentFile));
      template = parts[0] ?? "";
    }
    return { found: Boolean(entry?.templates.has(template)), file: entry?.file, template };
  }

  templateProvidesHookup(reference: string, currentFile: string, hookupPath: string): boolean {
    const resolved = this.resolveTemplate(reference, currentFile);
    if (!resolved.found || !resolved.file || !resolved.template) return false;
    const entry = this.layouts.get(normalize(resolved.file));
    return entry?.templateFramePaths.get(resolved.template)?.has(hookupPath) ?? false;
  }

  resolveFrameReference(reference: string): boolean {
    if (!reference || ["$this", "$parent", "$root"].includes(reference.toLowerCase())) return true;
    if (/^\$(?:this|parent|root)(?:\/|$)/i.test(reference)) return true;
    if (reference.startsWith("$")) {
      const handle = reference.slice(1).split("/", 1)[0];
      return this.handles.has(handle);
    }
    return true;
  }

  hasStyle(name: string): boolean {
    const clean = name.replace(/^@@?/, "");
    return this.styles.has(clean) || this.styles.has(name);
  }

  summary(): unknown {
    return {
      layouts: this.layouts.size,
      templates: [...this.layouts.values()].reduce((sum, entry) => sum + entry.templates.size, 0),
      handles: this.handles.size,
      styles: this.styles.size,
    };
  }
}
