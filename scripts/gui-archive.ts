import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractArchive, packArchive } from "../src/archive/archiveAdapter.js";
import { startGuiServer } from "../src/gui/server.js";

const archive = process.argv[2];
if (!archive) throw new Error("Usage: npm run gui:archive -- <map.SC2Map|mod.SC2Mod>");
const session = await fs.mkdtemp(path.join(os.tmpdir(), "sc2-ui-archive-session-"));
const component = path.join(session, "component");
await extractArchive(archive, component);
const gui = await startGuiServer({ root: component });
console.error(`[sc2-ui-mcp] Archive workbench: ${gui.url}`);
console.error("Edit and save in the GUI, then press Ctrl+C to repack with backup.");

await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
await gui.close();
let packed = false;
try {
  const result = await packArchive(component, archive, { backup: true });
  packed = true;
  console.error(`[sc2-ui-mcp] Packed atomically: ${result.archive}; backup: ${result.backup}`);
} finally {
  if (packed) await fs.rm(session, { recursive: true, force: true });
  else console.error(`[sc2-ui-mcp] Packing failed; edited component directory preserved at ${component}`);
}
