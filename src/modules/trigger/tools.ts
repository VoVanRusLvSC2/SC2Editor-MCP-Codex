import type {GuiValue,GuiCall,GuiRequest} from './authoring.js';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { TriggerWorkspace } from './workspace.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const identifier = z.string().min(1).max(128);
export function registerTriggerTools(server: McpServer, workspace: TriggerWorkspace) {
  const value:z.ZodType<GuiValue> = z.lazy(()=>z.discriminatedUnion('kind',[
    z.object({kind:z.literal('literal'),type:z.enum(['int','fixed','bool','string']),value:z.union([z.string().max(16384),z.number(),z.boolean()])}).strict(),
    z.object({kind:z.literal('variable'),library:z.string().optional(),id:identifier}).strict(),
    z.object({kind:z.literal('preset'),id:identifier}).strict(),
    z.object({kind:z.literal('gamelink'),domain:identifier,id:identifier}).strict(),
    z.object({kind:z.literal('nativeCall'),function:identifier}).strict(),
    z.object({kind:z.literal('call'),function:identifier,args:z.record(z.string(),value)}).strict(),
    z.object({kind:z.enum(['block','customScript']),source:z.string().max(16384)}).strict()
  ]));
  const guiCall:z.ZodType<GuiCall> = z.lazy(()=>z.object({kind:z.enum(['Event','Condition','Action']),function:identifier,args:z.record(z.string(),value),children:z.array(z.object({role:identifier,call:guiCall}).strict()).max(100).optional()}).strict());
  server.registerTool('trigger.search_functions',{description:'Search all parsed NativeLib FunctionDefs with separate serializer eligibility.',inputSchema:z.object({query:z.string().max(128).default(''),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(50)}).strict()},async a=>result(workspace.searchFunctions(a.query,a.offset,a.limit)));
  server.registerTool('trigger.describe_function',{description:'Verified NativeLib 97563 signature, ParamDef IDs, flags and supported argument forms.',inputSchema:z.object({name:identifier}).strict()},async a=>result(workspace.describeFunction(a.name)));
  server.registerTool('trigger.plan',{description:'Plan a typed GUI trigger/category and bounded batch of supported calls without staging. Triggers is source of truth; regenerate Galaxy in Editor.',inputSchema:z.object({stringFiles:z.array(z.string().min(1)).max(16).optional(),targetTrigger:identifier.optional(),create:z.object({library:identifier,identifier,category:identifier.optional()}).strict().optional(),calls:z.array(guiCall).max(100)}).strict()},async a=>result(await workspace.plan(a as GuiRequest)));
  server.registerTool('trigger.validate',{description:'Validate XML and local typed references; external/compiler validation remains explicit.',inputSchema:z.object({}).strict()},async()=>result(await workspace.validate()));
  server.registerTool('trigger.apply',{description:'Apply stored immutable GUI plan through shared coordinator with source/schema guards. Defaults to dry-run.',inputSchema:z.object({planId:identifier,dryRun:z.boolean().default(true),stage:z.boolean().default(true)}).strict()},async a=>result(await workspace.applyPlan(a.planId,a.dryRun,a.stage)));
  server.registerTool('trigger.labels',{description:'List verified NativeLib97563 and project visual labels with localized names; read-only until Editor-saved assignment format is available.',inputSchema:z.object({query:z.string().max(128).default(''),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(100)}).strict()},async a=>result(await workspace.labels(a.query,a.offset,a.limit)));
  server.registerTool('trigger.label_of',{description:'Read explicit Label on an exact Library/Type/Id element or inherited verified FunctionDef Label; does not assume None/default semantics.',inputSchema:z.object({library:z.string(),type:identifier,id:identifier}).strict()},async a=>result(await workspace.labelOf(a)));
  server.registerTool('trigger.inspect', { description: 'List GUI Triggers identifiers, IDs, and Event/Action references without regenerating the library.', inputSchema: z.object({ query: z.string().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }).strict() }, async a => result(await workspace.inspect(a.query, a.offset, a.limit)));
  server.registerTool('trigger.get', { description: 'Read one GUI Trigger and its referenced Event/Action definitions.', inputSchema: z.object({ identifier,includeRaw:z.boolean().default(false),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(500).default(100) }).strict() }, async a => result(await workspace.get(a.identifier,a)));
  server.registerTool('trigger.graft', { description: 'Copy one Event or Action and its local dependency graph from another unpacked Triggers file into an existing trigger. Preserves folder tree and existing IDs; dry-run by default.', inputSchema: z.object({ sourceFile: z.string().min(1), sourceTrigger: identifier, targetTrigger: identifier, kind: z.enum(['Event', 'Action']), index: z.number().int().min(0), dryRun: z.boolean().default(true), stage: z.boolean().default(true) }).strict() }, async a => result(await workspace.graft(a)));
  server.registerTool('trigger.save', { description: 'Save staged GUI Triggers with stale checks and optional backup.', inputSchema: z.object({ backup: z.boolean().default(true) }).strict() }, async a => result(await workspace.save(a.backup)));
  server.registerTool('trigger.normalizeScriptLayout', { description: 'Normalize custom-action ScriptCode XML indentation for SC2 Editor without rebuilding the GUI tree, changing IDs, actions, or typed Param expressions. Does not recover already missing code. Dry-run by default.', inputSchema: z.object({ dryRun: z.boolean().default(true), stage: z.boolean().default(true) }).strict() }, async a => result(await workspace.normalizeScriptLayout(a.dryRun, a.stage)));
  server.registerTool('trigger.discard', { description: 'Discard staged GUI Triggers edits.', inputSchema: z.object({}).strict() }, async () => result(workspace.discard()));
}
