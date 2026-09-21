import { StyleDocument } from "../../core/styleDocument.js";
import { StringTableDocument } from "./stringTable.js";
import { parseRichText } from "./richText.js";
import { TextSchemaRegistry } from "./schemaRegistry.js";
import type { RichTextNode, TextValidationDiagnostic, TextValidationReport } from "./types.js";

function referencedConstants(value: string): string[] {
  return [...value.matchAll(/#([A-Za-z_][\w.-]*)/g)].map((match) => match[1]);
}

function referencedStyles(nodes:RichTextNode[]):string[] {
  return nodes.flatMap(node=>node.kind!=="tag"?[]:[...(node.nativeName.toLowerCase()==="s"?node.attrs.filter(a=>a.name.toLowerCase()==="val").map(a=>a.value):[]),...referencedStyles(node.children)]);
}

export function validateTextSources(
  styleSources: Map<string, string>,
  stringSources: Map<string, string>,
  schema: TextSchemaRegistry,
): TextValidationReport {
  const diagnostics: TextValidationDiagnostic[] = [];
  const styles = new Map<string, { file: string; template?: string }>();
  const constants = new Set<string>(schema.constants.keys());
  const fontGroups = new Set<string>(schema.fontGroups.keys());

  for(const source of styleSources.values()) {
    try {const doc=new StyleDocument(source);for(const c of doc.listConstants())constants.add(c.name);for(const group of doc.listFontGroups())fontGroups.add(group.name);} catch { /* diagnosed below */ }
  }
  for (const [file, source] of styleSources) {
    let document: StyleDocument;
    try { document = new StyleDocument(source); } catch (error) {
      diagnostics.push({ level: "L1", severity: "error", code: "STYLE_PARSE", message: String(error), file });
      continue;
    }
    for (const item of document.diagnostics) diagnostics.push({ level: "L1", severity: item.severity === "error" ? "error" : "warning", code: "STYLE_XML", message: item.message, file });
    for (const constant of document.listConstants()) constants.add(constant.name);
    for (const group of document.listFontGroups()) fontGroups.add(group.name);
    for (const style of document.listStyles()) {
      if (styles.has(style.name)) diagnostics.push({ level: "L4", severity: "error", code: "DUPLICATE_STYLE", message: `Duplicate style '${style.name}'`, file, target: style.name });
      styles.set(style.name, { file, template: style.attrs.template });
      for (const [name, value] of Object.entries(style.attrs)) {
        if (name === "name" || name === "template") continue;
        const problem = schema.validateProperty(name, value);
        if (problem) diagnostics.push({ level: "L2", severity: "warning", code: "STYLE_PROPERTY", message: problem, file, target: style.name });
        for (const reference of referencedConstants(value)) if (!constants.has(reference)) diagnostics.push({ level: "L3", severity: "warning", code: "MISSING_CONSTANT", message: `Unresolved constant #${reference}`, file, target: style.name });
      }
      const font = style.attrs.font;
      if (font && !font.startsWith("#") && !/[\\/]|\.(?:ttf|otf)$/i.test(font) && !fontGroups.has(font)) {
        diagnostics.push({ level: "L3", severity: "warning", code: "UNRESOLVED_FONT", message: `Font '${font}' is neither an indexed font group nor an asset path`, file, target: style.name });
      }
    }
  }

  const allStyleNames = new Set([...schema.styles.keys(), ...styles.keys()]);
  for (const [name, style] of styles) if (style.template && !allStyleNames.has(style.template)) {
    diagnostics.push({ level: "L3", severity: "error", code: "MISSING_TEMPLATE", message: `Style '${name}' references missing template '${style.template}'`, file: style.file, target: name });
  }
  for (const name of styles.keys()) {
    const chain = new Set<string>();
    let cursor: string | undefined = name;
    while (cursor && styles.has(cursor)) {
      if (chain.has(cursor)) {
        diagnostics.push({ level: "L4", severity: "error", code: "TEMPLATE_CYCLE", message: `Style template cycle: ${[...chain, cursor].join(" -> ")}`, file: styles.get(name)?.file, target: name });
        break;
      }
      chain.add(cursor);
      cursor = styles.get(cursor)?.template;
    }
  }

  for (const [file, source] of stringSources) {
    const document = new StringTableDocument(source);
    for (const entry of document.list(undefined, Number.MAX_SAFE_INTEGER)) {
      const rich = parseRichText(entry.value);
      for (const item of rich.diagnostics) diagnostics.push({ level: "L1", severity: item.severity, code: "RICH_TEXT_SYNTAX", message: `${entry.key}: ${item.message}`, file, target: entry.key });
      for (const style of referencedStyles(rich.nodes)) if (!allStyleNames.has(style)) diagnostics.push({ level: "L3", severity: "warning", code: "MISSING_INLINE_STYLE", message: `${entry.key} references unknown style '${style}'`, file, target: entry.key });
    }
  }

  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.filter((entry) => entry.severity === "warning").length;
  return {
    valid: errors === 0,validationScope:"Known static rules only; PASS means no detected error in this scope",semanticCoverage:"PARTIAL",unresolvedRules:["Full native defaults and illegal combinations","Target Editor and game behavior"],
    errors,
    warnings,
    levels: {
      L1: diagnostics.some((entry) => entry.level === "L1" && entry.severity === "error") ? "FAIL" : "PASS",
      L2: diagnostics.some((entry) => entry.level === "L2" && entry.severity === "error") ? "FAIL" : "PASS",
      L3: diagnostics.some((entry) => entry.level === "L3" && entry.severity === "error") ? "FAIL" : "PASS",
      L4: diagnostics.some((entry) => entry.level === "L4" && entry.severity === "error") ? "FAIL" : "PASS",
      L5: "UNAVAILABLE",
      L6: "UNTESTED",
    },
    diagnostics,
  };
}
