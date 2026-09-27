import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { TriggerWorkspace } from './workspace.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const identifier = z.string().min(1).max(128);
export function registerTriggerTools(server: McpServer, workspace: TriggerWorkspace) {
  server.registerTool('trigger.inspect', { description: 'List GUI Triggers identifiers, IDs, and Event/Action references without regenerating the library.', inputSchema: z.object({ query: z.string().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(100) }).strict() }, async a => result(await workspace.inspect(a.query, a.offset, a.limit)));
  server.registerTool('trigger.get', { description: 'Read one GUI Trigger and its referenced Event/Action definitions.', inputSchema: z.object({ identifier }).strict() }, async a => result(await workspace.get(a.identifier)));
  server.registerTool('trigger.graft', { description: 'Copy one Event or Action and its local dependency graph from another unpacked Triggers file into an existing trigger. Preserves folder tree and existing IDs; dry-run by default.', inputSchema: z.object({ sourceFile: z.string().min(1), sourceTrigger: identifier, targetTrigger: identifier, kind: z.enum(['Event', 'Action']), index: z.number().int().min(0), dryRun: z.boolean().default(true), stage: z.boolean().default(true) }).strict() }, async a => result(await workspace.graft(a)));
  server.registerTool('trigger.save', { description: 'Save staged GUI Triggers with stale checks and optional backup.', inputSchema: z.object({ backup: z.boolean().default(true) }).strict() }, async a => result(await workspace.save(a.backup)));
  server.registerTool('trigger.discard', { description: 'Discard staged GUI Triggers edits.', inputSchema: z.object({}).strict() }, async () => result(workspace.discard()));
}
