import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { BatchTool } from "./mcpBatch.js";
import { ToolExecutor, type ToolCallback } from "./toolExecutor.js";
import { ToolVisibilityPolicy } from "./toolPolicy.js";

type Registered = ReturnType<McpServer["registerTool"]>;
interface ToolConfiguration {
  description?: string;
  inputSchema?: unknown;
}
interface ToolEntry {
  description: string;
  registered: Registered;
}

/** SDK typing is isolated here; callers retain the SDK's generic registerTool API. */
export class ToolRegistry {
  readonly batchTools = new Map<string, BatchTool>();
  private readonly entries = new Map<string, ToolEntry>();

  constructor(
    private readonly executor: ToolExecutor,
    readonly policy: ToolVisibilityPolicy,
  ) {}

  bind(server: McpServer): McpServer {
    const register = server.registerTool.bind(server) as unknown as (
      name: string,
      config: ToolConfiguration,
      callback: ToolCallback,
    ) => Registered;
    const registerTool = (name: string, config: ToolConfiguration, callback: ToolCallback) => {
      const registered = register(name, config, (args, context) =>
        this.executor.invoke(name, callback, args, context, "direct"),
      );
      this.entries.set(name, { description: config.description ?? "", registered });
      const schema =
        config.inputSchema && typeof (config.inputSchema as z.ZodType).parse === "function"
          ? (config.inputSchema as z.ZodType)
          : z.object((config.inputSchema ?? {}) as z.ZodRawShape).strict();
      this.batchTools.set(name, {
        schema,
        invoke: (args, context) => this.executor.invoke(name, callback, args, context, "internal"),
      });
      if (!this.policy.visible(name)) registered.disable();
      return registered;
    };
    // Keep SDK instance/private-field receivers intact without changing its methods.
    return new Proxy(server, {
      get(target, key) {
        if (key === "registerTool") return registerTool;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  find(query: string, offset: number, limit: number) {
    const search = query.toLowerCase();
    const matches = [...this.entries].filter(([name, entry]) =>
      (name + " " + entry.description).toLowerCase().includes(search),
    );
    matches.sort(
      ([left], [right]) =>
        Number(right.toLowerCase() === search) - Number(left.toLowerCase() === search) ||
        Number(right.toLowerCase().startsWith(search)) -
          Number(left.toLowerCase().startsWith(search)),
    );
    return {
      total: matches.length,
      items: matches.slice(offset, offset + limit).map(([name, entry]) => ({
        name,
        description: entry.description,
        enabled: entry.registered.enabled,
      })),
      nextOffset: offset + limit < matches.length ? offset + limit : null,
    };
  }

  enable(names: string[]) {
    const missing = names.filter((name) => !this.entries.has(name));
    if (missing.length) throw new Error("MCP_TOOL_UNKNOWN: " + missing.join(", "));
    for (const name of names) this.entries.get(name)!.registered.enable();
    return {
      enabled: names,
      profile: this.policy.focused ? this.policy.selection.profile : "unchanged",
    };
  }
}
