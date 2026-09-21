import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { TextApplyRequest, TextOperation } from "./types.js";
import { TextWorkspace } from "./workspace.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const styleValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
const styleValues = z.record(z.string(), styleValue);
const operation = z.discriminatedUnion("op", [
  z.object({ op: z.enum(["style.add", "style.set"]), id: z.string().min(1), template: z.string().optional(), values: styleValues }),
  z.object({ op: z.literal("style.clone"), source: z.string().min(1), id: z.string().min(1) }),
  z.object({ op: z.literal("style.setTemplate"), id: z.string().min(1), template: z.string().min(1) }),
  z.object({ op: z.literal("style.rename"), id: z.string().min(1), newId: z.string().min(1) }),
  z.object({ op: z.literal("style.delete"), id: z.string().min(1) }),
  z.object({ op: z.enum(["constant.add", "constant.set"]), id: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ op: z.literal("constant.remove"), id: z.string().min(1) }),
  z.object({ op: z.literal("fontGroup.set"), id: z.string().min(1), fonts: z.array(z.string().min(1)).min(1), requiredToLoad: z.string().optional() }),
  z.object({ op: z.literal("font.import"), source: z.string().min(1), target: z.string().min(1) }),
  z.object({ op: z.literal("text.set"), key: z.string().min(1), value: z.string(), locale: z.string().optional() }),
  z.object({ op: z.literal("text.setLocalized"), key: z.string().min(1), values: z.record(z.string(), z.string()) }),
  z.object({ op: z.literal("text.remove"), key: z.string().min(1), locale: z.string().optional() }),
  z.object({ op: z.literal("richText.style"), key: z.string().min(1), style: z.string().min(1), start: z.number().int().min(0), end: z.number().int().min(0), locale: z.string().optional() }),
  z.object({ op: z.literal("richText.color"), key: z.string().min(1), color: z.string().min(1), start: z.number().int().min(0), end: z.number().int().min(0), locale: z.string().optional() }),
  z.object({ op: z.literal("richText.noWrap"), key: z.string().min(1), start: z.number().int().min(0), end: z.number().int().min(0), locale: z.string().optional() }),
  z.object({ op: z.literal("richText.newLine"), key: z.string().min(1), offset: z.number().int().min(0), locale: z.string().optional() }),
]);

export interface TextToolContext { workspace: TextWorkspace }

export function registerTextTools(server: McpServer, context: TextToolContext): void {
  const text = context.workspace;

  server.registerTool("text.context", {
    description: "Token-efficient batch lookup for Font Styles, fonts, localized keys, locales, schema coverage and the complete text.apply operation registry.",
    inputSchema: z.object({
      styles: z.array(z.string()).max(20).optional(),
      fonts: z.array(z.string()).max(20).optional(),
      keys: z.array(z.string()).max(100).optional(),
      locales: z.array(z.string()).max(30).optional(),
      styleFile: z.string().optional(),
      stringFiles: z.record(z.string(), z.string()).optional(),
    }),
  }, async (args) => textResult(await text.context(args)));

  server.registerTool("text.inspect", {
    description: "Inspect either a Font Style with declared/effective inherited values and constant trace, or a localized text key with lossless SC2 rich-text AST.",
    inputSchema: z.object({
      kind: z.enum(["style", "text"]),
      file: z.string().min(1),
      name: z.string().optional(),
      key: z.string().optional(),
    }),
  }, async ({ kind, file, name, key }) => {
    if (kind === "style") {
      if (!name) throw new Error("Style inspection requires name");
      return textResult(await text.inspectStyle(file, name));
    }
    if (!key) throw new Error("Text inspection requires key");
    return textResult(await text.inspectText(file, key));
  });

  server.registerTool("text.schema.inspect", {
    description: "Inspect the discovered SC2 Font Style property/enum/flag registry with Editor/Core provenance and honest runtime coverage.",
    inputSchema: z.object({ property: z.string().optional(), search: z.string().optional(), limit: z.number().int().min(1).max(500).default(200) }),
  }, async (args) => textResult(text.schema.inspect(args)));

  server.registerTool("text.apply", {
    description: "Atomically apply up to 250 style, constant, font-group, localization and rich-text operations across one or more files. Returns minimal per-file diffs and validation in one call.",
    inputSchema: z.object({
      styleFile: z.string().optional(),
      stringFiles: z.record(z.string(), z.string()).optional(),
      operations: z.array(operation).min(1).max(250),
      dryRun: z.boolean().default(true),
      stage: z.boolean().default(true),
      backup: z.boolean().default(true),
      validate: z.boolean().default(true),
      allowInvalid: z.boolean().default(false),
      expectedSha256: z.record(z.string(), z.string()).optional(),
    }),
  }, async (args) => textResult(await text.apply({ ...args, operations: args.operations as TextOperation[] } as TextApplyRequest)));

  server.registerTool("text.validate", {
    description: "Run L1 syntax, L2 Font Style schema, L3 references and L4 semantics. L5 Editor and L6 runtime remain explicit UNAVAILABLE/UNTESTED until actually executed.",
    inputSchema: z.object({ styleFiles: z.array(z.string()).optional(), stringFiles: z.array(z.string()).optional() }),
  }, async ({ styleFiles, stringFiles }) => textResult(await text.validate(styleFiles, stringFiles)));

  server.registerTool("text.diff", {
    description: "Return minimal staged source diffs for all requested SC2Style/string-table files.",
    inputSchema: z.object({ files: z.array(z.string().min(1)).min(1).max(64) }),
  }, async ({ files }) => textResult({ files: await Promise.all(files.map((file) => text.workspace.diff(file))) }));
}
