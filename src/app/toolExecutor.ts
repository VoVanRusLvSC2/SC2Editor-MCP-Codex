import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { ToolTelemetry } from "./telemetry.js";

export type ToolCallback = (args: unknown, context: unknown) => unknown | Promise<unknown>;
export interface InvocationSpan {
  spanId: string;
  parentSpanId?: string;
  origin: "direct" | "internal";
}

/** Both MCP and batch invocations pass through this boundary after schema parsing. */
export class ToolExecutor {
  private readonly spans = new AsyncLocalStorage<InvocationSpan>();
  private sequence = 0;

  constructor(private readonly telemetry: Pick<ToolTelemetry, "record">) {}

  async invoke(
    name: string,
    callback: ToolCallback,
    args: unknown,
    context: unknown,
    origin: InvocationSpan["origin"],
  ): Promise<unknown> {
    const parent = this.spans.getStore();
    const span: InvocationSpan = {
      spanId: String(++this.sequence),
      origin,
      ...(parent ? { parentSpanId: parent.spanId } : {}),
    };
    return this.spans.run(span, async () => {
      const start = performance.now();
      try {
        const result = await callback(args, context);
        this.telemetry.record(name, args, result, performance.now() - start, span);
        return result;
      } catch (error) {
        this.telemetry.record(
          name,
          args,
          {
            isError: true,
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
          },
          performance.now() - start,
          span,
        );
        throw error;
      }
    });
  }
}
