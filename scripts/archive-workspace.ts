import { extractArchive, packArchive } from "../src/archive/archiveAdapter.js";

const [operation, first, second] = process.argv.slice(2);
if (!first || !second || (operation !== "extract" && operation !== "pack")) {
  throw new Error("Usage: archive-workspace.ts extract <map.SC2Map> <component-dir> | pack <component-dir> <map.SC2Map>");
}
const result = operation === "extract"
  ? await extractArchive(first, second)
  : await packArchive(first, second, { backup: true });
console.log(JSON.stringify(result, null, 2));
