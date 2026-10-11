import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
const root = process.cwd(), platform = process.platform === "win32" ? "windows" : process.platform;
if (!["windows", "linux"].includes(platform) || process.arch !== "x64") throw new Error("CASC helper currently targets Windows/Linux x64");
const revision = JSON.parse(await fs.readFile("native/casc/CASC-REVISION.json", "utf8"));
const build = path.join(root, "work", `casc-build-${platform}`), output = path.join(root, "native", "bin", `${platform}-x64`);
let cmake = process.env.SC2_MCP_CMAKE ?? "cmake";
if (!process.env.SC2_MCP_CMAKE && process.platform === "win32") {
  try { const probe = path.join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    cmake = execFileSync(probe, ["-products", "*", "-find", "**/cmake.exe"], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).at(-1) || cmake;
  } catch { /* Use configured PATH when no Visual Studio discovery is available. */ }
}
const args = ["-S", path.join(root, "native", "casc"), "-B", build, "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_POLICY_VERSION_MINIMUM=3.5", `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${output}`, `-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE=${output}`];
if (platform === "windows") args.push("-G", process.env.SC2_CASC_CMAKE_GENERATOR ?? "Visual Studio 17 2022", "-A", "x64");
if (process.env.SC2_CASCLIB_SOURCE) {
  const source = path.resolve(process.env.SC2_CASCLIB_SOURCE);
  const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  if (commit !== revision.commit) throw new Error("CASC_UPSTREAM_REVISION_MISMATCH");
  args.push(`-DSC2_CASCLIB_SOURCE=${source}`);
}
async function run(args) { await new Promise((resolve, reject) => { const child = spawn(cmake, args, { windowsHide: true, stdio: "inherit" }); child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(`CASC cmake exited ${code}`))); }); }
await run(args); await run(["--build", build, "--config", "Release", "--parallel", "4"]);
await fs.stat(path.join(output, `sc2-mcp-casc${platform === "windows" ? ".exe" : ""}`));
process.stdout.write(JSON.stringify({ platform, output, upstream: revision.commit, gameWrites: false, CDN: false }) + "\n");
