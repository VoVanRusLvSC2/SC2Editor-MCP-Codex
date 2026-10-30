import path from "node:path";
import { LayoutDocument } from "./layoutDocument.js";
import { StyleDocument } from "./styleDocument.js";
import { createHash } from "node:crypto";
import { PreparedValueCache } from "./preparedValues.js";
import type { FrameSummary } from "./types.js";

const preparedLayouts = new PreparedValueCache<{ frames: FrameSummary[]; includes: string[] }>(
  16,
  8 * 1024 * 1024,
);
const preparedStyles = new PreparedValueCache<string[]>(16, 8 * 1024 * 1024);
const contentKey = (source: string) => createHash("sha256").update(source).digest("hex");

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
      const source = await readText(file),
        key = contentKey(source);
      let metadata = preparedLayouts.get(key);
      if (!metadata) {
        const doc = new LayoutDocument(source);
        metadata = { frames: doc.listFrames(), includes: doc.includes() };
        preparedLayouts.set(
          key,
          metadata,
          Buffer.byteLength(source) + Buffer.byteLength(JSON.stringify(metadata)),
        );
      }
      const { frames } = metadata;
      const entry: LayoutIndexEntry = {
        file,
        descName: descriptorName(file),
        includes: metadata.includes,
        templates: new Set(
          frames.filter((frame) => !frame.path.includes("/")).map((frame) => frame.name),
        ),
        templateFramePaths: new Map(),
        handles: new Set(
          frames.map((frame) => frame.handle).filter((value): value is string => Boolean(value)),
        ),
      };
      for (const template of frames.filter((frame) => !frame.path.includes("/"))) {
        entry.templateFramePaths.set(
          template.name,
          new Set(
            frames
              .filter((frame) => frame.path.startsWith(`${template.path}/`))
              .map((frame) => frame.path.slice(template.path.length + 1)),
          ),
        );
      }
      resolver.layouts.set(normalize(file), entry);
      for (const handle of entry.handles) resolver.handles.add(handle);
    }
    for (const file of styleFiles) {
      const source = await readText(file),
        key = contentKey(source);
      let names = preparedStyles.get(key);
      if (!names) {
        names = new StyleDocument(source).listStyles().map((style) => style.name);
        preparedStyles.set(
          key,
          names,
          Buffer.byteLength(source) + Buffer.byteLength(JSON.stringify(names)),
        );
      }
      for (const name of names) resolver.styles.add(name);
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
