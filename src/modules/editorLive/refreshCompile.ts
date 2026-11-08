/** Compose existing snapshot, native job and verified adoption boundaries. */
export interface RefreshCompilerPort {
  snapshot(sessionId: string): Promise<{ archive: string; sha256: string }>;
  submit(archive: string): Promise<{ id: string }>;
  job(id: string): {
    state: string;
    phase?: string;
    result?: {
      outcome?: string;
      galaxy?: { error?: string };
      checks?: { compile?: { error?: string; diagnostics?: { compilerErrors?: unknown } } };
      report?: string;
    };
    error?: string;
  };
  adopt(sessionId: string, jobId: string): Promise<unknown>;
  current(sessionId: string): Promise<boolean>;
  active(sessionId: string): boolean;
}

type Run = {
  state:
    | "starting"
    | "queued"
    | "failed"
    | "unknown"
    | "adopting"
    | "adopted"
    | "checking"
    | "adoption_unknown";
  jobId?: string;
  sha256?: string;
  receipt?: unknown;
  error?: string;
  compilerErrors?: Array<{ message: string; line?: string; file?: string }>;
  reportFile?: string;
};

/** Keep only bounded native compiler messages; missing diagnostics stay unknown. */
function compilerMessages(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.message !== "string") return [];
    return [
      {
        message: row.message.slice(0, 1000),
        ...(typeof row.line === "string" && { line: row.line.slice(0, 64) }),
        ...(typeof row.file === "string" && { file: row.file.slice(0, 512) }),
      },
    ];
  });
}

export class RefreshCompiler {
  private readonly runs = new Map<string, Run>();
  constructor(private readonly port: RefreshCompilerPort) {}

  async begin(sessionId: string, retryFailed = false) {
    const previous = this.runs.get(sessionId);
    if (previous?.state === "failed" && retryFailed) {
      this.runs.delete(sessionId);
    } else if (previous?.state === "adopted") {
      previous.state = "checking";
      try {
        if (await this.port.current(sessionId)) {
          previous.state = "adopted";
          return { status: "prepared", sessionId, jobId: previous.jobId, retryMutation: false };
        }
        this.runs.delete(sessionId);
      } catch (error) {
        previous.state = "adopted";
        throw error;
      }
    } else if (previous)
      return {
        status:
          previous.state === "queued" ||
          previous.state === "starting" ||
          previous.state === "checking" ||
          previous.state === "adopting"
            ? "compile_pending"
            : previous.state === "failed"
              ? "compile_failed"
              : previous.state,
        sessionId,
        jobId: previous.jobId,
        error: previous.error,
        compilerErrors: previous.compilerErrors,
        reportFile: previous.reportFile,
        retryMutation: false,
      };
    if (this.runs.size >= 128) {
      // Only discard terminal jobs whose prepared session has been consumed or
      // released. Uncertain jobs must survive so they cannot be replayed.
      for (const [id, item] of this.runs) {
        if ((item.state === "adopted" || item.state === "failed") && !this.port.active(id)) {
          this.runs.delete(id);
          if (this.runs.size < 128) break;
        }
      }
      if (this.runs.size >= 128) throw Error("LIVE_REFRESH_COMPILE_RUN_LIMIT");
    }
    const run: Run = { state: "starting" };
    this.runs.set(sessionId, run);
    let snapshot: { archive: string; sha256: string };
    try {
      snapshot = await this.port.snapshot(sessionId);
    } catch (error) {
      this.runs.delete(sessionId);
      throw error;
    }
    run.sha256 = snapshot.sha256;
    try {
      const job = await this.port.submit(snapshot.archive);
      run.jobId = job.id;
      run.state = "queued";
      return {
        status: "compile_pending",
        sessionId,
        jobId: job.id,
        sourceSha256: snapshot.sha256,
        retryMutation: false,
      };
    } catch (error) {
      run.state = "unknown";
      return {
        status: "unknown",
        sessionId,
        sourceSha256: snapshot.sha256,
        error: String(error),
        retryMutation: false,
      };
    }
  }

  async finish(sessionId: string, waitMs = 0) {
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30000)
      throw Error("LIVE_REFRESH_COMPILE_WAIT_INVALID");
    const run = this.runs.get(sessionId);
    if (!run) throw Error("LIVE_REFRESH_COMPILE_RUN_MISSING");
    if (run.state === "adopted") {
      run.state = "checking";
      let current: boolean;
      try {
        current = await this.port.current(sessionId);
      } finally {
        run.state = "adopted";
      }
      if (!current)
        return { status: "compile_stale", sessionId, jobId: run.jobId, retryMutation: false };
      return {
        status: "prepared",
        sessionId,
        jobId: run.jobId,
        adopted: true,
        nativeCompilePassed: true,
        gameplayVerified: false,
        receipt: run.receipt,
      };
    }
    if (run.state !== "queued" || !run.jobId)
      return {
        status:
          run.state === "starting" || run.state === "checking" || run.state === "adopting"
            ? "compile_pending"
            : run.state === "failed"
              ? "compile_failed"
              : run.state,
        sessionId,
        jobId: run.jobId,
        error: run.error,
        compilerErrors: run.compilerErrors,
        reportFile: run.reportFile,
        retryMutation: false,
      };
    const deadline = performance.now() + waitMs;
    let job = this.port.job(run.jobId);
    while (!["completed", "failed"].includes(job.state)) {
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        return {
          status: "compile_pending",
          sessionId,
          jobId: run.jobId,
          phase: job.phase,
          retryMutation: false,
        };
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
      if (run.state !== "queued")
        return {
          status:
            run.state === "checking" || run.state === "adopting" || run.state === "adopted"
              ? "compile_pending"
              : run.state === "failed"
                ? "compile_failed"
                : run.state,
          sessionId,
          jobId: run.jobId,
          error: run.error,
          compilerErrors: run.compilerErrors,
          reportFile: run.reportFile,
          retryMutation: false,
        };
      job = this.port.job(run.jobId);
    }
    if (job.state === "failed" || job.result?.outcome === "failed") {
      run.state = "failed";
      run.error = job.error ?? job.result?.galaxy?.error ?? job.result?.checks?.compile?.error;
      run.compilerErrors = compilerMessages(
        job.result?.checks?.compile?.diagnostics?.compilerErrors,
      );
      run.reportFile = job.result?.report;
      return {
        status: "compile_failed",
        sessionId,
        jobId: run.jobId,
        error: run.error,
        compilerErrors: run.compilerErrors,
        reportFile: run.reportFile,
        retryMutation: false,
      };
    }
    if (job.result?.outcome !== "passed") {
      run.state = "unknown";
      return { status: "unknown", sessionId, jobId: run.jobId, retryMutation: false };
    }
    run.state = "adopting";
    try {
      run.receipt = await this.port.adopt(sessionId, run.jobId);
      run.state = "adopted";
      return {
        status: "prepared",
        sessionId,
        jobId: run.jobId,
        adopted: true,
        nativeCompilePassed: true,
        gameplayVerified: false,
        receipt: run.receipt,
      };
    } catch (error) {
      run.state = "adoption_unknown";
      return {
        status: "adoption_unknown",
        sessionId,
        jobId: run.jobId,
        error: String(error),
        retryMutation: false,
      };
    }
  }
}
