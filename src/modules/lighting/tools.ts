import type {McpServer} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type {LightingWorkspace} from './workspace.js';
export function registerLightingTools(server:McpServer,lighting:LightingWorkspace){
 server.registerTool('lighting.inspect',{description:'Resolve shared native SC2 global lighting from local CASC and project overlays: Key/Fill/Back, ambient cube, HDR controls, source hashes. Read-only; full engine parity is unvalidated.',inputSchema:z.object({preset:z.string().min(1).max(255).default('DefaultLight'),stateIndex:z.number().int().min(0).max(63).default(0),directory:z.string().default(''),packages:z.array(z.string()).max(8).optional()}).strict()},async args=>({content:[{type:'text' as const,text:JSON.stringify(await lighting.inspect(args))}]}));
}
