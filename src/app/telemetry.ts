import type { InvocationSpan } from "./toolExecutor.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
let worker: Worker | undefined,
  nextWorkerId = 0;
const pendingTokens = new Map<
  number,
  (value: { input: number | null; output: number | null }) => void
>();
function measureText(
  input: string,
  output: string,
): Promise<{ input: number | null; output: number | null }> {
  if (!worker) {
    worker = new Worker(new URL("./tokenWorker.js", import.meta.url));
    worker.on("message", (message) => {
      const resolve = pendingTokens.get(message.id);
      pendingTokens.delete(message.id);
      resolve?.(message);
      if (!pendingTokens.size) worker?.unref();
    });
    worker.on("error", () => {
      for (const resolve of pendingTokens.values()) resolve({ input: null, output: null });
      pendingTokens.clear();
      worker = undefined;
    });
    worker.unref();
  }
  const id = ++nextWorkerId;
  worker.ref();
  return new Promise((resolve) => {
    pendingTokens.set(id, resolve);
    worker!.postMessage({ id, input, output });
  });
}
export interface ToolMetric {
  at: string;
  tool: string;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
  inputTextTokens: number | null;
  outputTextTokens: number | null;
  tokenCountStatus?: "counted" | "over_budget" | "failed";
  isError: boolean;
  encoding: "o200k_base";
  actualModelUsage: null;
  spanId?: string;
  parentSpanId?: string;
  origin?: "direct" | "internal";
}
export class ToolTelemetry {
  private records: ToolMetric[] = [];
  private pending = Promise.resolve();
  readonly file: string;
  constructor(root: string) {
    this.file = path.join(root, ".sc2mcp-telemetry", "tools.jsonl");
  }
  record(tool: string, args: unknown, result: unknown, durationMs: number, span?: InvocationSpan) {
    const input = JSON.stringify(args) ?? "null",
      output =
        (result as { content?: Array<{ type: string; text?: string }> })?.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n") ??
        JSON.stringify(result) ??
        "null";
    const metric: ToolMetric = {
      at: new Date().toISOString(),
      tool,
      durationMs: Number(durationMs.toFixed(3)),
      inputBytes: Buffer.byteLength(input),
      outputBytes: Buffer.byteLength(output),
      inputTextTokens: null,
      outputTextTokens: null,
      isError: !!(result as { isError?: boolean })?.isError,
      encoding: "o200k_base",
      actualModelUsage: null,
      ...span,
    };
    this.records.push(metric);
    if (this.records.length > 2000) this.records.shift();
    this.pending = this.pending
      .then(async () => {
        if (metric.inputBytes + metric.outputBytes > 1024 * 1024)
          metric.tokenCountStatus = "over_budget";
        else {
          const counted = await measureText(input, output);
          metric.inputTextTokens = counted.input;
          metric.outputTextTokens = counted.output;
          metric.tokenCountStatus =
            counted.input === null || counted.output === null ? "failed" : "counted";
        }
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.appendFile(this.file, JSON.stringify(metric) + "\n");
      })
      .catch(() => undefined);
    return metric;
  }
  async summary() {
    await this.pending;
    let rows = this.records;
    try {
      const stat = await fs.stat(this.file);
      if (stat.size <= 8 * 1024 * 1024)
        rows = (await fs.readFile(this.file, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((s) => JSON.parse(s));
    } catch {
      /* In-memory metrics remain available. */
    }
    const internal = rows.filter((row) => row.origin === "internal");
    rows = rows.filter((row) => row.origin !== "internal");
    const groups = new Map<
      string,
      {
        tool: string;
        calls: number;
        durationMs: number;
        inputTextTokens: number;
        outputTextTokens: number;
        unmeasured: number;
        errors: number;
      }
    >();
    for (const m of rows) {
      let g = groups.get(m.tool);
      if (!g) {
        g = {
          tool: m.tool,
          calls: 0,
          durationMs: 0,
          inputTextTokens: 0,
          outputTextTokens: 0,
          unmeasured: 0,
          errors: 0,
        };
        groups.set(m.tool, g);
      }
      g.calls++;
      g.durationMs += m.durationMs;
      g.inputTextTokens += m.inputTextTokens ?? 0;
      g.outputTextTokens += m.outputTextTokens ?? 0;
      g.unmeasured += Number(m.inputTextTokens === null || m.outputTextTokens === null);
      g.errors += Number(m.isError);
    }
    return {
      scope:
        "Parsed MCP argument JSON and text response bodies only. Excludes system/tool schemas, assistant reasoning, user messages, images and model billing. Internal calls are reported separately and excluded from model-facing payload totals; nested durations are inclusive, not wall time. Payloads above 1 MiB skip tokenization and still record bytes/duration.",
      actualModelUsage: null,
      internalCalls: internal.length,
      internalDurationMs: internal.reduce((n, m) => n + m.durationMs, 0),
      encoding: "o200k_base",
      calls: rows.length,
      inputTextTokens: rows.reduce((n, m) => n + (m.inputTextTokens ?? 0), 0),
      outputTextTokens: rows.reduce((n, m) => n + (m.outputTextTokens ?? 0), 0),
      overBudgetTokenCounts: rows.filter((m) => m.tokenCountStatus === "over_budget").length,
      tools: [...groups.values()].sort((a, b) => b.outputTextTokens - a.outputTextTokens),
      logFile: this.file,
      payloadTextStored: false,
    };
  }
}
