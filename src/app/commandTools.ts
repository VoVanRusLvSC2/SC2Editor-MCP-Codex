import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  authoringGuide,
  compileAuthorScript,
  type AuthorCompilationReceipt,
} from "./authoringScript.js";
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
        "Compact authoring syntax. section=data gives the short unit/spell recipe guide without the full subsystem catalog; omitted section retains the complete guide.",
      inputSchema: z.object({ section: z.enum(["data", "all"]).optional() }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ section }) =>
      textResult(
        section === "data"
          ? {
              format: authoringGuide.format,
              modes: authoringGuide.modes,
              ...authoringGuide.dataQuickStart,
              examples: authoringGuide.examples.filter((e) => /^data (unit |spell )/.test(e)),
            }
          : authoringGuide,
      ),
  );
  server.registerTool(
    "modkit.author",
    {
      description:
        "Write concise line commands. Prefer data unit/spell recipes and unit.configure/spell.configure updates over raw graphs; see author_help section=data. Compatible adjacent Data, Text, Settings, Terrain and single-object placement commands share candidate validation/save. Reads, references and differing options retain boundaries. Returns compilation call counts and declared scopes; actual changed files stay in module receipts. Plan by default; stage/save retain original guards. No arbitrary source execution.",
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
        let compilation: AuthorCompilationReceipt | undefined;
        const steps = compileAuthorScript(args.script, args.mode, registry.batchTools, (value) => {
          compilation = value;
        });
        const result = await runMcpBatch(steps, registry.batchTools, context);
        return {
          isError: !result.ok,
          ...textResult({
            ...result,
            compilation,
            mode: args.mode,
            language: "SC2 compact authoring",
          }),
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
