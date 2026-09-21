import { startGuiServer } from "./server.js";

const root = process.env.SC2_UI_ROOT ?? process.cwd();
const host = process.env.SC2_UI_GUI_HOST ?? "127.0.0.1";
const parsedPort = Number(process.env.SC2_UI_GUI_PORT ?? 4312);
if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) throw new Error("SC2_UI_GUI_PORT must be a valid TCP port");

const gui = await startGuiServer({ root, host, port: parsedPort });
console.error(`[sc2-ui-mcp] GUI: ${gui.url}; workspace: ${root}`);
