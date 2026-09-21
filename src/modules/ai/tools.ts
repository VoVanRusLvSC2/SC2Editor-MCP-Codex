import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AiOperation, AiSelector } from "./types.js";
import { AiWorkspace } from "./workspace.js";

function textResult(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }; }
const scalar = z.union([z.string(), z.number(), z.boolean()]);
const selector: z.ZodType<AiSelector> = z.union([z.string().min(1), z.object({ id: z.string().optional(), nodeId: z.number().int().min(0).optional(), nativeType: z.string().optional(), occurrence: z.number().int().min(0).optional() })]);
const nativeNode: z.ZodType<{ nativeType: string; attrs?: Record<string, string | number | boolean>; value?: string | number | boolean; children?: unknown[] }> = z.lazy(() => z.object({ nativeType: z.string().regex(/^[A-Za-z_][\w:.-]*$/), attrs: z.record(z.string(), scalar).optional(), value: scalar.optional(), children: z.array(nativeNode).optional() }));
const commonUnconfirmed = { allowUnconfirmedStructure: z.boolean().optional() };
const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("definition.create"), as: z.string().optional(), id: z.string().min(1), properties: z.record(z.string(), scalar).optional(), ...commonUnconfirmed }),
  z.object({ op: z.literal("definition.update"), definition: selector, properties: z.record(z.string(), scalar), ...commonUnconfirmed }),
  z.object({ op: z.literal("definition.rename"), definition: selector, newId: z.string().min(1), updateReferences: z.boolean().optional() }),
  z.object({ op: z.literal("definition.clone"), definition: selector, id: z.string().min(1), as: z.string().optional() }),
  z.object({ op: z.literal("definition.delete"), definition: selector, force: z.boolean().optional() }),
  z.object({ op: z.literal("definition.reorder"), definition: selector, before: selector.optional(), after: selector.optional() }),
  z.object({ op: z.literal("wave.create"), definition: selector, id: z.string().min(1), as: z.string().optional(), properties: z.record(z.string(), scalar).optional(), composition: z.array(z.object({ unit: z.string().min(1), quantity: z.number().int().positive() })).optional(), ...commonUnconfirmed }),
  z.object({ op: z.literal("wave.update"), wave: selector, properties: z.record(z.string(), scalar), ...commonUnconfirmed }),
  z.object({ op: z.literal("wave.rename"), wave: selector, newId: z.string().min(1), updateReferences: z.boolean().optional() }),
  z.object({ op: z.literal("wave.clone"), wave: selector, id: z.string().min(1), as: z.string().optional() }),
  z.object({ op: z.literal("wave.delete"), wave: selector, force: z.boolean().optional() }),
  z.object({ op: z.literal("wave.reorder"), wave: selector, before: selector.optional(), after: selector.optional() }),
  z.object({ op: z.literal("composition.patch"), wave: selector, mode: z.enum(["replace", "add", "remove"]), units: z.array(z.object({ unit: z.string().min(1), quantity: z.number().int().positive().optional() })), unitTag: z.string().optional(), ...commonUnconfirmed }),
  z.object({ op: z.literal("native.add"), parent: selector.optional(), as: z.string().optional(), node: nativeNode, ...commonUnconfirmed }),
  z.object({ op: z.literal("native.set"), node: selector, property: z.string().min(1), value: scalar, allowUnknown: z.boolean().optional() }),
  z.object({ op: z.literal("native.remove"), node: selector, force: z.boolean().optional() }),
]);

export const aiApplySchema = z.object({ file: z.string().default("CustomAI"), componentListFile: z.string().optional(), operations: z.array(operation).min(1).max(250), dryRun: z.boolean().default(true), stage: z.boolean().default(true), backup: z.boolean().default(true), validate: z.boolean().default(true), allowInvalid: z.boolean().default(false), expectedSha256: z.record(z.string(), z.string()).optional(), expectedSourceSha256: z.record(z.string(), z.string()).optional() });

export interface AiToolContext { workspace: AiWorkspace }

export function registerAiTools(server: McpServer, context: AiToolContext): void {
  const ai = context.workspace;
  server.registerTool("ai.context", {
    description: "One-call selective context for native CustomAI definitions, waves, composition, timing, references, Trigger bindings, dependencies, diagnostics and operation registry.",
    inputSchema: z.object({ file: z.string().optional(), definitions: z.array(z.string()).max(100).optional(), waves: z.array(z.string()).max(100).optional(), units: z.array(z.string()).max(100).optional(), includeNative: z.boolean().default(false), includeTriggers: z.boolean().default(true), limit: z.number().int().min(1).max(2000).default(100) }),
  }, async (args) => textResult(await ai.context(args)));

  server.registerTool("ai.query", {
    description: "Batch-search CustomAI definitions/waves, timing, unit composition, dependency references, Trigger bindings or invalid references.",
    inputSchema: z.object({ file: z.string().optional(), kind: z.enum(["definitions", "waves", "references", "triggerBindings", "invalid"]).optional(), text: z.string().optional(), unit: z.string().optional(), minTime: z.number().min(0).optional(), maxTime: z.number().min(0).optional(), limit: z.number().int().min(1).max(2000).default(100) }),
  }, async (args) => textResult(await ai.query(args)));

  server.registerTool("ai.describe_type", {
    description: "Describe recovered native AI nodes/properties, types, defaults, constraints, reference kinds and exact evidence. Use only for unfamiliar AI fields.",
    inputSchema: z.object({ type: z.string().optional() }),
  }, async ({ type }) => textResult(ai.schema.describe(type)));

  server.registerTool("ai.apply", {
    description: "Atomically apply up to 250 CustomAI operations and aliases; validates before committing CustomAI and its sibling ComponentList. Trigger links are read-only; referenced renames/deletes are blocked. Defaults to dry-run.",
    inputSchema: aiApplySchema,
  }, async (args) => textResult(await ai.apply({ ...args, operations: args.operations as AiOperation[] })));

  server.registerTool("ai.validate", {
    description: "Validate CustomAI at L1 syntax, L2 recovered schema, L3 references/Trigger cross-links and L4 semantics. L5 Editor and L6 game runtime remain explicit.",
    inputSchema: z.object({ file: z.string().default("CustomAI") }),
  }, async ({ file }) => textResult(await ai.validate(file)));
}
