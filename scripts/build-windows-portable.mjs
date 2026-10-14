import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildPeLauncher } from "./build-pe-launcher.mjs";

const projectRoot = process.cwd();
const output = path.resolve(process.argv[2] ?? "release/SC2-UI-Workbench-Windows");
const app = path.join(output, "app");
const releaseRoot=path.resolve(projectRoot,"release");
const relativeOutput=path.relative(releaseRoot,output);
if(!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput) || relativeOutput.includes(path.sep))throw new Error("PORTABLE_OUTPUT_SCOPE_INVALID");
for(const candidate of [releaseRoot,output]){try{if((await fs.lstat(candidate)).isSymbolicLink())throw new Error("PORTABLE_OUTPUT_SYMLINK");}catch(error){if(error.code!=="ENOENT")throw error;}}
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(app, { recursive: true });

for (const directory of ["dist", "schema"]) {
  await fs.cp(path.join(projectRoot,directory === "dist" ? "dist-runtime" : directory), path.join(app, directory), { recursive: true });
}
await fs.cp(path.join(projectRoot,"vendor","blizzard-models"),path.join(app,"vendor","blizzard-models"),{recursive:true});
const runtimeSchemas=["cutscene-schema.json","text-font-style-schema.json","font-style-corpus.json","ai-module-schema.json","data-editor-schema.json","data-observed-schema.json", "galaxy-native-api.json", "trigger-authoring-registry.json", "trigger-skirmish-recipe.json", "o200k_base.tiktoken", "o200k_base.sha256", "TIKTOKEN_LICENSE.txt"];
await fs.mkdir(path.join(app,"generated"),{recursive:true});
for(const file of runtimeSchemas)await fs.copyFile(path.join(projectRoot,"generated",file),path.join(app,"generated",file));
await fs.cp(path.join(projectRoot,"generated","data-xsd-index"),path.join(app,"generated","data-xsd-index"),{recursive:true});
await fs.mkdir(path.join(app, "src", "gui"), { recursive: true });
await fs.cp(path.join(projectRoot, "src", "gui", "public"), path.join(app, "src", "gui", "public"), { recursive: true });
await fs.copyFile(path.join(projectRoot, "package.json"), path.join(app, "package.json"));
for (const file of ["LICENSE", "CREDITS.md", "THIRD_PARTY_LICENSES.md"]) {
  await fs.copyFile(path.join(projectRoot, file), path.join(app, file));
  await fs.copyFile(path.join(projectRoot, file), path.join(output, file));
}
await fs.mkdir(path.join(app, "src", "modules", "terrain", "surface"), { recursive: true });
await fs.copyFile(path.join(projectRoot, "src", "modules", "terrain", "surface", "NOTICE.md"), path.join(app, "src", "modules", "terrain", "surface", "NOTICE.md"));
const nativeArchiveSource = path.join(projectRoot,"native","bin","windows-x64");
await fs.stat(path.join(nativeArchiveSource,"sc2-mcp-archive.exe"));
await fs.stat(path.join(nativeArchiveSource,"sc2-mcp-casc.exe"));
await fs.mkdir(path.join(app,"native","bin","windows-x64"),{recursive:true});
for(const file of await fs.readdir(nativeArchiveSource))if(/\.(exe|dll)$/i.test(file))await fs.copyFile(path.join(nativeArchiveSource,file),path.join(app,"native","bin","windows-x64",file));
await fs.mkdir(path.join(app,"native"),{ recursive:true });
await fs.copyFile(path.join(projectRoot,"native","vendor","StormLib","LICENSE"),path.join(app,"native","StormLib-LICENSE.txt"));
await fs.copyFile(path.join(projectRoot,"native","STORMLIB-REVISION.json"),path.join(app,"native","STORMLIB-REVISION.json"));
await fs.copyFile(path.join(projectRoot,"native","README.md"),path.join(app,"native","README.md"));
await fs.copyFile(path.join(projectRoot,"native","casc","LICENSE-CascLib.txt"),path.join(app,"native","CascLib-LICENSE.txt"));
await fs.copyFile(path.join(projectRoot,"native","casc","CASC-REVISION.json"),path.join(app,"native","CASC-REVISION.json"));

for (const dependency of ["@modelcontextprotocol/server", "@modelcontextprotocol/core", "zod", "@xmldom/xmldom", "sharp", "@img/colour", "@img/sharp-win32-x64", "detect-libc", "semver"]) {
  const source = path.join(projectRoot, "node_modules", ...dependency.split("/"));
  const destination = path.join(app, "node_modules", ...dependency.split("/"));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

await fs.copyFile(path.join(projectRoot, "windows", "SC2-UI-Workbench.ps1"), path.join(output, "SC2-UI-Workbench.ps1"));
await fs.copyFile(path.join(projectRoot, "windows", "SC2-MCP.cmd"), path.join(output, "SC2-MCP.cmd"));
await fs.copyFile(path.join(projectRoot, "windows", "SC2-MCP-MAP-BUILDER.cmd"), path.join(output, "SC2-MCP-MAP-BUILDER.cmd"));
await fs.copyFile(path.join(projectRoot,"windows","SC2-MCP-WORKFLOW.cmd"),path.join(output,"SC2-MCP-WORKFLOW.cmd"));
await fs.copyFile(path.join(projectRoot,"windows","SC2-MCP-CUTSCENE-PREVIEW.cmd"),path.join(output,"SC2-MCP-CUTSCENE-PREVIEW.cmd"));
await fs.copyFile(path.join(projectRoot, "windows", "README-WINDOWS.md"), path.join(output, "README-WINDOWS.md"));
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(output, "README.md"));
await fs.copyFile(path.join(projectRoot, "README_RU.md"), path.join(output, "README_RU.md"));
await fs.mkdir(path.join(output,"generated"),{recursive:true});
for(const file of runtimeSchemas)await fs.copyFile(path.join(projectRoot,"generated",file),path.join(output,"generated",file));
await fs.cp(path.join(projectRoot,"generated","data-xsd-index"),path.join(output,"generated","data-xsd-index"),{recursive:true});
for (const file of ["casc-tools.json", "settings-tools.json", "settings-evidence.json", "document-tools.json", "document-foundation-evidence.json"]) {
  const source = path.join(projectRoot, "generated", file);
  try { await fs.access(source); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  await fs.copyFile(source, path.join(output, "generated", file));
}
await fs.cp(path.join(projectRoot, "docs"), path.join(output, "docs"), { recursive: true });
const examplesSource = path.join(projectRoot, "examples");
try { await fs.access(examplesSource); await fs.cp(examplesSource, path.join(output, "examples"), { recursive: true }); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await buildPeLauncher(path.join(output, "SC2-UI-Workbench.exe"));

const {version}=JSON.parse(await fs.readFile(path.join(projectRoot,"package.json"),"utf8"));
let bundledNode = false;
if (process.platform === "win32" && path.extname(process.execPath).toLowerCase() === ".exe") {
  await fs.mkdir(path.join(output, "runtime"), { recursive: true });
  await fs.copyFile(process.execPath, path.join(output, "runtime", "node.exe"));
  bundledNode = true;
} else {
  await fs.mkdir(path.join(output, "runtime"), { recursive: true });
  await fs.writeFile(path.join(output, "runtime", "PUT-NODE-EXE-HERE.txt"),
    "Optional: copy a Windows Node.js 20+ node.exe into this directory. Otherwise the launcher uses installed Node.js.\r\n", "utf8");
}
await fs.writeFile(path.join(output, "BUILD-INFO.json"), `${JSON.stringify({
  version,
  bundledArchiveBackend: true,
  bundledCascBackend: true,
  publicModules: 15,
  mcpLauncher: "SC2-MCP.cmd",
  mcpDefaultProfile: "all",
  settingsEditorValidation: "NOT_EXECUTED",
  archiveWindowsExecution: "NOT_EXECUTED",
  platformBuiltOn: process.platform,
  bundledNode,
  requiresInstalledNode: !bundledNode,
  launcher: "SC2-UI-Workbench.exe",
}, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output, bundledNode }, null, 2)}\n`);
