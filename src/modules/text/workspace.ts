import { promises as fs } from "node:fs";
import path from "node:path";
import { StyleDocument } from "../../core/styleDocument.js";
import { Workspace } from "../../core/workspace.js";
import { FontAssetIndex } from "./fonts.js";
import { parseRichText, wrapRichTextRange } from "./richText.js";
import { TextSchemaRegistry } from "./schemaRegistry.js";
import { StringTableDocument } from "./stringTable.js";
import type { ResolvedFontStyle, TextApplyRequest, TextOperation } from "./types.js";
import { validateTextSources } from "./validator.js";

const STYLE_ALIASES: Record<string, string> = {
  horizontaljustify: "hjustify",
  verticaljustify: "vjustify",
  fontflags: "fontflags",
  styleflags: "styleflags",
  textcolor: "textcolor",
  disabledcolor: "disabledcolor",
  highlightcolor: "highlightcolor",
  hotkeycolor: "hotkeycolor",
  hyperlinkcolor: "hyperlinkcolor",
  shadowcolor: "shadowcolor",
  shadowoffset: "shadowoffset",
  outlinewidth: "outlinewidth",
  outlinecolor: "outlinecolor",
  linespacing: "linespacing",
  characterspacing: "characterspacing",
  glowmode: "glowmode",
  glowcolor: "glowcolor",
};

function nativeValue(value: string | number | boolean | string[]): string | number | boolean {
  return Array.isArray(value) ? value.join("|") : value;
}

function nativeStyleValues(values: Record<string, string | number | boolean | string[]>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  const flags: string[] = [];
  for (const [rawName, rawValue] of Object.entries(values)) {
    const normalized = rawName.replace(/[._-]/g, "").toLowerCase();
    if (normalized === "shadow" || normalized === "outline") {
      flags.push(rawValue === false ? `!${normalized === "shadow" ? "Shadow" : "Outline"}` : (normalized === "shadow" ? "Shadow" : "Outline"));
      continue;
    }
    const name = STYLE_ALIASES[normalized] ?? rawName;
    output[name] = nativeValue(rawValue);
  }
  if (flags.length) output.styleflags = [String(output.styleflags ?? ""), ...flags].filter(Boolean).join("|");
  return output;
}

function localeFromPath(file: string): string | undefined {
  const match = file.replaceAll("\\", "/").match(/(?:^|\/)([a-z]{2})([a-z]{2})\.sc2data\/LocalizedData\//i);
  return match ? `${match[1].toLowerCase()}${match[2].toUpperCase()}` : undefined;
}

export class TextWorkspace {
  readonly fonts: FontAssetIndex;

  constructor(readonly workspace: Workspace, readonly schema: TextSchemaRegistry) {
    const observedFonts = [
      ...(schema.corpus.fontPaths ?? []),
      ...[...schema.fontGroups.values()].flatMap((entry) => entry.fonts),
    ].filter((entry) => /\.(?:ttf|otf)$/i.test(entry));
    this.fonts = new FontAssetIndex(workspace.root, [...new Set(observedFonts)]);
  }

  async context(query: { styles?: string[]; fonts?: string[]; keys?: string[]; locales?: string[]; styleFile?: string; stringFiles?: Record<string, string> }) {
    const [files, stringFiles] = await Promise.all([this.workspace.listStyleFiles(), this.workspace.listStringFiles()]);
    const localStyles = [] as Array<{ file: string; name: string; attrs: Record<string, string> }>;
    for (const file of files) {
      const { doc } = await this.workspace.readStyle(file);
      for (const style of doc.listStyles()) localStyles.push({ file, name: style.name, attrs: style.attrs });
    }
    const styleQueries = query.styles ?? [];
    const styles = styleQueries.length
      ? styleQueries.flatMap((search) => [
        ...localStyles.filter((entry) => entry.name.toLowerCase().includes(search.toLowerCase())),
        ...this.schema.searchStyles(search, 20).map((entry) => ({ file: entry.sourceFile, name: entry.name, attrs: entry.attrs })),
      ])
      : [];
    const fonts = (await Promise.all((query.fonts ?? []).map((search) => this.fonts.search(search, 20)))).flat();
    const keys = [] as Array<{ locale: string; file: string; key: string; value: string }>;
    for (const [locale, file] of Object.entries(query.stringFiles ?? {})) {
      const raw = await this.workspace.readRaw(file);
      const document = new StringTableDocument(raw.text);
      for (const key of query.keys ?? []) {
        const entry = document.get(key);
        if (entry) keys.push({ locale, file, key, value: entry.value });
      }
    }
    return {
      files: { styles: files, strings: stringFiles },
      locales: [...new Set(stringFiles.map(localeFromPath).filter((entry): entry is string => Boolean(entry)))],
      styles,
      fonts,
      textKeys: keys,
      schema: this.schema.coverage(),
      operations: {
        style: ["style.add", "style.set", "style.clone", "style.setTemplate", "style.rename", "style.delete"],
        constants: ["constant.add", "constant.set", "constant.remove", "fontGroup.set", "font.import"],
        content: ["text.set", "text.setLocalized", "text.remove"],
        richText: ["richText.style", "richText.color", "richText.newLine", "richText.noWrap"],
      },
      recommendedWorkflow: "one text.context + one text.apply; apply validates and returns per-file minimal diff",
    };
  }

  async inspectStyle(file: string, name: string): Promise<ResolvedFontStyle> {
    const { doc } = await this.workspace.readStyle(file);
    const styles = new Map(doc.listStyles().map((entry) => [entry.name, entry]));
    const constants = new Map([...this.schema.constants.values()].map((entry) => [entry.name, entry.value]));
    for (const entry of doc.listConstants()) constants.set(entry.name, entry.value);
    const declared = styles.get(name) ?? this.schema.styles.get(name);
    if (!declared) throw new Error(`Style not found: ${name}`);
    const effective: Record<string, { nativeValue: string; reference?: string; resolvedValue?: string }> = {};
    const trace: string[] = [];
    const visiting = new Set<string>();
    const resolveConstant = (value: string): { nativeValue: string; reference?: string; resolvedValue?: string } => {
      if (!value.startsWith("#")) return { nativeValue: value, resolvedValue: value };
      const reference = value.slice(1);
      let resolved = constants.get(reference);
      const chain = new Set([reference]);
      while (resolved?.startsWith("#") && !chain.has(resolved.slice(1))) { chain.add(resolved.slice(1)); resolved = constants.get(resolved.slice(1)); }
      return { nativeValue: value, reference, resolvedValue: resolved };
    };
    const resolve = (id: string) => {
      if (visiting.has(id)) throw new Error(`Style template cycle at ${id}`);
      const current = styles.get(id) ?? this.schema.styles.get(id);
      if (!current) throw new Error(`Missing style template: ${id}`);
      visiting.add(id);
      if (current.attrs.template) resolve(current.attrs.template);
      for (const [key, value] of Object.entries(current.attrs)) if (key !== "name" && key !== "template") effective[key] = resolveConstant(value);
      trace.push(id);
      visiting.delete(id);
    };
    resolve(name);
    const consumers = new Set([...styles.values()].filter((entry) => entry.attrs.template === name).map((entry) => `style:${entry.name}`));
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const [workspaceFiles, stringFiles] = await Promise.all([this.workspace.listFiles(), this.workspace.listStringFiles()]);
    for (const styleFile of workspaceFiles.styles) {
      if (styleFile === file) continue;
      const source = (await this.workspace.readRaw(styleFile)).text;
      if (new RegExp(`\\btemplate\\s*=\\s*["']${escapedName}["']`, "i").test(source)) consumers.add(`style-template:${styleFile}`);
    }
    for (const stringFile of stringFiles) {
      const source = (await this.workspace.readRaw(stringFile)).text;
      if (new RegExp(`<s\\b[^>]*\\bval\\s*=\\s*["']${escapedName}["']`, "i").test(source)) consumers.add(`rich-text:${stringFile}`);
    }
    for (const layoutFile of workspaceFiles.layouts) {
      const source = (await this.workspace.readRaw(layoutFile)).text;
      if (new RegExp(`<Style\\b[^>]*\\bval\\s*=\\s*["']${escapedName}["']`, "i").test(source)) consumers.add(`ui:${layoutFile}`);
    }
    return {
      name,
      sourceFile: "sourceFile" in declared ? declared.sourceFile : file,
      template: declared.attrs.template,
      declared: Object.fromEntries(Object.entries(declared.attrs).filter(([key]) => key !== "name").map(([key, value]) => [key, resolveConstant(value)])),
      effective,
      resolutionTrace: trace,
      consumers: [...consumers],
    };
  }

  private stringFileFor(operation: TextOperation, files: Record<string, string>): string {
    const locale = "locale" in operation ? operation.locale : undefined;
    if (locale) {
      const file = files[locale];
      if (!file) throw new Error(`No string-table file configured for locale ${locale}`);
      return file;
    }
    const entries = Object.entries(files);
    if (entries.length !== 1) throw new Error("Text operation must specify locale when more than one string file is configured");
    if (!entries.length) throw new Error("Text operation requires stringFiles");
    return entries[0][1];
  }

  async apply(request: TextApplyRequest) {
    if (!request.operations.length) throw new Error("text.apply requires at least one operation");
    if (request.operations.length > 250) throw new Error("text.apply accepts at most 250 operations");
    const hasFontImport = request.operations.some((entry) => entry.op === "font.import");
    if (hasFontImport && request.operations.length !== 1) throw new Error("font.import is isolated so binary import cannot partially commit with text/style edits");
    if (hasFontImport) return this.importFont(request.operations[0] as Extract<TextOperation, { op: "font.import" }>, request);

    const required = new Set<string>();
    if (request.operations.some((entry) => entry.op.startsWith("style.") || entry.op.startsWith("constant.") || entry.op === "fontGroup.set")) {
      if (!request.styleFile) throw new Error("Style operation requires styleFile");
      required.add(request.styleFile);
    }
    if (request.operations.some((entry) => entry.op === "style.rename" || entry.op === "style.delete")) {
      for (const file of Object.values(request.stringFiles ?? {})) required.add(file);
    }
    for (const operation of request.operations) {
      if (operation.op.startsWith("text.") || operation.op.startsWith("richText.")) {
        if (operation.op === "text.setLocalized") for (const locale of Object.keys(operation.values)) {
          const file = request.stringFiles?.[locale];
          if (!file) throw new Error(`No string-table file configured for locale ${locale}`);
          required.add(file);
        } else required.add(this.stringFileFor(operation, request.stringFiles ?? {}));
      }
    }

    let validation: ReturnType<typeof validateTextSources> | undefined;
    const transaction = await this.workspace.applyRawTransaction([...required], async (sources) => {
      const next = new Map(sources);
      const style = request.styleFile ? new StyleDocument(next.get(request.styleFile) || `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<StyleFile>\n</StyleFile>\n`) : undefined;
      const table = (file: string) => new StringTableDocument(next.get(file) ?? "");
      for (const operation of request.operations) {
        switch (operation.op) {
          case "style.add":
            if (style!.getStyle(operation.id)) throw new Error(`Style already exists: ${operation.id}`);
            style!.upsertStyle(operation.id, { ...(operation.template ? { template: operation.template } : {}), ...nativeStyleValues(operation.values) });
            break;
          case "style.set": style!.upsertStyle(operation.id, { ...(operation.template ? { template: operation.template } : {}), ...nativeStyleValues(operation.values) }); break;
          case "style.clone": style!.cloneStyle(operation.source, operation.id); break;
          case "style.setTemplate": style!.upsertStyle(operation.id, { template: operation.template }); break;
          case "style.rename": {
            style!.renameStyle(operation.id, operation.newId);
            for (const [locale, file] of Object.entries(request.stringFiles ?? {})) {
              void locale;
              const document = table(file);
              for (const entry of document.list(undefined, Number.MAX_SAFE_INTEGER)) {
                const changed = entry.value.replace(new RegExp(`(<s\\b[^>]*\\bval\\s*=\\s*["'])${operation.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'])`, "gi"), `$1${operation.newId}$2`);
                if (changed !== entry.value) document.set(entry.key, changed);
              }
              next.set(file, document.source);
            }
            break;
          }
          case "style.delete": {
            for (const file of Object.values(request.stringFiles ?? {})) {
              const document = table(file);
              if (document.list(undefined, Number.MAX_SAFE_INTEGER).some((entry) => new RegExp(`<s\\b[^>]*\\bval\\s*=\\s*["']${operation.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(entry.value))) throw new Error(`Style '${operation.id}' is referenced by ${file}`);
            }
            style!.deleteStyle(operation.id);
            break;
          }
          case "constant.add":
            if (style!.getConstant(operation.id)) throw new Error(`Constant already exists: ${operation.id}`);
            style!.upsertConstant(operation.id, operation.value);
            break;
          case "constant.set": style!.upsertConstant(operation.id, operation.value); break;
          case "constant.remove": style!.deleteConstant(operation.id); break;
          case "fontGroup.set": style!.upsertFontGroup(operation.id, operation.fonts.map((font) => ({ font })), operation.requiredToLoad ? { requiredtoload: operation.requiredToLoad } : {}); break;
          case "text.set": {
            const file = this.stringFileFor(operation, request.stringFiles ?? {});
            const document = table(file); document.set(operation.key, operation.value); next.set(file, document.source); break;
          }
          case "text.setLocalized":
            for (const [locale, value] of Object.entries(operation.values)) {
              const file = request.stringFiles![locale]; const document = table(file); document.set(operation.key, value); next.set(file, document.source);
            }
            break;
          case "text.remove": {
            const file = this.stringFileFor(operation, request.stringFiles ?? {}); const document = table(file); document.remove(operation.key); next.set(file, document.source); break;
          }
          case "richText.style":
          case "richText.color":
          case "richText.noWrap": {
            const file = this.stringFileFor(operation, request.stringFiles ?? {}); const document = table(file); const entry = document.get(operation.key);
            if (!entry) throw new Error(`Text key not found: ${operation.key}`);
            const tag = operation.op === "richText.style" ? "s" : operation.op === "richText.color" ? "c" : "w";
            const value = operation.op === "richText.style" ? operation.style : operation.op === "richText.color" ? operation.color : undefined;
            document.set(operation.key, wrapRichTextRange(entry.value, operation.start, operation.end, tag, value)); next.set(file, document.source); break;
          }
          case "richText.newLine": {
            const file = this.stringFileFor(operation, request.stringFiles ?? {}); const document = table(file); const entry = document.get(operation.key);
            if (!entry || operation.offset < 0 || operation.offset > entry.value.length) throw new Error(`Invalid new-line offset for ${operation.key}`);
            document.set(operation.key, entry.value.slice(0, operation.offset) + "<n/>" + entry.value.slice(operation.offset)); next.set(file, document.source); break;
          }
          case "font.import": throw new Error("Unexpected font.import in text transaction");
        }
      }
      if (style && request.styleFile) next.set(request.styleFile, style.source);
      const styleSources = new Map([...next].filter(([file]) => /\.SC2Style$/i.test(file)));
      const stringSources = new Map([...next].filter(([file]) => /Strings\.txt$/i.test(file)));
      validation = validateTextSources(styleSources, stringSources, this.schema);
      if ((request.validate ?? true) && !validation.valid && !request.allowInvalid) throw new Error(`Text transaction validation failed: ${validation.errors} error(s)`);
      return next;
    }, request);
    return { ...transaction, validation, operations: request.operations.map((entry, index) => ({ index, op: entry.op })), efficiency: { toolCalls: 1, operations: request.operations.length, files: transaction.files.length, includesValidation: request.validate ?? true, includesDiff: true } };
  }

  private async importFont(operation: Extract<TextOperation, { op: "font.import" }>, request: TextApplyRequest) {
    const source = path.resolve(operation.source);
    const target = this.workspace.resolveUserPath(operation.target);
    if (!/\.(?:ttf|otf)$/i.test(target)) throw new Error("Imported font target must end in .ttf or .otf");
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error("Font source is not a file");
    const bytes = await fs.readFile(source);
    const dryRun = request.dryRun ?? true;
    await this.workspace.binary.apply([operation.target], () => new Map([[this.workspace.binary.key(operation.target), bytes]]), { dryRun, stage: false, requireMissing: true });
    return { accepted: true, import: { source, target: operation.target, bytes: bytes.length, dryRun, saved: !dryRun }, efficiency: { toolCalls: 1, operations: 1, files: 1, includesValidation: true, includesDiff: false } };
  }

  async inspectText(file: string, key: string) {
    const raw = await this.workspace.readRaw(file);
    const entry = new StringTableDocument(raw.text).get(key);
    if (!entry) throw new Error(`Text key not found: ${key}`);
    return { file: raw.file, locale: localeFromPath(file), entry, richText: parseRichText(entry.value) };
  }

  async validate(styleFiles?: string[], stringFiles?: string[]) {
    const selectedStyles = styleFiles ?? await this.workspace.listStyleFiles();
    const selectedStrings = stringFiles ?? await this.workspace.listStringFiles();
    const styles = new Map<string, string>();
    const strings = new Map<string, string>();
    for (const file of selectedStyles) styles.set(file, (await this.workspace.readRaw(file)).text);
    for (const file of selectedStrings) strings.set(file, (await this.workspace.readRaw(file)).text);
    return validateTextSources(styles, strings, this.schema);
  }
}
