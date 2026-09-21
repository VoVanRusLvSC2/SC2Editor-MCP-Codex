import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createProject } from "./app/project.js";
import { createProjectServer } from "./app/server.js";
import { resolveModuleSelection } from "./app/moduleSelection.js";

const project = await createProject(process.env.SC2_UI_ROOT ?? process.cwd());
const selection = resolveModuleSelection();
// stdout is reserved for MCP protocol traffic.
console.error(`[sc2editor-mcp] workspace: ${project.workspace.root}; profile=${selection.profile}; modules=${[...selection.modules].join(",")}; shared transaction coordinator`);
serveStdio(() => createProjectServer(project));
