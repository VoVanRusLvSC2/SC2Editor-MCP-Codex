import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

async function run(name: string, args: string[]) {
  console.log(JSON.stringify({ running: name }));
  return new Promise<{ name: string; exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
    child.on("error", reject); child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("exit", (exitCode) => resolve({ name, exitCode, stdout, stderr }));
  });
}
const checks = [];
checks.push(await run("typescript-build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"]));
if (checks[0]!.exitCode === 0) {
  const tests = (await fs.readdir("dist/tests")).filter((file) => file.endsWith(".test.js")).sort().map((file) => `dist/tests/${file}`);
  checks.push(await run("all-automated-tests", ["--test", ...tests]));
  checks.push(await run("eslint", ["node_modules/eslint/bin/eslint.js", "src", "scripts"]));
  checks.push(await run("gui-js-syntax", ["--check", "src/gui/public/app.js"]));
  checks.push(await run("ai-tool-json-schemas", ["--import", "tsx", "scripts/generate-ai-schemas.ts"]));
  checks.push(await run("ui-schema-audit", ["--import", "tsx", "scripts/audit-schema-coverage.ts"]));
  checks.push(await run("windows-portable-cross-build", ["scripts/build-windows-portable.mjs"]));
}
const testOutput = checks.find((check) => check.name === "all-automated-tests")?.stdout ?? "";
const testSummary = Object.fromEntries(["tests", "pass", "fail", "skipped"].map((name) => [name, Number(testOutput.match(new RegExp(`(?:#|ℹ) ${name} (\\d+)`))?.[1] ?? NaN)]));
const evidence = JSON.parse(await fs.readFile("generated/ai-editor-evidence.json", "utf8"));
const report = { version: "1.1.0-alpha.7", executedAt: new Date().toISOString(), platform: process.platform, checks, testSummary,
  aiSource: "/workspace/scratch/0f9999397929/sc2editor-mcp-ai-work/project/sc2-ui-mcp-starter",
  coreWorkspaceChanged: false, triggerEditing: false, terrainEditing: false,
  evidence: { file: "generated/ai-editor-evidence.json", executable: evidence.executable, sha256: evidence.sha256, tokens: evidence.tokens.length, missing: evidence.missing },
  xmlRegression: "EXECUTED; original extracted empty/Definition CustomAI + synthetic populated waves",
  populatedEditorWaveRoundTrip: "NOT_EXECUTED", editorOpen: "NOT_EXECUTED", editorSave: "NOT_EXECUTED", visual: "NOT_EXECUTED", runtime: "NOT_EXECUTED", windowsLauncherExecution: "NOT_EXECUTED", guiBrowserVisual: "NOT_EXECUTED" };
await fs.writeFile("generated/ai-migration-test-report.json", JSON.stringify(report, null, 2) + "\n");
if (checks.find((check) => check.name === "windows-portable-cross-build")?.exitCode === 0) {
  await fs.copyFile("generated/ai-migration-test-report.json", "release/SC2-UI-Workbench-Windows/app/generated/ai-migration-test-report.json");
  await fs.copyFile("generated/ai-migration-test-report.json", "release/SC2-UI-Workbench-Windows/generated/ai-migration-test-report.json");
}
console.log(JSON.stringify({ file: "generated/ai-migration-test-report.json", checks: checks.map((check) => ({ name: check.name, exitCode: check.exitCode })), testSummary }, null, 2));
if (checks.some((check) => check.exitCode !== 0)) process.exitCode = 1;
