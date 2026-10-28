import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { authoringGuide, compileAuthorScript } from "./authoringScript.js";
import { registerMcpBatch, runMcpBatch } from "./mcpBatch.js";
import type { ToolRegistry } from "./toolRegistry.js";
import type { ToolTelemetry } from "./telemetry.js";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerCommandTools(
  server: McpServer,
  registry: ToolRegistry,
  meter: ToolTelemetry,
): void {
  server.registerTool(
    "modkit.usage",
    {
      description:
        "MCP text token counts and per-tool durations; actual model/billing usage is unavailable. No payload text saved.",
      inputSchema: z.object({}).strict(),
    },
    async () => textResult(await meter.summary()),
  );

  if (registry.policy.focused) {
    server.registerTool(
      "modkit.tools",
      {
        description:
          "Find additional tool names with compact descriptions; activate selected names to expose their schemas in focused profiles.",
        inputSchema: z
          .object({
            query: z.string().max(100).default(""),
            offset: z.number().int().min(0).default(0),
            limit: z.number().int().min(1).max(30).default(10),
          })
          .strict(),
      },
      async (args) => textResult(registry.find(args.query, args.offset, args.limit)),
    );
    server.registerTool(
      "modkit.enable_tools",
      {
        description:
          "Enable named tools and notify the MCP client that the tool list changed. No map modification.",
        inputSchema: z
          .object({ names: z.array(z.string().min(1).max(128)).min(1).max(40) })
          .strict(),
      },
      async (args) => textResult(registry.enable(args.names)),
    );
  }

  registerMcpBatch(server, registry.batchTools);
  server.registerTool(
    "modkit.author_help",
    {
      description:
        "Compact syntax and examples for writing map, terrain, objects, Data, Galaxy, GUI, UI, cutscene, text, settings, AI and assets through modkit.author.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => textResult(authoringGuide),
  );
  server.registerTool(
    "modkit.author",
    {
      description:
        "Write concise line commands across map, terrain, objects, Data, Galaxy, GUI, UI, cutscene, text, settings, assets and CASC. Compatible adjacent same-catalog Data setters/recipes share one atomic apply/save; reads, advanced options and result references preserve boundaries. Galaxy is default; GUI requires explicit gui.*. Plan by default; stage/save only for supported guarded workflows. No source execution or Galaxy-to-GUI conversion.",
      inputSchema: z
        .object({
          script: z.string().min(1).max(65536),
          mode: z.enum(["plan", "stage", "save"]).default("plan"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args, context) => {
      try {
        const steps = compileAuthorScript(args.script, args.mode, registry.batchTools);
        const result = await runMcpBatch(steps, registry.batchTools, context);
        return {
          isError: !result.ok,
          ...textResult({ ...result, mode: args.mode, language: "SC2 compact authoring" }),
        };
      } catch (error) {
        return {
          isError: true,
          ...textResult({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    },
  );
}
