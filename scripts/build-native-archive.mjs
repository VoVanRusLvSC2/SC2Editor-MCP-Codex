import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd(), platform = process.platform === "win32" ? "windows" : process.platform;
if(!["windows","linux"].includes(platform) || process.arch !== "x64") throw new Error("Native archive helper currently targets Windows/Linux x64");
const build = path.join(root,"native",`build-${platform}`), output = path.join(root,"native","bin",`${platform}-x64`);
const cmake = process.env.SC2_MCP_CMAKE ?? "cmake";
async function run(args) {
  await new Promise((resolve,reject) => {
    const child = spawn(cmake,args,{ stdio:"inherit",windowsHide:true });
    child.once("error",reject); child.once("close",code => code === 0 ? resolve() : reject(new Error(`cmake exited ${code}`)));
  });
}
await run(["-S",path.join(root,"native"),"-B",build,"-DCMAKE_BUILD_TYPE=Release",`-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${output}`,`-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE=${output}`]);
await run(["--build",build,"--config","Release","--parallel","4"]);
await fs.stat(path.join(output,`sc2-mcp-archive${platform === "windows" ? ".exe" : ""}`));
process.stdout.write(JSON.stringify({ platform,output,editorValidation:"NOT_EXECUTED" })+"\n");
