import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DataWorkspace } from "./workspace.js";
import type { DataNativeFieldSpec, DataObjectSelector, DataOperation } from "./types.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const dataId = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const selector: z.ZodType<DataObjectSelector> = z.union([z.string().min(1), z.object({ id: z.string().min(1), ctype: z.string().min(2).optional(), domain: z.string().min(1).optional() })]);
const nativeField: z.ZodType<DataNativeFieldSpec> = z.lazy(() => z.object({
  name: z.string().min(1), index: z.union([z.string(), z.number()]).optional(), value: scalar.optional(), link: z.string().optional(),
  attrs: z.record(z.string(), scalar).optional(), children: z.array(nativeField).optional(),
}));
const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("object.create"), as: z.string().optional(), ctype: z.string().regex(/^C[A-Z]/), id: z.string().min(1), parent: z.string().optional(), attrs: z.record(z.string(), scalar).optional(), fields: z.array(nativeField).optional() }),
  z.object({ op: z.literal("object.clone"), as: z.string().optional(), object: selector, id: z.string().min(1), parent: z.string().optional() }),
  z.object({ op: z.literal("object.rename"), object: selector, newId: z.string().min(1), updateReferences: z.boolean().optional() }),
  z.object({ op: z.literal("object.delete"), object: selector, force: z.boolean().optional() }),
  z.object({ op: z.literal("object.setParent"), object: selector, parent: z.string().optional() }),
  z.object({ op: z.literal("object.setAttribute"), object: selector, attribute: z.string().min(1), value: scalar }),
  z.object({ op: z.literal("object.removeAttribute"), object: selector, attribute: z.string().min(1) }),
  z.object({ op: z.literal("field.set"), object: selector, path: z.string().min(1), value: scalar }),
  z.object({ op: z.literal("field.setLink"), object: selector, path: z.string().min(1), link: z.string().min(1) }),
  z.object({ op: z.literal("field.setAttribute"), object: selector, path: z.string().min(1), attribute: z.string().min(1), value: scalar }),
  z.object({ op: z.literal("field.removeAttribute"), object: selector, path: z.string().min(1), attribute: z.string().min(1) }),
  z.object({ op: z.literal("field.remove"), object: selector, path: z.string().min(1) }),
  z.object({ op: z.literal("array.append"), object: selector, path: z.string().min(1), value: scalar.optional(), link: z.string().optional(), attrs: z.record(z.string(), scalar).optional() }),
  z.object({ op: z.literal("native.add"), object: selector, parentPath: z.string().optional(), field: nativeField }),
  z.object({
    op: z.literal("recipe.weaponBurn"), as: z.string().optional(), id: dataId,
    carrierEffect: dataId, carrierCtype: z.string().regex(/^CEffect[A-Za-z0-9_]*$/).default("CEffectCreatePersistent"),
    carrierPath: z.string().min(1).default("PeriodicEffectArray[0]"), impactEffect: dataId,
    duration: z.number().positive(), period: z.number().positive(), periodicDamage: z.number().nonnegative(),
    visualModel: dataId, attachSite: dataId.default("SOpAttachHead"),
    damageKind: z.string().min(1).optional(), alignment: z.string().min(1).optional(), editorCategories: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal("recipe.unitTextureByVital"), as: z.string().optional(), id: dataId, unit: dataId,
    threshold: z.number().positive().max(1), pollInterval: z.number().positive().default(0.5),
    textures: z.array(z.object({
      slot: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/),
      healthyFile: z.string().min(1), damagedFile: z.string().min(1),
    })).min(1).max(8),
  }),
]);

function textResult(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] }; }

export interface DataToolContext { workspace: DataWorkspace }

export function registerDataTools(server: McpServer, context: DataToolContext): void {
  const data = context.workspace;
  server.registerTool("data.context", {
    description: "Selective one-call context for SC2 Data Editor Catalog objects, inheritance, fields, references, dependencies and diagnostics.",
    inputSchema: z.object({ file: z.string().optional(), ids: z.array(z.string()).max(500).optional(), ctypes: z.array(z.string()).max(200).optional(), domains: z.array(z.string()).max(200).optional(), fields: z.array(z.string()).max(200).optional(), activeOnly:z.boolean().default(false), includeRaw: z.boolean().default(false), includeInherited: z.boolean().default(true), includeDependencies: z.boolean().default(true), includeReferences: z.boolean().default(true), limit: z.number().int().min(1).max(5000).default(200) }),
  }, async (args) => textResult(await data.context(args)));

  server.registerTool("data.query", {
    description: "Batch-search catalog objects by id/type/domain/field/parent/Link and return invalid or missing references.",
    inputSchema: z.object({ text: z.string().optional(), ids: z.array(z.string()).max(500).optional(), ctypes: z.array(z.string()).max(200).optional(), domains: z.array(z.string()).max(200).optional(), field: z.string().optional(), link: z.string().optional(), parent: z.string().optional(), invalidOnly: z.boolean().default(false), includeDependencies: z.boolean().default(true), limit: z.number().int().min(1).max(5000).default(200) }),
  }, async (args) => textResult(await data.query(args)));

  server.registerTool("data.describe_type", {
    description: "Describe an observed Data Editor C* type, its field paths, carriers, indexes and examples. The registry is generated from the current dependency corpus.",
    inputSchema: z.object({ ctype: z.string().optional() }),
  }, async ({ ctype }) => textResult(await data.describeType(ctype)));

  server.registerTool("data.apply", {
    description: "Atomically create/clone/rename/delete catalog objects, patch native fields, or apply evidence-backed linked recipes such as weapon burn and health-driven textures. One recipe may expand to many linked native objects. Preserves unknown XML, validates before commit, defaults to dry-run.",
    inputSchema: z.object({ file: z.string().default("Base.SC2Data/GameData/UnitData.xml"), componentListFile: z.string().default("ComponentList.SC2Components"), gameDataIndexFile: z.string().default("Base.SC2Data/GameData.xml"), referenceFiles: z.array(z.string()).max(61).optional(), operations: z.array(operation).min(1).max(500), dryRun: z.boolean().default(true), stage: z.boolean().default(true), backup: z.boolean().default(true), validate: z.boolean().default(true), allowInvalid: z.boolean().default(false), expectedSha256: z.record(z.string(), z.string()).optional() }),
  }, async (args) => textResult(await data.apply({ ...args, operations: args.operations as DataOperation[] })));

  server.registerTool("data.validate", {
    description: "Validate Data catalogs at L1 XML, L2 object identity, L3 dependency references and L4 inheritance/field semantics. L5/L6 remain explicit.",
    inputSchema: z.object({ file: z.string().default("Base.SC2Data/GameData/UnitData.xml") }),
  }, async ({ file }) => textResult(await data.validate(file)));
}
