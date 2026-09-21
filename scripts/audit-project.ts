import { promises as fs } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { createProject } from "../src/app/project.js";
import { createProjectServer } from "../src/app/server.js";
import { projectCoverage } from "../src/app/coverage.js";

const project = await createProject(process.argv[2] ?? process.cwd());
const tools: Record<string, { description?: string; inputSchema: unknown }> = {};
const original = McpServer.prototype.registerTool;
// Capture actual composition registrations, including dynamically named tools.
McpServer.prototype.registerTool = function(name, config, ...rest) {
  tools[name] = { description: config.description, inputSchema: z.toJSONSchema(config.inputSchema as z.ZodType, { unrepresentable: "any" }) };
  return original.call(this, name, config, ...rest);
} as typeof original;
try { createProjectServer(project); } finally { McpServer.prototype.registerTool = original; }
const names = Object.keys(tools).sort();
const counts = Object.fromEntries(Object.keys(projectCoverage(project).modules).map(module => [module, names.filter(name => name.startsWith(`${module}.`)).length]));
const report = { ...projectCoverage(project), inventory: { toolCount: names.length, counts, tools }, auditedAt: new Date().toISOString() };
await fs.mkdir("generated", { recursive: true });
await fs.writeFile("generated/project-architecture-coverage.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ toolCount: names.length, counts, completeEngineCoverage: report.completeEngineCoverage, ui: report.modules.ui.registry.frameTypes, cutscene: report.modules.cutscene.registry, text: report.modules.text.registry, ai: report.modules.ai.registry }, null, 2));
