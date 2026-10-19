import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createProject } from "./app/project.js";
import { createProjectServer } from "./app/server.js";
import { resolveModuleSelection } from "./app/moduleSelection.js";

const selection = resolveModuleSelection();
const project = await createProject(process.env.SC2_UI_ROOT ?? process.cwd(), {loadUiSchema:selection.modules.has("ui")});
// stdout is reserved for MCP protocol traffic.
console.error(`[sc2editor-mcp] workspace: ${project.workspace.root}; profile=${selection.profile}; modules=${[...selection.modules].join(",")}; shared transaction coordinator`);
const handle=serveStdio(() => createProjectServer(project));
let closing=false;
const close=async()=>{if(closing)return;closing=true;project.casc.close();await project.modkit.close();await handle.close();};
process.stdin.once('end',()=>{void close();});
process.once('SIGINT',()=>{void close();});
process.once('SIGTERM',()=>{void close();});
