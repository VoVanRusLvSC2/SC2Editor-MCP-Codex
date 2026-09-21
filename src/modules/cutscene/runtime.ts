import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { CutsceneSchemaRegistry } from "./schemaRegistry.js";

async function exists(file?: string): Promise<boolean> {
  if (!file) return false;
  try { await fs.access(file); return true; } catch { return false; }
}

export async function cutsceneRuntimeCapabilities(schema: CutsceneSchemaRegistry) {
  const editor = process.env.SC2_EDITOR_PATH ?? "C:\\Program Files (x86)\\StarCraft II\\Support64\\SC2Editor_x64.exe";
  const decompilation = process.env.SC2_EDITOR_DECOMPILATION ?? "E:\\SK2\\Decompilator Blizzards\\SC_editior_ksp.rep";
  const adapter = process.env.SC2_CUTSCENE_RUNTIME_ADAPTER;
  return {
    editor: { path: editor, available: await exists(editor) },
    decompilation: { path: decompilation, available: await exists(decompilation) },
    runtimeAdapter: { path: adapter, available: await exists(adapter) },
    indexedGalaxyFunctions: schema.data.runtime.functions.length,
    indexedGalaxyConstants: schema.data.runtime.constants.length,
    editorValidation: await exists(editor) ? "AVAILABLE_NOT_AUTOMATICALLY_RUN" : "UNAVAILABLE",
    runtimeValidation: adapter && await exists(adapter) ? "AVAILABLE" : "UNAVAILABLE",
  };
}

export async function runCutsceneRuntimeAdapter(workspace: string, file: string, timeoutMs = 900_000) {
  const adapter = process.env.SC2_CUTSCENE_RUNTIME_ADAPTER;
  if (!adapter) throw new Error("SC2_CUTSCENE_RUNTIME_ADAPTER is not configured");
  return new Promise<{ adapter: string; exitCode: number | null; timedOut: boolean; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(adapter, ["validate", "--workspace", path.resolve(workspace), "--cutscene", file], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode) => { clearTimeout(timer); resolve({ adapter, exitCode, timedOut, stdout, stderr }); });
  });
}

export function generateCutsceneTrigger(
  schema: CutsceneSchemaRegistry,
  options: { cutscenePath: string; positionExpression: string; playersExpression: string; autoPlay: boolean; variable?: string },
) {
  const variable = options.variable ?? "gv_cutscene";
  const functions = new Set(schema.data.runtime.functions.map((entry) => entry.name));
  const required = ["CutsceneCreate", "CutsceneLastCreated", "CutscenePlay"];
  const missing = required.filter((name) => !functions.has(name));
  if (missing.length) throw new Error(`Runtime registry does not contain ${missing.join(", ")}. Re-run discovery with the installed natives.galaxy; trigger code will not be guessed.`);
  const createSignature = schema.data.runtime.functions.find((entry) => entry.name === "CutsceneCreate")?.signature ?? "";
  if (!/CutsceneCreate\s*\(\s*string\b[^,]*,\s*point\b[^,]*,\s*playergroup\b[^,]*,\s*bool\b[^)]*\)/.test(createSignature)) {
    throw new Error(`Indexed CutsceneCreate signature is not the supported four-argument form: ${createSignature}`);
  }
  const escapedPath = options.cutscenePath.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  return {
    language: "Galaxy",
    source: `CutsceneCreate("${escapedPath}", ${options.positionExpression}, ${options.playersExpression}, ${options.autoPlay ? "true" : "false"});\n${variable} = CutsceneLastCreated();\nCutscenePlay(${variable});`,
    usedFunctions: required,
    signatures: required.map((name) => schema.data.runtime.functions.find((entry) => entry.name === name)?.signature),
  };
}
