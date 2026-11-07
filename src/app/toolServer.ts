import type { McpServer } from "@modelcontextprotocol/server";
import { resolveModuleSelection, type ModuleSelection } from "./moduleSelection.js";
import { ToolTelemetry } from "./telemetry.js";
import { ToolExecutor } from "./toolExecutor.js";
import { ToolRegistry } from "./toolRegistry.js";
import { ToolVisibilityPolicy } from "./toolPolicy.js";
import { registerCommandTools } from "./commandTools.js";

const registries = new WeakMap<McpServer, ToolRegistry>();

/** Internal composition access; scoped callers still use the original tool schema/executor. */
export function projectToolRegistry(server: McpServer): ToolRegistry {
  const registry = registries.get(server);
  if (!registry) throw Error("PROJECT_TOOL_REGISTRY_UNAVAILABLE");
  return registry;
}

/** Compose dispatch explicitly; telemetry no longer changes MCP registration. */
export function createToolServer(
  raw: McpServer,
  root: string,
  selection: ModuleSelection = resolveModuleSelection(),
  exposeCommands = selection.modules.size > 0,
): McpServer {
  const telemetry = new ToolTelemetry(root);
  const registry = new ToolRegistry(
    new ToolExecutor(telemetry),
    new ToolVisibilityPolicy(selection),
  );
  const server = registry.bind(raw);
  registries.set(server, registry);
  if (exposeCommands) registerCommandTools(server, registry, telemetry);
  return server;
}
