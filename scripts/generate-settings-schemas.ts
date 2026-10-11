import { promises as fs } from "node:fs";
import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerSettingsTools } from "../src/modules/settings/tools.js";
import type { SettingsWorkspace } from "../src/modules/settings/workspace.js";
import { APP_VERSION } from "../src/app/version.js";
const tools: Record<string, unknown> = {};
registerSettingsTools({ registerTool(name: string, config: {
        description: string;
        inputSchema: z.ZodType;
        annotations?: unknown;
    }) { tools[name] = { description: config.description, inputSchema: z.toJSONSchema(config.inputSchema), annotations: config.annotations }; } } as unknown as McpServer, undefined as unknown as SettingsWorkspace);
await fs.writeFile("generated/settings-tools.json", JSON.stringify({ version: APP_VERSION, tools }, null, 2) + "\n");
console.log(JSON.stringify({ count: Object.keys(tools).length, file: "generated/settings-tools.json" }));
