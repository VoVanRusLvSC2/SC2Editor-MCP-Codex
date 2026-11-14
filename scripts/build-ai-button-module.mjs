import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { aiButtonFiles, aiButtonDigest, inspectAiButtonModule } from "./ai-button-module.mjs";

if (process.platform !== "win32") throw Error("AI_BUTTON_WINDOWS_REQUIRED");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = JSON.parse(await fs.readFile(path.join(root, "ai-button-release.json"), "utf8"));
const source = path.resolve(
  process.argv[2] ?? process.env.SC2_AI_BUTTON_SOURCE ?? path.join(root, "work/ai-button-source"),
);
const output = path.join(root, "native/bin/windows-x64/ai-button", pin.revision);
const git = (...args) =>
  execFileSync("git", ["-C", source, ...args], { encoding: "utf8", windowsHide: true }).trim();
try {
  await fs.access(source);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await fs.mkdir(path.dirname(source), { recursive: true });
  execFileSync("git", ["clone", "--no-checkout", pin.repository, source], {
    stdio: "inherit",
    windowsHide: true,
  });
  git("checkout", "--detach", pin.revision);
}
if (
  git("rev-parse", "HEAD") !== pin.revision ||
  git("status", "--porcelain", "--untracked-files=no")
)
  throw Error("AI_BUTTON_PINNED_CLEAN_SOURCE_REQUIRED");
try {
  const existing = await inspectAiButtonModule(output);
  if (existing.revision !== pin.revision) throw Error("AI_BUTTON_EXISTING_MODULE_VERSION_DIFFERS");
  process.stdout.write(JSON.stringify({ output, reused: true, revision: pin.revision }) + "\n");
} catch (error) {
  // Refuse to replace any existing module, including a corrupt or loaded one.
  if (error.code !== "ENOENT") throw error;
  try {
    await fs.access(output);
    throw Error("AI_BUTTON_OUTPUT_ALREADY_EXISTS");
  } catch (missing) {
    if (missing.code !== "ENOENT") throw missing;
  }
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(source, "build.ps1")],
    { cwd: source, stdio: "inherit", windowsHide: true, timeout: 300000 },
  );
  const temporary = output + ".building-" + process.pid;
  await fs.mkdir(temporary, { recursive: true });
  const files = {};
  for (const file of aiButtonFiles) {
    const from = path.join(
      source,
      file.endsWith(".dll") || file.endsWith(".exe") ? "build" : "",
      file,
    );
    const target = path.join(temporary, file);
    const bytes = await fs.readFile(from);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: "wx" });
    files[file] = aiButtonDigest(bytes);
  }
  await fs.writeFile(
    path.join(temporary, "module.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        ...pin,
        loader: "SC2AILoader.exe",
        files,
        requirements: {
          node: ">=18.14 installed",
          provider: "Signed-in Codex or configured Claude API",
        },
        mcp: "Reuse the user's configured sc2editor MCP; no checkpoint fallback",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  await inspectAiButtonModule(temporary);
  await fs.rename(temporary, output);
  process.stdout.write(JSON.stringify({ output, reused: false, revision: pin.revision }) + "\n");
}
