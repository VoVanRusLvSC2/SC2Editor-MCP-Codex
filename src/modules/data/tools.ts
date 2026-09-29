import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DataWorkspace } from "./workspace.js";
import {DataAuthoringError} from "./authoringValidation.js";
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
async function authorResult<T>(work:Promise<T>){try{return textResult(await work);}catch(error){if(error instanceof DataAuthoringError)return textResult({accepted:false,authoring:error.verdict,error:{code:error.code,message:error.message}});throw error;}}

export interface DataToolContext { workspace: DataWorkspace }

export function registerDataTools(server: McpServer, context: DataToolContext): void {
  const data = context.workspace;
  server.registerTool("data.references",{description:"Paged typed XML references with domains, spans and explicit coverage limits.",inputSchema:z.object({id:z.string().optional(),domain:z.string().optional(),direction:z.enum(["incoming","outgoing","both"]).default("both"),issueOffset:z.number().int().min(0).default(0),issueLimit:z.number().int().min(1).max(500).default(100),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(500).default(100)}).strict()},async args=>textResult(await data.referenceQuery(args)));
  server.registerTool("data.resolve",{description:"Selective available-parent effective fields and provenance; runtime layer equivalence is not claimed.",inputSchema:z.object({id:z.string().min(1),domain:z.string().min(1),fields:z.array(z.string()).max(200).optional()}).strict()},async args=>textResult(await data.resolveFields(args)));
  server.registerTool("data.explain_usage",{description:"Explain known incoming references or unknown usage within the loaded XML scope.",inputSchema:z.object({id:z.string().min(1),domain:z.string().min(1)}).strict()},async args=>{const r=await data.referenceQuery({...args,direction:"incoming"});return textResult({...r,status:r.total?"used":"unknown",reason:r.total?"Known typed incoming reference":"No known XML reference; external/dynamic consumers are not proven absent"});});
  server.registerTool("data.context", {
    description: "Selective one-call context for SC2 Data Editor Catalog objects, inheritance, fields, references, dependencies and diagnostics.",
    inputSchema: z.object({ text:z.string().optional(),parent:z.string().optional(),link:z.string().optional(),file: z.string().optional(), ids: z.array(z.string()).max(500).optional(), ctypes: z.array(z.string()).max(200).optional(), domains: z.array(z.string()).max(200).optional(), fields: z.array(z.string()).max(200).optional(), activeOnly:z.boolean().default(false), offset:z.number().int().min(0).default(0), includeRaw: z.boolean().default(false), includeInherited: z.boolean().default(true), includeDependencies: z.boolean().default(true), includeReferences: z.boolean().default(true), limit: z.number().int().min(1).max(5000).default(200) }),
  }, async (args) => textResult(await data.context(args)));

  server.registerTool("data.query", {
    description: "Batch-search catalog objects by id/type/domain/field/parent/Link and return invalid or missing references.",
    inputSchema: z.object({ text: z.string().optional(), ids: z.array(z.string()).max(500).optional(), ctypes: z.array(z.string()).max(200).optional(), domains: z.array(z.string()).max(200).optional(), field: z.string().optional(), link: z.string().optional(), parent: z.string().optional(), invalidOnly: z.boolean().default(false), offset:z.number().int().min(0).default(0),includeDependencies: z.boolean().default(true), limit: z.number().int().min(1).max(5000).default(200) }),
  }, async (args) => textResult(await data.query(args)));

  server.registerTool("data.describe_type", {
    description: "Describe an observed Data Editor C* type, its field paths, carriers, indexes and examples. The registry is generated from the current dependency corpus.",
    inputSchema: z.object({ ctype: z.string().optional() }),
  }, async ({ ctype }) => textResult(await data.describeType(ctype)));

  const dataApplySchema = z.object({ file: z.string().default("Base.SC2Data/GameData/UnitData.xml"), componentListFile: z.string().default("ComponentList.SC2Components"), gameDataIndexFile: z.string().default("Base.SC2Data/GameData.xml"), referenceFiles: z.array(z.string()).max(61).optional(), operations: z.array(operation).min(1).max(500), dryRun: z.boolean().default(true), stage: z.boolean().default(true), backup: z.boolean().default(true), validate: z.boolean().default(true), allowInvalid: z.boolean().default(false), authoringPolicy:z.enum(["strict","compatibility"]).default("strict"), expectedSha256: z.record(z.string(), z.string()).optional() });
  server.registerTool("data.apply", {
    description: "Atomically edit Data catalogs. New authoring is strict by default: declared XSD fields and typed references must validate before staging. Compatibility mode reports an explicit unverified authoring verdict. Defaults to dry-run.",
    inputSchema: dataApplySchema,
  }, async (args) => authorResult(data.apply({ ...args, operations: args.operations as DataOperation[] })));

  server.registerTool("data.batch",{description:"Strict atomic multi-catalog Data batch. Supports create/clone/field and array operations with aliases and future references; destructive rename/delete and recipes use data.apply.",inputSchema:z.object({changes:z.array(z.object({file:z.string().min(1),operations:z.array(operation).min(1).max(500)}).strict()).min(1).max(48),componentListFile:z.string().optional(),gameDataIndexFile:z.string().optional(),dryRun:z.boolean().default(true),stage:z.boolean().default(true),backup:z.boolean().default(true),expectedSha256:z.record(z.string(),z.string()).optional()}).strict()},async args=>authorResult(data.batch({...args,changes:args.changes.map(c=>({...c,operations:c.operations as DataOperation[]}))})));
  server.registerTool("data.plan", {description:"Preview and store an immutable strict Data batch with final-graph validation and a stale source fingerprint.",inputSchema:dataApplySchema},async args=>authorResult(data.plan({...args,operations:args.operations as DataOperation[]})));
  server.registerTool("data.apply_plan", {description:"Apply a previously previewed strict Data batch if catalogs, consumers, dependencies and schema evidence are unchanged. Defaults to dry-run.",inputSchema:z.object({planId:z.string().min(1),dryRun:z.boolean().default(true),stage:z.boolean().default(true)}).strict()},async args=>authorResult(data.applyPlan(args.planId,args.dryRun,args.stage)));

  server.registerTool("data.validate", {
    description: "Validate Data catalogs at L1 XML, L2 object identity, L3 dependency references and L4 inheritance/field semantics. L5/L6 remain explicit.",
    inputSchema: z.object({ file: z.string().default("Base.SC2Data/GameData/UnitData.xml") }),
  }, async ({ file }) => textResult(await data.validate(file)));
}
