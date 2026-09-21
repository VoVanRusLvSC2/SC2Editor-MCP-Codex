import { APP_VERSION } from "../src/app/version.js";
import { promises as fs } from "node:fs";
import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerTerrainTools } from "../src/modules/terrain/tools.js";

const tools: Record<string, unknown> = {};
const collector = {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.ZodType },
  ) {
    tools[name] = {
      description: config.description,
      inputSchema: z.toJSONSchema(config.inputSchema, {
        target: "draft-2020-12",
      }),
    };
  },
} as unknown as McpServer;
registerTerrainTools(collector, { workspace: undefined! });
await fs.mkdir("generated", { recursive: true });
await fs.writeFile(
  "generated/terrain-tools.json",
  JSON.stringify({ version: APP_VERSION, tools }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    count: Object.keys(tools).length,
    file: "generated/terrain-tools.json",
  }),
);
