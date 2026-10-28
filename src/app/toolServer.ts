import type { McpServer } from "@modelcontextprotocol/server";
import { resolveModuleSelection, type ModuleSelection } from "./moduleSelection.js";
import { ToolTelemetry } from "./telemetry.js";
import { ToolExecutor } from "./toolExecutor.js";
import { ToolRegistry } from "./toolRegistry.js";
import { ToolVisibilityPolicy } from "./toolPolicy.js";
import { registerCommandTools } from "./commandTools.js";

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
  if (exposeCommands) registerCommandTools(server, registry, telemetry);
  return server;
}
