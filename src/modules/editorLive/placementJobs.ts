import { randomUUID } from "node:crypto";
import * as z from "zod/v4";
import { createPlacementGroup, placementJobSchema } from "./placementGroup.js";
import type { LivePlacement } from "./placement.js";
import type { LiveDocument } from "./document.js";

export const placementJobStartSchema = placementJobSchema.safeExtend({
  saveOnComplete: z.boolean().default(false),
});
type Input = z.input<typeof placementJobStartSchema>;
type Job = {
  id: string;
  status: "running" | "applied" | "stopped" | "cancelled";
  total: number;
  completed: unknown[];
  cancelRequested: boolean;
  phase: "placing" | "saving";
  result?: unknown;
  save?: Awaited<ReturnType<LiveDocument["save"]>>;
};

/** Process-local, single-flight sequence. A submitted native edit is never replayed. */
export class LivePlacementJobs {
  private readonly jobs = new Map<string, Job>();
  private active?: Promise<void>;
  private activeId?: string;
  private closed = false;

  constructor(
    private readonly placement: Pick<
      LivePlacement,
      "prepare" | "inspect" | "catalog" | "create" | "checkGroupCapacity"
    >,
    private readonly document: Pick<LiveDocument, "status" | "save">,
    private readonly enter: <T>(fn: () => Promise<T>) => Promise<T>,
    private readonly blocked: () => boolean,
  ) {}

  get busy() {
    return this.activeId !== undefined;
  }

  start(input: Input) {
    const { saveOnComplete, ...args } = placementJobStartSchema.parse(input);
    if (this.closed || this.busy || this.blocked()) throw Error("LIVE_PLACEMENT_JOB_BUSY");
    while (this.jobs.size >= 16) this.jobs.delete(this.jobs.keys().next().value!);
    const job: Job = {
      id: randomUUID(),
      status: "running",
      total: args.objects.length,
      completed: [],
      cancelRequested: false,
      phase: "placing",
    };
    this.jobs.set(job.id, job);
    this.activeId = job.id;
    this.active = Promise.resolve()
      .then(() =>
        this.enter(async () => {
          try {
            const result = await createPlacementGroup(this.placement, args, {
              cancelled: () => job.cancelRequested,
              progress: (completed) => {
                job.completed = completed;
              },
            });
            job.result = result;
            job.completed = result.completed;
            job.status =
              result.status === "applied"
                ? "applied"
                : result.status === "cancelled"
                  ? "cancelled"
                  : "stopped";
            if (job.status === "applied" && saveOnComplete && !job.cancelRequested) {
              // Save once, in the same file, only after every placement succeeded.
              // An exception or uncertain acknowledgement is never retried.
              job.status = "running";
              job.phase = "saving";
              const target = { archive: args.archive, windowId: args.windowId };
              const current = await this.document.status(target);
              const saved = await this.document.save({ ...target, expectedSha256: current.sha256 });
              job.save = saved;
              job.status =
                (saved.status === "saved" || saved.status === "already_clean") &&
                !("savedUiBufferError" in saved && saved.savedUiBufferError)
                  ? "applied"
                  : "stopped";
            }
          } catch (error) {
            job.status = "stopped";
            job.result = {
              status: "stopped",
              error: String(error),
              retryMutation: false,
              recovery: "Inspect the current document and Save state before any retry.",
            };
          } finally {
            this.activeId = undefined;
          }
        }),
      )
      .catch((error) => {
        job.status = "stopped";
        job.result = { status: "stopped", error: String(error), retryMutation: false };
        this.activeId = undefined;
      });
    return {
      jobId: job.id,
      status: job.status,
      total: job.total,
      processLocal: true,
      saved: false,
      copiesCreated: 0,
    };
  }

  status(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) throw Error("LIVE_PLACEMENT_JOB_NOT_FOUND");
    return {
      jobId: job.id,
      status: job.status,
      total: job.total,
      completed: job.completed,
      cancelRequested: job.cancelRequested,
      phase: job.phase,
      ...(job.result === undefined ? {} : { result: job.result }),
      ...(job.save === undefined ? {} : { save: job.save }),
      saved:
        job.save?.status === "saved" ? true : job.save?.status === "unknown" ? "unknown" : false,
      processLocal: true,
      copiesCreated: 0,
    };
  }

  cancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) throw Error("LIVE_PLACEMENT_JOB_NOT_FOUND");
    if (job.status === "running") job.cancelRequested = true;
    return this.status(jobId);
  }

  async close() {
    this.closed = true;
    if (this.activeId) this.jobs.get(this.activeId)!.cancelRequested = true;
    await this.active;
  }
}
