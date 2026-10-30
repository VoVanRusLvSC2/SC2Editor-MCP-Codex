import { performance } from "node:perf_hooks";

/** Request-local measurements; neither payload size nor model billing. */
export class DataTiming {
  private readonly started = performance.now();
  private readonly stages: Record<string, number> = {};

  run<T>(name: string, work: () => T): T {
    const started = performance.now();
    try {
      return work();
    } finally {
      this.add(name, started);
    }
  }

  async measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await work();
    } finally {
      this.add(name, started);
    }
  }

  private add(name: string, started: number): void {
    this.stages[name] = (this.stages[name] ?? 0) + performance.now() - started;
  }

  report() {
    return {
      elapsedMs: Math.round(performance.now() - this.started),
      stagesMs: Object.fromEntries(
        Object.entries(this.stages).map(([key, value]) => [key, Math.round(value)]),
      ),
      scope:
        "Data operation stages; nested stage durations must not be added to tool/parent durations",
    };
  }
}
