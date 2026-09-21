import { promises as fs } from "node:fs";
import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerBrowseTools } from "../src/modules/browse/tools.js";
import { registerPlacementTools } from "../src/modules/placement/tools.js";

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
registerBrowseTools(collector, { workspace: undefined! });
registerPlacementTools(collector, { workspace: undefined! });
await fs.writeFile(
  "generated/browse-placement-tools.json",
  JSON.stringify({ version: "1.1.0-alpha.11", tools }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    tools: Object.keys(tools),
    file: "generated/browse-placement-tools.json",
  }),
);
