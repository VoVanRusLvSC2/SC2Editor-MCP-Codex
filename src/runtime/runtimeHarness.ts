import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { xmlEscape } from "../core/layoutDocument.js";
import { SchemaRegistry } from "../schema/schemaRegistry.js";

export interface RuntimeProbeEntry {
  frameType: string;
  frameClass: string;
  file: string;
  template?: string;
  restricted: boolean;
  expected: "load" | "runtime-uncertain";
}

export interface RuntimeProbeManifest {
  protocol: "sc2-ui-runtime-corpus-v1";
  generatedAt: string;
  frameTypes: number;
  entries: RuntimeProbeEntry[];
}

export interface RuntimeAdapterReport {
  adapter: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export async function generateRuntimeCorpus(schema: SchemaRegistry, outputDirectory: string): Promise<RuntimeProbeManifest> {
  const root = path.resolve(outputDirectory);
  const layouts = path.join(root, "UI", "Layout", "RuntimeCorpus");
  await fs.mkdir(layouts, { recursive: true });
  const frameTypes = schema.query({ kind: "frameType", limit: 2000 }) as Array<{ name: string }>;
  const entries: RuntimeProbeEntry[] = [];

  for (const [index, row] of frameTypes.entries()) {
    const type = schema.getFrameType(row.name)!;
    const directTemplate = schema.queryBlizzardTemplates({ frameType: type.name, limit: 1 })[0];
    const fileName = `${String(index + 1).padStart(4, "0")}_${type.name.replace(/[^A-Za-z0-9_.-]/g, "_")}.SC2Layout`;
    const relative = `UI/Layout/RuntimeCorpus/${fileName}`;
    const template = directTemplate?.reference;
    const attrs = [
      `type="${xmlEscape(type.name)}"`,
      `name="Probe_${String(index + 1).padStart(4, "0")}"`,
      ...(template ? [`template="${xmlEscape(template)}"`] : []),
    ];
    const source = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n    <Frame ${attrs.join(" ")}>\n    </Frame>\n</Desc>\n`;
    await fs.writeFile(path.join(layouts, fileName), source, "utf8");
    entries.push({
      frameType: type.name,
      frameClass: type.classType,
      file: relative,
      template,
      restricted: type.blizzardOnly,
      expected: type.blizzardOnly ? "runtime-uncertain" : "load",
    });
  }

  const includes = entries.map((entry) => `    <Include path="${xmlEscape(entry.file)}"/>`).join("\n");
  await fs.writeFile(path.join(root, "UI", "Layout", "RuntimeCorpusIndex.SC2Layout"),
    `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<Desc>\n${includes}\n</Desc>\n`, "utf8");
  const manifest: RuntimeProbeManifest = {
    protocol: "sc2-ui-runtime-corpus-v1",
    generatedAt: new Date().toISOString(),
    frameTypes: entries.length,
    entries,
  };
  await fs.writeFile(path.join(root, "runtime-corpus.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function runRuntimeAdapter(
  workspace: string,
  manifest: string,
  options: { adapter?: string; timeoutMs?: number } = {},
): Promise<RuntimeAdapterReport> {
  const adapter = options.adapter ?? process.env.SC2_UI_RUNTIME_ADAPTER;
  if (!adapter) throw new Error("SC2_UI_RUNTIME_ADAPTER is not configured");
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  return new Promise((resolve, reject) => {
    const child = spawn(adapter, ["probe", "--workspace", path.resolve(workspace), "--manifest", path.resolve(manifest)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ adapter, exitCode, timedOut, stdout, stderr });
    });
  });
}
