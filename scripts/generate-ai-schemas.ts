import { promises as fs } from "node:fs";
import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAiTools } from "../src/modules/ai/tools.js";

const tools: Record<string, unknown> = {};
const collector = { registerTool(name: string, config: { description: string; inputSchema: z.ZodType }) {
  tools[name] = { description: config.description, inputSchema: z.toJSONSchema(config.inputSchema, { target: "draft-2020-12" }) };
} } as unknown as McpServer;
registerAiTools(collector, { workspace: { schema: undefined! } as never });
await fs.writeFile("generated/ai-tools.json", JSON.stringify({ version: "1.1.0-alpha.7", triggerEditing: false, terrainEditing: false, tools }, null, 2) + "\n");
console.log(JSON.stringify({ tools: Object.keys(tools), file: "generated/ai-tools.json" }));
